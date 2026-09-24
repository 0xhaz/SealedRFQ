// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISealedRFQAdapter
/// @notice The post-award half of SealedRFQ: turns an award into a milestone engagement on top of
///         ERC-8183. One ACP job per milestone, opened sequentially. The adapter is each job's
///         `client` (it holds the buyer's escrow), its `evaluator` (so acceptance can time out to
///         auto-release on-chain) and its `hook` (enforces the delivery deadline, records submission).
///
///  Per milestone i:  gross_i = price * bps_i (last takes the remainder)
///                    retention_i = gross_i * retentionBps   -> held here until final acceptance
///                    job budget  = gross_i - retention_i     -> escrowed in AgenticCommerce
///  Supplier submits on the ACP job. Buyer (or an attested VERIFIER) accepts or rejects; silence for
///  `acceptanceWindow` lets anyone autoRelease. Final acceptance releases retention + the
///  performance stake to the supplier and the buyer stake back to the buyer.
///  Rejection opens a dispute window: the supplier may escalate to ARBITER, else the buyer is made
///  whole. Missing a delivery deadline abandons the engagement in the buyer's favour.
interface ISealedRFQAdapter {
    enum EngagementStatus {
        None,
        Active,
        Completed,
        Rejected,
        Disputed,
        Resolved,
        Abandoned
    }

    struct EngagementTerms {
        address buyer;
        address supplier;
        uint128 price;
        uint128 buyerStake;
        uint128 performanceStake;
        uint16 retentionBps;
        uint32 deliveryWindow;
        uint32 acceptanceWindow;
        /// @dev Allowance for goods to reach the buyer when they never confirm receipt. Zero for
        ///      anything delivered as a file, which makes the release timing identical to before.
        uint32 transitWindow;
        /// @dev What re-procuring would have cost above this award, measured from the next
        ///      cheapest revealed bid. Zero when no cheaper alternative existed to measure against.
        uint128 excessCost;
        uint16[] milestoneBps;
    }

    struct Engagement {
        address buyer;
        address supplier;
        EngagementStatus status;
        uint8 milestoneCount;
        uint8 currentMilestone;
        uint16 retentionBps;
        uint32 deliveryWindow;
        uint32 acceptanceWindow;
        uint32 transitWindow;
        uint128 price;
        uint128 allocated; // gross amount of milestones opened so far
        uint128 buyerStake;
        uint128 performanceStake;
        uint128 retentionHeld;
        uint128 currentJobBudget;
        /// @dev Retention withheld from the milestone currently open. Tracked apart from
        ///      `retentionHeld` because that total includes it, and retention on a milestone
        ///      nobody delivered is not money the supplier earned.
        uint128 currentRetention;
        uint128 excessCost;
        uint256 currentJobId;
        uint64 deliveryDeadline;
        uint64 submittedAt;
        /// @dev When the buyer acknowledged the goods arrived. Zero until they do; the inspection
        ///      clock runs from here when it is set, and from `submittedAt + transitWindow` when
        ///      it never is, so a silent buyer delays payment but cannot withhold it.
        uint64 receivedAt;
        uint64 disputeDeadline;
        bytes32 deliverable;
    }

    event EngagementStarted(
        uint256 indexed rfqId,
        address indexed buyer,
        address indexed supplier,
        uint256 price,
        uint8 milestones
    );
    event MilestoneFunded(
        uint256 indexed rfqId,
        uint8 indexed index,
        uint256 indexed jobId,
        uint256 jobBudget,
        uint256 retention,
        uint64 deliveryDeadline
    );
    event MilestoneSubmitted(
        uint256 indexed rfqId, uint8 indexed index, uint256 indexed jobId, bytes32 deliverable
    );
    event MilestoneAccepted(
        uint256 indexed rfqId,
        uint8 indexed index,
        uint256 indexed jobId,
        bytes32 reason,
        address by,
        bool automatic
    );
    event MilestoneRejected(
        uint256 indexed rfqId, uint8 indexed index, uint256 indexed jobId, bytes32 reason, address by
    );
    event DisputeRaised(uint256 indexed rfqId, address indexed by);
    event DisputeResolved(uint256 indexed rfqId, uint256 toSupplier, uint256 toBuyer, bytes32 reason);
    event RejectionFinalized(uint256 indexed rfqId, uint256 toBuyer);
    /// @notice The buyer says the goods arrived. Starts the inspection clock; decides nothing.
    event ReceiptConfirmed(uint256 indexed rfqId, uint8 indexed milestone, uint64 at);
    /// @notice The buyer gave the supplier more time, before the original window ran out.
    event DeliveryExtended(uint256 indexed rfqId, uint8 indexed milestone, uint64 newDeadline);
    event EngagementCompleted(uint256 indexed rfqId, uint256 toSupplier, uint256 toBuyer);
    /// @notice Nothing was delivered in time. `toBuyer` covers their loss; `toSupplier` is what
    ///         was at risk and not needed to cover it.
    event EngagementAbandoned(uint256 indexed rfqId, uint256 toBuyer, uint256 toSupplier);

    error NotFound(uint256 rfqId);
    error AlreadyStarted(uint256 rfqId);
    error InvalidTerms();
    error WrongStatus(EngagementStatus status);
    error WrongJobStatus();
    error NotBuyerOrVerifier(address caller);
    error NotSupplier(address caller);
    error ReasonNotAttested(bytes32 reason);
    error ReasonRequired();
    error AcceptanceWindowOpen(uint64 releasesAt);
    error DeliveryWindowClosed(uint64 deadline);
    error DisputeWindowClosed(uint64 deadline);
    error DisputeWindowOpen(uint64 deadline);
    error NotExpired();
    error NotBuyer(address caller);
    error AlreadyReceived();
    error NothingSubmitted();
    /// @dev An extension must move the deadline forward, and not past the job's own expiry.
    error BadExtension(uint64 latest);
    error OnlyAgenticCommerce();
    error InvalidBps();

    /// @notice Only the RFQRegistry (REGISTRY role). Pulls price + stakes from the caller.
    function startEngagement(uint256 rfqId, EngagementTerms calldata t) external;

    function acceptMilestone(uint256 rfqId, bytes32 reason) external;
    function rejectMilestone(uint256 rfqId, bytes32 reason) external;
    /// @notice Anyone, once `acceptanceWindow` has passed since submission.
    function autoRelease(uint256 rfqId) external;
    /// @notice Anyone, once the current job has expired (delivered-but-unreviewed pays the supplier;
    ///         never-delivered abandons in the buyer's favour).
    function settleExpired(uint256 rfqId) external;

    function raiseDispute(uint256 rfqId) external;
    function finalizeRejection(uint256 rfqId) external;
    function resolveDispute(uint256 rfqId, uint16 supplierBps, bytes32 reason) external;

    function getEngagement(uint256 rfqId) external view returns (Engagement memory);
    function milestoneBps(uint256 rfqId) external view returns (uint16[] memory);
    function jobToRfq(uint256 jobId) external view returns (uint256);
}
