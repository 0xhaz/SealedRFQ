// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IRFQRegistry
/// @notice The pre-award half of SealedRFQ: RFQs, commit-reveal sealed bids and USDC bid deposits.
///
///  Lifecycle (every state has a clock):
///    createRFQ  -> budget + buyer stake escrowed atomically ("funded before open")
///    Bidding    -> now < bidDeadline: suppliers commitBid(hash) + deposit
///    Reveal     -> bidDeadline <= now < revealDeadline: revealBid(price, days, salt)
///    Award      -> revealDeadline <= now < awardDeadline: buyer or AWARDER awards, policy-checked
///    Awarded    -> price + buyer stake + winner deposit (performance stake) move to the adapter
///    NoAward    -> closeNoAward after awardDeadline (or at revealDeadline with zero reveals)
///  Deposits settle per bidder via settleDeposit (no loops over bidders): revealed losers are
///  refunded, unrevealed bids forfeit to the buyer, the winner's rolls over. All payouts are pull.
interface IRFQRegistry {
    enum Status {
        None,
        Open,
        Awarded,
        NoAward,
        Cancelled
    }

    /// @dev Derived from Status + block.timestamp.
    enum Phase {
        None,
        Bidding,
        Reveal,
        Award,
        Awarded,
        NoAward,
        Cancelled
    }

    enum DepositState {
        None,
        Held,
        Refunded,
        RolledOver,
        Forfeited
    }

    struct RFQParams {
        bytes32 rubricHash; // sha256 of the published scoring rubric (fixed before bids open)
        bytes32 metadataHash; // sha256 of the scope document at metadataURI
        bytes32 category;
        bytes32 region;
        uint128 budget; // 6-decimal USDC; award price may not exceed it
        uint128 depositAmount; // per-bid deposit
        uint16 buyerStakeBps; // buyer's skin in the game, share of budget
        uint64 bidDeadline;
        uint64 revealDeadline;
        uint64 awardDeadline;
        uint16 retentionBps; // holdback per milestone, released on final acceptance
        uint32 deliveryWindow; // seconds per milestone to submit
        uint32 acceptanceWindow; // seconds for the buyer to accept/reject before auto-release
        uint16[] milestoneBps; // split of the award price, sums to 10000
        address[] invitees; // empty = public RFQ
        bool requiresQualification;
        string metadataURI;
    }

    struct RFQ {
        address buyer;
        Status status;
        bool inviteOnly;
        bool requiresQualification;
        uint64 bidDeadline;
        uint64 revealDeadline;
        uint64 awardDeadline;
        uint128 budget;
        uint128 buyerStake;
        uint128 depositAmount;
        bytes32 rubricHash;
        bytes32 metadataHash;
        bytes32 category;
        bytes32 region;
        uint16 retentionBps;
        uint32 deliveryWindow;
        uint32 acceptanceWindow;
        uint32 commitCount;
        uint32 revealCount;
        address winner;
        uint128 awardPrice;
        bytes32 evaluationHash;
    }

    struct Bid {
        bytes32 commitHash;
        uint128 price;
        uint32 deliveryDays;
        bool revealed;
        DepositState deposit;
    }

    event RFQCreated(
        uint256 indexed rfqId,
        address indexed buyer,
        bytes32 indexed category,
        uint256 budget,
        uint256 buyerStake,
        uint256 depositAmount,
        uint64 bidDeadline,
        uint64 revealDeadline,
        uint64 awardDeadline,
        bytes32 rubricHash,
        string metadataURI
    );
    event InviteesAdded(uint256 indexed rfqId, address[] invitees);
    event RFQCancelled(uint256 indexed rfqId);
    event BidCommitted(uint256 indexed rfqId, address indexed bidder, bytes32 commitHash, uint256 deposit);
    event BidRevealed(uint256 indexed rfqId, address indexed bidder, uint256 price, uint32 deliveryDays);
    event RFQAwarded(
        uint256 indexed rfqId,
        address indexed winner,
        uint256 price,
        bytes32 evaluationHash,
        address awardedBy
    );
    event RFQClosedNoAward(uint256 indexed rfqId);
    event DepositSettled(
        uint256 indexed rfqId, address indexed bidder, DepositState state, address beneficiary, uint256 amount
    );
    event QualifierSet(address qualifier);

    error RFQNotFound(uint256 rfqId);
    error InvalidAmount();
    error InvalidDeadlines();
    error InvalidMilestones();
    error InvalidBps();
    error InvalidWindows();
    error TooManyInvitees();
    error NotBuyer(address caller);
    error WrongPhase(Phase current);
    error NotInvited(address bidder);
    error NotQualified(address bidder);
    error BuyerCannotBid();
    error NoCommitment(address bidder);
    error AlreadyRevealed(address bidder);
    error CommitmentMismatch();
    error ZeroPrice();
    error NotAuthorizedToAward(address caller);
    error WinnerNotRevealed(address winner);
    error EvaluationNotAttested(bytes32 evaluationHash);
    error CannotCancel();
    error DepositNotHeld(address bidder);
    error NotInviteOnly();

    // ---- buyer ----
    function createRFQ(RFQParams calldata p) external returns (uint256 rfqId);
    function createRFQWithPermit(RFQParams calldata p, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        returns (uint256 rfqId);
    function addInvitees(uint256 rfqId, address[] calldata invitees) external;
    function cancelRFQ(uint256 rfqId) external;

    // ---- suppliers ----
    function commitBid(uint256 rfqId, bytes32 commitHash) external;
    function commitBidWithPermit(
        uint256 rfqId,
        bytes32 commitHash,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function revealBid(uint256 rfqId, uint128 price, uint32 deliveryDays, bytes32 salt) external;

    // ---- award (buyer or AWARDER, always through ProcurementPolicy) ----
    /// @notice Award to a revealed bidder. `evaluationHash` must be an AWARD_RECOMMENDATION attested
    ///         by an EVALUATOR under subject `awardSubject(rfqId, winner)`, so the awarder can only
    ///         award the bidder the evaluator actually recommended.
    function award(uint256 rfqId, address winner, bytes32 evaluationHash, bytes32 rubricHash) external;

    // ---- permissionless clocks ----
    function closeNoAward(uint256 rfqId) external;
    function settleDeposit(uint256 rfqId, address bidder) external;

    // ---- views ----
    function getRFQ(uint256 rfqId) external view returns (RFQ memory);
    function getBid(uint256 rfqId, address bidder) external view returns (Bid memory);
    function milestoneBps(uint256 rfqId) external view returns (uint16[] memory);
    function phase(uint256 rfqId) external view returns (Phase);
    function isInvited(uint256 rfqId, address supplier) external view returns (bool);
    function rfqCount() external view returns (uint256);
    /// @notice AttestationLog subject for an award recommendation: binds the RFQ and the winner.
    function awardSubject(uint256 rfqId, address winner) external pure returns (uint256);
    /// @notice The hash a bidder commits: binds this contract, chain, RFQ and bidder.
    function computeCommitment(
        uint256 rfqId,
        address bidder,
        uint128 price,
        uint32 deliveryDays,
        bytes32 salt
    ) external view returns (bytes32);
}
