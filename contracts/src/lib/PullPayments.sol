// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PullPayments
/// @notice Pull-over-push payouts in a single ERC-20 (Arc USDC).
/// @dev Contracts never force-send. Payouts are credited and beneficiaries call `withdraw()`.
///      If a transfer reverts (e.g. the recipient is on Arc's protocol blocklist), the whole
///      `withdraw()` reverts and the credit stays parked. No milestone or refund is ever bricked
///      by a bad recipient, and funds are never redirected elsewhere.
abstract contract PullPayments is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable settlementToken;

    /// @notice Withdrawable balance per beneficiary (6-decimal USDC units).
    mapping(address => uint256) public withdrawable;
    /// @notice Sum of all `withdrawable` balances. Invariant: <= token balance of this contract.
    uint256 public totalWithdrawable;

    event Credited(address indexed beneficiary, uint256 amount);
    event Withdrawn(address indexed beneficiary, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error NothingToWithdraw();

    constructor(IERC20 token) {
        if (address(token) == address(0)) revert ZeroAddress();
        settlementToken = token;
    }

    /// @notice Withdraw everything credited to the caller.
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        totalWithdrawable -= amount;
        emit Withdrawn(msg.sender, amount);
        settlementToken.safeTransfer(msg.sender, amount);
    }

    /// @dev Pull `amount` from `from` into this contract. Caller must have approved (or used permit).
    function _pullIn(address from, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        settlementToken.safeTransferFrom(from, address(this), amount);
    }

    /// @dev Credit a beneficiary. Funds must already be held by this contract.
    function _credit(address beneficiary, uint256 amount) internal {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) return;
        withdrawable[beneficiary] += amount;
        totalWithdrawable += amount;
        emit Credited(beneficiary, amount);
    }
}
