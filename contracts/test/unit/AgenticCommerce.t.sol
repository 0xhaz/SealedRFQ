// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgenticCommerce} from "../../src/core/AgenticCommerce.sol";
import {IAgenticCommerce} from "../../src/core/IAgenticCommerce.sol";
import {IACPHook} from "../../src/core/IACPHook.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract RecordingHook is IACPHook {
    bytes4[] public before_;
    bytes4[] public after_;
    bool public blockSubmit;

    function setBlockSubmit(bool b) external {
        blockSubmit = b;
    }

    function beforeAction(uint256, bytes4 selector, bytes calldata) external {
        if (blockSubmit && selector == IAgenticCommerce.submit.selector) revert("blocked");
        before_.push(selector);
    }

    function afterAction(uint256, bytes4 selector, bytes calldata) external {
        after_.push(selector);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IACPHook).interfaceId || id == 0x01ffc9a7;
    }

    function afterCount() external view returns (uint256) {
        return after_.length;
    }
}

/// @notice ERC-8183 state machine: Open -> Funded -> Submitted -> Completed | Rejected | Expired.
contract AgenticCommerceTest is Test {
    MockUSDC usdc;
    AgenticCommerce acp;
    address admin = makeAddr("admin");
    address client = makeAddr("client");
    address provider = makeAddr("provider");
    address evaluator = makeAddr("evaluator");
    address stranger = makeAddr("stranger");

    function setUp() public {
        usdc = new MockUSDC();
        acp = new AgenticCommerce(address(usdc), admin, admin);
        usdc.mint(client, 10e6);
        vm.prank(client);
        usdc.approve(address(acp), type(uint256).max);
    }

    function _funded(uint256 budget) internal returns (uint256 jobId) {
        vm.startPrank(client);
        jobId = acp.createJob(provider, evaluator, block.timestamp + 1 days, "job", address(0));
        acp.setBudget(jobId, budget, "");
        acp.fund(jobId, "");
        vm.stopPrank();
    }

    function test_happyPath_paysProvider() public {
        uint256 jobId = _funded(1e6);
        assertEq(usdc.balanceOf(address(acp)), 1e6);
        vm.prank(provider);
        acp.submit(jobId, "work", "");
        vm.prank(evaluator);
        acp.complete(jobId, "attestation", "");
        assertEq(usdc.balanceOf(provider), 1e6);
        assertEq(uint8(acp.getJob(jobId).status), uint8(IAgenticCommerce.JobStatus.Completed));
    }

    function test_reject_refundsClient() public {
        uint256 jobId = _funded(1e6);
        vm.prank(provider);
        acp.submit(jobId, "work", "");
        vm.prank(evaluator);
        acp.reject(jobId, "bad", "");
        assertEq(usdc.balanceOf(client), 10e6);
    }

    function test_claimRefund_afterExpiry_anyone() public {
        uint256 jobId = _funded(1e6);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        acp.claimRefund(jobId);
        vm.warp(block.timestamp + 1 days);
        vm.prank(stranger);
        acp.claimRefund(jobId);
        assertEq(usdc.balanceOf(client), 10e6);
        assertEq(uint8(acp.getJob(jobId).status), uint8(IAgenticCommerce.JobStatus.Expired));
    }

    function test_auth() public {
        vm.prank(client);
        uint256 jobId = acp.createJob(provider, evaluator, block.timestamp + 1 days, "job", address(0));

        vm.prank(stranger);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        acp.setBudget(jobId, 1, "");

        vm.prank(provider); // EIP-8183: provider may also set the budget
        acp.setBudget(jobId, 2, "");

        vm.prank(stranger);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        acp.fund(jobId, "");

        vm.prank(client);
        acp.fund(jobId, "");

        vm.prank(stranger);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        acp.submit(jobId, "x", "");

        vm.prank(provider);
        acp.submit(jobId, "x", "");

        vm.prank(client); // the client is not the evaluator
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        acp.complete(jobId, "", "");
    }

    function test_createJob_guards() public {
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.ExpiryTooShort.selector);
        acp.createJob(provider, evaluator, block.timestamp + 5 minutes, "job", address(0));

        RecordingHook hook = new RecordingHook();
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.HookNotWhitelisted.selector);
        acp.createJob(provider, evaluator, block.timestamp + 1 days, "job", address(hook));
    }

    function test_hooks_calledAndCanBlock() public {
        RecordingHook hook = new RecordingHook();
        vm.prank(admin);
        acp.setHookWhitelist(address(hook), true);

        vm.startPrank(client);
        uint256 jobId = acp.createJob(provider, evaluator, block.timestamp + 1 days, "job", address(hook));
        acp.setBudget(jobId, 1e6, "");
        acp.fund(jobId, "");
        vm.stopPrank();
        assertEq(hook.afterCount(), 3); // createJob, setBudget, fund

        hook.setBlockSubmit(true);
        vm.prank(provider);
        vm.expectRevert("blocked");
        acp.submit(jobId, "x", "");
    }

    function test_fees_onlyOnCompletion() public {
        address treasury = makeAddr("treasury");
        vm.startPrank(admin);
        acp.setPlatformFee(100, treasury); // 1%
        acp.setEvaluatorFee(50); // 0.5%
        vm.stopPrank();
        uint256 jobId = _funded(1e6);
        vm.prank(provider);
        acp.submit(jobId, "x", "");
        vm.prank(evaluator);
        acp.complete(jobId, "", "");
        assertEq(usdc.balanceOf(treasury), 10_000);
        assertEq(usdc.balanceOf(evaluator), 5_000);
        assertEq(usdc.balanceOf(provider), 985_000);
    }

    function test_referenceGetterAbi() public {
        uint256 jobId = _funded(1e6);
        (uint256 id, address c, address p,,, uint256 budget,, IAgenticCommerce.JobStatus st,) =
            acp.jobs(jobId);
        assertEq(id, jobId);
        assertEq(c, client);
        assertEq(p, provider);
        assertEq(budget, 1e6);
        assertEq(uint8(st), uint8(IAgenticCommerce.JobStatus.Funded));
        assertEq(acp.paymentToken(), address(usdc));
    }
}
