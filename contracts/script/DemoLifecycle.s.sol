// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgenticCommerce} from "../src/core/AgenticCommerce.sol";
import {AttestationLog} from "../src/governance/AttestationLog.sol";
import {AttestationKinds} from "../src/governance/Roles.sol";
import {IRFQRegistry} from "../src/interfaces/IRFQRegistry.sol";
import {ISealedRFQAdapter} from "../src/interfaces/ISealedRFQAdapter.sol";
import {ArcUsdc} from "../src/lib/ArcUsdc.sol";
import {RFQRegistry} from "../src/rfq/RFQRegistry.sol";
import {SealedRFQAdapter} from "../src/rfq/SealedRFQAdapter.sol";

/// @notice The demo RFQ, run stage by stage on a live Arc network (a live chain cannot warp, so
///         each stage runs once its window opens; `script/demo.sh` sequences them with waits).
///
///   STAGE=open        buyer posts + funds the RFQ with a permit; 3 suppliers commit sealed bids (permit)
///   STAGE=reveal      the 3 suppliers reveal (s3 bid 3.40 on a 3.00 budget)
///   STAGE=recommend   EVALUATOR anchors the bid evaluation + an AWARD_RECOMMENDATION for s3 (over budget)
///   (demo.sh)         AWARDER's award(s3) is sent anyway -> reverts on-chain: AwardExceedsBudget
///   STAGE=award       EVALUATOR re-recommends s1; AWARDER awards s1; losers' deposits settle
///   STAGE=submit      s1 submits the current milestone on ERC-8183
///   STAGE=accept      buyer accepts it (pays 90%, holds 10% retention)
///   STAGE=autorelease anyone releases a milestone the buyer ignored for the acceptance window
///   STAGE=withdraw    everyone pulls what they are owed
///   STAGE=status      print state
///
/// Memo hashes are sha256 of the JSON strings stored in deployments/demo-<chainId>.json, so they can
/// be re-hashed later. (The agent service replaces these with full sealedrfq.decision.v1 memos.)
contract DemoLifecycle is Script {
    uint128 constant BUDGET = 3_000_000;
    uint128 constant DEPOSIT = 250_000;
    uint128 constant P1 = 2_800_000;
    uint128 constant P2 = 2_950_000;
    uint128 constant P3 = 3_400_000; // over budget: the policy-firewall bid
    bytes32 immutable RUBRIC_HASH = sha256("sealedrfq.rubric.v1{price:50,delivery:30,quality:20}");

    RFQRegistry registry;
    SealedRFQAdapter adapter;
    AgenticCommerce acp;
    AttestationLog attestationLog;
    IERC20 usdc = IERC20(ArcUsdc.ADDRESS);

    uint256 buyerPk;
    uint256[3] supplierPk;
    uint128[3] prices = [P1, P2, P3];
    uint32[3] days_ = [uint32(21), 14, 10];

    function run() external {
        _load();
        bytes32 stage = keccak256(bytes(vm.envString("STAGE")));
        if (stage == keccak256("open")) return _open();
        uint256 id = _rfqId();
        if (stage == keccak256("reveal")) return _reveal(id);
        if (stage == keccak256("recommend")) return _recommend(id);
        if (stage == keccak256("award")) return _award(id);
        if (stage == keccak256("submit")) return _submit(id);
        if (stage == keccak256("accept")) return _accept(id);
        if (stage == keccak256("autorelease")) return _autorelease(id);
        if (stage == keccak256("withdraw")) return _withdraw(id);
        if (stage == keccak256("status")) return _status(id);
        revert("unknown STAGE");
    }

    // ───────────── stages ─────────────

    function _open() internal {
        uint16[] memory ms = new uint16[](3);
        (ms[0], ms[1], ms[2]) = (3_000, 3_000, 4_000);
        IRFQRegistry.RFQParams memory p;
        p.rubricHash = RUBRIC_HASH;
        p.metadataHash = sha256("Route-optimisation SaaS integration for Northwind Logistics Inc.");
        p.category = "SOFTWARE";
        p.region = "US";
        p.budget = BUDGET;
        p.depositAmount = DEPOSIT;
        p.buyerStakeBps = 500;
        p.bidDeadline = uint64(block.timestamp + vm.envOr("BID_SECS", uint256(240)));
        p.revealDeadline = p.bidDeadline + uint64(vm.envOr("REVEAL_SECS", uint256(240)));
        p.awardDeadline = p.revealDeadline + uint64(vm.envOr("AWARD_SECS", uint256(1800)));
        p.retentionBps = 1_000;
        p.deliveryWindow = uint32(vm.envOr("DELIVERY_SECS", uint256(1800)));
        p.acceptanceWindow = uint32(vm.envOr("ACCEPT_SECS", uint256(180)));
        p.milestoneBps = ms;
        p.metadataURI = "https://sealedrfq.axiqo.xyz/rfq/demo-1";

        uint256 total = BUDGET + (uint256(BUDGET) * 500) / 10_000;
        (uint8 v, bytes32 r, bytes32 s) = _permit(buyerPk, address(registry), total);
        vm.startBroadcast(buyerPk);
        uint256 id = registry.createRFQWithPermit(p, block.timestamp + 1 hours, v, r, s);
        vm.stopBroadcast();

        for (uint256 i; i < 3; ++i) {
            address bidder = vm.addr(supplierPk[i]);
            bytes32 h = registry.computeCommitment(id, bidder, prices[i], days_[i], bytes32(0), _salt(i, id));
            (v, r, s) = _permit(supplierPk[i], address(registry), DEPOSIT);
            vm.startBroadcast(supplierPk[i]);
            registry.commitBidWithPermit(id, h, block.timestamp + 1 hours, v, r, s);
            vm.stopBroadcast();
        }

        string memory k = "demo";
        vm.serializeUint(k, "rfqId", id);
        vm.serializeBytes32(k, "rubricHash", RUBRIC_HASH);
        string memory json = vm.serializeUint(k, "revealAt", p.bidDeadline);
        vm.writeJson(json, _statePath());
        console2.log("RFQ opened:", id);
        console2.log("reveal opens at", p.bidDeadline, "award opens at", p.revealDeadline);
    }

    function _reveal(uint256 id) internal {
        for (uint256 i; i < 3; ++i) {
            vm.startBroadcast(supplierPk[i]);
            registry.revealBid(id, prices[i], days_[i], bytes32(0), _salt(i, id));
            vm.stopBroadcast();
        }
        console2.log("revealed 3 bids; award window opens at", registry.getRFQ(id).revealDeadline);
    }

    function _recommend(uint256 id) internal {
        uint256 evaluatorPk = vm.envUint("EVALUATOR_PK");
        string memory evaluation =
            _memo(id, "BID_EVALUATION", address(0), "s3 scores highest on quality+delivery");
        string memory rec = _memo(id, "AWARD_RECOMMENDATION", vm.addr(supplierPk[2]), "recommend s3 at 3.40");
        address s3 = vm.addr(supplierPk[2]);
        uint256 subject = registry.awardSubject(id, s3);
        vm.startBroadcast(evaluatorPk);
        attestationLog.attest(
            AttestationKinds.BID_EVALUATION, id, sha256(bytes(evaluation)), "mock-rubric-v1"
        );
        attestationLog.attest(
            AttestationKinds.AWARD_RECOMMENDATION, subject, sha256(bytes(rec)), "mock-rubric-v1"
        );
        vm.stopBroadcast();

        string memory k = "demo";
        vm.serializeUint(k, "rfqId", id);
        vm.serializeBytes32(k, "rubricHash", RUBRIC_HASH);
        vm.serializeAddress(k, "firewallWinner", s3);
        vm.serializeString(k, "firewallMemo", rec);
        string memory json = vm.serializeBytes32(k, "firewallMemoHash", sha256(bytes(rec)));
        vm.writeJson(json, _statePath());
        console2.log("recommended s3 at 3.40 on a 3.00 budget; demo.sh now sends the award that must revert");
    }

    function _award(uint256 id) internal {
        address s1 = vm.addr(supplierPk[0]);
        string memory rec = _memo(id, "AWARD_RECOMMENDATION", s1, "s3 over budget; next best s1 at 2.80");
        bytes32 memoHash = sha256(bytes(rec));
        uint256 subject = registry.awardSubject(id, s1);
        bytes32 rubric = RUBRIC_HASH;
        vm.startBroadcast(vm.envUint("EVALUATOR_PK"));
        attestationLog.attest(AttestationKinds.AWARD_RECOMMENDATION, subject, memoHash, "mock-rubric-v1");
        vm.stopBroadcast();
        vm.startBroadcast(vm.envUint("AWARDER_PK"));
        registry.award(id, s1, memoHash, rubric);
        vm.stopBroadcast();

        vm.startBroadcast(vm.envUint("ADMIN_PK")); // permissionless: anyone can settle deposits
        registry.settleDeposit(id, vm.addr(supplierPk[1]));
        registry.settleDeposit(id, vm.addr(supplierPk[2]));
        vm.stopBroadcast();
        console2.log("awarded s1 at 2.80; losers' deposits refunded");
    }

    function _submit(uint256 id) internal {
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        bytes32 deliverable =
            sha256(abi.encodePacked("demo deliverable, milestone ", vm.toString(e.currentMilestone + 1)));
        vm.startBroadcast(supplierPk[0]);
        acp.submit(e.currentJobId, deliverable, "");
        vm.stopBroadcast();
        console2.log("submitted milestone", e.currentMilestone + 1, "job", e.currentJobId);
    }

    function _accept(uint256 id) internal {
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        bytes32 reason =
            sha256(abi.encodePacked("buyer accepts milestone ", vm.toString(e.currentMilestone + 1)));
        vm.startBroadcast(buyerPk);
        adapter.acceptMilestone(id, reason);
        vm.stopBroadcast();
        console2.log("accepted milestone", e.currentMilestone + 1);
    }

    function _autorelease(uint256 id) internal {
        vm.startBroadcast(vm.envUint("ADMIN_PK"));
        adapter.autoRelease(id);
        vm.stopBroadcast();
        console2.log("auto-released milestone", adapter.getEngagement(id).currentMilestone);
    }

    function _withdraw(uint256) internal {
        address[4] memory who =
            [vm.addr(buyerPk), vm.addr(supplierPk[0]), vm.addr(supplierPk[1]), vm.addr(supplierPk[2])];
        uint256[4] memory pks = [buyerPk, supplierPk[0], supplierPk[1], supplierPk[2]];
        for (uint256 i; i < 4; ++i) {
            if (registry.withdrawable(who[i]) > 0) {
                vm.startBroadcast(pks[i]);
                registry.withdraw();
                vm.stopBroadcast();
            }
            if (adapter.withdrawable(who[i]) > 0) {
                vm.startBroadcast(pks[i]);
                adapter.withdraw();
                vm.stopBroadcast();
            }
        }
    }

    function _status(uint256 id) internal view {
        IRFQRegistry.RFQ memory r = registry.getRFQ(id);
        ISealedRFQAdapter.Engagement memory e = adapter.getEngagement(id);
        console2.log("rfq", id, "phase", uint8(registry.phase(id)));
        console2.log("  commits / reveals", r.commitCount, r.revealCount);
        console2.log("  winner", r.winner, "price", r.awardPrice);
        console2.log("  engagement status", uint8(e.status), "milestone", e.currentMilestone);
        console2.log("  job", e.currentJobId, "submittedAt", e.submittedAt);
        console2.log("  retention held", e.retentionHeld);
    }

    // ───────────── helpers ─────────────

    function _load() internal {
        string memory json = vm.readFile(
            string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json")
        );
        registry = RFQRegistry(vm.parseJsonAddress(json, ".RFQRegistry"));
        adapter = SealedRFQAdapter(vm.parseJsonAddress(json, ".SealedRFQAdapter"));
        acp = AgenticCommerce(vm.parseJsonAddress(json, ".AgenticCommerce"));
        attestationLog = AttestationLog(vm.parseJsonAddress(json, ".AttestationLog"));
        buyerPk = vm.envUint("BUYER_PK");
        supplierPk = [vm.envUint("SUPPLIER_1_PK"), vm.envUint("SUPPLIER_2_PK"), vm.envUint("SUPPLIER_3_PK")];
    }

    function _rfqId() internal view returns (uint256) {
        return vm.parseJsonUint(vm.readFile(_statePath()), ".rfqId");
    }

    function _statePath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/demo-", vm.toString(block.chainid), ".json");
    }

    /// @dev Client-side salt (never prevrandao). Derived from the supplier's own key so only it can reveal.
    function _salt(uint256 i, uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encode("sealedrfq.salt", supplierPk[i], id));
    }

    function _permit(uint256 pk, address spender, uint256 value)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        address owner = vm.addr(pk);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                owner,
                spender,
                value,
                IERC20Permit(address(usdc)).nonces(owner),
                block.timestamp + 1 hours
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", IERC20Permit(address(usdc)).DOMAIN_SEPARATOR(), structHash)
        );
        return vm.sign(pk, digest);
    }

    /// @dev Keys in sorted order, no whitespace: already RFC 8785 canonical for these values.
    function _memo(uint256 id, string memory kind, address bidder, string memory rationale)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '{"bidder":"',
            vm.toString(bidder),
            '","kind":"',
            kind,
            '","rationale":"',
            rationale,
            '","rfqId":"',
            vm.toString(id),
            '","schema":"sealedrfq.demo-memo.v0"}'
        );
    }
}
