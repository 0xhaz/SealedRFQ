// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ArcUsdc
/// @notice Arc USDC facts shared by every SealedRFQ contract.
/// @dev Native USDC on Arc is the gas asset (18 decimals). The ERC-20 interface at
///      `ADDRESS` exposes the same balance with 6 decimals (1 ERC-20 unit == 1e12 wei).
///      SealedRFQ settles exclusively through the ERC-20 interface: never `msg.value`.
///      Verified on mainnet (5042) and testnet (5042002) on 2026-09-20: name/symbol "USDC",
///      decimals 6, EIP-712 version "2", ERC-2612 `permit` supported.
library ArcUsdc {
    address internal constant ADDRESS = 0x3600000000000000000000000000000000000000;
    uint8 internal constant DECIMALS = 6;
    uint256 internal constant ONE = 1e6;
    /// @dev native (18d) wei per ERC-20 (6d) unit
    uint256 internal constant NATIVE_SCALE = 1e12;

    uint256 internal constant CHAIN_ID_MAINNET = 5042;
    uint256 internal constant CHAIN_ID_TESTNET = 5042002;
}
