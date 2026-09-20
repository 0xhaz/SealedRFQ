// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Roles
/// @notice Least-privilege role ids shared by every SealedRFQ contract (OZ AccessControl).
/// @dev Each contract keeps its own role membership; `script/Configure.s.sol` grants per contract.
///      EVALUATOR scores and attests but cannot award. AWARDER awards within policy only. VERIFIER
///      accepts/rejects milestones but cannot award or refund deposits. ARBITER only splits disputed
///      escrow. REGISTRY is the RFQRegistry contract itself, the only caller that opens engagements.
library Roles {
    bytes32 internal constant ADMIN = 0x00; // OZ DEFAULT_ADMIN_ROLE
    bytes32 internal constant EVALUATOR = keccak256("sealedrfq.role.EVALUATOR");
    bytes32 internal constant AWARDER = keccak256("sealedrfq.role.AWARDER");
    bytes32 internal constant VERIFIER = keccak256("sealedrfq.role.VERIFIER");
    bytes32 internal constant ATTESTOR = keccak256("sealedrfq.role.ATTESTOR");
    bytes32 internal constant ARBITER = keccak256("sealedrfq.role.ARBITER");
    bytes32 internal constant REGISTRY = keccak256("sealedrfq.role.REGISTRY");
}

/// @title AttestationKinds
/// @notice Decision kinds anchored in AttestationLog. Mirrors `DecisionKind` in
///         `packages/shared/src/memo.ts` (sealedrfq.decision.v1).
library AttestationKinds {
    bytes32 internal constant BID_EVALUATION = "BID_EVALUATION";
    bytes32 internal constant AWARD_RECOMMENDATION = "AWARD_RECOMMENDATION";
    bytes32 internal constant AWARD_REJECTION = "AWARD_REJECTION";
    bytes32 internal constant MILESTONE_ACCEPT = "MILESTONE_ACCEPT";
    bytes32 internal constant MILESTONE_REJECT = "MILESTONE_REJECT";
    bytes32 internal constant QUALIFICATION = "QUALIFICATION";
}
