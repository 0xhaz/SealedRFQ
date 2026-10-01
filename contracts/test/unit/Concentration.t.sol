// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProcurementPolicy} from "../../src/governance/ProcurementPolicy.sol";
import {IProcurementPolicy} from "../../src/interfaces/IProcurementPolicy.sol";

/**
 * The concentration cap is one of the mechanisms this project exists for: it stops someone with
 * authority over a budget steering work to a favoured supplier, and it binds because a buyer
 * cannot opt out of it.
 *
 * It is also the policy most easily rendered useless in either direction, and it becomes permanent
 * when ADMIN_ROLE is renounced. These tests pin both failure modes so a value change has to break
 * one of them visibly rather than quietly.
 */
contract ConcentrationTest is Test {
    bytes32 constant RUBRIC = keccak256("rubric");

    function _policy(uint128 floor, uint16 maxShare) internal returns (ProcurementPolicy) {
        return new ProcurementPolicy(
            address(this),
            IProcurementPolicy.Policy({
                maxAwardBps: 10_000,
                minRevealedBids: 2,
                minDepositBps: 500,
                minBuyerStakeBps: 500,
                maxSupplierShareBps: maxShare,
                concentrationFloor: floor,
                agentAwardCap: 100e6
            })
        );
    }

    function _check(ProcurementPolicy p, uint256 price, uint256 awardedTotal, uint256 toThisSupplier)
        internal
        view
    {
        p.checkAward(
            IProcurementPolicy.AwardCheck({
                budget: price,
                price: price,
                deposit: (price * 500) / 10_000,
                revealedBids: 2,
                rubricHash: RUBRIC,
                expectedRubricHash: RUBRIC,
                buyerAwardedTotal: awardedTotal,
                buyerSupplierTotal: toThisSupplier
            })
        );
    }

    /// A first award is always 100% concentrated, so a floor below it blocks every real purchase.
    function test_floorBelowTheFirstAwardBlocksIt() public {
        ProcurementPolicy p = _policy(100e6, 4_000);
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.ConcentrationCapExceeded.selector, 10_000, 4_000)
        );
        _check(p, 10_000e6, 0, 0);
    }

    /// Calibrated, the same purchase goes through: there is no pattern to judge on a first award.
    function test_aCalibratedFloorLetsAFirstPurchaseThrough() public {
        ProcurementPolicy p = _policy(50_000e6, 6_000);
        _check(p, 10_000e6, 0, 0); // no revert
    }

    /// A share cap at or below half blocks a buyer giving one supplier half their work, which is
    /// ordinary preferred-supplier behaviour rather than abuse.
    function test_aCapOfHalfBlocksOrdinaryPurchasing() public {
        ProcurementPolicy p = _policy(50_000e6, 4_000);
        // 60k awarded, 30k of it to this supplier, now awarding 10k more: 40k/70k = 57%.
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.ConcentrationCapExceeded.selector, 5_714, 4_000)
        );
        _check(p, 10_000e6, 60_000e6, 30_000e6);
    }

    function test_aboveHalfAllowsIt() public {
        ProcurementPolicy p = _policy(50_000e6, 6_000);
        _check(p, 10_000e6, 60_000e6, 30_000e6); // no revert
    }

    /// And it still catches the thing it is for: everything funnelled to one supplier.
    function test_sustainedFunnellingIsStillCaught() public {
        ProcurementPolicy p = _policy(50_000e6, 6_000);
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.ConcentrationCapExceeded.selector, 10_000, 6_000)
        );
        _check(p, 10_000e6, 50_000e6, 50_000e6);
    }
}
