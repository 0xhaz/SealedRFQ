// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BidDeposit} from "./BidDeposit.sol";

/// @title SealedBid
/// @notice Commit-reveal sealed bids. During Bidding a supplier posts only
///         `computeCommitment(rfqId, bidder, price, deliveryDays, salt)` plus the deposit, so no
///         price is visible on-chain until the reveal window. The salt is generated client-side
///         (never `block.prevrandao`, which is 0 on Arc). A bid that is not revealed in time forfeits
///         its deposit.
abstract contract SealedBid is BidDeposit {
    function computeCommitment(
        uint256 rfqId,
        address bidder,
        uint128 price,
        uint32 deliveryDays,
        bytes32 proposalHash,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(address(this), block.chainid, rfqId, bidder, price, deliveryDays, proposalHash, salt)
        );
    }

    function commitBid(uint256 rfqId, bytes32 commitHash) external nonReentrant {
        _commit(rfqId, commitHash);
    }

    function commitBidWithPermit(
        uint256 rfqId,
        bytes32 commitHash,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _permit(_rfq(rfqId).depositAmount, deadline, v, r, s);
        _commit(rfqId, commitHash);
    }

    /// @notice Reveal a committed bid. Only the bidder can reveal, only in the reveal window.
    /// @dev `proposalHash` is bound into the commitment, so an RFP proposal cannot be rewritten
    ///      after seeing the competition any more than the price can.
    function revealBid(uint256 rfqId, uint128 price, uint32 deliveryDays, bytes32 proposalHash, bytes32 salt)
        external
    {
        RFQ storage r = _rfq(rfqId);
        _requirePhase(r, Phase.Reveal);
        Bid storage b = _bids[rfqId][msg.sender];
        if (b.commitHash == bytes32(0)) revert NoCommitment(msg.sender);
        if (b.revealed) revert AlreadyRevealed(msg.sender);
        if (price == 0) revert ZeroPrice();
        if (r.requiresProposal && proposalHash == bytes32(0)) revert ProposalRequired();
        if (computeCommitment(rfqId, msg.sender, price, deliveryDays, proposalHash, salt) != b.commitHash) {
            revert CommitmentMismatch();
        }

        b.revealed = true;
        b.price = price;
        b.deliveryDays = deliveryDays;
        b.proposalHash = proposalHash;
        r.revealCount++;
        emit BidRevealed(rfqId, msg.sender, price, deliveryDays, proposalHash);
    }

    /// @dev Re-committing before the deadline replaces the hash without a second deposit.
    function _commit(uint256 rfqId, bytes32 commitHash) internal {
        RFQ storage r = _rfq(rfqId);
        _requirePhase(r, Phase.Bidding);
        if (commitHash == bytes32(0)) revert CommitmentMismatch();
        if (msg.sender == r.buyer) revert BuyerCannotBid();
        if (r.inviteOnly && !_invited[rfqId][msg.sender]) revert NotInvited(msg.sender);
        if (
            r.requiresQualification
                && (address(qualifier) == address(0) || !qualifier.isQualified(msg.sender))
        ) {
            revert NotQualified(msg.sender);
        }

        Bid storage b = _bids[rfqId][msg.sender];
        if (b.deposit == DepositState.None) {
            b.deposit = DepositState.Held;
            r.commitCount++;
            _takeDeposit(r, msg.sender);
        }
        b.commitHash = commitHash;
        emit BidCommitted(rfqId, msg.sender, commitHash, r.depositAmount);
    }
}
