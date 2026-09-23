// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgenticCommerce} from "../../src/core/AgenticCommerce.sol";
import {IAgenticCommerce} from "../../src/core/IAgenticCommerce.sol";
import {AttestationLog} from "../../src/governance/AttestationLog.sol";
import {ProcurementPolicy} from "../../src/governance/ProcurementPolicy.sol";
import {AttestationKinds, Roles} from "../../src/governance/Roles.sol";
import {IProcurementPolicy} from "../../src/interfaces/IProcurementPolicy.sol";
import {IRFQRegistry} from "../../src/interfaces/IRFQRegistry.sol";
import {ISealedRFQAdapter} from "../../src/interfaces/ISealedRFQAdapter.sol";
import {RFQRegistry} from "../../src/rfq/RFQRegistry.sol";
import {SealedRFQAdapter} from "../../src/rfq/SealedRFQAdapter.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Deploys the full SealedRFQ system on MockUSDC with the demo personas and role keys.
///         Amounts mirror the mainnet demo: budget 3.00, deposit 0.25, 3 milestones, 10% retention.
abstract contract SealedRFQFixture is Test {
    uint128 internal constant USDC = 1e6;
    uint128 internal constant BUDGET = 3 * USDC;
    uint128 internal constant DEPOSIT = 250_000;
    uint16 internal constant STAKE_BPS = 500; // 5% -> 0.15
    uint16 internal constant RETENTION_BPS = 1_000; // 10%
    uint32 internal constant DELIVERY = 1 days;
    uint32 internal constant ACCEPTANCE = 2 days;
    bytes32 internal constant RUBRIC = keccak256("rubric: price 50 / delivery 30 / quality 20");
    bytes32 internal constant MODEL = "deterministic-rubric-v1";

    MockUSDC internal usdc;
    AgenticCommerce internal acp;
    AttestationLog internal attestations;
    ProcurementPolicy internal policy;
    SealedRFQAdapter internal adapter;
    RFQRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal evaluator = makeAddr("evaluator");
    address internal awarder = makeAddr("awarder");
    address internal verifier = makeAddr("verifier");
    address internal arbiter = makeAddr("arbiter");
    address internal buyer = makeAddr("buyer");
    address internal s1 = makeAddr("supplier1");
    address internal s2 = makeAddr("supplier2");
    address internal s3 = makeAddr("supplier3");
    address internal stranger = makeAddr("stranger");

    uint16[] internal defaultMilestones;

    function setUp() public virtual {
        usdc = new MockUSDC();
        acp = new AgenticCommerce(address(usdc), admin, admin);
        attestations = new AttestationLog(admin);
        policy = new ProcurementPolicy(admin, defaultPolicy());
        adapter =
            new SealedRFQAdapter(IERC20(address(usdc)), IAgenticCommerce(address(acp)), attestations, admin);
        registry = new RFQRegistry(IERC20(address(usdc)), policy, attestations, adapter, admin);

        vm.startPrank(admin);
        acp.setHookWhitelist(address(adapter), true);
        adapter.grantRole(Roles.REGISTRY, address(registry));
        adapter.grantRole(Roles.VERIFIER, verifier);
        adapter.grantRole(Roles.ARBITER, arbiter);
        registry.grantRole(Roles.AWARDER, awarder);
        attestations.grantRole(Roles.EVALUATOR, evaluator);
        attestations.grantRole(Roles.VERIFIER, verifier);
        vm.stopPrank();

        defaultMilestones.push(3_000);
        defaultMilestones.push(3_000);
        defaultMilestones.push(4_000);

        address[5] memory people = [buyer, s1, s2, s3, stranger];
        for (uint256 i; i < people.length; ++i) {
            usdc.mint(people[i], 100 * USDC);
            vm.startPrank(people[i]);
            usdc.approve(address(registry), type(uint256).max);
            vm.stopPrank();
        }
    }

    function defaultPolicy() internal pure returns (IProcurementPolicy.Policy memory) {
        return IProcurementPolicy.Policy({
            maxAwardBps: 10_000,
            minRevealedBids: 2,
            minDepositBps: 500, // deposit >= 5% of the bid price
            minBuyerStakeBps: 500,
            maxSupplierShareBps: 4_000,
            concentrationFloor: 100 * USDC
        });
    }

    // ───────────── RFQ helpers ─────────────

    function defaultParams() internal view returns (IRFQRegistry.RFQParams memory p) {
        p.rubricHash = RUBRIC;
        p.metadataHash = keccak256("scope: route-optimisation SaaS integration");
        p.category = "SOFTWARE";
        p.region = "US";
        p.budget = BUDGET;
        p.depositAmount = DEPOSIT;
        p.buyerStakeBps = STAKE_BPS;
        p.bidDeadline = uint64(block.timestamp + 1 days);
        p.revealDeadline = uint64(block.timestamp + 2 days);
        p.awardDeadline = uint64(block.timestamp + 3 days);
        p.retentionBps = RETENTION_BPS;
        p.deliveryWindow = DELIVERY;
        p.acceptanceWindow = ACCEPTANCE;
        p.milestoneBps = defaultMilestones;
        p.metadataURI = "ipfs://scope";
    }

    function createRFQ() internal returns (uint256 id) {
        vm.prank(buyer);
        id = registry.createRFQ(defaultParams());
    }

    function salt(address bidder) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", bidder));
    }

    function commit(uint256 id, address bidder, uint128 price, uint32 days_) internal {
        commit(id, bidder, price, days_, bytes32(0));
    }

    /// @dev `proposalHash` is zero for a price-only RFQ and the proposal document hash in RFP mode.
    function commit(uint256 id, address bidder, uint128 price, uint32 days_, bytes32 proposalHash) internal {
        bytes32 h = registry.computeCommitment(id, bidder, price, days_, proposalHash, salt(bidder));
        vm.prank(bidder);
        registry.commitBid(id, h);
    }

    function reveal(uint256 id, address bidder, uint128 price, uint32 days_) internal {
        reveal(id, bidder, price, days_, bytes32(0));
    }

    function reveal(uint256 id, address bidder, uint128 price, uint32 days_, bytes32 proposalHash) internal {
        vm.prank(bidder);
        registry.revealBid(id, price, days_, proposalHash, salt(bidder));
    }

    function toReveal(uint256 id) internal {
        vm.warp(registry.getRFQ(id).bidDeadline);
    }

    function toAward(uint256 id) internal {
        vm.warp(registry.getRFQ(id).revealDeadline);
    }

    /// @dev Evaluator anchors an AWARD_RECOMMENDATION for `winner`; returns the memo hash.
    function recommend(uint256 id, address winner) internal returns (bytes32 memo) {
        memo = keccak256(abi.encode("memo", id, winner));
        uint256 subject = registry.awardSubject(id, winner); // before prank: external calls consume it
        vm.prank(evaluator);
        attestations.attest(AttestationKinds.AWARD_RECOMMENDATION, subject, memo, MODEL);
    }

    /// @dev Standard three-supplier RFQ up to the award window: s1 2.80, s2 2.95, s3 3.40 (over budget).
    function rfqReadyToAward() internal returns (uint256 id) {
        id = createRFQ();
        commit(id, s1, 2_800_000, 21);
        commit(id, s2, 2_950_000, 14);
        commit(id, s3, 3_400_000, 10);
        toReveal(id);
        reveal(id, s1, 2_800_000, 21);
        reveal(id, s2, 2_950_000, 14);
        reveal(id, s3, 3_400_000, 10);
        toAward(id);
    }

    function awardTo(uint256 id, address winner) internal {
        bytes32 memo = recommend(id, winner);
        vm.prank(awarder);
        registry.award(id, winner, memo, RUBRIC);
    }

    // ───────────── milestone helpers ─────────────

    function submitCurrent(uint256 id, bytes32 deliverable) internal {
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        vm.prank(e.supplier);
        acp.submit(e.currentJobId, deliverable, "");
    }

    function acceptCurrent(uint256 id) internal {
        vm.prank(buyer);
        adapter.acceptMilestone(id, keccak256("ok"));
    }

    function withdrawAll(address who) internal {
        if (registry.withdrawable(who) > 0) {
            vm.prank(who);
            registry.withdraw();
        }
        if (adapter.withdrawable(who) > 0) {
            vm.prank(who);
            adapter.withdraw();
        }
    }

    function assertAccounting() internal view {
        assertEq(
            registry.totalHeld() + registry.totalWithdrawable(),
            usdc.balanceOf(address(registry)),
            "registry accounting"
        );
        assertEq(
            adapter.totalHeld() + adapter.totalWithdrawable(),
            usdc.balanceOf(address(adapter)),
            "adapter accounting"
        );
    }
}
