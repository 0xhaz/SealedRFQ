// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.28;

/// @title IACPHook: Agentic Commerce Protocol hook interface (ERC-8183)
/// @notice Normative hook interface from EIP-8183, identical to the one used by the ERC-8183
///         reference deployment on Arc testnet (0x0747EE…4583). Hooks must also report support
///         via ERC-165.
interface IACPHook {
    /// @notice Called before a core ACP function executes. MAY revert to block the action.
    /// @param data Function-specific parameters, prefixed with the caller:
    ///        submit   -> abi.encode(address caller, bytes32 deliverable, bytes optParams)
    ///        complete -> abi.encode(address caller, bytes32 reason, bytes optParams)
    ///        reject   -> abi.encode(address caller, bytes32 reason, bytes optParams)
    ///        setBudget-> abi.encode(address caller, uint256 amount, bytes optParams)
    ///        fund     -> abi.encode(address caller, bytes optParams)
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;

    /// @notice Called after a core ACP function completes. MAY revert to roll back the transaction.
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
