// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SealedBid} from "./SealedBid.sol";
import {PullPayments} from "../lib/PullPayments.sol";
import {IAttestationLog} from "../interfaces/IAttestationLog.sol";
import {IProcurementPolicy} from "../interfaces/IProcurementPolicy.sol";
import {ISealedRFQAdapter} from "../interfaces/ISealedRFQAdapter.sol";
import {AttestationKinds, Roles} from "../governance/Roles.sol";

/// @title RFQRegistry
/// @notice SealedRFQ's entry point: buyers post funded RFQs, suppliers bid sealed, and an award,
///         checked by ProcurementPolicy and backed by an attested AI recommendation, hands the
///         escrow to SealedRFQAdapter for milestone settlement on ERC-8183.
/// @dev Settles in Arc USDC through its ERC-20 interface (6 decimals). Never `msg.value`.
contract RFQRegistry is SealedBid {
    using SafeERC20 for IERC20;

    IProcurementPolicy public immutable policy;
    IAttestationLog public immutable attestationLog;
    ISealedRFQAdapter public immutable adapter;

    mapping(address buyer => uint256) public buyerAwardedTotal;
    mapping(address buyer => mapping(address supplier => uint256)) public buyerSupplierAwarded;

    constructor(
        IERC20 usdc,
        IProcurementPolicy policy_,
        IAttestationLog attestationLog_,
        ISealedRFQAdapter adapter_,
        address admin
    ) PullPayments(usdc) {
        if (
            address(policy_) == address(0) || address(attestationLog_) == address(0)
                || address(adapter_) == address(0) || admin == address(0)
        ) revert ZeroAddress();
        policy = policy_;
        attestationLog = attestationLog_;
        adapter = adapter_;
        _grantRole(Roles.ADMIN, admin);
    }

    // ─────────────────────────── buyer ───────────────────────────

    /// @notice Create and fund an RFQ in one transaction: budget + buyer stake are escrowed before
    ///         any supplier can bid. Requires a prior USDC approval of `budget + stake`.
    function createRFQ(RFQParams calldata p) external nonReentrant returns (uint256) {
        return _create(p);
    }

    /// @notice Same as createRFQ, approving via an ERC-2612 permit for `budget + stake`.
    function createRFQWithPermit(RFQParams calldata p, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256)
    {
        _permit(uint256(p.budget) + _stakeOf(p), deadline, v, r, s);
        return _create(p);
    }

    function addInvitees(uint256 rfqId, address[] calldata invitees) external {
        RFQ storage r = _rfq(rfqId);
        if (msg.sender != r.buyer) revert NotBuyer(msg.sender);
        if (!r.inviteOnly) revert NotInviteOnly();
        _requirePhase(r, Phase.Bidding);
        if (invitees.length > MAX_INVITEES) revert TooManyInvitees();
        for (uint256 i; i < invitees.length; ++i) {
            _invited[rfqId][invitees[i]] = true;
        }
        emit InviteesAdded(rfqId, invitees);
    }

    /// @notice Buyer may withdraw an RFQ nobody has bid on yet.
    function cancelRFQ(uint256 rfqId) external nonReentrant {
        RFQ storage r = _rfq(rfqId);
        if (msg.sender != r.buyer) revert NotBuyer(msg.sender);
        if (r.status != Status.Open || r.commitCount != 0) revert CannotCancel();
        r.status = Status.Cancelled;
        _releaseEscrowToBuyer(r);
        emit RFQCancelled(rfqId);
    }

    // ─────────────────────────── award ───────────────────────────

    function award(uint256 rfqId, address winner, bytes32 evaluationHash, bytes32 rubricHash)
        external
        nonReentrant
    {
        RFQ storage r = _rfq(rfqId);
        _requirePhase(r, Phase.Award);
        if (msg.sender != r.buyer && !hasRole(Roles.AWARDER, msg.sender)) {
            revert NotAuthorizedToAward(msg.sender);
        }

        Bid storage b = _bids[rfqId][winner];
        if (!b.revealed) revert WinnerNotRevealed(winner);
        // Checked here rather than at reveal, deliberately. A bid quoting longer than the tender
        // allows is unawardable, but the supplier who placed it did so against a window they could
        // read and should not lose their deposit for it — and reverting their reveal would leave
        // them recorded as never having revealed, which is exactly how a deposit is forfeited.
        // Refusing the award instead makes the bid worthless without making it costly.
        if (r.deliveryWindow > 0 && b.deliverySeconds > r.deliveryWindow) {
            revert DeliveryExceedsWindow(b.deliverySeconds, r.deliveryWindow);
        }
        if (!attestationLog.isAttested(
                awardSubject(rfqId, winner), evaluationHash, AttestationKinds.AWARD_RECOMMENDATION
            )) {
            revert EvaluationNotAttested(evaluationHash);
        }

        address buyer = r.buyer;
        uint256 price = b.price;
        // A person spending their own money is not capped. An agent deciding unattended is: this is
        // the line between "the machine recommends" and "the machine commits", and it is the only
        // thing standing between an automated evaluation and a binding award on a supplier who
        // never dealt with a human. §6d and §6g of the work plan.
        if (msg.sender != r.buyer) {
            uint128 cap = policy.policy().agentAwardCap;
            if (price > cap) revert AgentAwardCapExceeded(price, cap);
        }
        policy.checkAward(
            IProcurementPolicy.AwardCheck({
                budget: r.budget,
                price: price,
                deposit: r.depositAmount,
                revealedBids: r.revealCount,
                rubricHash: rubricHash,
                expectedRubricHash: r.rubricHash,
                buyerAwardedTotal: buyerAwardedTotal[buyer],
                buyerSupplierTotal: buyerSupplierAwarded[buyer][winner]
            })
        );

        // effects
        r.status = Status.Awarded;
        r.winner = winner;
        r.awardPrice = uint128(price);
        r.evaluationHash = evaluationHash;
        b.deposit = DepositState.RolledOver;
        buyerAwardedTotal[buyer] += price;
        buyerSupplierAwarded[buyer][winner] += price;

        // money: unused budget back to the buyer; price + buyer stake + performance stake to adapter
        uint256 budget = r.budget;
        uint256 toAdapter = price + r.buyerStake + r.depositAmount;
        totalHeld -= budget + r.buyerStake + r.depositAmount;
        _credit(buyer, budget - price);
        settlementToken.forceApprove(address(adapter), toAdapter);
        adapter.startEngagement(
            rfqId,
            ISealedRFQAdapter.EngagementTerms({
                buyer: buyer,
                supplier: winner,
                price: uint128(price),
                buyerStake: r.buyerStake,
                performanceStake: r.depositAmount,
                retentionBps: r.retentionBps,
                deliveryWindow: r.deliveryWindow,
                acceptanceWindow: r.acceptanceWindow,
                transitWindow: r.transitWindow,
                // The next higher acceptable offer, which is the measure FAR uses for what a
                // default actually costs a buyer. Zero unless this award was the cheapest revealed
                // bid: if the buyer chose a dearer one on other criteria, a cheaper compliant
                // alternative existed, so re-procuring costs them nothing extra.
                excessCost: (price == r.lowestRevealed && r.secondLowestRevealed > r.lowestRevealed)
                    ? r.secondLowestRevealed - uint128(price)
                    : 0,
                milestoneBps: _milestones[rfqId]
            })
        );

        emit RFQAwarded(rfqId, winner, price, evaluationHash, msg.sender);
    }

    /// @notice Permissionless. Returns budget + buyer stake once no award can happen: after the award
    ///         deadline, or at the reveal deadline if fewer bids were revealed than policy requires.
    function closeNoAward(uint256 rfqId) external nonReentrant {
        RFQ storage r = _rfq(rfqId);
        if (r.status != Status.Open) revert WrongPhase(_phase(r));
        bool expired = block.timestamp >= r.awardDeadline;
        bool unawardable =
            block.timestamp >= r.revealDeadline && r.revealCount < policy.policy().minRevealedBids;
        if (!expired && !unawardable) revert WrongPhase(_phase(r));

        r.status = Status.NoAward;
        _releaseEscrowToBuyer(r);
        emit RFQClosedNoAward(rfqId);
    }

    // ─────────────────────────── views ───────────────────────────

    function getRFQ(uint256 rfqId) external view returns (RFQ memory) {
        return _rfqs[rfqId];
    }

    function getBid(uint256 rfqId, address bidder) external view returns (Bid memory) {
        return _bids[rfqId][bidder];
    }

    function milestoneBps(uint256 rfqId) external view returns (uint16[] memory) {
        return _milestones[rfqId];
    }

    function isInvited(uint256 rfqId, address supplier) external view returns (bool) {
        return !_rfqs[rfqId].inviteOnly || _invited[rfqId][supplier];
    }

    function awardSubject(uint256 rfqId, address winner) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(rfqId, winner)));
    }

    // ─────────────────────────── internal ───────────────────────────

    function _create(RFQParams calldata p) internal returns (uint256 rfqId) {
        _validate(p);
        policy.checkCreate(p.buyerStakeBps);

        uint128 stake = uint128(_stakeOf(p));
        rfqId = ++rfqCount;
        RFQ storage r = _rfqs[rfqId];
        r.buyer = msg.sender;
        r.status = Status.Open;
        r.inviteOnly = p.invitees.length != 0;
        r.requiresQualification = p.requiresQualification;
        r.requiresProposal = p.requiresProposal;
        r.bidDeadline = p.bidDeadline;
        r.revealDeadline = p.revealDeadline;
        r.awardDeadline = p.awardDeadline;
        r.budget = p.budget;
        r.buyerStake = stake;
        r.depositAmount = p.depositAmount;
        r.rubricHash = p.rubricHash;
        r.metadataHash = p.metadataHash;
        r.category = p.category;
        r.region = p.region;
        r.retentionBps = p.retentionBps;
        r.deliveryWindow = p.deliveryWindow;
        r.acceptanceWindow = p.acceptanceWindow;
        r.transitWindow = p.transitWindow;
        r.bidMode = p.bidMode;
        _milestones[rfqId] = p.milestoneBps;
        for (uint256 i; i < p.invitees.length; ++i) {
            _invited[rfqId][p.invitees[i]] = true;
        }

        uint256 escrow = uint256(p.budget) + stake;
        _pullIn(msg.sender, escrow);
        totalHeld += escrow;

        emit RFQCreated(
            rfqId,
            msg.sender,
            p.category,
            p.budget,
            stake,
            p.depositAmount,
            p.bidDeadline,
            p.revealDeadline,
            p.awardDeadline,
            p.rubricHash,
            p.requiresProposal,
            p.metadataURI
        );
        if (p.invitees.length != 0) emit InviteesAdded(rfqId, p.invitees);
    }

    function _validate(RFQParams calldata p) internal view {
        if (p.budget == 0 || p.depositAmount == 0) revert InvalidAmount();
        if (!(block.timestamp < p.bidDeadline && p.bidDeadline < p.revealDeadline
                    && p.revealDeadline < p.awardDeadline)) {
            revert InvalidDeadlines();
        }
        if (p.retentionBps > BPS / 2 || p.buyerStakeBps > BPS / 2) revert InvalidBps();
        // ERC-8183 jobs need expiredAt > now + 5 min; the adapter sets delivery + 2 x acceptance.
        if (p.deliveryWindow < 5 minutes || p.acceptanceWindow < 1 minutes) revert InvalidWindows();
        if (p.invitees.length > MAX_INVITEES) revert TooManyInvitees();
        // _commit fails closed when qualification is demanded and no qualifier is configured, which
        // is the right behaviour there: silently dropping a stated requirement would be worse than
        // refusing. But it makes this combination an RFQ nobody can ever bid on, so it is refused
        // here instead of escrowing a budget against a tender that cannot receive bids.
        if (p.requiresQualification && address(qualifier) == address(0)) revert QualifierNotSet();

        uint256 n = p.milestoneBps.length;
        if (n == 0 || n > MAX_MILESTONES) revert InvalidMilestones();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (p.milestoneBps[i] == 0) revert InvalidMilestones();
            sum += p.milestoneBps[i];
        }
        if (sum != BPS) revert InvalidMilestones();
    }

    function _stakeOf(RFQParams calldata p) internal pure returns (uint256) {
        return (uint256(p.budget) * p.buyerStakeBps) / BPS;
    }

    function _releaseEscrowToBuyer(RFQ storage r) internal {
        uint256 amount = uint256(r.budget) + r.buyerStake;
        totalHeld -= amount;
        _credit(r.buyer, amount);
    }
}
