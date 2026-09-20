// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {AgenticCommerce} from "../../src/core/AgenticCommerce.sol";
import {IAgenticCommerce} from "../../src/core/IAgenticCommerce.sol";
import {AttestationLog} from "../../src/governance/AttestationLog.sol";
import {AttestationKinds} from "../../src/governance/Roles.sol";
import {IRFQRegistry} from "../../src/interfaces/IRFQRegistry.sol";
import {ISealedRFQAdapter} from "../../src/interfaces/ISealedRFQAdapter.sol";
import {RFQRegistry} from "../../src/rfq/RFQRegistry.sol";
import {SealedRFQAdapter} from "../../src/rfq/SealedRFQAdapter.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {SealedRFQFixture} from "../utils/SealedRFQFixture.sol";

/// @notice Drives random interleavings of every lifecycle action across many RFQs. Reverting calls
///         are simply discarded by the fuzzer; the invariants must hold after every successful one.
contract Handler is Test {
    RFQRegistry registry;
    SealedRFQAdapter adapter;
    AgenticCommerce acp;
    AttestationLog attestations;
    MockUSDC usdc;
    address buyer;
    address evaluator;
    address awarder;
    address arbiter;
    address[3] suppliers;
    IRFQRegistry.RFQParams params;

    uint256[] public rfqIds;
    uint256[] public engaged;
    /// Successful calls per action, to prove the fuzzer reaches deep states (logged with -vv).
    mapping(bytes32 => uint256) public ghost;
    mapping(uint256 => mapping(address => uint128)) public bidPrice;

    constructor(
        RFQRegistry r,
        SealedRFQAdapter a,
        AgenticCommerce c,
        AttestationLog l,
        MockUSDC u,
        address[7] memory people,
        IRFQRegistry.RFQParams memory p
    ) {
        (registry, adapter, acp, attestations, usdc) = (r, a, c, l, u);
        (buyer, evaluator, awarder, arbiter) = (people[0], people[1], people[2], people[3]);
        suppliers = [people[4], people[5], people[6]];
        params = p;
    }

    function _rfq(uint256 seed) internal view returns (uint256) {
        return rfqIds.length == 0 ? 0 : rfqIds[seed % rfqIds.length];
    }

    function _engaged(uint256 seed) internal view returns (uint256) {
        return engaged.length == 0 ? 0 : engaged[seed % engaged.length];
    }

    function _supplier(uint256 seed) internal view returns (address) {
        return suppliers[seed % 3];
    }

    function create() external {
        IRFQRegistry.RFQParams memory p = params;
        p.bidDeadline = uint64(block.timestamp + 1 days);
        p.revealDeadline = uint64(block.timestamp + 2 days);
        p.awardDeadline = uint64(block.timestamp + 3 days);
        vm.prank(buyer);
        rfqIds.push(registry.createRFQ(p));
    }

    /// @dev Composite step so the fuzzer reaches award/milestone/dispute states: a fresh RFQ with
    ///      three sealed bids (one may be over budget, one may stay unrevealed), walked to its award window.
    function openToAward(uint128 p0, uint128 p1, uint128 p2, bool skipLast) external {
        IRFQRegistry.RFQParams memory p = params;
        p.bidDeadline = uint64(block.timestamp + 1 hours);
        p.revealDeadline = uint64(block.timestamp + 2 hours);
        p.awardDeadline = uint64(block.timestamp + 2 hours + 1 days);
        vm.prank(buyer);
        uint256 id = registry.createRFQ(p);
        rfqIds.push(id);
        uint128[3] memory prices =
            [uint128(bound(p0, 1, 3.5e6)), uint128(bound(p1, 1, 3.5e6)), uint128(bound(p2, 1, 3.5e6))];
        for (uint256 i; i < 3; ++i) {
            bytes32 salt = bytes32(uint256(uint160(suppliers[i])));
            bytes32 h = registry.computeCommitment(id, suppliers[i], prices[i], 7, bytes32(0), salt);
            vm.prank(suppliers[i]);
            registry.commitBid(id, h);
            bidPrice[id][suppliers[i]] = prices[i];
        }
        vm.warp(p.bidDeadline);
        for (uint256 i; i < (skipLast ? 2 : 3); ++i) {
            vm.prank(suppliers[i]);
            registry.revealBid(id, prices[i], 7, bytes32(0), bytes32(uint256(uint160(suppliers[i]))));
        }
        vm.warp(p.revealDeadline);
        ghost["openToAward"]++;
    }

    function commit(uint256 rfqSeed, uint256 who, uint128 price) external {
        uint256 id = _rfq(rfqSeed);
        address s = _supplier(who);
        price = uint128(bound(price, 1, 3.5e6));
        bytes32 h = registry.computeCommitment(id, s, price, 7, bytes32(0), bytes32(uint256(uint160(s))));
        vm.prank(s);
        registry.commitBid(id, h);
        bidPrice[id][s] = price;
    }

    function reveal(uint256 rfqSeed, uint256 who) external {
        uint256 id = _rfq(rfqSeed);
        address s = _supplier(who);
        vm.prank(s);
        registry.revealBid(id, bidPrice[id][s], 7, bytes32(0), bytes32(uint256(uint160(s))));
    }

    function award(uint256 who) external {
        if (rfqIds.length == 0) return;
        uint256 id = rfqIds[rfqIds.length - 1];
        address s = _supplier(who);
        bytes32 memo = keccak256(abi.encode(id, s, block.timestamp));
        uint256 subject = registry.awardSubject(id, s);
        if (!attestations.isAttested(subject, memo, AttestationKinds.AWARD_RECOMMENDATION)) {
            vm.prank(evaluator);
            attestations.attest(AttestationKinds.AWARD_RECOMMENDATION, subject, memo, "m");
        }
        vm.prank(awarder);
        registry.award(id, s, memo, params.rubricHash);
        engaged.push(id);
        ghost["award"]++;
    }

    function closeNoAward(uint256 rfqSeed) external {
        registry.closeNoAward(_rfq(rfqSeed));
        ghost["closeNoAward"]++;
    }

    function settleDeposit(uint256 rfqSeed, uint256 who) external {
        registry.settleDeposit(_rfq(rfqSeed), _supplier(who));
    }

    function submit(uint256 rfqSeed) external {
        uint256 id = _engaged(rfqSeed);
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        vm.prank(e.supplier);
        acp.submit(e.currentJobId, keccak256(abi.encode(id, block.timestamp)), "");
        ghost["submit"]++;
    }

    function accept(uint256 rfqSeed) external {
        vm.prank(buyer);
        adapter.acceptMilestone(_engaged(rfqSeed), "ok");
        ghost["accept"]++;
    }

    function reject(uint256 rfqSeed) external {
        vm.prank(buyer);
        adapter.rejectMilestone(_engaged(rfqSeed), "no");
        ghost["reject"]++;
    }

    function autoRelease(uint256 rfqSeed) external {
        adapter.autoRelease(_engaged(rfqSeed));
        ghost["autoRelease"]++;
    }

    function settleExpired(uint256 rfqSeed) external {
        adapter.settleExpired(_engaged(rfqSeed));
        ghost["settleExpired"]++;
    }

    /// @dev Anyone may call ERC-8183 claimRefund directly, bypassing the adapter.
    function claimRefundDirect(uint256 rfqSeed) external {
        acp.claimRefund(adapter.getEngagement(_engaged(rfqSeed)).currentJobId);
        ghost["claimRefundDirect"]++;
    }

    function raiseDispute(uint256 rfqSeed) external {
        uint256 id = _engaged(rfqSeed);
        vm.prank(adapter.getEngagement(id).supplier);
        adapter.raiseDispute(id);
    }

    function resolve(uint256 rfqSeed, uint16 bps) external {
        vm.prank(arbiter);
        adapter.resolveDispute(_engaged(rfqSeed), uint16(bound(bps, 0, 10_000)), "r");
        ghost["resolve"]++;
    }

    function finalizeRejection(uint256 rfqSeed) external {
        adapter.finalizeRejection(_engaged(rfqSeed));
        ghost["finalizeRejection"]++;
    }

    function withdraw(uint256 who, bool fromAdapter) external {
        address[5] memory all = [buyer, suppliers[0], suppliers[1], suppliers[2], evaluator];
        vm.prank(all[who % 5]);
        if (fromAdapter) adapter.withdraw();
        else registry.withdraw();
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 minutes, 1 days));
    }
}

