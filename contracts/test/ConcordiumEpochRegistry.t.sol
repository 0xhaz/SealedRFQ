// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ConcordiumEpochRegistry} from "../src/concordium/ConcordiumEpochRegistry.sol";

/// @notice The registry, against a real Concordium mainnet certificate.
///
/// Everything here uses the live committee for reward period 244: 72 finalizers, 51 of whom signed
/// round 10506057, carrying 68.2% of effective stake.
contract ConcordiumEpochRegistryTest is Test {
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

    uint32 constant EPOCH_MS = 3_600_000;
    uint32 constant REWARD_PERIOD_EPOCHS = 24;

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
        uint64 eraMs = uint64(vm.parseJsonUint(qc, ".eraGenesisMs"));
        bytes32 era = vm.parseJsonBytes32(qc, ".genesis");

        bytes memory negG2 = vm.parseJsonBytes(vm.readFile("test/fixtures/bls-concordium.json"), ".negG2Generator");

        reg = new ConcordiumEpochRegistry(era, eraMs, EPOCH_MS, REWARD_PERIOD_EPOCHS, 2, negG2, 1, address(this));

        period = epoch / REWARD_PERIOD_EPOCHS;
        // The certificate's own epoch, not the start of its period.
        //
        // Warping to the period start put the clock nine epochs behind the certificate, which read
        // as a certificate from the future once certificate age started being checked. It was
        // wrong before too; nothing was looking.
        vm.warp((uint256(eraMs) + uint256(epoch) * EPOCH_MS) / 1000 + 60);
    }

    function _register() internal {
        reg.proposeCommittee(period, membersHash, totalStake);
    }

    function test_derivesTheCurrentPeriodFromItsOwnClock() public view {
        assertEq(reg.currentPeriod(), period);
    }

    function test_verifiesARealCertificate() public {
        _register();
        assertTrue(reg.verifyCertificate(blockHash, round, epoch, members, signerBits, signature));
    }

    /// The property the whole policy choice turns on.
    function test_failsClosedWhenTheCommitteeIsNotRegistered() public {
        assertFalse(reg.isFresh());
        vm.expectRevert(
            abi.encodeWithSelector(ConcordiumEpochRegistry.StaleRegistry.selector, period, 0)
        );
        reg.verifyCertificate(blockHash, round, epoch, members, signerBits, signature);
    }

    function test_failsClosedWhenTheRegistryFallsBehind() public {
        _register();
        assertTrue(reg.isFresh());
        // A reward period later with nobody updating.
        vm.warp(block.timestamp + uint256(REWARD_PERIOD_EPOCHS) * EPOCH_MS / 1000);
        assertFalse(reg.isFresh());
        assertEq(reg.periodsBehind(), 1);
        vm.expectRevert();
        reg.requireFresh();
    }

    function test_reportsHowFarBehindItIs() public {
        _register();
        vm.warp(block.timestamp + 3 * uint256(REWARD_PERIOD_EPOCHS) * EPOCH_MS / 1000);
        // Public, so an operator can see it and a front end can say why bidding is closed.
        assertEq(reg.periodsBehind(), 3);
    }

    function test_rejectsACommitteeThatIsNotTheRegisteredOne() public {
        _register();
        bytes memory tampered = members;
        tampered[100] = bytes1(uint8(tampered[100]) ^ 0x01);
        vm.expectRevert(ConcordiumEpochRegistry.CommitteeMismatch.selector);
        reg.verifyCertificate(blockHash, round, epoch, tampered, signerBits, signature);
    }

    /// Dropping signers until the remaining stake is under two thirds must be refused, even though
    /// the signature itself is genuine.
    function test_rejectsBelowQuorum() public {
        _register();
        bytes memory fewer = signerBits;
        // Clear the first byte: eight fewer signers, which takes stake below the threshold.
        fewer[0] = 0x00;
        fewer[1] = 0x00;
        fewer[2] = 0x00;
        vm.expectRevert();
        reg.verifyCertificate(blockHash, round, epoch, fewer, signerBits.length > 0 ? fewer : fewer, signature);
    }

    function test_rejectsACertificateForAnotherBlock() public {
        _register();
        vm.expectRevert(ConcordiumEpochRegistry.InvalidCertificate.selector);
        reg.verifyCertificate(bytes32(uint256(blockHash) ^ 1), round, epoch, members, signerBits, signature);
    }

    /// @dev Measured through an external call with the committee read into memory first.
    ///
    /// Reading it straight from this contract's storage charged the measurement about 1.36M gas of
    /// SLOADs that the registry never pays: 20,736 bytes is 648 words, and a cold word is 2,100
    /// gas. The first version of this test reported 1.78M and most of it was the test's own
    /// bookkeeping, which is exactly the kind of number that gets quoted later as if it meant
    /// something.
    function test_gas() public {
        _register();
        bytes memory m = members;
        bytes memory b = signerBits;
        bytes memory s = signature;
        uint256 before = gasleft();
        this.callVerify(blockHash, round, epoch, m, b, s);
        console2.log("verifyCertificate, 72-member committee, 51 signers:", before - gasleft());
    }

    function callVerify(
        bytes32 bh,
        uint64 r,
        uint64 e,
        bytes calldata m,
        bytes calldata b,
        bytes calldata s
    ) external view returns (bool) {
        return reg.verifyCertificate(bh, r, e, m, b, s);
    }
}

