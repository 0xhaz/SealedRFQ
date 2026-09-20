// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IAttestationLog
/// @notice Append-only log of AI and agent decision hashes: approvals *and* rejections.
///         `payloadHash` is sha256(JCS(memo)) of a `sealedrfq.decision.v1` memo. Anyone can re-hash
///         the published memo and compare it with the anchor (`verify_decision_hash`).
interface IAttestationLog {
    struct Attestation {
        address actor;
        uint64 ts;
        bytes32 kind;
        bytes32 model;
    }

    event Attested(
        uint256 indexed subjectId,
        bytes32 indexed payloadHash,
        bytes32 indexed kind,
        address actor,
        bytes32 model
    );
    event KindRoleSet(bytes32 indexed kind, bytes32 indexed role);

    error UnknownKind(bytes32 kind);
    error NotAuthorizedForKind(address caller, bytes32 kind);
    error AlreadyAttested(uint256 subjectId, bytes32 payloadHash);
    error ZeroHash();

    /// @notice Anchor a decision. Caller must hold the role mapped to `kind`.
    /// @param subjectId rfqId for RFQ decisions; RFQRegistry.awardSubject(rfqId, winner) for
    ///        AWARD_RECOMMENDATION (binds the recommended winner); uint160(supplier) for QUALIFICATION.
    function attest(bytes32 kind, uint256 subjectId, bytes32 payloadHash, bytes32 model) external;

    function getAttestation(uint256 subjectId, bytes32 payloadHash) external view returns (Attestation memory);

    function isAttested(uint256 subjectId, bytes32 payloadHash, bytes32 kind) external view returns (bool);

    function kindRole(bytes32 kind) external view returns (bytes32);

    function setKindRole(bytes32 kind, bytes32 role) external;
}
