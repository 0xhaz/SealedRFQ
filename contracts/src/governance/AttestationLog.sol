// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAttestationLog} from "../interfaces/IAttestationLog.sol";
import {AttestationKinds, Roles} from "./Roles.sol";

/// @title AttestationLog
/// @notice Tamper-proof "why this supplier won" trail. Each AI or agent decision memo is hashed
///         off-chain (sha256 over RFC 8785 JCS) and anchored here by the role allowed to make that
///         kind of decision. Rejections are anchored exactly like approvals.
contract AttestationLog is IAttestationLog, AccessControl {
    mapping(uint256 subjectId => mapping(bytes32 payloadHash => Attestation)) internal _attestations;
    mapping(bytes32 kind => bytes32 role) public kindRole;

    constructor(address admin) {
        _grantRole(Roles.ADMIN, admin);
        _setKindRole(AttestationKinds.BID_EVALUATION, Roles.EVALUATOR);
        _setKindRole(AttestationKinds.AWARD_RECOMMENDATION, Roles.EVALUATOR);
        _setKindRole(AttestationKinds.AWARD_REJECTION, Roles.EVALUATOR);
        _setKindRole(AttestationKinds.MILESTONE_ACCEPT, Roles.VERIFIER);
        _setKindRole(AttestationKinds.MILESTONE_REJECT, Roles.VERIFIER);
        _setKindRole(AttestationKinds.QUALIFICATION, Roles.ATTESTOR);
    }

    function attest(bytes32 kind, uint256 subjectId, bytes32 payloadHash, bytes32 model) external {
        bytes32 role = kindRole[kind];
        if (role == bytes32(0)) revert UnknownKind(kind);
        if (!hasRole(role, msg.sender)) revert NotAuthorizedForKind(msg.sender, kind);
        if (payloadHash == bytes32(0)) revert ZeroHash();
        Attestation storage a = _attestations[subjectId][payloadHash];
        if (a.ts != 0) revert AlreadyAttested(subjectId, payloadHash);

        a.actor = msg.sender;
        a.ts = uint64(block.timestamp);
        a.kind = kind;
        a.model = model;
        emit Attested(subjectId, payloadHash, kind, msg.sender, model);
    }

    function getAttestation(uint256 subjectId, bytes32 payloadHash)
        external
        view
        returns (Attestation memory)
    {
        return _attestations[subjectId][payloadHash];
    }

    function isAttested(uint256 subjectId, bytes32 payloadHash, bytes32 kind) external view returns (bool) {
        Attestation storage a = _attestations[subjectId][payloadHash];
        return a.ts != 0 && a.kind == kind;
    }

    /// @notice Map a decision kind to the role allowed to attest it. `role == 0` disables the kind
    ///         (ADMIN is never a valid attesting role).
    function setKindRole(bytes32 kind, bytes32 role) external onlyRole(Roles.ADMIN) {
        _setKindRole(kind, role);
    }

    function _setKindRole(bytes32 kind, bytes32 role) internal {
        kindRole[kind] = role;
        emit KindRoleSet(kind, role);
    }
}
