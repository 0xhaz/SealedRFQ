// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgenticCommerce} from "../../src/core/IAgenticCommerce.sol";
import {ISealedRFQAdapter} from "../../src/interfaces/ISealedRFQAdapter.sol";
import {AttestationKinds, Roles} from "../../src/governance/Roles.sol";
import {SealedRFQFixture} from "../utils/SealedRFQFixture.sol";

contract SealedRFQAdapterTest is SealedRFQFixture {
    uint256 internal id;
    uint128 internal constant PRICE = 2_800_000;

    function setUp() public override {
        super.setUp();
        id = rfqReadyToAward();
        awardTo(id, s1);
    }

    // ───────────── happy path ─────────────

    function test_firstMilestoneFundedOnAward() public view {
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        // milestone 1 = 30% of 2.80 = 0.84 gross, 10% retention 0.084, job budget 0.756
        assertEq(e.allocated, 840_000);
        assertEq(e.retentionHeld, 84_000);
        assertEq(e.currentJobBudget, 756_000);
        IAgenticCommerce.Job memory job = acp.getJob(e.currentJobId);
        assertEq(uint8(job.status), uint8(IAgenticCommerce.JobStatus.Funded));
        assertEq(job.client, address(adapter));
        assertEq(job.provider, s1);
        assertEq(job.evaluator, address(adapter));
        assertEq(job.hook, address(adapter));
        assertEq(job.budget, 756_000);
        assertEq(job.description, "SealedRFQ #1 milestone 1");
        assertEq(adapter.jobToRfq(e.currentJobId), id);
    }

    function test_fullLifecycle_threeMilestones_exactPayouts() public {
        uint256 s1Before = usdc.balanceOf(s1);
        for (uint256 i; i < 3; ++i) {
            submitCurrent(id, keccak256(abi.encode("deliverable", i)));
            acceptCurrent(id);
        }
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        assertEq(uint8(e.status), uint8(ISealedRFQAdapter.EngagementStatus.Completed));

        // jobs paid 90% of 2.80 directly; retention (0.28) + performance stake (0.25) are withdrawable
        assertEq(usdc.balanceOf(s1) - s1Before, 2_520_000);
        assertEq(adapter.withdrawable(s1), 280_000 + DEPOSIT);
        assertEq(adapter.withdrawable(buyer), 150_000, "buyer stake back");

        registry.settleDeposit(id, s2);
        registry.settleDeposit(id, s3);
        _withdrawEveryone();
        // supplier: -0.25 deposit + 2.80 price + 0.25 stake back; buyer: -2.80 net
        assertEq(usdc.balanceOf(s1), 100 * USDC + PRICE);
        assertEq(usdc.balanceOf(buyer), 100 * USDC - PRICE);
        assertEq(usdc.balanceOf(s2), 100 * USDC);
        assertEq(usdc.balanceOf(s3), 100 * USDC);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(usdc.balanceOf(address(registry)), 0);
        assertEq(usdc.balanceOf(address(acp)), 0);
    }

    // ───────────── auto-release ─────────────

    function test_autoRelease_afterBuyerSilence() public {
        submitCurrent(id, "d1");
        vm.expectRevert(
            abi.encodeWithSelector(
                ISealedRFQAdapter.AcceptanceWindowOpen.selector, uint64(block.timestamp + ACCEPTANCE)
            )
        );
        adapter.autoRelease(id);

        vm.warp(block.timestamp + ACCEPTANCE);
        vm.prank(stranger);
        adapter.autoRelease(id);
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        assertEq(e.currentMilestone, 1, "moved to milestone 2");
        assertEq(usdc.balanceOf(s1), 100 * USDC - DEPOSIT + 756_000);
    }

    function test_autoRelease_requiresSubmission() public {
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(ISealedRFQAdapter.WrongJobStatus.selector);
        adapter.autoRelease(id);
    }

    // ───────────── reviewers ─────────────

    function test_verifierNeedsAttestedReason() public {
        submitCurrent(id, "d1");
        bytes32 reason = keccak256("verifier memo");
        vm.prank(verifier);
        vm.expectRevert(abi.encodeWithSelector(ISealedRFQAdapter.ReasonNotAttested.selector, reason));
        adapter.acceptMilestone(id, reason);

        vm.prank(verifier);
        attestations.attest(AttestationKinds.MILESTONE_ACCEPT, id, reason, MODEL);
        vm.prank(verifier);
        adapter.acceptMilestone(id, reason);
        assertEq(adapter.getEngagement(id).currentMilestone, 1);
    }

    function test_strangerCannotReview() public {
        submitCurrent(id, "d1");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ISealedRFQAdapter.NotBuyerOrVerifier.selector, stranger));
        adapter.acceptMilestone(id, "ok");
    }

    function test_cannotAcceptBeforeSubmission() public {
        vm.prank(buyer);
        vm.expectRevert(ISealedRFQAdapter.WrongJobStatus.selector);
        adapter.acceptMilestone(id, "ok");
    }

    // ───────────── rejection & disputes ─────────────

    function test_reject_unchallenged_buyerMadeWhole() public {
        submitCurrent(id, "d1");
        acceptCurrent(id); // milestone 1 paid (0.756)
        submitCurrent(id, "d2");
        vm.prank(buyer);
        adapter.rejectMilestone(id, keccak256("missing SSO integration"));
        assertEq(uint8(adapter.getEngagement(id).status), uint8(ISealedRFQAdapter.EngagementStatus.Rejected));

        vm.expectRevert();
        adapter.finalizeRejection(id); // dispute window still open
        vm.warp(block.timestamp + ACCEPTANCE);
        adapter.finalizeRejection(id);

        // buyer gets: unpaid price (2.80 - 0.756 paid) + buyer stake + performance stake
        assertEq(adapter.withdrawable(buyer), PRICE - 756_000 + 150_000 + DEPOSIT);
        assertAccounting();
    }

    function test_reject_requiresReason() public {
        submitCurrent(id, "d1");
        vm.prank(buyer);
        vm.expectRevert(ISealedRFQAdapter.ReasonRequired.selector);
        adapter.rejectMilestone(id, bytes32(0));
    }

    function test_dispute_arbiterSplits() public {
        submitCurrent(id, "d1");
        vm.prank(buyer);
        adapter.rejectMilestone(id, keccak256("not what we asked for"));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ISealedRFQAdapter.NotSupplier.selector, stranger));
        adapter.raiseDispute(id);
        vm.prank(s1);
        adapter.raiseDispute(id);

        vm.prank(buyer);
        vm.expectRevert(); // only ARBITER
        adapter.resolveDispute(id, 5_000, "split");

        uint256 pot = PRICE + 150_000 + DEPOSIT;
        vm.prank(arbiter);
        adapter.resolveDispute(id, 5_000, keccak256("arbiter ruling"));
        assertEq(adapter.withdrawable(s1), pot / 2);
        assertEq(adapter.withdrawable(buyer), pot - pot / 2);
        assertAccounting();
    }

    function test_dispute_windowCloses() public {
        submitCurrent(id, "d1");
        vm.prank(buyer);
        adapter.rejectMilestone(id, keccak256("no"));
        vm.warp(block.timestamp + ACCEPTANCE);
        vm.prank(s1);
        vm.expectRevert();
        adapter.raiseDispute(id);
    }

    // ───────────── deadlines & expiry ─────────────

    function test_lateSubmissionBlockedByHook() public {
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        vm.warp(e.deliveryDeadline + 1);
        vm.prank(s1);
        vm.expectRevert(
            abi.encodeWithSelector(ISealedRFQAdapter.DeliveryWindowClosed.selector, e.deliveryDeadline)
        );
        acp.submit(e.currentJobId, "late", "");
    }

    function test_neverDelivered_abandonedToBuyer() public {
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        // While the supplier still has time, settling is refused — the deadline, not the job's
        // expiry, is what gates it now.
        vm.expectRevert(
            abi.encodeWithSelector(ISealedRFQAdapter.DeliveryWindowOpen.selector, e.deliveryDeadline)
        );
        adapter.settleExpired(id);

        // And the moment it passes, settlement works. It used to wait a further transit and two
        // acceptance windows, a stretch in which the contract permitted nothing at all.
        vm.warp(uint256(e.deliveryDeadline) + 1);
        assertLt(block.timestamp, acp.getJob(e.currentJobId).expiredAt, "still inside the old gap");
        adapter.settleExpired(id);
        assertEq(uint8(adapter.getEngagement(id).status), uint8(ISealedRFQAdapter.EngagementStatus.Abandoned));
        // The buyer is made whole, not enriched. They get every penny that was never earned — the
        // whole price, their own stake — plus damages measured at what re-procuring would actually
        // have cost: s2 revealed 2.95 against the 2.80 awarded, so 0.15. The rest of the supplier's
        // 0.25 stake is returned, because a security is available to offset a loss rather than
        // forfeited for its own sake.
        uint256 excess = 2_950_000 - PRICE;
        assertEq(
            adapter.withdrawable(buyer),
            PRICE + 150_000 + excess,
            "buyer covered for the real cost of re-procuring"
        );
        assertEq(adapter.withdrawable(s1), DEPOSIT - excess, "unneeded stake returned");
        assertAccounting();
    }

    function test_deliveredButUnreviewed_expiryPaysSupplier_evenIfRefundClaimedDirectly() public {
        submitCurrent(id, "d1");
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        vm.warp(acp.getJob(e.currentJobId).expiredAt);
        // Anyone may hit ERC-8183 claimRefund directly: funds come back to the adapter...
        vm.prank(stranger);
        acp.claimRefund(e.currentJobId);
        // ...and settleExpired still pays the supplier who delivered, then opens milestone 2.
        adapter.settleExpired(id);
        assertEq(adapter.withdrawable(s1), 756_000);
        assertEq(adapter.getEngagement(id).currentMilestone, 1);
        assertAccounting();
    }

    // ───────────── access & hook ─────────────

    function test_onlyRegistryStartsEngagements() public {
        ISealedRFQAdapter.EngagementTerms memory t;
        vm.prank(stranger);
        vm.expectRevert();
        adapter.startEngagement(99, t);
    }

    function test_hookOnlyCallableByAgenticCommerce() public {
        vm.expectRevert(ISealedRFQAdapter.OnlyAgenticCommerce.selector);
        adapter.afterAction(1, IAgenticCommerce.submit.selector, abi.encode(s1, bytes32("x"), bytes("")));
    }

    function test_supportsIACPHook() public view {
        assertTrue(adapter.supportsInterface(0x01ffc9a7)); // ERC-165
        assertTrue(adapter.hasRole(Roles.REGISTRY, address(registry)));
    }

    function _withdrawEveryone() internal {
        withdrawAll(buyer);
        withdrawAll(s1);
        withdrawAll(s2);
        withdrawAll(s3);
    }
}
