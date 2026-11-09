// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {BLS} from "./BLS.sol";

/// @title Concordium finalization committee registry, fail-closed
/// @notice Lets Arc contracts check that a Concordium block was finalized, without trusting anyone
///         to say so.
///
/// Concordium's finalization committee is fixed for a reward period, which mainnet sets to 24
/// epochs of one hour, so this holds one committee per period rather than per block. The committee
/// is stored as a hash; whoever submits a certificate supplies the members and a bitmap saying who
/// signed.
///
/// That is a deliberate change from the original design sketch, which used a Merkle tree and had
/// callers prove each signer individually. Supplying the whole committee is both cheaper and
/// simpler: 685k gas against 810k for the live 72-member committee, because Merkle paths cost more
/// calldata than the twenty-one absent members they save, and there is no tree to build, store or
/// get wrong.
///
/// **Fail closed.** If the committee for the current period has not been registered, every check
/// reverts. An outage therefore stops bidding and awarding rather than letting either proceed on a
/// stale view of who is qualified. That costs availability and buys a property worth more: this
/// contract never asserts something about Concordium that it cannot currently verify. A supplier
/// who loses a bidding window to an outage is a problem for the tender timetable to solve, by
/// extension, and not for the verification rule to soften.
contract ConcordiumEpochRegistry is AccessControl {
    bytes32 public constant UPDATER_ROLE = keccak256("sealedrfq.role.CCD_UPDATER");

    /// Domain separator and hash-to-curve tag, both from Concordium's own sources.
    bytes public constant DST = "CONCORDIUM-hashtoG1-with-BLS12381G1_XMD:SHA-256_SSWU_RO";
    bytes public constant QUORUM_PREFIX = "QUORUM.";

    /// The era's genesis block hash, which every quorum signature commits to.
    ///
    /// The era's, not the chain's. Each protocol update starts a new era with its own genesis, and
    /// a signature verified against the original genesis of a chain that has since updated simply
    /// fails. Immutable here: a new era is a new deployment, which is the honest way to represent a
    /// protocol update rather than quietly repointing a live contract.
    bytes32 public immutable eraGenesis;

    /// Concordium's clock, in milliseconds, as the chain reports it.
    uint64 public immutable eraGenesisMs;
    uint32 public immutable epochDurationMs;
    uint32 public immutable rewardPeriodEpochs;

    /// How many epochs old a certificate may be and still answer a question about now.
    ///
    /// A fresh *registry* is not a fresh *certificate*. Without this, a genuine certificate from
    /// months ago verifies perfectly well against a committee that is still registered, and a
    /// caller asking whether a supplier is qualified today is answered with ancient evidence. That
    /// is the precise failure the fail-closed policy exists to prevent, and the first version of
    /// this contract had it.
    uint32 public immutable maxCertificateAgeEpochs;

    /// Negated G2 generator, so a verification is one pairing product rather than two pairings.
    bytes public negG2Generator;

    struct Committee {
        /// keccak over the members, in ascending baker id, each 288 bytes of key then stake.
        bytes32 membersHash;
        uint128 totalStake;
        uint64 registeredAt;
        /// Members are not stored: the aggregate is rebuilt per call from what the caller supplies.
        bool present;
    }

    mapping(uint64 period => Committee) public committees;

    event CommitteeRegistered(uint64 indexed period, bytes32 membersHash, uint128 totalStake);

    error StaleRegistry(uint64 expectedPeriod, uint64 latestRegistered);
    error CertificateTooOld(uint64 certificateEpoch, uint64 currentEpoch);
    error CertificateFromTheFuture(uint64 certificateEpoch, uint64 currentEpoch);
    error CommitteeMismatch();
    error BelowQuorum(uint256 signedStake, uint256 totalStake);
    error InvalidCertificate();
    error BadCommitteeEncoding();

    /// Highest period registered, so staleness is one read rather than a search.
    uint64 public latestPeriod;

    constructor(
        bytes32 eraGenesis_,
        uint64 eraGenesisMs_,
        uint32 epochDurationMs_,
        uint32 rewardPeriodEpochs_,
        uint32 maxCertificateAgeEpochs_,
        bytes memory negG2Generator_,
        uint8 confirmationsRequired_,
        address admin
    ) {
        // Zero would register a committee before anyone had agreed to it.
        require(confirmationsRequired_ > 0, "confirmations must be at least one");
        confirmationsRequired = confirmationsRequired_;
        eraGenesis = eraGenesis_;
        eraGenesisMs = eraGenesisMs_;
        epochDurationMs = epochDurationMs_;
        rewardPeriodEpochs = rewardPeriodEpochs_;
        maxCertificateAgeEpochs = maxCertificateAgeEpochs_;
        negG2Generator = negG2Generator_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPDATER_ROLE, admin);
    }

    /// @notice Which reward period Concordium should be in, by this chain's clock.
    /// @dev Derived rather than reported, because the contract cannot ask Concordium anything. It
    ///      assumes Concordium keeps to its schedule; if Concordium stalls, this runs ahead and the
    ///      registry reads stale, which under a fail-closed rule is the correct direction to be
    ///      wrong in.
    function currentEpoch() public view returns (uint64) {
        uint256 nowMs = block.timestamp * 1000;
        if (nowMs <= eraGenesisMs) return 0;
        return uint64((nowMs - eraGenesisMs) / epochDurationMs);
    }

    function currentPeriod() public view returns (uint64) {
        return currentEpoch() / rewardPeriodEpochs;
    }

    /// @notice How many periods behind the registry is. Zero means current.
    /// @dev Public so an operator can watch it, and so a front end can say why bidding is closed.
    ///      A fail-closed system that cannot explain itself is indistinguishable from a broken one.
    function periodsBehind() public view returns (uint64) {
        uint64 expected = currentPeriod();
        return expected > latestPeriod ? expected - latestPeriod : 0;
    }

    function isFresh() public view returns (bool) {
        return committees[currentPeriod()].present;
    }

    /// @notice Revert unless the current period's committee is registered.
    function requireFresh() public view {
        uint64 expected = currentPeriod();
        if (!committees[expected].present) revert StaleRegistry(expected, latestPeriod);
    }

    /// Distinct updaters that must agree before a committee takes effect.
    uint8 public confirmationsRequired;

    mapping(uint64 period => mapping(bytes32 proposal => uint8)) public confirmations;
    mapping(uint64 period => mapping(bytes32 proposal => mapping(address => bool))) public confirmed;

    event CommitteeProposed(uint64 indexed period, bytes32 proposal, address updater, uint8 count);

    error AlreadyConfirmed();

    /// @notice Propose the committee for a reward period; it takes effect on the Nth agreement.
    ///
    /// @dev **This is the trusted part of the design, and it is the only one.**
    ///
    /// Arc can verify Concordium's finality cryptographically: given the right committee, nobody
    /// can forge a certificate. What Arc cannot do is work out the committee for itself. That would
    /// need a proof that the committee is in a finalized block's state, and Concordium's node API
    /// exposes no state proofs at all: no Merkle proof, no inclusion proof, nothing in the gRPC
    /// surface. Blocks commit to a `state_hash`, but no interface will produce a path to a value
    /// underneath it.
    ///
    /// So a committee is asserted here rather than proven. That is a smaller thing to trust than
    /// the alternative, and the difference is worth being precise about. A signed-attestor design
    /// asserts "this bidder holds credential X", privately, per bid, and nobody else can check it.
    /// This asserts "Concordium's committee today hashes to H", once a day, about public chain
    /// data, and anyone with a node can recompute H and see immediately that it is wrong. One is an
    /// unverifiable private claim, the other a publicly falsifiable one.
    ///
    /// Requiring several updaters to agree means one compromised key cannot make the claim alone.
    function proposeCommittee(uint64 period, bytes32 membersHash, uint128 totalStake)
        external
        onlyRole(UPDATER_ROLE)
    {
        bytes32 proposal = keccak256(abi.encode(period, membersHash, totalStake));
        if (confirmed[period][proposal][msg.sender]) revert AlreadyConfirmed();
        confirmed[period][proposal][msg.sender] = true;
        uint8 count = ++confirmations[period][proposal];
        emit CommitteeProposed(period, proposal, msg.sender, count);

        if (count < confirmationsRequired) return;
        committees[period] = Committee({
            membersHash: membersHash,
            totalStake: totalStake,
            registeredAt: uint64(block.timestamp),
            present: true
        });
        if (period > latestPeriod) latestPeriod = period;
        emit CommitteeRegistered(period, membersHash, totalStake);
    }

    /// @notice The bytes a Concordium finalizer signs, from the node's quorumSignatureMessageBytes.
    function quorumMessage(bytes32 blockHash, uint64 round, uint64 epoch)
        public
        view
        returns (bytes memory)
    {
        return abi.encodePacked(QUORUM_PREFIX, eraGenesis, blockHash, round, epoch);
    }

    /// @notice Verify that a Concordium block carries a valid quorum certificate.
    /// @param members every committee member for the period, ascending by baker id, each encoded as
    ///        256 bytes of uncompressed G2 public key followed by a 32-byte stake.
    /// @param signerBits one bit per member in the same order, little-endian within each word.
    /// @param signature the aggregate signature, as an uncompressed 128-byte G1 point.
    ///
    /// Points arrive uncompressed because Concordium serialises them compressed and EIP-2537 does
    /// not accept that form. Decompressing on-chain would mean a field square root per key; the
    /// submitter does it instead, and a wrong point fails the pairing, so nothing is taken on trust.
    function verifyCertificate(
        bytes32 blockHash,
        uint64 round,
        uint64 epoch,
        bytes calldata members,
        bytes calldata signerBits,
        bytes calldata signature
    ) external view returns (bool) {
        requireFresh();
        _requireRecent(epoch);
        uint64 period = epoch / rewardPeriodEpochs;
        Committee memory c = committees[period];
        if (!c.present) revert StaleRegistry(currentPeriod(), latestPeriod);
        if (keccak256(members) != c.membersHash) revert CommitteeMismatch();
        if (members.length % 288 != 0 || members.length == 0) revert BadCommitteeEncoding();

        uint256 count = members.length / 288;
        if (signerBits.length * 8 < count) revert BadCommitteeEncoding();

        (bytes memory aggregate, uint256 signedStake) = _aggregate(members, signerBits, count);

        // Two thirds of stake, not of signatures. The measures disagree: in a live mainnet
        // certificate 51 of 72 members was 70.8% by headcount and 68.2% by stake, so a count-based
        // check would admit certificates the protocol's own rule rejects.
        if (signedStake * 3 < uint256(c.totalStake) * 2) {
            revert BelowQuorum(signedStake, c.totalStake);
        }

        if (!BLS.verify(aggregate, quorumMessage(blockHash, round, epoch), signature, DST, negG2Generator)) {
            revert InvalidCertificate();
        }
        return true;
    }

    /// @dev A certificate must describe roughly now, not merely a period someone once registered.
    ///
    /// Both directions are bounded. Too old, and the answer predates any revocation since. From the
    /// future, and a caller could pre-build a certificate against a clock that has not arrived;
    /// one epoch of tolerance absorbs ordinary skew between the two chains without opening that.
    function _requireRecent(uint64 epoch) private view {
        uint64 nowEpoch = currentEpoch();
        if (epoch + maxCertificateAgeEpochs < nowEpoch) revert CertificateTooOld(epoch, nowEpoch);
        if (epoch > nowEpoch + 1) revert CertificateFromTheFuture(epoch, nowEpoch);
    }

    /// @dev Aggregating BLS public keys is addition in G2, so this adds the signers rather than
    ///      subtracting absentees from a stored total. Subtraction is fewer additions, since quorum
    ///      guarantees more signers than absentees, but it needs each key negated, and a negation
    ///      the caller supplies has to be checked. Adding is one path with nothing to verify.
    function _aggregate(bytes calldata members, bytes calldata signerBits, uint256 count)
        private
        view
        returns (bytes memory aggregate, uint256 signedStake)
    {
        for (uint256 i = 0; i < count; ++i) {
            if (uint8(signerBits[i / 8]) & (1 << (i % 8)) == 0) continue;
            bytes calldata key = members[i * 288:i * 288 + 256];
            signedStake += uint256(bytes32(members[i * 288 + 256:i * 288 + 288]));
            aggregate = aggregate.length == 0 ? bytes(key) : _g2add(aggregate, key);
        }
    }

    function _g2add(bytes memory a, bytes calldata b) private view returns (bytes memory) {
        (bool ok, bytes memory out) = address(0x0d).staticcall(abi.encodePacked(a, b));
        if (!ok || out.length != 256) revert InvalidCertificate();
        return out;
    }
}
