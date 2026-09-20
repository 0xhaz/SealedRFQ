// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IRFQRegistry} from "../../src/interfaces/IRFQRegistry.sol";
import {ISealedRFQAdapter} from "../../src/interfaces/ISealedRFQAdapter.sol";
import {SealedRFQFixture} from "../utils/SealedRFQFixture.sol";

/// @notice Money is conserved across the whole lifecycle for any price, milestone split and
///         retention: the supplier nets exactly the price, the buyer pays exactly the price, losers
///         get their deposits back, and no contract keeps a unit.
contract LifecycleFuzzTest is SealedRFQFixture {
    function testFuzz_fullLifecycle_conservesMoney(
        uint128 price,
        uint8 nMilestones,
        uint16 retentionBps,
        uint256 seed
    ) public {
        price = uint128(bound(price, 1, BUDGET));
        uint256 n = bound(nMilestones, 1, 10);
        retentionBps = uint16(bound(retentionBps, 0, 5_000));

        IRFQRegistry.RFQParams memory p = defaultParams();
        p.retentionBps = retentionBps;
        p.milestoneBps = _split(n, seed);
        vm.prank(buyer);
        uint256 id = registry.createRFQ(p);

        commit(id, s1, price, 7);
        commit(id, s2, BUDGET, 7);
        toReveal(id);
        reveal(id, s1, price, 7);
        reveal(id, s2, BUDGET, 7);
        toAward(id);
        awardTo(id, s1);

        for (uint256 i; i < n; ++i) {
            submitCurrent(id, bytes32(i + 1));
            if (uint256(keccak256(abi.encode(seed, i))) % 2 == 0) {
                acceptCurrent(id);
            } else {
                vm.warp(block.timestamp + ACCEPTANCE);
                adapter.autoRelease(id);
            }
            assertAccounting();
        }
        assertEq(uint8(adapter.getEngagement(id).status), uint8(ISealedRFQAdapter.EngagementStatus.Completed));

        registry.settleDeposit(id, s2);
        withdrawAll(buyer);
        withdrawAll(s1);
        withdrawAll(s2);
        assertEq(usdc.balanceOf(s1), 100 * USDC + price, "supplier nets the price");
        assertEq(usdc.balanceOf(buyer), 100 * USDC - price, "buyer pays the price");
        assertEq(usdc.balanceOf(s2), 100 * USDC, "loser refunded");
        assertEq(
            usdc.balanceOf(address(registry)) + usdc.balanceOf(address(adapter))
                + usdc.balanceOf(address(acp)),
            0
        );
    }

    function testFuzz_rejectAtAnyMilestone_resolvesPotExactly(uint8 rejectAt, uint16 supplierBps) public {
        uint256 id = rfqReadyToAward();
        awardTo(id, s1);
        uint256 k = bound(rejectAt, 0, 2);
        supplierBps = uint16(bound(supplierBps, 0, 10_000));

        for (uint256 i; i < k; ++i) {
            submitCurrent(id, bytes32(i + 1));
            acceptCurrent(id);
        }
        submitCurrent(id, "disputed");
        vm.prank(buyer);
        adapter.rejectMilestone(id, keccak256("reject"));
        vm.prank(s1);
        adapter.raiseDispute(id);
        vm.prank(arbiter);
        adapter.resolveDispute(id, supplierBps, "ruling");
        assertAccounting();

        registry.settleDeposit(id, s2);
        registry.settleDeposit(id, s3);
        withdrawAll(buyer);
        withdrawAll(s1);
        withdrawAll(s2);
        withdrawAll(s3);
        // Nothing is created or lost: all 500 USDC minted to the five personas is still with them.
        uint256 total = usdc.balanceOf(buyer) + usdc.balanceOf(s1) + usdc.balanceOf(s2) + usdc.balanceOf(s3)
            + usdc.balanceOf(stranger);
        assertEq(total, 500 * USDC);
        assertEq(usdc.balanceOf(address(adapter)), 0);
    }

    function _split(uint256 n, uint256 seed) internal pure returns (uint16[] memory bps) {
        bps = new uint16[](n);
        uint256 left = 10_000;
        for (uint256 i; i < n; ++i) {
            if (i == n - 1) {
                bps[i] = uint16(left);
            } else {
                uint256 maxHere = left - (n - 1 - i); // leave >= 1 bps for each remaining milestone
                uint256 v = 1 + (uint256(keccak256(abi.encode(seed, i))) % maxHere);
                if (v > maxHere) v = maxHere;
                bps[i] = uint16(v);
                left -= v;
            }
        }
    }
}
