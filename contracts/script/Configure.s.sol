// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AttestationLog} from "../src/governance/AttestationLog.sol";
import {Roles} from "../src/governance/Roles.sol";
import {RFQRegistry} from "../src/rfq/RFQRegistry.sol";
import {SealedRFQAdapter} from "../src/rfq/SealedRFQAdapter.sol";

/// @notice Grants the least-privilege agent roles, one key per role (see docs/techstack.md):
///           AttestationLog:   EVALUATOR, VERIFIER, ATTESTOR
///           RFQRegistry:      AWARDER
///           SealedRFQAdapter: VERIFIER, ARBITER
///         Idempotent: grantRole is a no-op for existing members.
///
///   arc-forge script script/Configure.s.sol --rpc-url arcTestnet --broadcast
contract Configure is Script {
    function run() external {
        string memory json = vm.readFile(
            string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json")
        );
        AttestationLog attestationLog = AttestationLog(vm.parseJsonAddress(json, ".AttestationLog"));
        RFQRegistry registry = RFQRegistry(vm.parseJsonAddress(json, ".RFQRegistry"));
        SealedRFQAdapter adapter = SealedRFQAdapter(vm.parseJsonAddress(json, ".SealedRFQAdapter"));

        address evaluator = vm.addr(vm.envUint("EVALUATOR_PK"));
        address awarder = vm.addr(vm.envUint("AWARDER_PK"));
        address verifier = vm.addr(vm.envUint("VERIFIER_PK"));
        address attestor = vm.addr(vm.envUint("ATTESTOR_PK"));
        address arbiter = vm.addr(vm.envUint("ARBITER_PK"));

        vm.startBroadcast(vm.envUint("ADMIN_PK"));
        _grant(
            attestationLog.hasRole(Roles.EVALUATOR, evaluator),
            address(attestationLog),
            Roles.EVALUATOR,
            evaluator
        );
        _grant(
            attestationLog.hasRole(Roles.VERIFIER, verifier),
            address(attestationLog),
            Roles.VERIFIER,
            verifier
        );
        _grant(
            attestationLog.hasRole(Roles.ATTESTOR, attestor),
            address(attestationLog),
            Roles.ATTESTOR,
            attestor
        );
        _grant(registry.hasRole(Roles.AWARDER, awarder), address(registry), Roles.AWARDER, awarder);
        _grant(adapter.hasRole(Roles.VERIFIER, verifier), address(adapter), Roles.VERIFIER, verifier);
        _grant(adapter.hasRole(Roles.ARBITER, arbiter), address(adapter), Roles.ARBITER, arbiter);
        vm.stopBroadcast();

        console2.log("EVALUATOR", evaluator);
        console2.log("AWARDER  ", awarder);
        console2.log("VERIFIER ", verifier);
        console2.log("ATTESTOR ", attestor);
        console2.log("ARBITER  ", arbiter);
    }

    /// @dev Skips existing members so re-runs broadcast nothing.
    function _grant(bool has, address target, bytes32 role, address account) internal {
        if (!has) IAccessControl(target).grantRole(role, account);
    }
}