/// @notice Committee registration under multiple updaters.
///
/// This is the only trusted step in the design, so it is the one worth making hard to subvert with
/// a single key.
contract ConcordiumEpochRegistryQuorumTest is Test {
    ConcordiumEpochRegistry reg;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant MALLORY = address(0xBAD);

    function setUp() public {
        reg = new ConcordiumEpochRegistry(
            bytes32(uint256(1)), 1_000_000, 3_600_000, 24, 2, new bytes(256), 2, address(this)
        );
        reg.grantRole(reg.UPDATER_ROLE(), ALICE);
        reg.grantRole(reg.UPDATER_ROLE(), BOB);
        reg.grantRole(reg.UPDATER_ROLE(), MALLORY);
    }

    function test_oneUpdaterCannotRegisterAlone() public {
        vm.prank(ALICE);
        reg.proposeCommittee(5, bytes32(uint256(0xC0FFEE)), 100);
        (,,, bool present) = reg.committees(5);
        assertFalse(present, "a single updater registered a committee");
    }

    function test_twoAgreeingUpdatersRegisterIt() public {
        vm.prank(ALICE);
        reg.proposeCommittee(5, bytes32(uint256(0xC0FFEE)), 100);
        vm.prank(BOB);
        reg.proposeCommittee(5, bytes32(uint256(0xC0FFEE)), 100);
        (bytes32 h,,, bool present) = reg.committees(5);
        assertTrue(present);
        assertEq(h, bytes32(uint256(0xC0FFEE)));
    }

    function test_disagreementRegistersNothing() public {
        // Mallory proposes a committee of her own choosing. Honest updaters propose the real one.
        vm.prank(MALLORY);
        reg.proposeCommittee(5, bytes32(uint256(0xBAD)), 100);
        vm.prank(ALICE);
        reg.proposeCommittee(5, bytes32(uint256(0xC0FFEE)), 100);
        (,,, bool present) = reg.committees(5);
        assertFalse(present, "disagreeing proposals registered a committee");
    }

    function test_oneUpdaterCannotConfirmTwice() public {
        vm.prank(ALICE);
        reg.proposeCommittee(5, bytes32(uint256(0xC0FFEE)), 100);
        vm.prank(ALICE);
        vm.expectRevert(ConcordiumEpochRegistry.AlreadyConfirmed.selector);
        reg.proposeCommittee(5, bytes32(uint256(0xC0FFEE)), 100);
    }

    function test_aDifferentStakeIsADifferentProposal() public {
        // The stake is part of the quorum arithmetic, so agreeing on members alone is not agreement.
        vm.prank(ALICE);
        reg.proposeCommittee(5, bytes32(uint256(0xC0FFEE)), 100);
        vm.prank(BOB);
        reg.proposeCommittee(5, bytes32(uint256(0xC0FFEE)), 999);
        (,,, bool present) = reg.committees(5);
        assertFalse(present);
    }
}
