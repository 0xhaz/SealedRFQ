// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {PullPayments} from "../lib/PullPayments.sol";

/// @title UsdcProbe
/// @notice Day-1 "hello" contract. Proves the Arc USDC paths every SealedRFQ contract relies on:
///         ERC-20 pull-in (approve and ERC-2612 permit), 6-decimal accounting, and pull-payment
///         payouts through `withdraw()`. Not part of the product; safe to leave deployed on testnet.
contract UsdcProbe is PullPayments {
    /// @notice Escrowed (not yet assigned) balance per depositor.
    mapping(address => uint256) public escrowed;

    event Deposited(address indexed from, uint256 amount);
    event Paid(address indexed from, address indexed to, uint256 amount);

    error InsufficientEscrow(uint256 available, uint256 requested);

    constructor(IERC20 token) PullPayments(token) {}

    /// @notice Deposit after a prior `approve`.
    function deposit(uint256 amount) external nonReentrant {
        _deposit(msg.sender, amount);
    }

    /// @notice Deposit in one transaction using an ERC-2612 permit signature.
    /// @dev If the permit was already consumed (front-run), fall through to the allowance check.
    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        try IERC20Permit(address(settlementToken))
            .permit(msg.sender, address(this), amount, deadline, v, r, s) {}
            catch {}
        _deposit(msg.sender, amount);
    }

    /// @notice Assign part of the caller's escrow to `to`, who can then `withdraw()`.
    function pay(address to, uint256 amount) external {
        uint256 available = escrowed[msg.sender];
        if (amount > available) revert InsufficientEscrow(available, amount);
        escrowed[msg.sender] = available - amount;
        _credit(to, amount);
        emit Paid(msg.sender, to, amount);
    }

    function _deposit(address from, uint256 amount) private {
        _pullIn(from, amount);
        escrowed[from] += amount;
        emit Deposited(from, amount);
    }
}
