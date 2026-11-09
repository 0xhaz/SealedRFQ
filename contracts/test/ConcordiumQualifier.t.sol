// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ConcordiumEpochRegistry} from "../src/concordium/ConcordiumEpochRegistry.sol";
import {ConcordiumQualifier} from "../src/concordium/ConcordiumQualifier.sol";

/// @notice Eligibility, against the real mainnet certificate.
contract ConcordiumQualifierTest is Test {
    ConcordiumEpochRegistry reg;
    ConcordiumQualifier qual;

    bytes32 blockHash;
    uint64 round;
    uint64 epoch;
    bytes members;
    bytes signerBits;
    bytes signature;
    uint64 eraMs;

    address constant ALICE = address(0xA11CE);
    address constant ALICE_SECOND_WALLET = address(0xA11CE2);
    address constant BOB = address(0xB0B);
    uint256 constant TENDER = 1;
    bytes32 constant ALICE_PRINCIPAL = keccak256("alice-ltd");
    bytes32 constant BOB_PRINCIPAL = keccak256("bob-gmbh");

    uint32 constant EPOCH_MS = 3_600_000;
    uint32 constant RPE = 24;
    uint64 constant VALIDITY = 1 hours;

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
            vm.parseJsonBytes32(qc, ".genesis"), eraMs, EPOCH_MS, RPE, 2,
            vm.parseJsonBytes(vm.readFile("test/fixtures/bls-concordium.json"), ".negG2Generator"),
            1, address(this)
        );
        vm.warp((uint256(eraMs) + uint256(epoch) * EPOCH_MS) / 1000 + 60);
        reg.proposeCommittee(
            epoch / RPE,
            vm.parseJsonBytes32(qc, ".membersHash"),
            uint128(vm.parseJsonUint(qc, ".totalStake"))
        );
        qual = new ConcordiumQualifier(reg, VALIDITY, address(this));
    }

    function record(address bidder, bytes32 principal) internal {
        qual.recordQualification(
            bidder, TENDER, principal, blockHash, round, epoch, members, signerBits, signature
        );
    }

    function test_qualifiesAgainstARealFinalizedBlock() public {
        record(ALICE, ALICE_PRINCIPAL);
        assertTrue(qual.isQualified(ALICE, TENDER));
        assertEq(qual.qualificationOf(ALICE, TENDER).checkedAtEpoch, epoch);
    }

    /// The certificate is verified by this contract, not taken on the qualifier's word.
    function test_cannotQualifyWithoutAGenuineCertificate() public {
        vm.expectRevert();
        qual.recordQualification(
            ALICE, TENDER, ALICE_PRINCIPAL, bytes32(uint256(blockHash) ^ 1), round, epoch,
            members, signerBits, signature
        );
        assertFalse(qual.isQualified(ALICE, TENDER));
    }

    /// ADR-007B: counting wallets is not counting bidders.
    function test_oneEntityCannotBidTwiceFromTwoWallets() public {
        record(ALICE, ALICE_PRINCIPAL);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConcordiumQualifier.NullifierAlreadyUsed.selector, TENDER, ALICE_PRINCIPAL, ALICE
            )
        );
        record(ALICE_SECOND_WALLET, ALICE_PRINCIPAL);
        assertFalse(qual.isQualified(ALICE_SECOND_WALLET, TENDER));
    }

    function test_differentEntitiesBothQualify() public {
        record(ALICE, ALICE_PRINCIPAL);
        record(BOB, BOB_PRINCIPAL);
        assertTrue(qual.isQualified(ALICE, TENDER));
        assertTrue(qual.isQualified(BOB, TENDER));
    }

    /// A nullifier is scoped to one tender, so the same entity bids freely on the next one.
    function test_theSameEntityQualifiesOnAnotherTender() public {
        record(ALICE, ALICE_PRINCIPAL);
        qual.recordQualification(
            ALICE, 2, ALICE_PRINCIPAL, blockHash, round, epoch, members, signerBits, signature
        );
        assertTrue(qual.isQualified(ALICE, 2));
    }

    /// Re-qualifying the same wallet is allowed: it is a refresh, not a second principal.
    function test_aBidderCanRefreshItsOwnQualification() public {
        record(ALICE, ALICE_PRINCIPAL);
        uint64 first = qual.qualificationOf(ALICE, TENDER).expiresAt;
        vm.warp(block.timestamp + 10);
        record(ALICE, ALICE_PRINCIPAL);
        assertGt(qual.qualificationOf(ALICE, TENDER).expiresAt, first);
    }

    function test_expiresRatherThanStandingForever() public {
        record(ALICE, ALICE_PRINCIPAL);
        vm.warp(block.timestamp + VALIDITY + 1);
        assertFalse(qual.isQualified(ALICE, TENDER));
        vm.expectRevert(
            abi.encodeWithSelector(
                ConcordiumQualifier.QualificationExpired.selector,
                ALICE, TENDER, qual.qualificationOf(ALICE, TENDER).expiresAt
            )
        );
        qual.requireQualified(ALICE, TENDER);
    }

    function test_saysWhichOfTheTwoRefusalsApplied() public {
        // Never qualified reads differently from qualified and lapsed, which are different
        // problems for whoever is being refused.
        vm.expectRevert(
            abi.encodeWithSelector(ConcordiumQualifier.NotQualified.selector, BOB, TENDER)
        );
        qual.requireQualified(BOB, TENDER);
    }

    function test_canBeWithdrawnBeforeItExpires() public {
        record(ALICE, ALICE_PRINCIPAL);
        qual.revoke(ALICE, TENDER, "credential revoked upstream");
        assertFalse(qual.isQualified(ALICE, TENDER));
    }

    function test_onlyAQualifierMayRecord() public {
        vm.prank(BOB);
        vm.expectRevert();
        record(ALICE, ALICE_PRINCIPAL);
    }
}
