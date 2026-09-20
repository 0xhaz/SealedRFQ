// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IProcurementPolicy} from "../interfaces/IProcurementPolicy.sol";
import {Roles} from "./Roles.sol";

/// @title ProcurementPolicy
/// @notice The rules of the desk. Admin-set, read by RFQRegistry on every create and award.
///         An AI-recommended award that breaks a rule reverts with a typed error, so "anti-corruption
///         by construction" is a property of the contract, not a promise of the operator.
contract ProcurementPolicy is IProcurementPolicy, AccessControl {
    uint256 internal constant BPS = 10_000;

    Policy internal _policy;

    constructor(address admin, Policy memory initial) {
        _grantRole(Roles.ADMIN, admin);
        _setPolicy(initial);
    }

    function policy() external view returns (Policy memory) {
        return _policy;
    }

    function setPolicy(Policy calldata p) external onlyRole(Roles.ADMIN) {
        _setPolicy(p);
    }

    function checkCreate(uint256 buyerStakeBps) external view {
        if (buyerStakeBps < _policy.minBuyerStakeBps) {
            revert BuyerStakeTooLow(buyerStakeBps, _policy.minBuyerStakeBps);
        }
    }

    function checkAward(AwardCheck calldata c) external view {
        Policy memory p = _policy;

        if (c.rubricHash != c.expectedRubricHash) revert RubricMismatch(c.rubricHash, c.expectedRubricHash);

        if (c.revealedBids < p.minRevealedBids) {
            revert InsufficientBidders(c.revealedBids, p.minRevealedBids);
        }

        uint256 cap = (c.budget * p.maxAwardBps) / BPS;
        if (c.price > cap) revert AwardExceedsBudget(c.price, cap);

        // deposit / price >= minDepositBps  <=>  deposit * BPS >= price * minDepositBps (round up)
        uint256 required = (c.price * p.minDepositBps + BPS - 1) / BPS;
        if (c.deposit < required) revert DepositRatioTooLow(c.deposit, required);

        if (p.maxSupplierShareBps < BPS) {
            uint256 newTotal = c.buyerAwardedTotal + c.price;
            if (newTotal >= p.concentrationFloor) {
                uint256 shareBps = ((c.buyerSupplierTotal + c.price) * BPS) / newTotal;
                if (shareBps > p.maxSupplierShareBps) {
                    revert ConcentrationCapExceeded(shareBps, p.maxSupplierShareBps);
                }
            }
        }
    }

    function _setPolicy(Policy memory p) internal {
        if (
            p.maxAwardBps == 0 || p.maxAwardBps > BPS || p.minDepositBps > BPS || p.minBuyerStakeBps > BPS
                || p.maxSupplierShareBps == 0 || p.maxSupplierShareBps > BPS
        ) revert InvalidPolicy();
        _policy = p;
        emit PolicyUpdated(p);
    }
}
