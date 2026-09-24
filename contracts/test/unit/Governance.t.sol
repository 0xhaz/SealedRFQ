// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AttestationLog} from "../../src/governance/AttestationLog.sol";
import {ProcurementPolicy} from "../../src/governance/ProcurementPolicy.sol";
import {AttestationKinds, Roles} from "../../src/governance/Roles.sol";
import {IAttestationLog} from "../../src/interfaces/IAttestationLog.sol";
import {IProcurementPolicy} from "../../src/interfaces/IProcurementPolicy.sol";

contract AttestationLogTest is Test {
    AttestationLog attestations;
    address admin = makeAddr("admin");
    address evaluator = makeAddr("evaluator");
    address verifier = makeAddr("verifier");

    function setUp() public {
        attestations = new AttestationLog(admin);
        vm.startPrank(admin);
        attestations.grantRole(Roles.EVALUATOR, evaluator);
        attestations.grantRole(Roles.VERIFIER, verifier);
        vm.stopPrank();
    }

    function test_attest_recordsActorKindModelTime() public {
        vm.warp(1_789_835_952);
        vm.prank(evaluator);
        attestations.attest(AttestationKinds.BID_EVALUATION, 7, keccak256("memo"), "claude-opus-5");
        IAttestationLog.Attestation memory a = attestations.getAttestation(7, keccak256("memo"));
        assertEq(a.actor, evaluator);
        assertEq(a.ts, 1_789_835_952);
        assertEq(a.kind, AttestationKinds.BID_EVALUATION);
        assertEq(a.model, "claude-opus-5");
        assertTrue(attestations.isAttested(7, keccak256("memo"), AttestationKinds.BID_EVALUATION));
        assertFalse(attestations.isAttested(7, keccak256("memo"), AttestationKinds.AWARD_RECOMMENDATION));
    }

    function test_rejectionsAreAnchoredToo() public {
        vm.prank(evaluator);
        attestations.attest(AttestationKinds.AWARD_REJECTION, 7, keccak256("no award"), "m");
        assertTrue(attestations.isAttested(7, keccak256("no award"), AttestationKinds.AWARD_REJECTION));
    }

    function test_roleSeparation() public {
        vm.prank(verifier); // a VERIFIER cannot write evaluations
        vm.expectRevert(
            abi.encodeWithSelector(
                IAttestationLog.NotAuthorizedForKind.selector, verifier, AttestationKinds.BID_EVALUATION
            )
        );
        attestations.attest(AttestationKinds.BID_EVALUATION, 1, keccak256("m"), "m");

        vm.prank(evaluator); // an EVALUATOR cannot sign off milestones
        vm.expectRevert(
            abi.encodeWithSelector(
                IAttestationLog.NotAuthorizedForKind.selector, evaluator, AttestationKinds.MILESTONE_ACCEPT
            )
        );
        attestations.attest(AttestationKinds.MILESTONE_ACCEPT, 1, keccak256("m"), "m");
    }

    function test_guards() public {
        vm.startPrank(evaluator);
        vm.expectRevert(abi.encodeWithSelector(IAttestationLog.UnknownKind.selector, bytes32("NOPE")));
        attestations.attest("NOPE", 1, keccak256("m"), "m");
        vm.expectRevert(IAttestationLog.ZeroHash.selector);
        attestations.attest(AttestationKinds.BID_EVALUATION, 1, bytes32(0), "m");
        attestations.attest(AttestationKinds.BID_EVALUATION, 1, keccak256("m"), "m");
        vm.expectRevert(abi.encodeWithSelector(IAttestationLog.AlreadyAttested.selector, 1, keccak256("m")));
        attestations.attest(AttestationKinds.BID_EVALUATION, 1, keccak256("m"), "m");
        vm.stopPrank();
    }
}

contract ProcurementPolicyTest is Test {
    ProcurementPolicy policy;
    address admin = makeAddr("admin");

    function setUp() public {
        policy = new ProcurementPolicy(
            admin,
            IProcurementPolicy.Policy({
                maxAwardBps: 9_000,
                minRevealedBids: 3,
                minDepositBps: 500,
                minBuyerStakeBps: 500,
                maxSupplierShareBps: 5_000,
                concentrationFloor: 10e6,
                agentAwardCap: type(uint128).max
            })
        );
    }

    function _ok() internal pure returns (IProcurementPolicy.AwardCheck memory c) {
        c = IProcurementPolicy.AwardCheck({
            budget: 3e6,
            price: 2.5e6,
            deposit: 250_000,
            revealedBids: 3,
            rubricHash: "r",
            expectedRubricHash: "r",
            buyerAwardedTotal: 0,
            buyerSupplierTotal: 0
        });
    }

    function test_passes() public view {
        policy.checkAward(_ok());
    }

    function test_maxAwardBps_isAShareOfBudget() public {
        IProcurementPolicy.AwardCheck memory c = _ok();
        c.price = 2.8e6; // cap = 90% of 3.00 = 2.70
        vm.expectRevert(abi.encodeWithSelector(IProcurementPolicy.AwardExceedsBudget.selector, 2.8e6, 2.7e6));
        policy.checkAward(c);
    }

    function test_concentration_appliesAboveFloor() public {
        IProcurementPolicy.AwardCheck memory c = _ok();
        c.buyerAwardedTotal = 8e6;
        c.buyerSupplierTotal = 4e6; // (4 + 2.5) / (8 + 2.5) = 61.9% > 50%
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.ConcentrationCapExceeded.selector, 6_190, 5_000)
        );
        policy.checkAward(c);

        c.buyerAwardedTotal = 5e6; // new total 7.5 < floor 10: not applied yet
        policy.checkAward(c);
    }

    function test_checkOrder_rubricFirst() public {
        IProcurementPolicy.AwardCheck memory c = _ok();
        c.rubricHash = "x";
        c.revealedBids = 0;
        c.price = 99e6;
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.RubricMismatch.selector, bytes32("x"), bytes32("r"))
        );
        policy.checkAward(c);
    }

    function test_setPolicy_adminOnlyAndValidated() public {
        IProcurementPolicy.Policy memory p = policy.policy();
        vm.expectRevert();
        policy.setPolicy(p);

        p.maxAwardBps = 0;
        vm.prank(admin);
        vm.expectRevert(IProcurementPolicy.InvalidPolicy.selector);
        policy.setPolicy(p);
    }

    /// deposit >= ceil(price * minDepositBps / 10000): the exact minimum passes, one unit less fails.
    function testFuzz_depositRatioBoundary(uint64 price) public {
        IProcurementPolicy.AwardCheck memory c = _ok();
        c.price = bound(price, 20, 2.7e6);
        uint256 required = (c.price * 500 + 9_999) / 10_000;
        c.deposit = required;
        policy.checkAward(c);
        c.deposit = required - 1;
        vm.expectRevert(
            abi.encodeWithSelector(IProcurementPolicy.DepositRatioTooLow.selector, required - 1, required)
        );
        policy.checkAward(c);
    }
}
