// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UsdcProbe} from "../src/probe/UsdcProbe.sol";
import {ArcUsdc} from "../src/lib/ArcUsdc.sol";

/// @notice Day-1 hello deploy: UsdcProbe on Arc, then one real deposit -> pay -> withdraw cycle.
///         set -a; source ../.env.testnet; set +a
///         forge script script/DeployProbe.s.sol --rpc-url arcTestnet --broadcast
///         (add --verify --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/)
contract DeployProbe is Script {
    uint256 constant AMOUNT = 100_000; // 0.10 USDC
    uint256 constant PAY = 40_000; // 0.04 USDC

    function run() external {
        require(
            block.chainid == ArcUsdc.CHAIN_ID_TESTNET || block.chainid == ArcUsdc.CHAIN_ID_MAINNET,
            "not an Arc network"
        );
        uint256 buyerPk = vm.envUint("BUYER_PK");
        uint256 supplierPk = vm.envUint("SUPPLIER_1_PK");
        address supplier = vm.addr(supplierPk);
        IERC20 usdc = IERC20(ArcUsdc.ADDRESS);

        vm.startBroadcast(buyerPk);
        UsdcProbe probe = new UsdcProbe(usdc);
        usdc.approve(address(probe), AMOUNT);
        probe.deposit(AMOUNT);
        probe.pay(supplier, PAY);
        vm.stopBroadcast();

        vm.startBroadcast(supplierPk);
        probe.withdraw();
        vm.stopBroadcast();

        console2.log("UsdcProbe:", address(probe));
        console2.log("probe USDC balance (6d):", usdc.balanceOf(address(probe)));
        console2.log("supplier withdrawable left:", probe.withdrawable(supplier));
    }
}
