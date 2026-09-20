// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IProcurementPolicy
/// @notice On-chain caps that no key (AI agent or human) can cross. RFQRegistry calls
///         `checkCreate` in createRFQ and `checkAward` inside `award()`; a violation reverts the
///         whole transaction with a typed error. "AI proposes, the contract disposes."
interface IProcurementPolicy {
    struct Policy {
        /// Award price cap as a share of the published budget (10000 = the full budget).
        uint16 maxAwardBps;
        /// Revealed bids required before any award.
        uint16 minRevealedBids;
        /// Winner's deposit must be at least this share of its bid price.
        uint16 minDepositBps;
        /// Buyer stake floor at RFQ creation (share of budget).
        uint16 minBuyerStakeBps;
        /// One supplier's share of a buyer's cumulative awarded spend (10000 = no cap).
        uint16 maxSupplierShareBps;
        /// Concentration cap only applies once the buyer's cumulative spend reaches this (6d USDC).
        uint128 concentrationFloor;
    }

    struct AwardCheck {
        uint256 budget;
        uint256 price;
        uint256 deposit;
        uint256 revealedBids;
        bytes32 rubricHash;
        bytes32 expectedRubricHash;
        /// Buyer's cumulative awarded spend before this award.
        uint256 buyerAwardedTotal;
        /// Buyer's cumulative awarded spend with this supplier before this award.
        uint256 buyerSupplierTotal;
    }

    event PolicyUpdated(Policy policy);

    error InvalidPolicy();
    error BuyerStakeTooLow(uint256 bps, uint256 minBps);
    error RubricMismatch(bytes32 got, bytes32 expected);
    error InsufficientBidders(uint256 revealed, uint256 required);
    error AwardExceedsBudget(uint256 price, uint256 cap);
    error DepositRatioTooLow(uint256 deposit, uint256 required);
    error ConcentrationCapExceeded(uint256 shareBps, uint256 maxBps);

    function policy() external view returns (Policy memory);

    function setPolicy(Policy calldata p) external;

    /// @dev Reverts if an RFQ with these terms may not be created.
    function checkCreate(uint256 buyerStakeBps) external view;

    /// @dev Reverts with the first violated rule. Checked in this order: rubric, bidders, budget,
    ///      deposit ratio, concentration.
    function checkAward(AwardCheck calldata c) external view;
}
