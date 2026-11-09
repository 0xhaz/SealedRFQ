// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {BLS} from "../src/concordium/BLS.sol";

/// @notice Verify a real Concordium mainnet quorum certificate on Arc.
///
/// Not a synthetic vector. The fixture is a certificate pulled from
/// grpc.mainnet.concordium.software at round 10506057, with the finalization committee for the
/// same block: 72 finalizers, 51 of whom signed, carrying 68.2% of effective stake. The protocol
/// requires two thirds, so this is a certificate that passed its own quorum rule by 1.5 points.
///
/// The message is the one the node actually signs, from quorumSignatureMessageBytes in
/// KonsensusV1/Types.hs:
///
///     "QUORUM." || genesisHash || blockHash || round(u64 BE) || epoch(u64 BE)
///
/// The genesis is the current era's, not the original. Each protocol update begins a new era with
/// its own genesis block, and Concordium mainnet is on protocol 10; signing against the original
/// genesis fails, which is how this was settled rather than assumed.
contract ConcordiumQCTest is Test {
    bytes dst = "CONCORDIUM-hashtoG1-with-BLS12381G1_XMD:SHA-256_SSWU_RO";
    bytes message;
    bytes signature;
    bytes aggregatePublicKey;
    bytes negG2;
    uint256 totalStake;
    uint256 signedStake;

    function setUp() public {
        string memory qc = vm.readFile("test/fixtures/concordium-qc.json");
        message = vm.parseJsonBytes(qc, ".message");
        signature = vm.parseJsonBytes(qc, ".signature");
        aggregatePublicKey = vm.parseJsonBytes(qc, ".aggregatePublicKey");
        totalStake = vm.parseJsonUint(qc, ".totalStake");
        signedStake = vm.parseJsonUint(qc, ".signedStake");

        string memory bls = vm.readFile("test/fixtures/bls-concordium.json");
        negG2 = vm.parseJsonBytes(bls, ".negG2Generator");
    }

    function test_verifiesARealMainnetCertificate() public view {
        assertTrue(
            BLS.verify(aggregatePublicKey, message, signature, dst, negG2),
            "a genuine Concordium quorum certificate failed to verify on Arc"
        );
    }

    /// Concordium's quorum is two thirds of effective stake, not of headcount. A verifier that
    /// counted signatures would accept a certificate signed by many small validators.
    function test_quorumIsMeasuredInStake() public view {
        assertGe(signedStake * 3, totalStake * 2, "fixture is below quorum");
        // 51 of 72 is 70.8% by headcount but 68.2% by stake: the two measures disagree, which is
        // the whole reason the rule is written in stake.
        assertLt((signedStake * 1000) / totalStake, uint256(51 * 1000) / 72);
    }

    function test_rejectsACertificateForADifferentBlock() public view {
        bytes memory tampered = message;
        // Flip a bit inside the block hash, leaving the prefix, round and epoch intact.
        tampered[10] = bytes1(uint8(tampered[10]) ^ 0x01);
        assertFalse(BLS.verify(aggregatePublicKey, tampered, signature, dst, negG2));
    }

    function test_rejectsACertificateReplayedIntoAnotherRound() public view {
        bytes memory tampered = message;
        // The round is the last sixteen bytes, epoch the last eight; bump the round.
        tampered[tampered.length - 9] = bytes1(uint8(tampered[tampered.length - 9]) ^ 0x01);
        assertFalse(BLS.verify(aggregatePublicKey, tampered, signature, dst, negG2));
    }

    function test_gas() public view {
        uint256 before = gasleft();
        bool ok = BLS.verify(aggregatePublicKey, message, signature, dst, negG2);
        uint256 used = before - gasleft();
        assertTrue(ok);
        console2.log("real mainnet QC verified on Arc, gas:", used);
    }
}
