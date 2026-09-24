// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgenticCommerce} from "../../src/core/IAgenticCommerce.sol";
import {IRFQRegistry} from "../../src/interfaces/IRFQRegistry.sol";
import {ISealedRFQAdapter} from "../../src/interfaces/ISealedRFQAdapter.sol";
import {SealedRFQFixture} from "../utils/SealedRFQFixture.sol";

/**
 * Receipt, transit and extension: the parts that only matter when something is shipped.
 *
 * Two rules are being protected here and they pull against each other. A buyer must not pay for a
 * container still at sea merely because a supplier uploaded a bill of lading — that is what the
 * transit allowance is for. And a buyer must not be able to withhold payment indefinitely by
 * refusing to acknowledge anything ever arrived — that is the hostage position the whole contract
 * exists to remove. Every test below is one side or the other of that pair.
 */
contract DeliveryTest is SealedRFQFixture {
    uint128 internal constant PRICE = 2_800_000;
    uint32 internal constant TRANSIT = 10 days;

    /** An RFQ whose goods are expected to spend time in freight. */
    function goodsRfq() internal returns (uint256 id) {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.transitWindow = TRANSIT;
        vm.prank(buyer);
        id = registry.createRFQ(p);

        commit(id, s1, PRICE, 21);
        commit(id, s2, 2_950_000, 14);
        toReveal(id);
        reveal(id, s1, PRICE, 21);
        reveal(id, s2, 2_950_000, 14);
        toAward(id);
        awardTo(id, s1);
        submitCurrent(id, keccak256("bill-of-lading"));
    }

    // ───────────── the buyer confirms ─────────────

    function test_confirmReceipt_startsTheInspectionClockAtReceipt() public {
        uint256 id = goodsRfq();
        assertEq(adapter.getEngagement(id).receivedAt, 0, "nothing received yet");

        vm.warp(block.timestamp + 6 days); // arrived early, inside the transit allowance
        vm.prank(buyer);
        adapter.confirmReceipt(id);

        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        assertEq(e.receivedAt, uint64(block.timestamp), "receipt recorded");

        // Inspection runs from arrival, so payment is due before the silent path would have allowed.
        vm.warp(block.timestamp + ACCEPTANCE - 1);
        vm.expectRevert();
        adapter.autoRelease(id);

        uint256 before = usdc.balanceOf(s1);
        vm.warp(block.timestamp + 1);
        adapter.autoRelease(id);
        assertGt(usdc.balanceOf(s1), before, "supplier paid");
    }

    function test_confirmingEarlyPaysSoonerThanSayingNothing() public {
        uint256 id = goodsRfq();
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        uint64 silentPath = e.submittedAt + TRANSIT + ACCEPTANCE;

        vm.warp(block.timestamp + 2 days);
        vm.prank(buyer);
        adapter.confirmReceipt(id);

        // Confirming is in the buyer's own interest only if it does not cost them inspection time,
        // and in the supplier's because it brings payment forward. Both hold.
        uint64 confirmedPath = adapter.getEngagement(id).receivedAt + ACCEPTANCE;
        assertLt(confirmedPath, silentPath, "receipt brings the clock forward");
    }

    function test_onlyTheBuyerConfirms() public {
        uint256 id = goodsRfq();
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(ISealedRFQAdapter.NotBuyer.selector, s1));
        adapter.confirmReceipt(id);
    }

    function test_receiptCannotBeReplayedToRestartInspection() public {
        uint256 id = goodsRfq();
        vm.prank(buyer);
        adapter.confirmReceipt(id);
        vm.warp(block.timestamp + 1 days);
        vm.prank(buyer);
        vm.expectRevert(ISealedRFQAdapter.AlreadyReceived.selector);
        adapter.confirmReceipt(id);
    }

    function test_cannotConfirmReceiptOfSomethingNeverSent() public {
        uint256 id = createRFQ();
        commit(id, s1, PRICE, 21);
        commit(id, s2, 2_950_000, 14);
        toReveal(id);
        reveal(id, s1, PRICE, 21);
        reveal(id, s2, 2_950_000, 14);
        toAward(id);
        awardTo(id, s1);

        vm.prank(buyer);
        vm.expectRevert(ISealedRFQAdapter.NothingSubmitted.selector);
        adapter.confirmReceipt(id);
    }

    // ───────────── the buyer says nothing ─────────────

    function test_silenceDoesNotPayWhileTheGoodsCouldStillBeInTransit() public {
        uint256 id = goodsRfq();
        // The old rule paid here. It would have released money for a container still at sea.
        vm.warp(block.timestamp + ACCEPTANCE + 1);
        vm.expectRevert();
        adapter.autoRelease(id);
    }

    function test_silenceStillPaysEventually() public {
        // The liveness guarantee, and the reason receipt is not a gate. A buyer who never
        // acknowledges anything must not be able to keep the money indefinitely.
        uint256 id = goodsRfq();
        uint256 before = usdc.balanceOf(s1);
        vm.warp(block.timestamp + TRANSIT + ACCEPTANCE + 1);
        adapter.autoRelease(id);
        assertGt(usdc.balanceOf(s1), before, "supplier paid despite total silence");
    }

    function test_aFileDeliverableBehavesExactlyAsBefore() public {
        // transitWindow defaults to zero, so nothing about a software tender changes.
        uint256 id = rfqReadyToAward();
        awardTo(id, s1);
        submitCurrent(id, keccak256("report.pdf"));

        vm.warp(block.timestamp + ACCEPTANCE - 1);
        vm.expectRevert();
        adapter.autoRelease(id);
        uint256 before = usdc.balanceOf(s1);
        vm.warp(block.timestamp + 1);
        adapter.autoRelease(id);
        assertGt(usdc.balanceOf(s1), before, "paid on the acceptance window alone");
    }

    // ───────────── extending a delivery window ─────────────

    function test_extendDelivery_letsALateSupplierStillDeliver() public {
        uint256 id = createRFQ();
        commit(id, s1, PRICE, 21);
        commit(id, s2, 2_950_000, 14);
        toReveal(id);
        reveal(id, s1, PRICE, 21);
        reveal(id, s2, 2_950_000, 14);
        toAward(id);
        awardTo(id, s1);

        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        uint64 extended = e.deliveryDeadline + 12 hours;
        vm.prank(buyer);
        adapter.extendDelivery(id, extended);
        assertEq(adapter.getEngagement(id).deliveryDeadline, extended, "deadline moved");

        // Past the original deadline, inside the new one: the hook must now allow the submission.
        vm.warp(e.deliveryDeadline + 1 hours);
        submitCurrent(id, keccak256("late-but-allowed"));
        assertGt(adapter.getEngagement(id).submittedAt, 0, "accepted after the original deadline");
    }

    function test_onlyTheBuyerExtends() public {
        uint256 id = rfqReadyToAward();
        awardTo(id, s1);
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(ISealedRFQAdapter.NotBuyer.selector, s1));
        adapter.extendDelivery(id, e.deliveryDeadline + 1 hours);
    }

    function test_cannotExtendAWindowThatHasAlreadyClosed() public {
        // Reopening a forfeiture is a different decision from preventing one, and the contract
        // should not let a buyer quietly make it after the fact.
        uint256 id = rfqReadyToAward();
        awardTo(id, s1);
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        vm.warp(uint256(e.deliveryDeadline) + 1);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(ISealedRFQAdapter.DeliveryWindowClosed.selector, e.deliveryDeadline)
        );
        adapter.extendDelivery(id, e.deliveryDeadline + 1 days);
    }

    function test_extensionMustMoveForwardAndFitInsideTheJob() public {
        uint256 id = rfqReadyToAward();
        awardTo(id, s1);
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);

        vm.prank(buyer);
        vm.expectRevert();
        adapter.extendDelivery(id, e.deliveryDeadline); // not forward

        // Past the job's own expiry there would be no room left to inspect, so it is refused.
        IAgenticCommerce.Job memory job = acp.getJob(e.currentJobId);
        vm.prank(buyer);
        vm.expectRevert();
        adapter.extendDelivery(id, uint64(job.expiredAt));
    }
}
