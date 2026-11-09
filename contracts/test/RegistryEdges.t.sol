// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {BLS} from "../src/concordium/BLS.sol";
import {ConcordiumEpochRegistry} from "../src/concordium/ConcordiumEpochRegistry.sol";

/// @notice The cases I asserted were handled but never checked.
contract RegistryEdgesTest is Test {
    ConcordiumEpochRegistry reg;
    bytes32 blockHash;
    uint64 round;
    uint64 epoch;
    bytes members;
    bytes signerBits;
    bytes signature;
    bytes32 membersHash;
    uint128 totalStake;
    uint64 period;
    uint64 eraMs;

    uint32 constant EPOCH_MS = 3_600_000;
    uint32 constant RPE = 24;

    function setUp() public {
        string memory qc = vm.readFile("test/fixtures/concordium-qc.json");
        blockHash = vm.parseJsonBytes32(qc, ".blockHash");
        round = uint64(vm.parseJsonUint(qc, ".round"));
        epoch = uint64(vm.parseJsonUint(qc, ".epoch"));
        members = vm.parseJsonBytes(qc, ".members");
        signerBits = vm.parseJsonBytes(qc, ".signerBits");
        signature = vm.parseJsonBytes(qc, ".signature");
        membersHash = vm.parseJsonBytes32(qc, ".membersHash");
        totalStake = uint128(vm.parseJsonUint(qc, ".totalStake"));
        eraMs = uint64(vm.parseJsonUint(qc, ".eraGenesisMs"));

        reg = new ConcordiumEpochRegistry(
            vm.parseJsonBytes32(qc, ".genesis"), eraMs, EPOCH_MS, RPE, 2,
            vm.parseJsonBytes(vm.readFile("test/fixtures/bls-concordium.json"), ".negG2Generator"),
            1, address(this)
        );
        period = epoch / RPE;
        vm.warp((uint256(eraMs) + uint256(period) * RPE * EPOCH_MS) / 1000 + 60);
        reg.proposeCommittee(period, membersHash, totalStake);
    }

    function call(bytes memory b) internal view returns (bool) {
        return reg.verifyCertificate(blockHash, round, epoch, members, b, signature);
    }

    /// An empty signer set aggregates to nothing. Both pairings would be the identity, so the
    /// product is one and a naive verifier would accept an all-zero signature from nobody.
    function test_anEmptySignerSetIsRefused() public {
        bytes memory none = new bytes(signerBits.length);
        vm.expectRevert();
        call(none);
    }

    /// The claim in the design notes is that the precompiles do the subgroup checks, so a point on
    /// the curve but outside the prime-order subgroup is rejected without the contract checking.
    function test_aPointOutsideTheSubgroupIsRejectedByThePrecompile() public {
        bytes memory dst = "CONCORDIUM-hashtoG1-with-BLS12381G1_XMD:SHA-256_SSWU_RO";
        bytes memory negG2 = vm.parseJsonBytes(vm.readFile("test/fixtures/bls-concordium.json"), ".negG2Generator");
        bytes memory pk = vm.parseJsonBytes(vm.readFile("test/fixtures/concordium-qc.json"), ".aggregatePublicKey");
        // Not a valid encoding at all: every coordinate at one, which is on no curve.
        bytes memory bogus = new bytes(128);
        bogus[63] = 0x01;
        bogus[127] = 0x01;
        vm.expectRevert();
        this.verifyExternal(pk, "x", bogus, dst, negG2);
    }

    function verifyExternal(
        bytes memory pk, bytes memory m, bytes memory s, bytes memory d, bytes memory n
    ) external view returns (bool) {
        return BLS.verify(pk, m, s, d, n);
    }

    /// Written expecting a pass and it found a bug.
    ///
    /// `requireFresh` says the *registry* is current. It said nothing about the certificate, so a
    /// genuine certificate from ten reward periods ago verified while the registry reported fresh,
    /// and a caller asking "is this supplier qualified now" was answered with ten-day-old
    /// evidence. That is precisely the failure the fail-closed policy was chosen to prevent, built
    /// into the contract that implements it.
    ///
    /// `maxCertificateAgeEpochs` now bounds the certificate itself. Kept here, next to the
    /// freshness suite, because the shape of the mistake is worth more than the assertion: a fresh
    /// registry is not a fresh answer.
    function test_anOldCertificateIsRefusedEvenWhenTheRegistryIsFresh() public {
        uint64 newPeriod = period + 10;
        vm.warp((uint256(eraMs) + uint256(newPeriod) * RPE * EPOCH_MS) / 1000 + 60);
        reg.proposeCommittee(newPeriod, bytes32(uint256(1)), 1);
        assertTrue(reg.isFresh(), "registry should be fresh");

        vm.expectRevert(
            abi.encodeWithSelector(
                ConcordiumEpochRegistry.CertificateTooOld.selector, epoch, reg.currentEpoch()
            )
        );
        call(signerBits);
    }
}

