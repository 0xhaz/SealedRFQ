// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RFQBase} from "./RFQBase.sol";

/// @title BidDeposit
/// @notice USDC bid deposits: every sealed bid is backed by `depositAmount`, which makes the RFQ
///         spam-resistant without KYC. Outcomes, settled one bidder at a time (no loops):
///           revealed, not awarded -> Refunded to the bidder
///           never revealed        -> Forfeited to the buyer
///           winner                -> RolledOver into the performance stake (at award)
abstract contract BidDeposit is RFQBase {
    /// @notice Permissionless once the RFQ is Awarded or closed with no award.
    function settleDeposit(uint256 rfqId, address bidder) external nonReentrant {
        RFQ storage r = _rfq(rfqId);
        if (r.status != Status.Awarded && r.status != Status.NoAward) revert WrongPhase(_phase(r));
        Bid storage b = _bids[rfqId][bidder];
        if (b.deposit != DepositState.Held) revert DepositNotHeld(bidder);

        uint256 amount = r.depositAmount;
        address beneficiary;
        if (b.revealed) {
            b.deposit = DepositState.Refunded;
            beneficiary = bidder;
        } else {
            b.deposit = DepositState.Forfeited;
            beneficiary = r.buyer;
        }
        totalHeld -= amount;
        _credit(beneficiary, amount);
        emit DepositSettled(rfqId, bidder, b.deposit, beneficiary, amount);
    }

    function _takeDeposit(RFQ storage r, address bidder) internal {
        uint256 amount = r.depositAmount;
        _pullIn(bidder, amount);
        totalHeld += amount;
    }
}
