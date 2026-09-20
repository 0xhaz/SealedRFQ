// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IRFQRegistry} from "../interfaces/IRFQRegistry.sol";
import {ISupplierQualifier} from "../interfaces/ISupplierQualifier.sol";
import {PullPayments} from "../lib/PullPayments.sol";
import {Roles} from "../governance/Roles.sol";

/// @title RFQBase
/// @notice Shared storage and helpers for the RFQRegistry modules (BidDeposit, SealedBid).
/// @dev Accounting invariant: `totalHeld + totalWithdrawable == settlementToken.balanceOf(this)`.
///      `totalHeld` covers budget + buyer stake of Open RFQs and every Held deposit.
abstract contract RFQBase is IRFQRegistry, PullPayments, AccessControl {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_MILESTONES = 10;
    uint256 internal constant MAX_INVITEES = 50;

    mapping(uint256 rfqId => RFQ) internal _rfqs;
    mapping(uint256 rfqId => uint16[]) internal _milestones;
    mapping(uint256 rfqId => mapping(address bidder => Bid)) internal _bids;
    mapping(uint256 rfqId => mapping(address supplier => bool)) internal _invited;

    uint256 public rfqCount;
    uint256 public totalHeld;
    ISupplierQualifier public qualifier;

    function setQualifier(ISupplierQualifier q) external onlyRole(Roles.ADMIN) {
        qualifier = q;
        emit QualifierSet(address(q));
    }

    function phase(uint256 rfqId) external view returns (Phase) {
        RFQ storage r = _rfqs[rfqId];
        return r.status == Status.None ? Phase.None : _phase(r);
    }

    function _rfq(uint256 rfqId) internal view returns (RFQ storage r) {
        r = _rfqs[rfqId];
        if (r.status == Status.None) revert RFQNotFound(rfqId);
    }

    /// @dev An Open RFQ past its award deadline reports NoAward until someone calls closeNoAward.
    function _phase(RFQ storage r) internal view returns (Phase) {
        Status s = r.status;
        if (s == Status.Awarded) return Phase.Awarded;
        if (s == Status.NoAward) return Phase.NoAward;
        if (s == Status.Cancelled) return Phase.Cancelled;
        if (block.timestamp < r.bidDeadline) return Phase.Bidding;
        if (block.timestamp < r.revealDeadline) return Phase.Reveal;
        if (block.timestamp < r.awardDeadline) return Phase.Award;
        return Phase.NoAward;
    }

    function _requirePhase(RFQ storage r, Phase expected) internal view {
        Phase current = _phase(r);
        if (current != expected) revert WrongPhase(current);
    }

    /// @dev Best-effort ERC-2612 permit. A front-run permit is fine: the pull still succeeds on the
    ///      allowance it created, and a bad signature fails at the pull with a clear ERC-20 error.
    function _permit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) internal {
        try IERC20Permit(address(settlementToken))
            .permit(msg.sender, address(this), amount, deadline, v, r, s) {}
            catch {}
    }
}
