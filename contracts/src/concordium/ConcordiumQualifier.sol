// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ConcordiumEpochRegistry} from "./ConcordiumEpochRegistry.sol";

/// @title Eligibility to bid, anchored to a finalized Concordium block
/// @notice Records that a bidder was checked against Concordium, and binds that record to a block
///         this contract has independently confirmed was finalized.
///
/// **What is verified here, and what is asserted.** Being exact about this matters more than the
/// code, because the two are easy to conflate and the difference is the security model.
///
/// *Verified:* that the Concordium block a qualification refers to was genuinely finalized by the
/// finalization committee, and that it is recent. `ConcordiumEpochRegistry` checks the aggregate
/// BLS signature and the two-thirds stake quorum, so nobody can invent a block or reuse an old one.
///
/// *Asserted:* that the credential check against that block's state was performed honestly. The
/// contract cannot repeat it. Verifying a credential means proving a commitment sits in that
/// block's state, and Concordium exposes no state proofs of any kind, so no contract on any chain
/// can do that today.
///
/// So this does not remove the trusted check. What it removes is the trusted *clock*: a qualifier
/// cannot backdate a qualification, cannot replay one against state that has since changed, and
/// cannot claim to have checked against a block that never reached finality. Those are the lies a
/// bare signed attestation makes easy, and they are the ones that matter for revocation.
///
/// Separately, a qualification carries a **nullifier**: an identifier for the verified principal,
/// scoped to one tender. Two wallets belonging to the same entity produce the same nullifier for a
/// given tender, so the contract can refuse the second. That is what makes a minimum-bidder rule
/// mean independent bidders rather than independent addresses, which is the flaw in counting
/// wallets. The nullifier does not identify anyone across tenders, by construction.
contract ConcordiumQualifier is AccessControl {
    bytes32 public constant QUALIFIER_ROLE = keccak256("sealedrfq.role.CCD_QUALIFIER");

    ConcordiumEpochRegistry public immutable finality;

    /// How long a qualification stands before it has to be re-established.
    ///
    /// Not forever, and not until revoked: this contract cannot see a revocation, so the only
    /// honest bound is time. Short enough that a revoked credential stops being usable quickly,
    /// long enough that a bidder is not re-checked on every call.
    uint64 public immutable validitySeconds;

    struct Qualification {
        bytes32 nullifier;
        /// The Concordium epoch of the finalized block this was checked against.
        uint64 checkedAtEpoch;
        uint64 expiresAt;
        bool present;
    }

    /// bidder => tender => qualification
    mapping(address => mapping(uint256 => Qualification)) private _qualifications;

    /// tender => nullifier => the wallet that claimed it first
    mapping(uint256 => mapping(bytes32 => address)) public claimedBy;

    event Qualified(
        address indexed bidder, uint256 indexed tenderId, bytes32 nullifier, uint64 epoch, uint64 expiresAt
    );
    event Revoked(address indexed bidder, uint256 indexed tenderId, string reason);

    error NullifierAlreadyUsed(uint256 tenderId, bytes32 nullifier, address claimedBy);
    error NotQualified(address bidder, uint256 tenderId);
    error QualificationExpired(address bidder, uint256 tenderId, uint64 expiredAt);

    constructor(ConcordiumEpochRegistry finality_, uint64 validitySeconds_, address admin) {
        finality = finality_;
        validitySeconds = validitySeconds_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(QUALIFIER_ROLE, admin);
    }

    /// @notice Record that a bidder is eligible for one tender, against a named Concordium block.
    /// @dev The certificate is verified by this call, not taken on the caller's word. A qualifier
    ///      that cannot produce a genuine, recent, quorum-signed certificate cannot register
    ///      anything, whatever it claims to have checked.
    function recordQualification(
        address bidder,
        uint256 tenderId,
        bytes32 nullifier,
        bytes32 blockHash,
        uint64 round,
        uint64 epoch,
        bytes calldata members,
        bytes calldata signerBits,
        bytes calldata signature
    ) external onlyRole(QUALIFIER_ROLE) {
        // Reverts unless the block was finalized by a quorum and is recent enough to answer a
        // question about now.
        finality.verifyCertificate(blockHash, round, epoch, members, signerBits, signature);

        address existing = claimedBy[tenderId][nullifier];
        // One principal, one bid. A second wallet for the same entity is refused rather than
        // counted, which is what a minimum-bidder rule has to mean to mean anything.
        if (existing != address(0) && existing != bidder) {
            revert NullifierAlreadyUsed(tenderId, nullifier, existing);
        }
        claimedBy[tenderId][nullifier] = bidder;

        _qualifications[bidder][tenderId] = Qualification({
            nullifier: nullifier,
            checkedAtEpoch: epoch,
            expiresAt: uint64(block.timestamp) + validitySeconds,
            present: true
        });
        emit Qualified(bidder, tenderId, nullifier, epoch, uint64(block.timestamp) + validitySeconds);
    }

    /// @notice Withdraw a qualification before it expires.
    /// @dev The one thing a qualifier can do about a revocation it learns of out of band. It is a
    ///      patch on a gap rather than a solution to it: the contract still cannot see revocations,
    ///      and nothing here should be read as implying it can.
    function revoke(address bidder, uint256 tenderId, string calldata reason)
        external
        onlyRole(QUALIFIER_ROLE)
    {
        delete _qualifications[bidder][tenderId];
        emit Revoked(bidder, tenderId, reason);
    }

    function qualificationOf(address bidder, uint256 tenderId)
        external
        view
        returns (Qualification memory)
    {
        return _qualifications[bidder][tenderId];
    }

    function isQualified(address bidder, uint256 tenderId) public view returns (bool) {
        Qualification memory q = _qualifications[bidder][tenderId];
        return q.present && q.expiresAt > block.timestamp;
    }

    /// @notice Revert unless this bidder may bid on this tender. For a registry to call at commit.
    /// @dev Separate from `isQualified` so the refusal says which of the two reasons applied.
    ///      "Not qualified" and "qualified a week ago" are different problems for the bidder.
    function requireQualified(address bidder, uint256 tenderId) external view {
        Qualification memory q = _qualifications[bidder][tenderId];
        if (!q.present) revert NotQualified(bidder, tenderId);
        if (q.expiresAt <= block.timestamp) {
            revert QualificationExpired(bidder, tenderId, q.expiresAt);
        }
    }
}
