// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {BLS} from "../src/concordium/BLS.sol";

/// @notice Does Arc verify a Concordium-style BLS signature, and what does it cost?
///
/// The whole of ADR-007 option C rests on this. If a pairing check against the EIP-2537
/// precompiles is affordable, an Arc contract can verify Concordium's consensus signatures itself
/// and the qualification gate needs no trusted signer. If it is not, option C is a research project
/// and the honest answer is a trusted attestor.
///
/// The vectors are generated in test/fixtures/bls-concordium.json from Concordium's own
/// domain separation tag, with the pairing identity checked off-chain before it is checked here.
contract BLSSpikeTest is Test {
    bytes dst;
    bytes message;
    bytes signature;
    bytes publicKey;
    bytes negG2;
    bytes expectedHash;

    function setUp() public {
        string memory json = vm.readFile("test/fixtures/bls-concordium.json");
        dst = bytes(vm.parseJsonString(json, ".dst"));
        message = vm.parseJsonBytes(json, ".message");
        signature = vm.parseJsonBytes(json, ".signature");
        publicKey = vm.parseJsonBytes(json, ".publicKey");
        negG2 = vm.parseJsonBytes(json, ".negG2Generator");
        expectedHash = vm.parseJsonBytes(json, ".hashToG1");
    }

    /// Hash-to-curve has to agree with the signer's, or the pairing fails for the wrong reason.
    function test_hashToG1_matchesConcordiumDst() public view {
        bytes memory got = BLS.hashToG1(message, dst);
        assertEq(got, expectedHash, "hash_to_curve disagrees with concordium-base");
    }

    function test_verifiesAGenuineSignature() public view {
        assertTrue(BLS.verify(publicKey, message, signature, dst, negG2));
    }

    function test_rejectsAMessageThatWasNotSigned() public view {
        assertFalse(BLS.verify(publicKey, "a different message", signature, dst, negG2));
    }

    function test_rejectsTheWrongDomainTag() public view {
        // A signature is only valid for the tag it was made under, which is what stops a proof
        // issued for one purpose being replayed into another.
        assertFalse(BLS.verify(publicKey, message, signature, "SOME-OTHER-DST", negG2));
    }

    function test_rejectsATamperedSignature() public view {
        bytes memory bad = signature;
        bad[127] = bytes1(uint8(bad[127]) ^ 0x01);
        // A flipped bit usually leaves the curve entirely, which the precompile rejects outright
        // rather than returning false. Either answer is a refusal; both are recorded.
        try this.callVerify(publicKey, message, bad, dst, negG2) returns (bool ok) {
            assertFalse(ok, "a tampered signature verified");
        } catch {}
    }

    function callVerify(
        bytes memory pk,
        bytes memory m,
        bytes memory s,
        bytes memory d,
        bytes memory n
    ) external view returns (bool) {
        return BLS.verify(pk, m, s, d, n);
    }

    /// The number this spike exists to produce.
    function test_gas() public view {
        uint256 before = gasleft();
        bool ok = BLS.verify(publicKey, message, signature, dst, negG2);
        uint256 used = before - gasleft();
        assertTrue(ok);
        console2.log("BLS verify total gas:", used);

        before = gasleft();
        BLS.hashToG1(message, dst);
        console2.log("  of which hash_to_G1:", before - gasleft());
    }
}
