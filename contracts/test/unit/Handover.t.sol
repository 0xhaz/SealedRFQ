// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AgenticCommerce} from "../../src/core/AgenticCommerce.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/**
 * Handing the operator keys to hardware, which has to happen before any renunciation.
 *
 * Pinned because the order is unforgiving and the contracts use plain `AccessControl`: there is no
 * two-step accept, a grant to a wrong address cannot be reversed, and nothing can be re-granted
 * once the granting role is gone. The failure is silent — everything keeps working until the day
 * somebody needs to change a policy or move a treasury and finds that nobody can.
 */
contract HandoverTest is Test {
    bytes32 constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;

    AgenticCommerce acp;
    address old_ = address(0xA11CE);
    address hw = address(0xB0B);
    address treasury = address(0xFEE5);

    function setUp() public {
        acp = new AgenticCommerce(address(new MockUSDC()), treasury, old_);
    }

    function test_bothRolesTransfer_andTheOldWalletLosesControl() public {
        vm.startPrank(old_);
        acp.grantRole(DEFAULT_ADMIN_ROLE, hw);
        acp.grantRole(ADMIN_ROLE, hw);
        acp.renounceRole(ADMIN_ROLE, old_);
        acp.renounceRole(DEFAULT_ADMIN_ROLE, old_);
        vm.stopPrank();

        assertTrue(acp.hasRole(ADMIN_ROLE, hw));
        assertTrue(acp.hasRole(DEFAULT_ADMIN_ROLE, hw));
        assertFalse(acp.hasRole(ADMIN_ROLE, old_));
        assertFalse(acp.hasRole(DEFAULT_ADMIN_ROLE, old_));
    }

    /// Transferring only ADMIN_ROLE leaves the old wallet able to grant it straight back.
    function test_movingOnlyOneRoleIsNotAHandover() public {
        vm.startPrank(old_);
        acp.grantRole(ADMIN_ROLE, hw);
        acp.renounceRole(ADMIN_ROLE, old_);
        // Still holds DEFAULT_ADMIN_ROLE, so it can simply take ADMIN_ROLE again.
        acp.grantRole(ADMIN_ROLE, old_);
        vm.stopPrank();
        assertTrue(acp.hasRole(ADMIN_ROLE, old_), "the old wallet is still in control");
    }

    /// The treasury freezes with the role, so it must be moved before renouncing, not after.
    function test_treasuryCannotBeMovedAfterRenouncing() public {
        vm.startPrank(old_);
        acp.renounceRole(ADMIN_ROLE, old_);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, old_, ADMIN_ROLE
            )
        );
        acp.setPlatformFee(0, hw);
        vm.stopPrank();
        assertEq(acp.platformTreasury(), treasury, "frozen at whatever it was");
    }
}
