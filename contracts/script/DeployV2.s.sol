// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ConcordiumEpochRegistry} from "../src/concordium/ConcordiumEpochRegistry.sol";
import {ConcordiumQualifier} from "../src/concordium/ConcordiumQualifier.sol";
import {QualifiedRFQRegistryV2} from "../src/rfq/QualifiedRFQRegistryV2.sol";
import {Roles} from "../src/governance/Roles.sol";
import {IProcurementPolicy} from "../src/interfaces/IProcurementPolicy.sol";
import {IAttestationLog} from "../src/interfaces/IAttestationLog.sol";
import {ISealedRFQAdapter} from "../src/interfaces/ISealedRFQAdapter.sol";

/// @title Deploy the V2 qualification stack beside the V1 one.
/// @notice Only the three new contracts are deployed. The policy, attestation log and escrow
///         adapter already on this chain are reused, because redeploying them would orphan the
///         evidence V1 produced and change nothing about how V2 behaves.
///
/// @dev The Concordium constants are network-specific and are read from the environment rather
///      than hard-coded, because a registry built with the wrong era genesis or epoch length
///      verifies nothing and says nothing about why. They are read off the chain by
///      `scripts/concordium/_params.mjs`.
contract DeployV2 is Script {
    function run() external {
        uint256 pk = vm.envUint("ADMIN_PK");
        address admin = vm.addr(pk);

        // Reused from the V1 deployment on this chain.
        IERC20 usdc = IERC20(vm.envAddress("USDC_ADDRESS"));
        IProcurementPolicy policy = IProcurementPolicy(vm.envAddress("V1_POLICY"));
        IAttestationLog attestationLog = IAttestationLog(vm.envAddress("V1_ATTESTATION_LOG"));
        ISealedRFQAdapter adapter = ISealedRFQAdapter(vm.envAddress("V1_ADAPTER"));

        // Concordium, for the network this deployment will check certificates from.
        bytes32 eraGenesis = vm.envBytes32("CCD_ERA_GENESIS");
        uint64 eraGenesisMs = uint64(vm.envUint("CCD_ERA_GENESIS_MS"));
        uint32 epochMs = uint32(vm.envUint("CCD_EPOCH_MS"));
        uint32 rewardPeriodEpochs = uint32(vm.envUint("CCD_REWARD_PERIOD_EPOCHS"));
        uint32 maxCertAgeEpochs = uint32(vm.envUint("CCD_MAX_CERT_AGE_EPOCHS"));
        bytes memory negG2 = vm.envBytes("CCD_NEG_G2");
        uint8 confirmations = uint8(vm.envUint("CCD_CONFIRMATIONS"));
        uint64 validitySeconds = uint64(vm.envUint("QUALIFICATION_VALIDITY_SECONDS"));

        vm.startBroadcast(pk);

        ConcordiumEpochRegistry finality = new ConcordiumEpochRegistry(
            eraGenesis,
            eraGenesisMs,
            epochMs,
            rewardPeriodEpochs,
            maxCertAgeEpochs,
            negG2,
            confirmations,
            admin
        );

        ConcordiumQualifier qualifier = new ConcordiumQualifier(finality, validitySeconds, admin);

        QualifiedRFQRegistryV2 registry =
            new QualifiedRFQRegistryV2(usdc, policy, attestationLog, adapter, admin);

        // The adapter only takes instructions from a registry it has been told about, and the
        // attestation log only records from an attestor. Without both, V2 deploys and then fails
        // at the first award rather than at deployment.
        IAccessControl(address(adapter)).grantRole(Roles.REGISTRY, address(registry));
        IAccessControl(address(attestationLog)).grantRole(Roles.ATTESTOR, address(registry));

        registry.setQualifierV2(qualifier);

        vm.stopBroadcast();

        console2.log("ConcordiumEpochRegistry", address(finality));
        console2.log("ConcordiumQualifier    ", address(qualifier));
        console2.log("QualifiedRFQRegistryV2 ", address(registry));
        console2.log("admin                  ", admin);
        console2.log("");
        console2.log("Next: register the Concordium committee for the current reward period, or");
        console2.log("every qualification is refused. The registry is fail-closed by design.");
    }
}
