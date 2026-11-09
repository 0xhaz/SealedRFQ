// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";

/// @notice What does aggregating a Concordium quorum certificate's keys cost on Arc?
///
/// A QuorumCertificate carries one BLS aggregate signature and the set of BakerIds that produced
/// it. To check it, a verifier aggregates those bakers' public keys, which live in G2, and runs a
/// single pairing. The pairing is already measured at ~246k gas; the open question is the key
/// aggregation, which scales with committee size.
///
/// Two ways to aggregate, and the cheaper one depends on turnout. Adding the signers costs one G2
/// addition per signer. Subtracting the absentees from a precomputed committee total costs one per
/// absentee, which is far fewer when turnout is high, and quorum rules mean turnout is always
/// above two thirds.
contract G2CostTest is Test {
    address constant G2ADD = address(0x0d);
    address constant G2MSM = address(0x0e);

    // BLS12-381 G2 generator in EIP-2537 encoding, Fp2 coordinates ordered (c0, c1).
    bytes constant G2 =
        hex"00000000000000000000000000000000024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8"
        hex"0000000000000000000000000000000013e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e"
        hex"000000000000000000000000000000000ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801"
        hex"000000000000000000000000000000000606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be";

    function test_g2AddCost() public view {
        uint256 before = gasleft();
        (bool ok,) = G2ADD.staticcall(abi.encodePacked(G2, G2));
        uint256 used = before - gasleft();
        require(ok, "G2ADD failed");
        console2.log("one G2 addition:", used, "gas");

        // A committee of n, aggregated by repeated addition.
        for (uint256 i = 0; i < 3; ++i) {
            uint256 n = [uint256(32), 100, 200][i];
            console2.log("  aggregate", n, "keys by addition:", used * (n - 1));
        }
    }

    function test_g2MsmCost() public view {
        uint256[4] memory sizes = [uint256(1), 16, 64, 128];
        for (uint256 i = 0; i < sizes.length; ++i) {
            uint256 k = sizes[i];
            bytes memory input = new bytes(k * 288);
            for (uint256 j = 0; j < k; ++j) {
                uint256 off = j * 288;
                for (uint256 b = 0; b < 256; ++b) input[off + b] = G2[b];
                bytes32 scalar = bytes32(uint256(1));
                for (uint256 b = 0; b < 32; ++b) input[off + 256 + b] = scalar[b];
            }
            uint256 before = gasleft();
            (bool ok,) = G2MSM.staticcall(input);
            uint256 used = before - gasleft();
            require(ok, "G2MSM failed");
            console2.log("G2MSM k =", k, "gas =", used);
        }
    }
}