contract AccountingInvariantTest is SealedRFQFixture {
    Handler handler;

    function setUp() public override {
        super.setUp();
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.deliveryWindow = 1 days;
        p.acceptanceWindow = 1 days;
        handler = new Handler(
            registry, adapter, acp, attestations, usdc, [buyer, evaluator, awarder, arbiter, s1, s2, s3], p
        );
        usdc.mint(buyer, 10_000 * USDC);
        targetContract(address(handler));
    }

    function afterInvariant() external view {
        bytes32[11] memory k = [
            bytes32("openToAward"),
            "award",
            "accept",
            "autoRelease",
            "reject",
            "resolve",
            "finalizeRejection",
            "settleExpired",
            "claimRefundDirect",
            "closeNoAward",
            "submit"
        ];
        for (uint256 i; i < k.length; ++i) {
            console2.log(string(abi.encodePacked(k[i])), handler.ghost(k[i]));
        }
    }

    /// Registry: every unit it holds is either escrowed for an RFQ/deposit or owed to someone.
    function invariant_registryAccounting() public view {
        assertEq(registry.totalHeld() + registry.totalWithdrawable(), usdc.balanceOf(address(registry)));
    }

    /// Adapter: never owes more than it holds (== except after a direct ERC-8183 claimRefund,
    /// which parks the refund until settleExpired books it).
    function invariant_adapterSolvent() public view {
        assertGe(usdc.balanceOf(address(adapter)), adapter.totalHeld() + adapter.totalWithdrawable());
    }

    /// AgenticCommerce holds exactly the budgets of live (Funded/Submitted) jobs.
    function invariant_acpHoldsLiveBudgets() public view {
        uint256 live;
        uint256 n = acp.jobCounter();
        for (uint256 j = 1; j <= n; ++j) {
            IAgenticCommerce.Job memory job = acp.getJob(j);
            if (
                job.status == IAgenticCommerce.JobStatus.Funded
                    || job.status == IAgenticCommerce.JobStatus.Submitted
            ) {
                live += job.budget;
            }
        }
        assertEq(usdc.balanceOf(address(acp)), live);
    }
}
