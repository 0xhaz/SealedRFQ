// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IProcurementPolicy} from "../../src/interfaces/IProcurementPolicy.sol";
import {IRFQRegistry} from "../../src/interfaces/IRFQRegistry.sol";
import {ISealedRFQAdapter} from "../../src/interfaces/ISealedRFQAdapter.sol";
import {SealedRFQFixture} from "../utils/SealedRFQFixture.sol";

/**
 * Open tenders, the award-time delivery check, and the cap on what an agent may decide alone.
 *
 * The three of these share a theme: each makes something the contract previously only hoped for
 * into something it enforces. An open bid was impossible, a bid quoting more days than the tender
 * allowed was merely frowned upon by an off-chain evaluator, and an agent could commit a buyer to
 * any sum at all provided the evaluation named the right bidder.
 */
contract BidModesTest is SealedRFQFixture {
    uint128 internal constant PRICE = 2_800_000;

    function openRfq() internal returns (uint256 id) {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.bidMode = IRFQRegistry.BidMode.Open;
        vm.prank(buyer);
        id = registry.createRFQ(p);
    }

    // ───────────── open bidding ─────────────

    function test_openBid_isVisibleImmediately_withNothingToReveal() public {
        uint256 id = openRfq();
        vm.prank(s1);
        registry.placeOpenBid(id, PRICE, _days(21), bytes32(0));

        // The whole difference between the modes: the price is readable while bidding is still
        // open, so a rival can respond to it. That is what an open tender is, and what costs it
        // the integrity claim a sealed one carries.
        IRFQRegistry.Bid memory b = registry.getBid(id, s1);
        assertEq(b.price, PRICE, "price public at once");
        assertTrue(b.revealed, "nothing left to reveal");
        assertEq(registry.getRFQ(id).revealCount, 1, "counts as revealed on arrival");
    }

    function test_openBid_takesOneDeposit_howeverOftenItIsImproved() public {
        uint256 id = openRfq();
        uint256 before = usdc.balanceOf(s1);

        vm.startPrank(s1);
        registry.placeOpenBid(id, PRICE, _days(21), bytes32(0));
        registry.placeOpenBid(id, 2_600_000, _days(18), bytes32(0));
        registry.placeOpenBid(id, 2_500_000, _days(15), bytes32(0));
        vm.stopPrank();

        // Improving your own bid is the point of an open auction; charging a deposit each time
        // would make competing with yourself expensive and the auction pointless.
        assertEq(before - usdc.balanceOf(s1), DEPOSIT, "one deposit only");
        assertEq(registry.getRFQ(id).commitCount, 1, "one bidder");
        assertEq(registry.getBid(id, s1).price, 2_500_000, "latest price stands");
    }

    function test_theTwoModesRefuseEachOther() public {
        uint256 open = openRfq();
        vm.prank(s1);
        vm.expectRevert(IRFQRegistry.WrongBidMode.selector);
        registry.commitBid(open, keccak256("sealed"));

        uint256 sealed_ = createRFQ();
        vm.prank(s1);
        vm.expectRevert(IRFQRegistry.WrongBidMode.selector);
        registry.placeOpenBid(sealed_, PRICE, _days(21), bytes32(0));
    }

    function test_openBidsStillScreenWhoMayBid() public {
        // Open is about prices being visible, not about anyone being able to bid.
        uint256 id = openRfq();
        vm.prank(buyer);
        vm.expectRevert(IRFQRegistry.BuyerCannotBid.selector);
        registry.placeOpenBid(id, PRICE, _days(21), bytes32(0));
    }

    function test_openBidsFeedTheRunnerUpMeasure() public {
        // The damages measure in §6c needs the next cheapest bid, and it has to work in both modes.
        uint256 id = openRfq();
        vm.prank(s1);
        registry.placeOpenBid(id, PRICE, _days(21), bytes32(0));
        vm.prank(s2);
        registry.placeOpenBid(id, 2_950_000, _days(14), bytes32(0));

        IRFQRegistry.RFQ memory r = registry.getRFQ(id);
        assertEq(r.lowestRevealed, PRICE);
        assertEq(r.secondLowestRevealed, 2_950_000);
    }

    // ───────────── the delivery window is now enforced ─────────────

    /**
     * Delivery used to be stored in whole days while the window was seconds, so the smallest bid
     * anyone could place was 86,400 seconds and *no* bid could satisfy a window shorter than a
     * day. Such a tender took deposits, revealed normally, then refused every award — presenting
     * as a tender that merely attracted no acceptable offer. Both are seconds now.
     */
    function test_aSubDayWindowIsAwardable() public {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.deliveryWindow = 2 hours;
        vm.prank(buyer);
        uint256 id = registry.createRFQ(p);

        // Hashes first: `computeCommitment` is itself a call, and vm.prank applies to the next
        // one — inlining it would spend the prank and send commitBid from the test contract.
        bytes32 h1 = registry.computeCommitment(id, s1, PRICE, uint32(90 minutes), bytes32(0), salt(s1));
        bytes32 h2 =
            registry.computeCommitment(id, s2, 2_950_000, uint32(2 hours), bytes32(0), salt(s2));
        vm.prank(s1);
        registry.commitBid(id, h1);
        vm.prank(s2);
        registry.commitBid(id, h2);
        toReveal(id);
        vm.prank(s1);
        registry.revealBid(id, PRICE, uint32(90 minutes), bytes32(0), salt(s1));
        vm.prank(s2);
        registry.revealBid(id, 2_950_000, uint32(2 hours), bytes32(0), salt(s2));
        toAward(id);

        bytes32 memo = recommend(id, s1);
        vm.prank(awarder);
        registry.award(id, s1, memo, RUBRIC);

        assertEq(registry.getRFQ(id).winner, s1);
    }

    function test_awardRefusesABidThatCannotBeDeliveredInTime() public {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.deliveryWindow = 7 days;
        vm.prank(buyer);
        uint256 id = registry.createRFQ(p);

        commit(id, s1, PRICE, 21); // more days than the window allows
        commit(id, s2, 2_950_000, 5);
        toReveal(id);
        reveal(id, s1, PRICE, 21);
        reveal(id, s2, 2_950_000, 5);
        toAward(id);

        bytes32 memo = recommend(id, s1);
        vm.prank(awarder);
        vm.expectRevert(
            abi.encodeWithSelector(IRFQRegistry.DeliveryExceedsWindow.selector, uint32(21 days), uint32(7 days))
        );
        registry.award(id, s1, memo, RUBRIC);
    }

    function test_theLateBidderKeepsTheirDeposit() public {
        // Checked at award rather than at reveal, deliberately. Reverting the reveal would leave
        // them recorded as never having revealed, which is exactly how a deposit is forfeited —
        // punishing a supplier for bidding against a window they could read.
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.deliveryWindow = 7 days;
        vm.prank(buyer);
        uint256 id = registry.createRFQ(p);

        commit(id, s1, PRICE, 21);
        commit(id, s2, 2_950_000, 5);
        toReveal(id);
        reveal(id, s1, PRICE, 21); // must not revert
        assertTrue(registry.getBid(id, s1).revealed, "reveal accepted");

        reveal(id, s2, 2_950_000, 5);
        toAward(id);
        awardTo(id, s2);

        registry.settleDeposit(id, s1);
        assertEq(registry.withdrawable(s1), DEPOSIT, "deposit refunded, not forfeited");
    }

    // ───────────── what an agent may decide alone ─────────────

    function test_agentCannotAwardAboveItsCap() public {
        vm.prank(admin);
        IProcurementPolicy.Policy memory pol = defaultPolicy();
        pol.agentAwardCap = 1_000_000; // 1 USDC; the winning bid is 2.80
        policy.setPolicy(pol);

        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s1);
        vm.prank(awarder);
        vm.expectRevert(
            abi.encodeWithSelector(IRFQRegistry.AgentAwardCapExceeded.selector, uint256(PRICE), uint128(1_000_000))
        );
        registry.award(id, s1, memo, RUBRIC);
    }

    function test_theBuyerIsNeverCapped() public {
        // The cap bounds what a machine decides unattended, not what a person may spend.
        vm.prank(admin);
        IProcurementPolicy.Policy memory pol = defaultPolicy();
        pol.agentAwardCap = 1;
        policy.setPolicy(pol);

        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s1);
        vm.prank(buyer);
        registry.award(id, s1, memo, RUBRIC);
        assertEq(registry.getRFQ(id).winner, s1, "the buyer's own award stands");
    }

    function test_aZeroCapStopsAgentAwardsEntirely() public {
        // Fail-safe reading: a deployment that forgets to set this gets a human in the loop rather
        // than an uncapped robot.
        vm.prank(admin);
        IProcurementPolicy.Policy memory pol = defaultPolicy();
        pol.agentAwardCap = 0;
        policy.setPolicy(pol);

        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s1);
        vm.prank(awarder);
        vm.expectRevert();
        registry.award(id, s1, memo, RUBRIC);
    }
}
