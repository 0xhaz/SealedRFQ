// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcUsdc} from "../../src/lib/ArcUsdc.sol";
import {UsdcProbe} from "../../src/probe/UsdcProbe.sol";

/// @notice Fork checks against live Arc USDC. Skipped unless ARC_TESTNET_RPC_URL is set.
///         Run: forge test --match-path test/fork/* -vv
contract ArcUsdcForkTest is Test {
    IERC20Metadata usdc = IERC20Metadata(ArcUsdc.ADDRESS);
    bool forked;
    /// @dev USDC transfers call Arc system precompiles (0x1800…01 `isBlocklisted`, 0x1800…00
    ///      native `transfer`) that vanilla Foundry lacks. Transfer tests need Arc Foundry with
    ///      Arc rules on: FOUNDRY_PROFILE=arc arc-forge test --match-path "test/fork/*"
    bool arcFoundry;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        arcFoundry = keccak256(bytes(vm.envOr("FOUNDRY_PROFILE", string("")))) == keccak256("arc");
    }

    function test_fork_metadataAndPermitDomain() public view {
        if (!forked) return;
        assertEq(usdc.decimals(), ArcUsdc.DECIMALS);
        assertEq(usdc.symbol(), "USDC");
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("USDC"),
                keccak256("2"),
                block.chainid,
                ArcUsdc.ADDRESS
            )
        );
        assertEq(IERC20Permit(ArcUsdc.ADDRESS).DOMAIN_SEPARATOR(), expected);
    }

    /// @dev Records how a vanilla-Foundry fork models the native (18d) <-> ERC-20 (6d) link.
    ///      Informational: logs the result instead of asserting, since Arc Foundry is needed to
    ///      reproduce Arc's precompiles faithfully.
    function test_fork_nativeDealVsErc20Balance() public {
        if (!forked) return;
        address who = makeAddr("fresh");
        vm.deal(who, 5 ether); // 5 USDC native (18d)
        uint256 erc20Bal = usdc.balanceOf(who);
        console2.log("native wei after deal:", who.balance);
        console2.log("ERC-20 balanceOf     :", erc20Bal);
        console2.log(
            erc20Bal == 5 * ArcUsdc.ONE ? "LINKED: vm.deal funds ERC-20 balance" : "NOT LINKED in fork"
        );
    }

    /// @dev Full probe cycle against the real Arc USDC contract: approve -> deposit -> pay -> withdraw.
    function test_fork_probeCycleOnRealUsdc() public {
        if (!forked || !arcFoundry) return;
        UsdcProbe probe = new UsdcProbe(IERC20(ArcUsdc.ADDRESS));
        address buyer = makeAddr("buyer");
        address supplier = makeAddr("supplier");
        vm.deal(buyer, 2 ether); // 2 USDC
        vm.deal(supplier, 0);

        vm.startPrank(buyer);
        IERC20(ArcUsdc.ADDRESS).approve(address(probe), ArcUsdc.ONE);
        probe.deposit(ArcUsdc.ONE);
        probe.pay(supplier, 400_000);
        vm.stopPrank();

        vm.prank(supplier);
        probe.withdraw();
        assertEq(usdc.balanceOf(supplier), 400_000);
        assertEq(supplier.balance, 400_000 * ArcUsdc.NATIVE_SCALE, "native view of the same balance");
        assertEq(usdc.balanceOf(address(probe)), 600_000);
    }
}
