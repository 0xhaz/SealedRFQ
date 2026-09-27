// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AttestationKinds} from "../src/governance/Roles.sol";
import {IRFQRegistry} from "../src/interfaces/IRFQRegistry.sol";
import {ArcUsdc} from "../src/lib/ArcUsdc.sol";
import {AttestationLog} from "../src/governance/AttestationLog.sol";
import {RFQRegistry} from "../src/rfq/RFQRegistry.sol";

/// @notice Fills a local chain with RFQs sitting in every phase, so the UI has something to show
///         without waiting for windows to elapse. `tools/local.sh` warps the chain clock between
///         stages, which a public network cannot do.
///
///   STAGE=open    one RFQ per shape (RFQ / RFP / price-only), all with sealed bids
///   STAGE=reveal  reveal bids on the ones past their bidding deadline
contract SeedLocal is Script {
    uint128 constant BUDGET = 3_000_000;
    uint128 constant DEPOSIT = 250_000;

    RFQRegistry registry;
    AttestationLog attestationLog;
    IERC20 usdc = IERC20(ArcUsdc.ADDRESS);

    uint256 buyerPk;
    uint256[3] supplierPk;
    uint128[3] prices = [2_800_000, 2_950_000, 3_400_000]; // the third is over budget on purpose
    /**
     * Delivery quotes, in **seconds** — the unit a bid is stored in.
     *
     * These used to read `[21, 14, 10]` as days against a delivery window of well under an hour,
     * which no bid could satisfy: the award reverted with `DeliveryExceedsWindow` every time. They
     * are now a fraction of whatever window the run is configured with, so the ordering the demo
     * narrates (supplier 3 quickest, supplier 1 slowest) holds however the windows are set.
     */
    uint32[3] private deliveryFractionBps = [uint32(6_600), 5_000, 3_300];

    /// @dev A bid's delivery quote, as a fraction of the tender's own window, read from the RFQ
    ///      so commit and reveal cannot disagree about it.
    function _delivery(uint256 i, uint256 id) internal view returns (uint32) {
        uint32 window = registry.getRFQ(id).deliveryWindow;
        return uint32((uint256(window) * deliveryFractionBps[i]) / 10_000);
    }


    function run() external {
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
        registry = RFQRegistry(vm.parseJsonAddress(json, ".RFQRegistry"));
        attestationLog = AttestationLog(vm.parseJsonAddress(json, ".AttestationLog"));
        buyerPk = vm.envUint("BUYER_PK");
        supplierPk = [vm.envUint("SUPPLIER_1_PK"), vm.envUint("SUPPLIER_2_PK"), vm.envUint("SUPPLIER_3_PK")];

        bytes32 stage = keccak256(bytes(vm.envString("STAGE")));
        if (stage == keccak256("open")) return _open();
        if (stage == keccak256("reveal")) return _reveal();
        revert("unknown STAGE");
    }

    function _open() internal {
        // 1. a long-running RFQ that stays in Bidding, so the board always shows a sealed one
        uint256 slow = _create("Fleet telematics rollout", "LOGISTICS", false, 2 hours, 3 hours, 6 hours);
        _commitAll(slow);

        // 2. an RFP whose bidding closes in a minute of chain time
        uint256 rfp = _create("Warehouse automation partner", "OPERATIONS", true, 60, 2 hours, 4 hours);
        _commitAll(rfp);

        // 3. a price-only RFQ on the same short clock
        uint256 quick = _create("500 barcode scanners", "HARDWARE", false, 60, 2 hours, 4 hours);
        _commitAll(quick);

        console2.log("seeded RFQs: %s (bidding), %s (RFP), %s (price-only)", slow, rfp, quick);
    }

    function _reveal() internal {
        uint256 count = registry.rfqCount();
        for (uint256 id = 1; id <= count; ++id) {
            if (registry.phase(id) != IRFQRegistry.Phase.Reveal) continue;
            bool rfp = registry.getRFQ(id).requiresProposal;
            for (uint256 i; i < 3; ++i) {
                // Supplier 3 never reveals anywhere: its deposit forfeits, which is worth seeing.
                if (i == 2) continue;
                // Re-running the stage must not retry bids already revealed on an earlier pass.
                if (registry.getBid(id, vm.addr(supplierPk[i])).revealed) continue;
                bytes32 proposal = rfp ? _proposal(id, i) : bytes32(0);
                vm.startBroadcast(supplierPk[i]);
                registry.revealBid(id, prices[i], _delivery(i, id), proposal, _salt(i, id));
                vm.stopBroadcast();
            }
            console2.log("revealed bids on RFQ", id);
        }
    }

    // ───────────── helpers ─────────────

    function _create(
        string memory scope,
        bytes32 category,
        bool rfp,
        uint256 bidIn,
        uint256 revealIn,
        uint256 awardIn
    ) internal returns (uint256 id) {
        uint16[] memory ms = new uint16[](3);
        (ms[0], ms[1], ms[2]) = (3_000, 3_000, 4_000);
        string memory metadata = string.concat(
            '{"scope":"', scope, '","rubric":{"price":50,"delivery":30,"quality":20},"mode":"', rfp ? "RFP" : "RFQ", '"}'
        );

        IRFQRegistry.RFQParams memory p;
        p.rubricHash = _rubricHash();
        p.metadataHash = sha256(bytes(metadata));
        p.category = category;
        p.region = "US";
        p.budget = BUDGET;
        p.depositAmount = DEPOSIT;
        p.buyerStakeBps = 500;
        p.bidDeadline = uint64(block.timestamp + bidIn);
        p.revealDeadline = uint64(block.timestamp + revealIn);
        p.awardDeadline = uint64(block.timestamp + awardIn);
        p.retentionBps = 1_000;
        p.deliveryWindow = 900;
        p.acceptanceWindow = 300;
        p.milestoneBps = ms;
        p.requiresProposal = rfp;
        p.metadataURI = metadata;

        uint256 total = BUDGET + (uint256(BUDGET) * 500) / 10_000;
        vm.startBroadcast(buyerPk);
        usdc.approve(address(registry), total);
        id = registry.createRFQ(p);
        vm.stopBroadcast();
    }

    function _commitAll(uint256 id) internal {
        bool rfp = registry.getRFQ(id).requiresProposal;
        for (uint256 i; i < 3; ++i) {
            address bidder = vm.addr(supplierPk[i]);
            bytes32 proposal = rfp ? _proposal(id, i) : bytes32(0);
            bytes32 h = registry.computeCommitment(id, bidder, prices[i], _delivery(i, id), proposal, _salt(i, id));
            vm.startBroadcast(supplierPk[i]);
            usdc.approve(address(registry), DEPOSIT);
            registry.commitBid(id, h);
            vm.stopBroadcast();
        }
    }

    /// @dev The rubric the metadata publishes, hashed the same way the web app does it.
    function _rubricHash() internal pure returns (bytes32) {
        return sha256('{"criteria":{"delivery":30,"price":50,"quality":20},"schema":"sealedrfq.rubric.v1"}');
    }

    function _proposal(uint256 id, uint256 i) internal pure returns (bytes32) {
        return sha256(abi.encodePacked("proposal for rfq ", vm.toString(id), " from supplier ", vm.toString(i)));
    }

    function _salt(uint256 i, uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encode("sealedrfq.salt", supplierPk[i], id));
    }
}