/// @notice Certificate freshness, after the ten-day-old certificate was found to verify.
contract CertificateFreshnessTest is Test {
    ConcordiumEpochRegistry reg;
    bytes32 blockHash;
    uint64 round;
    uint64 epoch;
    bytes members;
    bytes signerBits;
    bytes signature;
    uint64 eraMs;
    uint64 period;

    uint32 constant EPOCH_MS = 3_600_000;
    uint32 constant RPE = 24;
    uint32 constant MAX_AGE = 2;

    function setUp() public {
        string memory qc = vm.readFile("test/fixtures/concordium-qc.json");
        blockHash = vm.parseJsonBytes32(qc, ".blockHash");
        round = uint64(vm.parseJsonUint(qc, ".round"));
        epoch = uint64(vm.parseJsonUint(qc, ".epoch"));
        members = vm.parseJsonBytes(qc, ".members");
        signerBits = vm.parseJsonBytes(qc, ".signerBits");
        signature = vm.parseJsonBytes(qc, ".signature");
        eraMs = uint64(vm.parseJsonUint(qc, ".eraGenesisMs"));

        reg = new ConcordiumEpochRegistry(
            vm.parseJsonBytes32(qc, ".genesis"), eraMs, EPOCH_MS, RPE, MAX_AGE,
            vm.parseJsonBytes(vm.readFile("test/fixtures/bls-concordium.json"), ".negG2Generator"),
            1, address(this)
        );
        period = epoch / RPE;
        reg.proposeCommittee(period, vm.parseJsonBytes32(qc, ".membersHash"), uint128(vm.parseJsonUint(qc, ".totalStake")));
    }

    /// Put the chain clock `epochsAfter` epochs past the certificate's own epoch.
    function warpTo(uint64 epochsAfter) internal {
        vm.warp((uint256(eraMs) + (uint256(epoch) + epochsAfter) * EPOCH_MS) / 1000 + 60);
    }

    function verify() internal view returns (bool) {
        return reg.verifyCertificate(blockHash, round, epoch, members, signerBits, signature);
    }

    function test_acceptsACertificateFromThisEpoch() public {
        warpTo(0);
        assertTrue(verify());
    }

    function test_acceptsOneUpToTheAgeBound() public {
        warpTo(MAX_AGE);
        assertTrue(verify());
    }

    function test_refusesOneBeyondTheAgeBound() public {
        warpTo(MAX_AGE + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConcordiumEpochRegistry.CertificateTooOld.selector, epoch, epoch + MAX_AGE + 1
            )
        );
        verify();
    }

    /// The bug this suite was written for: ten reward periods, not epochs.
    function test_refusesTheTenDayOldCertificateThatUsedToPass() public {
        warpTo(10 * RPE);
        // The registry is made fresh for the new period, so only the certificate's age can refuse it.
        reg.proposeCommittee(reg.currentPeriod(), bytes32(uint256(1)), 1);
        assertTrue(reg.isFresh());
        vm.expectRevert();
        verify();
    }

    /// A certificate built against a clock that has not arrived yet.
    function test_refusesOneFromTheFuture() public {
        // Rewind so the certificate's epoch is well ahead of the chain's view.
        vm.warp((uint256(eraMs) + (uint256(epoch) - 5) * EPOCH_MS) / 1000);
        reg.proposeCommittee(reg.currentPeriod(), bytes32(uint256(1)), 1);
        vm.expectRevert();
        verify();
    }

    /// One epoch of tolerance, so ordinary skew between two chains is not an outage.
    function test_toleratesOneEpochOfSkew() public {
        vm.warp((uint256(eraMs) + (uint256(epoch) - 1) * EPOCH_MS) / 1000 + 60);
        assertTrue(verify());
    }
}
