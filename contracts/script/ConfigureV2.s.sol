// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Roles} from "../src/governance/Roles.sol";

/// @title Grant the V2 roles.
/// @notice Idempotent: `grantRole` is a no-op for an existing member, so this is safe to re-run
///         and safe to run after a partial failure.
///
/// @dev The evaluator granted here is the key bound in Concordium CIS-8. That binding is what
///      makes the agent's badge mean anything: the badge claims the agent controls the key Arc
///      accepts recommendations from, and until this grant exists the claim is about a key with
///      no authority anywhere.
contract ConfigureV2 is Script {
    function run() external {
        uint256 pk = vm.envUint("ADMIN_PK");

        address attestationLog = vm.envAddress("V1_ATTESTATION_LOG");
        address qualifier = vm.envAddress("V2_QUALIFIER");
        address registry = vm.envAddress("V2_RFQ_REGISTRY");
        address evaluator = vm.envAddress("CCD_EVALUATOR_ADDRESS");
        address awarder = vm.envAddress("AWARDER_ADDRESS");

        vm.startBroadcast(pk);

        _grant(attestationLog, Roles.EVALUATOR, evaluator, "attestationLog EVALUATOR");
        _grant(registry, Roles.AWARDER, awarder, "registryV2 AWARDER");
        // The qualifier's own QUALIFIER_ROLE stays with the admin for now: the agent that will
        // hold it has nowhere to run yet, and granting it to a key nobody uses widens the surface
        // for nothing.
        console2.log("qualifier", qualifier);

        vm.stopBroadcast();
    }

    function _grant(address target, bytes32 role, address account, string memory what) internal {
        if (IAccessControl(target).hasRole(role, account)) {
            console2.log("already granted:", what, account);
            return;
        }
        IAccessControl(target).grantRole(role, account);
        console2.log("granted:", what, account);
    }
}
