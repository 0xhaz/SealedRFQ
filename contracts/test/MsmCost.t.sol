// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";

/// @notice What does a multi-scalar multiplication in G1 cost on Arc?
///
/// This is the number that decides whether Concordium's bulletproof statements can be verified
/// on-chain. Verifying a set-membership proof over a set of n members reduces to one
/// multi-exponentiation of roughly 2n + 2*log2(n) points, so the shape of this cost curve is the
/// shape of the feature.
///
/// EIP-2537 prices G1MSM with a discount that deepens as k grows, which is why this is measured
/// across sizes rather than multiplied up from the single-point case.
contract MsmCostTest is Test {
    address constant G1MSM = address(0x0c);

    // The BLS12-381 G1 generator, in EIP-2537 encoding: each coordinate is 16 zero bytes then 48.
    bytes constant G1X =
        hex"0000000000000000000000000000000017f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    bytes constant G1Y =
        hex"0000000000000000000000000000000008b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1";

    function msmGas(uint256 k) internal view returns (uint256 used) {
        // Preallocated and filled in place. Growing it with abi.encodePacked copies the whole
        // buffer every iteration, which is quadratic and ran the EVM out of memory at k = 528
        // while measuring nothing about the precompile.
        bytes memory input = new bytes(k * 160);
        for (uint256 i = 0; i < k; ++i) {
            uint256 off = i * 160;
            for (uint256 j = 0; j < 128; ++j) {
                input[off + j] = j < 64 ? G1X[j] : G1Y[j - 64];
            }
            // Scalars vary so the implementation cannot shortcut a repeated one.
            bytes32 scalar = bytes32(uint256(i + 1));
            for (uint256 j = 0; j < 32; ++j) input[off + 128 + j] = scalar[j];
        }
        uint256 before = gasleft();
        (bool ok, bytes memory out) = G1MSM.staticcall(input);
        used = before - gasleft();
        require(ok && out.length == 128, "G1MSM failed");
    }

    function test_msmCostCurve() public view {
        uint256[9] memory sizes = [uint256(1), 2, 4, 8, 16, 32, 64, 128, 256];
        for (uint256 i = 0; i < sizes.length; ++i) {
            console2.log("k =", sizes[i], "gas =", msmGas(sizes[i]));
        }
    }

    /// Set-membership proof sizes a real tender might use.
    function test_setMembershipEstimate() public view {
        // A jurisdiction predicate over 32 countries: the inner product argument reduces to one
        // multiexp of about 2n + 2*log2(n) points.
        uint256 n32 = 2 * 32 + 2 * 5;
        uint256 n64 = 2 * 64 + 2 * 6;
        uint256 n256 = 2 * 256 + 2 * 8;
        console2.log("set of  32 -> points:", n32, "gas:", msmGas(n32));
        console2.log("set of  64 -> points:", n64, "gas:", msmGas(n64));
        console2.log("set of 256 -> points:", n256, "gas:", msmGas(n256));
    }
}
