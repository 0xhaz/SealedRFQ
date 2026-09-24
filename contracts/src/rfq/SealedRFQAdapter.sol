// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IACPHook} from "../core/IACPHook.sol";
import {IAgenticCommerce} from "../core/IAgenticCommerce.sol";
import {IAttestationLog} from "../interfaces/IAttestationLog.sol";
import {ISealedRFQAdapter} from "../interfaces/ISealedRFQAdapter.sol";
import {PullPayments} from "../lib/PullPayments.sol";
import {AttestationKinds, Roles} from "../governance/Roles.sol";

/// @title SealedRFQAdapter
/// @notice Milestone settlement for awarded RFQs, built around an ERC-8183 AgenticCommerce instance.
///         See ISealedRFQAdapter for the money flow. Neither party can hold the other hostage: a
///         silent buyer is overridden by auto-release, a silent supplier by the delivery deadline,
///         and a contested rejection goes to the ARBITER.
/// @dev Accounting invariant: `totalHeld + totalWithdrawable == settlementToken.balanceOf(this)`
///      (`>=` transiently if someone calls AgenticCommerce.claimRefund directly before settleExpired).
///      Hook callbacks are not `nonReentrant`: they run inside the adapter's own calls into ACP and
///      only record the submission.
contract SealedRFQAdapter is ISealedRFQAdapter, IACPHook, PullPayments, AccessControl {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_MILESTONES = 10;

    /// @notice `reason` recorded when a milestone releases because the buyer stayed silent.
    bytes32 public constant AUTO_RELEASE = "AUTO_RELEASE";
    /// @notice `reason` recorded when a delivered milestone's job expired unreviewed.
    bytes32 public constant EXPIRED_AFTER_SUBMIT = "EXPIRED_AFTER_SUBMIT";
    /// @notice Recorded when a delivery window closed with nothing submitted.
    bytes32 public constant NOT_DELIVERED = "NOT_DELIVERED";

    IAgenticCommerce public immutable acp;
    IAttestationLog public immutable attestationLog;

    mapping(uint256 rfqId => Engagement) internal _eng;
    mapping(uint256 rfqId => uint16[]) internal _milestones;
    mapping(uint256 jobId => uint256 rfqId) public jobToRfq;
    uint256 public totalHeld;

    constructor(IERC20 usdc, IAgenticCommerce acp_, IAttestationLog attestationLog_, address admin)
        PullPayments(usdc)
    {
        if (address(acp_) == address(0) || address(attestationLog_) == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        if (acp_.paymentToken() != address(usdc)) revert InvalidTerms();
        acp = acp_;
        attestationLog = attestationLog_;
        _grantRole(Roles.ADMIN, admin);
    }

    // ─────────────────────────── start ───────────────────────────

    function startEngagement(uint256 rfqId, EngagementTerms calldata t)
        external
        onlyRole(Roles.REGISTRY)
        nonReentrant
    {
        Engagement storage e = _eng[rfqId];
        if (e.status != EngagementStatus.None) revert AlreadyStarted(rfqId);
        _validateTerms(t);

        e.buyer = t.buyer;
        e.supplier = t.supplier;
        e.status = EngagementStatus.Active;
        e.milestoneCount = uint8(t.milestoneBps.length);
        e.retentionBps = t.retentionBps;
        e.deliveryWindow = t.deliveryWindow;
        e.acceptanceWindow = t.acceptanceWindow;
        e.transitWindow = t.transitWindow;
        e.excessCost = t.excessCost;
        e.price = t.price;
        e.buyerStake = t.buyerStake;
        e.performanceStake = t.performanceStake;
        _milestones[rfqId] = t.milestoneBps;

        uint256 total = uint256(t.price) + t.buyerStake + t.performanceStake;
        _pullIn(msg.sender, total);
        totalHeld += total;

        emit EngagementStarted(rfqId, t.buyer, t.supplier, t.price, e.milestoneCount);
        _fundCurrent(rfqId, e);
    }

    // ─────────────────────────── review ───────────────────────────

    /// @notice Buyer, or a VERIFIER whose `reason` is an attested MILESTONE_ACCEPT memo.
    function acceptMilestone(uint256 rfqId, bytes32 reason) external nonReentrant {
        Engagement storage e = _active(rfqId);
        _requireReviewer(rfqId, e, reason, AttestationKinds.MILESTONE_ACCEPT);
        if (e.submittedAt == 0) revert WrongJobStatus();
        _release(rfqId, e, reason, false);
    }

    /// @notice Buyer, or an attested VERIFIER. Refusal to pay is a recorded act: `reason` is required.
    function rejectMilestone(uint256 rfqId, bytes32 reason) external nonReentrant {
        Engagement storage e = _active(rfqId);
        if (reason == bytes32(0)) revert ReasonRequired();
        _requireReviewer(rfqId, e, reason, AttestationKinds.MILESTONE_REJECT);
        if (e.submittedAt == 0) revert WrongJobStatus();

        uint256 jobId = e.currentJobId;
        acp.reject(jobId, reason, ""); // job budget refunds to this contract (the client)
        totalHeld += e.currentJobBudget;
        e.status = EngagementStatus.Rejected;
        e.disputeDeadline = uint64(block.timestamp + e.acceptanceWindow);
        emit MilestoneRejected(rfqId, e.currentMilestone, jobId, reason, msg.sender);
    }

    /// @notice Anyone. The buyer had `acceptanceWindow` after submission and said nothing.
    function autoRelease(uint256 rfqId) external nonReentrant {
        Engagement storage e = _active(rfqId);
        if (e.submittedAt == 0) revert WrongJobStatus();
        uint64 releasesAt = _releasesAt(e);
        if (block.timestamp < releasesAt) revert AcceptanceWindowOpen(releasesAt);
        _release(rfqId, e, AUTO_RELEASE, true);
    }

    /**
     * When silence starts paying the supplier.
     *
     * Two paths, and the difference matters for anything with a shipping container behind it. A
     * buyer who confirms receipt starts the inspection clock at that moment, so they get their full
     * window to examine what arrived. A buyer who says nothing is not allowed to block payment
     * forever — that would hand them the hostage position this contract exists to remove — so the
     * clock starts anyway once the transit allowance has run, as though the goods had arrived on
     * the last day they plausibly could.
     *
     * `transitWindow` is zero for anything delivered as a file, which makes this exactly the rule
     * it replaced.
     */
    function _releasesAt(Engagement storage e) internal view returns (uint64) {
        uint64 from = e.receivedAt == 0 ? e.submittedAt + e.transitWindow : e.receivedAt;
        return from + e.acceptanceWindow;
    }

    /**
     * @notice Buyer. Records that the goods arrived, which starts the inspection window.
     * @dev Deliberately not an acceptance and not a rejection: it says the shipment is here, not
     *      that it is right. A buyer who confirms receipt and then finds a problem still has their
     *      whole inspection window to reject, and confirming early is in their own interest because
     *      the alternative clock runs from a transit allowance they did not need.
     */
    function confirmReceipt(uint256 rfqId) external {
        Engagement storage e = _active(rfqId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender);
        if (e.submittedAt == 0) revert NothingSubmitted();
        if (e.receivedAt != 0) revert AlreadyReceived();
        e.receivedAt = uint64(block.timestamp);
        emit ReceiptConfirmed(rfqId, e.currentMilestone, e.receivedAt);
    }

    /**
     * @notice Buyer. Gives the supplier more time to deliver the current milestone.
     * @dev The answer to a manufacturer slipping, and the only one the contract can give: nothing
     *      else anywhere can move a delivery deadline. Buyer-only because it relaxes the buyer's
     *      own term, and only before the window shuts — an extension granted afterwards would be
     *      re-opening a forfeiture rather than preventing one, which is a different decision with
     *      a different remedy. Capped so the acceptance window still fits inside the job's life.
     */
    function extendDelivery(uint256 rfqId, uint64 newDeadline) external {
        Engagement storage e = _active(rfqId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender);
        if (block.timestamp > e.deliveryDeadline) revert DeliveryWindowClosed(e.deliveryDeadline);
        IAgenticCommerce.Job memory job = acp.getJob(e.currentJobId);
        // The job has to outlive the extended deadline plus a full transit and inspection, or the
        // supplier would be given time to deliver into a job that expires before they can be paid.
        // Subtracting only one acceptance window rather than two is deliberate: the second was
        // grace for someone to call autoRelease, and spending it on the extension is the trade the
        // buyer is making. Subtracting both leaves `latest` equal to the current deadline, which
        // makes every extension impossible — which is what it did before this comment existed.
        uint64 latest = uint64(job.expiredAt) - e.transitWindow - e.acceptanceWindow;
        if (newDeadline <= e.deliveryDeadline || newDeadline > latest) revert BadExtension(latest);
        e.deliveryDeadline = newDeadline;
        emit DeliveryExtended(rfqId, e.currentMilestone, newDeadline);
    }

    /// @notice Anyone. Resolves a job past `expiredAt` (ERC-8183 refunds it to this contract):
    ///         delivered work is paid anyway; missing work abandons the engagement to the buyer.
    function settleExpired(uint256 rfqId) external nonReentrant {
        Engagement storage e = _active(rfqId);
        uint256 jobId = e.currentJobId;
        IAgenticCommerce.Job memory job = acp.getJob(jobId);
        if (job.status == IAgenticCommerce.JobStatus.Funded && e.submittedAt == 0) {
            /*
             * Nothing was delivered and the window has shut, so there is nothing left to wait for.
             *
             * This used to wait out `job.expiredAt`, which sits a transit and two acceptance windows
             * beyond the delivery deadline — and in that gap the supplier could not submit, the
             * buyer could not accept or reject for want of a submission, and this reverted
             * `NotExpired`. A stretch of time in which the contract permitted nothing at all.
             *
             * `reject` closes it without touching ERC-8183: on a funded job it is the *evaluator's*
             * call, the adapter is its own evaluator, and it refunds the budget to the client, which
             * is also the adapter. So the money comes back the moment the deadline passes.
             */
            if (block.timestamp <= e.deliveryDeadline) {
                revert DeliveryWindowOpen(e.deliveryDeadline);
            }
            acp.reject(jobId, NOT_DELIVERED, "");
        } else if (
            job.status == IAgenticCommerce.JobStatus.Funded
                || job.status == IAgenticCommerce.JobStatus.Submitted
        ) {
            if (block.timestamp < job.expiredAt) revert NotExpired();
            acp.claimRefund(jobId);
        } else if (
            job.status != IAgenticCommerce.JobStatus.Expired
                && job.status != IAgenticCommerce.JobStatus.Rejected
        ) {
            revert WrongJobStatus();
        }
        uint128 refunded = e.currentJobBudget;
        totalHeld += refunded;

        if (e.submittedAt != 0) {
            e.currentJobBudget = 0;
            totalHeld -= refunded;
            _credit(e.supplier, refunded);
            emit MilestoneAccepted(rfqId, e.currentMilestone, jobId, EXPIRED_AFTER_SUBMIT, msg.sender, true);
            _advance(rfqId, e);
        } else {
            e.status = EngagementStatus.Abandoned;
            (uint256 toBuyer, uint256 toSupplier) = _abandon(e);
            _credit(e.buyer, toBuyer);
            if (toSupplier > 0) _credit(e.supplier, toSupplier);
            emit EngagementAbandoned(rfqId, toBuyer, toSupplier);
        }
    }

    // ─────────────────────────── disputes ───────────────────────────

    function raiseDispute(uint256 rfqId) external {
        Engagement storage e = _get(rfqId);
        if (e.status != EngagementStatus.Rejected) revert WrongStatus(e.status);
        if (msg.sender != e.supplier) revert NotSupplier(msg.sender);
        if (block.timestamp >= e.disputeDeadline) revert DisputeWindowClosed(e.disputeDeadline);
        e.status = EngagementStatus.Disputed;
        emit DisputeRaised(rfqId, msg.sender);
    }

    /// @notice Anyone, after an unchallenged rejection: the buyer is made whole, performance stake included.
    function finalizeRejection(uint256 rfqId) external nonReentrant {
        Engagement storage e = _get(rfqId);
        if (e.status != EngagementStatus.Rejected) revert WrongStatus(e.status);
        if (block.timestamp < e.disputeDeadline) revert DisputeWindowOpen(e.disputeDeadline);
        e.status = EngagementStatus.Resolved;
        uint256 pot = _drain(e);
        _credit(e.buyer, pot);
        emit RejectionFinalized(rfqId, pot);
    }

    /// @notice ARBITER splits everything still escrowed for the engagement in one call.
    function resolveDispute(uint256 rfqId, uint16 supplierBps, bytes32 reason)
        external
        onlyRole(Roles.ARBITER)
        nonReentrant
    {
        Engagement storage e = _get(rfqId);
        if (e.status != EngagementStatus.Disputed) revert WrongStatus(e.status);
        if (supplierBps > BPS) revert InvalidBps();
        e.status = EngagementStatus.Resolved;
        uint256 pot = _drain(e);
        uint256 toSupplier = (pot * supplierBps) / BPS;
        _credit(e.supplier, toSupplier);
        _credit(e.buyer, pot - toSupplier);
        emit DisputeResolved(rfqId, toSupplier, pot - toSupplier, reason);
    }

    // ─────────────────────────── ERC-8183 hook ───────────────────────────

    /// @dev Blocks late submissions: the delivery deadline is the adapter's, not the job's expiry.
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata) external view {
        if (msg.sender != address(acp)) revert OnlyAgenticCommerce();
        if (selector == IAgenticCommerce.submit.selector) {
            Engagement storage e = _eng[jobToRfq[jobId]];
            if (e.currentJobId == jobId && block.timestamp > e.deliveryDeadline) {
                revert DeliveryWindowClosed(e.deliveryDeadline);
            }
        }
    }

    /// @dev Records the submission time that starts the acceptance window.
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        if (msg.sender != address(acp)) revert OnlyAgenticCommerce();
        if (selector != IAgenticCommerce.submit.selector) return;
        uint256 rfqId = jobToRfq[jobId];
        Engagement storage e = _eng[rfqId];
        if (rfqId == 0 || e.currentJobId != jobId) return;
        (, bytes32 deliverable,) = abi.decode(data, (address, bytes32, bytes));
        e.submittedAt = uint64(block.timestamp);
        e.deliverable = deliverable;
        emit MilestoneSubmitted(rfqId, e.currentMilestone, jobId, deliverable);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || super.supportsInterface(interfaceId);
    }

    // ─────────────────────────── views ───────────────────────────

    function getEngagement(uint256 rfqId) external view returns (Engagement memory) {
        return _eng[rfqId];
    }

    function milestoneBps(uint256 rfqId) external view returns (uint16[] memory) {
        return _milestones[rfqId];
    }

    // ─────────────────────────── internal ───────────────────────────

    function _get(uint256 rfqId) internal view returns (Engagement storage e) {
        e = _eng[rfqId];
        if (e.status == EngagementStatus.None) revert NotFound(rfqId);
    }

    function _active(uint256 rfqId) internal view returns (Engagement storage e) {
        e = _get(rfqId);
        if (e.status != EngagementStatus.Active) revert WrongStatus(e.status);
    }

    function _requireReviewer(uint256 rfqId, Engagement storage e, bytes32 reason, bytes32 kind)
        internal
        view
    {
        if (msg.sender == e.buyer) return;
        if (!hasRole(Roles.VERIFIER, msg.sender)) revert NotBuyerOrVerifier(msg.sender);
        if (!attestationLog.isAttested(rfqId, reason, kind)) revert ReasonNotAttested(reason);
    }

    /// @dev Open the current milestone as a funded ERC-8183 job.
    function _fundCurrent(uint256 rfqId, Engagement storage e) internal {
        uint8 i = e.currentMilestone;
        uint128 gross = i + 1 == e.milestoneCount
            ? e.price - e.allocated
            : uint128((uint256(e.price) * _milestones[rfqId][i]) / BPS);
        uint128 retention = uint128((uint256(gross) * e.retentionBps) / BPS);
        uint128 budget = gross - retention;

        e.allocated += gross;
        e.retentionHeld += retention;
        e.currentRetention = retention;
        e.currentJobBudget = budget;
        e.submittedAt = 0;
        e.receivedAt = 0;
        e.deliverable = bytes32(0);
        uint64 deadline = uint64(block.timestamp + e.deliveryWindow);
        e.deliveryDeadline = deadline;

        // Expiry leaves room for the longest legitimate path to payment: deliver on the last
        // permitted day, goods spend the whole transit allowance in freight, then a full inspection
        // window — plus the same window again as grace for someone to call autoRelease before a
        // refund becomes possible. Without the transit term the job would expire while the buyer
        // was still entitled to be inspecting.
        uint256 expiredAt =
            uint256(deadline) + uint256(e.transitWindow) + 2 * uint256(e.acceptanceWindow);
        uint256 jobId =
            acp.createJob(e.supplier, address(this), expiredAt, _description(rfqId, i), address(this));
        jobToRfq[jobId] = rfqId;
        e.currentJobId = jobId;

        acp.setBudget(jobId, budget, "");
        settlementToken.forceApprove(address(acp), budget);
        acp.fund(jobId, "");
        totalHeld -= budget;

        emit MilestoneFunded(rfqId, i, jobId, budget, retention, deadline);
    }

    /// @dev Complete the current job (ACP pays the supplier) and move on.
    function _release(uint256 rfqId, Engagement storage e, bytes32 reason, bool automatic) internal {
        uint256 jobId = e.currentJobId;
        acp.complete(jobId, reason, "");
        e.currentJobBudget = 0;
        emit MilestoneAccepted(rfqId, e.currentMilestone, jobId, reason, msg.sender, automatic);
        _advance(rfqId, e);
    }

    function _advance(uint256 rfqId, Engagement storage e) internal {
        if (e.currentMilestone + 1 < e.milestoneCount) {
            e.currentMilestone++;
            _fundCurrent(rfqId, e);
            return;
        }
        // Final acceptance: retention + performance stake to the supplier, buyer stake back.
        uint256 toSupplier = uint256(e.retentionHeld) + e.performanceStake;
        uint256 toBuyer = e.buyerStake;
        e.retentionHeld = 0;
        e.performanceStake = 0;
        e.buyerStake = 0;
        e.status = EngagementStatus.Completed;
        totalHeld -= toSupplier + toBuyer;
        _credit(e.supplier, toSupplier);
        _credit(e.buyer, toBuyer);
        emit EngagementCompleted(rfqId, toSupplier, toBuyer);
    }

    /// @dev Everything still escrowed for the engagement (current job budget must be back here).
    /**
     * Split an abandoned engagement between the two sides.
     *
     * Money that was never earned goes back to the buyer without argument: milestones not opened,
     * the milestone not delivered, and their own stake. The question is what happens to the money
     * the supplier put at risk — their performance stake, and the retention withheld from
     * milestones the buyer already accepted.
     *
     * Taking all of it, whatever the buyer actually lost, is what this did before and it has no
     * precedent anywhere we could find. Every comparable instrument — liquidated damages, a bid
     * guarantee, a performance bond, retainage — is compensatory and capped: the security is
     * *available to offset* a real loss, and the surplus returns. FAR states the measure outright
     * as the difference between the offer price and the next higher acceptable offer, which is
     * exactly what a sealed-bid tender is in a position to know.
     *
     * So the at-risk fund covers what re-procuring would really have cost, and the remainder is
     * returned. Where nothing cheaper was ever revealed there is no alternative to measure against,
     * and the fund is forfeited whole — a security that evaporates because the loss is hard to
     * quantify would not be a security.
     */
    function _abandon(Engagement storage e) internal returns (uint256 toBuyer, uint256 toSupplier) {
        // Retention is withheld when a milestone opens, not when it is accepted, so the running
        // total includes the milestone that was never delivered. Only the part held back from work
        // the buyer actually accepted is the supplier's to have returned; the rest belongs with the
        // milestone it was taken from, and that milestone's money goes back to the buyer.
        uint256 earnedRetention = uint256(e.retentionHeld) - e.currentRetention;
        uint256 atRisk = uint256(e.performanceStake) + earnedRetention;
        uint256 damages = e.excessCost == 0 ? atRisk : Math.min(atRisk, uint256(e.excessCost));
        uint256 pot = _drain(e);
        toBuyer = pot - (atRisk - damages);
        toSupplier = atRisk - damages;
    }

    function _drain(Engagement storage e) internal returns (uint256 pot) {
        pot = uint256(e.price - e.allocated) + e.retentionHeld + e.currentJobBudget + e.performanceStake
            + e.buyerStake;
        e.allocated = e.price;
        e.retentionHeld = 0;
        e.currentJobBudget = 0;
        e.performanceStake = 0;
        e.buyerStake = 0;
        totalHeld -= pot;
    }

    function _validateTerms(EngagementTerms calldata t) internal pure {
        if (t.buyer == address(0) || t.supplier == address(0) || t.price == 0) revert InvalidTerms();
        if (t.retentionBps > BPS) revert InvalidBps();
        uint256 n = t.milestoneBps.length;
        if (n == 0 || n > MAX_MILESTONES) revert InvalidTerms();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            sum += t.milestoneBps[i];
        }
        if (sum != BPS) revert InvalidTerms();
    }

    function _description(uint256 rfqId, uint8 index) internal pure returns (string memory) {
        return string.concat(
            "SealedRFQ #", Strings.toString(rfqId), " milestone ", Strings.toString(uint256(index) + 1)
        );
    }
}
