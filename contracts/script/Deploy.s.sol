// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgenticCommerce} from "../src/core/AgenticCommerce.sol";
import {IAgenticCommerce} from "../src/core/IAgenticCommerce.sol";
import {AttestationLog} from "../src/governance/AttestationLog.sol";
import {ProcurementPolicy} from "../src/governance/ProcurementPolicy.sol";
import {Roles} from "../src/governance/Roles.sol";
import {IProcurementPolicy} from "../src/interfaces/IProcurementPolicy.sol";
import {ArcUsdc} from "../src/lib/ArcUsdc.sol";
import {RFQRegistry} from "../src/rfq/RFQRegistry.sol";
import {SealedRFQAdapter} from "../src/rfq/SealedRFQAdapter.sol";

/// @notice Deploys and wires the SealedRFQ core. The ADMIN key deploys and keeps DEFAULT_ADMIN on
///         every contract; agent roles are granted separately by Configure.s.sol.
///
///   set -a; source ../.env.testnet; set +a
///   arc-forge script script/Deploy.s.sol --rpc-url arcTestnet --broadcast \
///     --verify --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
///
/// Writes deployments/<chainId>.json (read by Configure, DemoLifecycle, the agent and the web app).
contract Deploy is Script {
    function run() external {
        require(
            block.chainid == ArcUsdc.CHAIN_ID_MAINNET || block.chainid == ArcUsdc.CHAIN_ID_TESTNET
                || block.chainid == ArcUsdc.CHAIN_ID_LOCAL,
            "Deploy: not an Arc network (use arc-anvil --network arc for local)"
        );
        uint256 pk = vm.envUint("ADMIN_PK");
        address admin = vm.addr(pk);
        IERC20 usdc = IERC20(ArcUsdc.ADDRESS);

        IProcurementPolicy.Policy memory policyParams = IProcurementPolicy.Policy({
            maxAwardBps: uint16(vm.envOr("POLICY_MAX_AWARD_BPS", uint256(10_000))),
            minRevealedBids: uint16(vm.envOr("POLICY_MIN_REVEALED_BIDS", uint256(2))),
            minDepositBps: uint16(vm.envOr("POLICY_MIN_DEPOSIT_BPS", uint256(500))),
            minBuyerStakeBps: uint16(vm.envOr("POLICY_MIN_BUYER_STAKE_BPS", uint256(500))),
            maxSupplierShareBps: uint16(vm.envOr("POLICY_MAX_SUPPLIER_SHARE_BPS", uint256(4_000))),
            concentrationFloor: uint128(vm.envOr("POLICY_CONCENTRATION_FLOOR", uint256(100 * ArcUsdc.ONE)))
        });

        uint256 startBlock = block.number;
        vm.startBroadcast(pk);
        AgenticCommerce acp = new AgenticCommerce(address(usdc), admin, admin);
        AttestationLog attestationLog = new AttestationLog(admin);
        ProcurementPolicy policy = new ProcurementPolicy(admin, policyParams);
        SealedRFQAdapter adapter =
            new SealedRFQAdapter(usdc, IAgenticCommerce(address(acp)), attestationLog, admin);
        RFQRegistry registry = new RFQRegistry(usdc, policy, attestationLog, adapter, admin);

        acp.setHookWhitelist(address(adapter), true);
        adapter.grantRole(Roles.REGISTRY, address(registry));
        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeAddress(k, "usdc", address(usdc));
        vm.serializeAddress(k, "admin", admin);
        vm.serializeAddress(k, "AgenticCommerce", address(acp));
        vm.serializeAddress(k, "AttestationLog", address(attestationLog));
        vm.serializeAddress(k, "ProcurementPolicy", address(policy));
        vm.serializeAddress(k, "SealedRFQAdapter", address(adapter));
        string memory json = vm.serializeAddress(k, "RFQRegistry", address(registry));
        vm.writeJson(json, _path());

        console2.log("AgenticCommerce  ", address(acp));
        console2.log("AttestationLog   ", address(attestationLog));
        console2.log("ProcurementPolicy", address(policy));
        console2.log("SealedRFQAdapter ", address(adapter));
        console2.log("RFQRegistry      ", address(registry));
        console2.log("written:", _path());
    }

    function _path() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    }
}
