// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IRFQRegistry} from "../../src/interfaces/IRFQRegistry.sol";
import {IProcurementPolicy} from "../../src/interfaces/IProcurementPolicy.sol";
import {ISealedRFQAdapter} from "../../src/interfaces/ISealedRFQAdapter.sol";
import {ISupplierQualifier} from "../../src/interfaces/ISupplierQualifier.sol";
import {AttestationKinds} from "../../src/governance/Roles.sol";
import {SealedRFQFixture} from "../utils/SealedRFQFixture.sol";

contract MockQualifier is ISupplierQualifier {
    mapping(address => bool) public isQualified;

    function set(address s, bool q) external {
        isQualified[s] = q;
    }
}

contract RFQRegistryTest is SealedRFQFixture {
    // ───────────── create ─────────────

    function test_create_escrowsBudgetAndStake_fundedBeforeOpen() public {
        uint256 before = usdc.balanceOf(buyer);
        uint256 id = createRFQ();
        IRFQRegistry.RFQ memory r = registry.getRFQ(id);
        assertEq(id, 1);
        assertEq(r.buyer, buyer);
        assertEq(r.buyerStake, 150_000);
        assertEq(uint8(registry.phase(id)), uint8(IRFQRegistry.Phase.Bidding));
        assertEq(before - usdc.balanceOf(buyer), BUDGET + 150_000);
        assertEq(registry.totalHeld(), BUDGET + 150_000);
        assertEq(registry.milestoneBps(id).length, 3);
        assertAccounting();
    }

    function test_create_revertsOnBadParams() public {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.budget = 0;
        _expectCreateRevert(p, abi.encodeWithSelector(IRFQRegistry.InvalidAmount.selector));

        p = defaultParams();
        p.revealDeadline = p.bidDeadline;
        _expectCreateRevert(p, abi.encodeWithSelector(IRFQRegistry.InvalidDeadlines.selector));

        p = defaultParams();
        p.milestoneBps[2] = 3_999;
        _expectCreateRevert(p, abi.encodeWithSelector(IRFQRegistry.InvalidMilestones.selector));

        p = defaultParams();
        p.retentionBps = 5_001;
        _expectCreateRevert(p, abi.encodeWithSelector(IRFQRegistry.InvalidBps.selector));

        p = defaultParams();
        p.deliveryWindow = 4 minutes;
        _expectCreateRevert(p, abi.encodeWithSelector(IRFQRegistry.InvalidWindows.selector));

        p = defaultParams();
        p.buyerStakeBps = 100;
        _expectCreateRevert(p, abi.encodeWithSelector(IProcurementPolicy.BuyerStakeTooLow.selector, 100, 500));
    }

    function test_createWithPermit() public {
        uint256 pk = 0xA11CE;
        address b = vm.addr(pk);
        usdc.mint(b, 10 * USDC);
        IRFQRegistry.RFQParams memory p = defaultParams();
        uint256 amount = BUDGET + 150_000;
        (uint8 v, bytes32 r, bytes32 s) =
            _signPermit(pk, b, address(registry), amount, block.timestamp + 1 hours);
        vm.prank(b);
        uint256 id = registry.createRFQWithPermit(p, block.timestamp + 1 hours, v, r, s);
        assertEq(registry.getRFQ(id).buyer, b);
    }

    function test_cancel_onlyWithoutBids() public {
        uint256 id = createRFQ();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.NotBuyer.selector, stranger));
        registry.cancelRFQ(id);

        vm.prank(buyer);
        registry.cancelRFQ(id);
        assertEq(registry.withdrawable(buyer), BUDGET + 150_000);

        uint256 id2 = createRFQ();
        commit(id2, s1, 2_800_000, 21);
        vm.prank(buyer);
        vm.expectRevert(IRFQRegistry.CannotCancel.selector);
        registry.cancelRFQ(id2);
        assertAccounting();
    }

    // ───────────── bidding ─────────────

    function test_commit_takesDepositOnce_recommitReplacesHash() public {
        uint256 id = createRFQ();
        commit(id, s1, 2_800_000, 21);
        commit(id, s1, 2_700_000, 21); // changed their mind before the deadline
        IRFQRegistry.Bid memory b = registry.getBid(id, s1);
        assertEq(uint8(b.deposit), uint8(IRFQRegistry.DepositState.Held));
        assertEq(registry.getRFQ(id).commitCount, 1);
        assertEq(usdc.balanceOf(s1), 100 * USDC - DEPOSIT);
        assertEq(b.commitHash, registry.computeCommitment(id, s1, 2_700_000, 21, bytes32(0), salt(s1)));
    }

    function test_commit_rules() public {
        uint256 id = createRFQ();
        vm.prank(buyer);
        vm.expectRevert(IRFQRegistry.BuyerCannotBid.selector);
        registry.commitBid(id, bytes32("x"));

        toReveal(id);
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.WrongPhase.selector, IRFQRegistry.Phase.Reveal));
        registry.commitBid(id, bytes32("x"));
    }

    function test_inviteOnly() public {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.invitees = new address[](1);
        p.invitees[0] = s1;
        vm.prank(buyer);
        uint256 id = registry.createRFQ(p);

        commit(id, s1, 2_800_000, 21);
        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.NotInvited.selector, s2));
        registry.commitBid(id, bytes32("x"));

        address[] memory more = new address[](1);
        more[0] = s2;
        vm.prank(buyer);
        registry.addInvitees(id, more);
        commit(id, s2, 2_900_000, 21);
        assertTrue(registry.isInvited(id, s2));
        assertFalse(registry.isInvited(id, s3));
    }

    function test_requiresQualification() public {
        // The qualifier has to exist before an RFQ may demand qualification; see the test below.
        MockQualifier q = new MockQualifier();
        vm.prank(admin);
        registry.setQualifier(q);

        IRFQRegistry.RFQParams memory p = defaultParams();
        p.requiresQualification = true;
        vm.prank(buyer);
        uint256 id = registry.createRFQ(p);

        // Configured but not qualified: still refused.
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.NotQualified.selector, s1));
        registry.commitBid(id, bytes32("x"));

        q.set(s1, true);
        commit(id, s1, 2_800_000, 21);
    }

    /// @dev _commit fails closed with no qualifier configured, which is right: silently dropping a
    ///      stated requirement would be worse than refusing. But that makes the combination an RFQ
    ///      nobody could ever bid on, so creating one is refused rather than escrowing a budget
    ///      against a tender that cannot receive a single bid.
    function test_requiresQualification_withoutQualifier_cannotBeCreated() public {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.requiresQualification = true;

        vm.prank(buyer);
        vm.expectRevert(IRFQRegistry.QualifierNotSet.selector);
        registry.createRFQ(p);

        // Once a qualifier exists the same parameters are accepted.
        MockQualifier q = new MockQualifier();
        vm.prank(admin);
        registry.setQualifier(q);
        vm.prank(buyer);
        assertGt(registry.createRFQ(p), 0);
    }

    function test_reveal_rules() public {
        uint256 id = createRFQ();
        commit(id, s1, 2_800_000, 21);

        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.WrongPhase.selector, IRFQRegistry.Phase.Bidding));
        registry.revealBid(id, 2_800_000, 21, bytes32(0), salt(s1));

        toReveal(id);
        vm.prank(s1);
        vm.expectRevert(IRFQRegistry.CommitmentMismatch.selector);
        registry.revealBid(id, 2_700_000, 21, bytes32(0), salt(s1)); // lying about the price

        vm.prank(s2);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.NoCommitment.selector, s2));
        registry.revealBid(id, 1, 1, bytes32(0), bytes32(0));

        reveal(id, s1, 2_800_000, 21);
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.AlreadyRevealed.selector, s1));
        registry.revealBid(id, 2_800_000, 21, bytes32(0), salt(s1));

        toAward(id);
        vm.prank(s1);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.WrongPhase.selector, IRFQRegistry.Phase.Award));
        registry.revealBid(id, 2_800_000, 21, bytes32(0), salt(s1));
    }

    function test_commitmentIsBoundToBidder() public {
        uint256 id = createRFQ();
        // s2 copies s1's commitment hash; it cannot be revealed by s2
        bytes32 h = registry.computeCommitment(id, s1, 2_800_000, 21, bytes32(0), salt(s1));
        vm.prank(s2);
        registry.commitBid(id, h);
        toReveal(id);
        vm.prank(s2);
        vm.expectRevert(IRFQRegistry.CommitmentMismatch.selector);
        registry.revealBid(id, 2_800_000, 21, bytes32(0), salt(s1));
    }

    // ───────────── RFP mode: the proposal is sealed too ─────────────

    function test_proposalHash_isBoundToTheCommitment() public {
        bytes32 proposal = sha256("proposal v1: two engineers, 3 sprints, weekly demos");
        uint256 id = createRFQ();
        commit(id, s1, 2_800_000, 21, proposal);
        toReveal(id);

        // Revealing a different proposal than the one committed to cannot match the hash.
        // (sha256 is a precompile staticcall, so hash it before expectRevert, not inside the call.)
        bytes32 rewritten = sha256("proposal v2: rewritten after seeing rivals");
        bytes32 s1Salt = salt(s1);
        vm.prank(s1);
        vm.expectRevert(IRFQRegistry.CommitmentMismatch.selector);
        registry.revealBid(id, 2_800_000, 21, rewritten, s1Salt);

        reveal(id, s1, 2_800_000, 21, proposal);
        assertEq(registry.getBid(id, s1).proposalHash, proposal);
    }

    function test_rfpMode_requiresAProposal() public {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.requiresProposal = true;
        vm.prank(buyer);
        uint256 id = registry.createRFQ(p);
        assertTrue(registry.getRFQ(id).requiresProposal);

        commit(id, s1, 2_800_000, 21, bytes32(0));
        toReveal(id);
        bytes32 s1Salt = salt(s1);
        vm.prank(s1);
        vm.expectRevert(IRFQRegistry.ProposalRequired.selector);
        registry.revealBid(id, 2_800_000, 21, bytes32(0), s1Salt);
    }

    function test_priceOnlyRfq_needsNoProposal() public {
        uint256 id = createRFQ(); // requiresProposal defaults to false
        commit(id, s1, 2_800_000, 21);
        toReveal(id);
        reveal(id, s1, 2_800_000, 21);
        IRFQRegistry.Bid memory b = registry.getBid(id, s1);
        assertTrue(b.revealed);
        assertEq(b.proposalHash, bytes32(0));
    }

    // ───────────── award & policy firewall ─────────────

    function test_award_happyPath_movesEscrowToAdapter() public {
        uint256 id = rfqReadyToAward();
        awardTo(id, s1);

        IRFQRegistry.RFQ memory r = registry.getRFQ(id);
        assertEq(uint8(r.status), uint8(IRFQRegistry.Status.Awarded));
        assertEq(r.winner, s1);
        assertEq(r.awardPrice, 2_800_000);
        assertEq(uint8(registry.getBid(id, s1).deposit), uint8(IRFQRegistry.DepositState.RolledOver));
        assertEq(registry.withdrawable(buyer), BUDGET - 2_800_000, "unused budget back to buyer");

        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        assertEq(uint8(e.status), uint8(ISealedRFQAdapter.EngagementStatus.Active));
        assertEq(e.supplier, s1);
        assertEq(e.performanceStake, DEPOSIT);
        assertEq(e.buyerStake, 150_000);
        assertEq(registry.buyerAwardedTotal(buyer), 2_800_000);
        assertAccounting();
    }

    function test_policyFirewall_overBudgetRecommendationReverts() public {
        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s3); // the AI recommends the 3.40 bid on a 3.00 budget
        vm.prank(awarder);
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.AwardExceedsBudget.selector, 3_400_000, BUDGET)
        );
        registry.award(id, s3, memo, RUBRIC);
    }

    function test_award_requiresRecommendationForThatWinner() public {
        uint256 id = rfqReadyToAward();
        bytes32 memoForS1 = recommend(id, s1);
        vm.prank(awarder);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.EvaluationNotAttested.selector, memoForS1));
        registry.award(id, s2, memoForS1, RUBRIC); // awarder tries to swap the winner
    }

    function test_award_rubricMismatch() public {
        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s1);
        bytes32 other = keccak256("a different rubric");
        vm.prank(awarder);
        vm.expectRevert(abi.encodeWithSelector(IProcurementPolicy.RubricMismatch.selector, other, RUBRIC));
        registry.award(id, s1, memo, other);
    }

    function test_award_insufficientBidders() public {
        uint256 id = createRFQ();
        commit(id, s1, 2_800_000, 21);
        commit(id, s2, 2_900_000, 21);
        toReveal(id);
        reveal(id, s1, 2_800_000, 21); // s2 never reveals
        toAward(id);
        bytes32 memo = recommend(id, s1);
        vm.prank(awarder);
        vm.expectRevert(abi.encodeWithSelector(IProcurementPolicy.InsufficientBidders.selector, 1, 2));
        registry.award(id, s1, memo, RUBRIC);
    }

    function test_award_depositRatio() public {
        vm.prank(admin);
        IProcurementPolicy.Policy memory p = defaultPolicy();
        p.minDepositBps = 1_000; // deposit must be >= 10% of price
        policy.setPolicy(p);
        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s1);
        vm.prank(awarder);
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.DepositRatioTooLow.selector, DEPOSIT, 280_000)
        );
        registry.award(id, s1, memo, RUBRIC);
    }

    function test_award_concentrationCap() public {
        vm.prank(admin);
        IProcurementPolicy.Policy memory p = defaultPolicy();
        p.concentrationFloor = 0; // apply from the first award: 100% share > 40% cap
        policy.setPolicy(p);
        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s1);
        vm.prank(awarder);
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.ConcentrationCapExceeded.selector, 10_000, 4_000)
        );
        registry.award(id, s1, memo, RUBRIC);
    }

    function test_award_authAndTiming() public {
        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s1);
        vm.prank(evaluator); // EVALUATOR recommends but cannot award
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.NotAuthorizedToAward.selector, evaluator));
        registry.award(id, s1, memo, RUBRIC);

        vm.warp(registry.getRFQ(id).awardDeadline);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.WrongPhase.selector, IRFQRegistry.Phase.NoAward));
        registry.award(id, s1, memo, RUBRIC);
    }

    function test_buyerCanAwardTheRecommendedBidder() public {
        uint256 id = rfqReadyToAward();
        bytes32 memo = recommend(id, s2);
        vm.prank(buyer);
        registry.award(id, s2, memo, RUBRIC);
        assertEq(registry.getRFQ(id).winner, s2);
    }

    // ───────────── deposits & closing ─────────────

    function test_settleDeposits_afterAward() public {
        uint256 id = createRFQ();
        commit(id, s1, 2_800_000, 21);
        commit(id, s2, 2_950_000, 14);
        commit(id, s3, 2_990_000, 10);
        toReveal(id);
        reveal(id, s1, 2_800_000, 21);
        reveal(id, s2, 2_950_000, 14); // s3 never reveals
        toAward(id);
        awardTo(id, s1);

        registry.settleDeposit(id, s2);
        registry.settleDeposit(id, s3);
        assertEq(registry.withdrawable(s2), DEPOSIT, "revealed loser refunded");
        assertEq(registry.withdrawable(buyer), BUDGET - 2_800_000 + DEPOSIT, "unrevealed forfeits to buyer");

        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.DepositNotHeld.selector, s1));
        registry.settleDeposit(id, s1); // rolled over
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.DepositNotHeld.selector, s2));
        registry.settleDeposit(id, s2); // already settled
        assertAccounting();
    }

    function test_settleDeposit_notBeforeOutcome() public {
        uint256 id = createRFQ();
        commit(id, s1, 2_800_000, 21);
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.WrongPhase.selector, IRFQRegistry.Phase.Bidding));
        registry.settleDeposit(id, s1);
    }

    function test_closeNoAward_afterDeadline_refundsEverything() public {
        uint256 id = rfqReadyToAward();
        vm.expectRevert(abi.encodeWithSelector(IRFQRegistry.WrongPhase.selector, IRFQRegistry.Phase.Award));
        registry.closeNoAward(id);

        vm.warp(registry.getRFQ(id).awardDeadline);
        vm.prank(stranger);
        registry.closeNoAward(id);
        assertEq(registry.withdrawable(buyer), BUDGET + 150_000);
        registry.settleDeposit(id, s1);
        registry.settleDeposit(id, s2);
        registry.settleDeposit(id, s3);
        assertEq(registry.withdrawable(s3), DEPOSIT);

        withdrawAll(buyer);
        withdrawAll(s1);
        assertEq(usdc.balanceOf(buyer), 100 * USDC);
        assertEq(usdc.balanceOf(s1), 100 * USDC);
        assertAccounting();
    }

    function test_closeNoAward_earlyWhenTooFewReveals() public {
        uint256 id = createRFQ();
        commit(id, s1, 2_800_000, 21);
        toReveal(id);
        reveal(id, s1, 2_800_000, 21);
        toAward(id); // 1 reveal < minRevealedBids (2): award impossible, close right away
        registry.closeNoAward(id);
        assertEq(uint8(registry.phase(id)), uint8(IRFQRegistry.Phase.NoAward));
    }

    // ───────────── helpers ─────────────

    function _expectCreateRevert(IRFQRegistry.RFQParams memory p, bytes memory err) internal {
        vm.prank(buyer);
        vm.expectRevert(err);
        registry.createRFQ(p);
    }

    function _signPermit(uint256 pk, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 typehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash =
            keccak256(abi.encode(typehash, owner, spender, value, usdc.nonces(owner), deadline));
        return vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
    }

    function test_attestationKindsGuarded() public {
        vm.prank(awarder); // AWARDER cannot write recommendations for itself
        vm.expectRevert();
        attestations.attest(AttestationKinds.AWARD_RECOMMENDATION, 1, keccak256("m"), MODEL);
    }
}
