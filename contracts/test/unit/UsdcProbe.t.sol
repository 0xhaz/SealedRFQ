// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UsdcProbe} from "../../src/probe/UsdcProbe.sol";
import {PullPayments} from "../../src/lib/PullPayments.sol";
import {ArcUsdc} from "../../src/lib/ArcUsdc.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract UsdcProbeTest is Test {
    MockUSDC usdc;
    UsdcProbe probe;

    uint256 buyerPk = 0xB0B;
    address buyer;
    address supplier = makeAddr("supplier");

    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        usdc = new MockUSDC();
        probe = new UsdcProbe(IERC20(address(usdc)));
        buyer = vm.addr(buyerPk);
        usdc.mint(buyer, 10 * ArcUsdc.ONE);
    }

    function test_depositWithApprove_thenPay_thenWithdraw() public {
        vm.startPrank(buyer);
        usdc.approve(address(probe), 3 * ArcUsdc.ONE);
        probe.deposit(3 * ArcUsdc.ONE);
        probe.pay(supplier, 1 * ArcUsdc.ONE);
        vm.stopPrank();

        assertEq(probe.escrowed(buyer), 2 * ArcUsdc.ONE);
        assertEq(probe.withdrawable(supplier), 1 * ArcUsdc.ONE);
        assertEq(usdc.balanceOf(supplier), 0, "payout is pull, never push");

        vm.prank(supplier);
        probe.withdraw();
        assertEq(usdc.balanceOf(supplier), 1 * ArcUsdc.ONE);
        assertEq(probe.totalWithdrawable(), 0);
    }

    function test_depositWithPermit_singleTx() public {
        uint256 amount = 250_000; // 0.25 USDC
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(buyerPk, buyer, address(probe), amount, deadline);

        vm.prank(buyer);
        probe.depositWithPermit(amount, deadline, v, r, s);
        assertEq(probe.escrowed(buyer), amount);
        assertEq(usdc.nonces(buyer), 1);
    }

    function test_depositWithPermit_survivesFrontRunPermit() public {
        uint256 amount = 250_000;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(buyerPk, buyer, address(probe), amount, deadline);
        // Griefer submits the permit first; the deposit must still succeed on the allowance.
        usdc.permit(buyer, address(probe), amount, deadline, v, r, s);

        vm.prank(buyer);
        probe.depositWithPermit(amount, deadline, v, r, s);
        assertEq(probe.escrowed(buyer), amount);
    }

    function test_blocklistedBeneficiary_fundsStayParked() public {
        vm.startPrank(buyer);
        usdc.approve(address(probe), ArcUsdc.ONE);
        probe.deposit(ArcUsdc.ONE);
        probe.pay(supplier, ArcUsdc.ONE);
        vm.stopPrank();

        usdc.setBlocklisted(supplier, true);
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocklisted.selector, supplier));
        probe.withdraw();
        assertEq(probe.withdrawable(supplier), ArcUsdc.ONE, "credit parked, not lost");

        usdc.setBlocklisted(supplier, false);
        vm.prank(supplier);
        probe.withdraw();
        assertEq(usdc.balanceOf(supplier), ArcUsdc.ONE);
    }

    function test_revert_payMoreThanEscrow() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(UsdcProbe.InsufficientEscrow.selector, 0, 1));
        probe.pay(supplier, 1);
    }

    function test_revert_withdrawNothing() public {
        vm.expectRevert(PullPayments.NothingToWithdraw.selector);
        probe.withdraw();
    }

    function test_revert_zeroDeposit() public {
        vm.prank(buyer);
        vm.expectRevert(PullPayments.ZeroAmount.selector);
        probe.deposit(0);
    }

    function testFuzz_accountingNeverExceedsBalance(uint96 depositAmt, uint96 payAmt) public {
        uint256 d = bound(depositAmt, 1, 10 * ArcUsdc.ONE);
        uint256 p = bound(payAmt, 0, d);
        vm.startPrank(buyer);
        usdc.approve(address(probe), d);
        probe.deposit(d);
        probe.pay(supplier, p);
        vm.stopPrank();
        assertEq(probe.escrowed(buyer) + probe.totalWithdrawable(), usdc.balanceOf(address(probe)));
    }

    function _signPermit(uint256 pk, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, owner, spender, value, usdc.nonces(owner), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(pk, digest);
    }
}
