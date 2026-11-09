// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ConcordiumQualifier} from "../concordium/ConcordiumQualifier.sol";
import {IAttestationLog} from "../interfaces/IAttestationLog.sol";
import {IProcurementPolicy} from "../interfaces/IProcurementPolicy.sol";
import {ISealedRFQAdapter} from "../interfaces/ISealedRFQAdapter.sol";
import {Roles} from "../governance/Roles.sol";
import {RFQRegistry} from "./RFQRegistry.sol";

/// @title RFQ registry with a Concordium eligibility gate
/// @notice V1 with one thing added: a tender can require that bidders were checked against
///         Concordium, per tender, and the contract refuses the commit otherwise.
///
/// V1's qualifier interface asks `isQualified(address)`, which cannot express the two rules that
/// matter. Eligibility belongs to a bidder *for a tender*, since a supplier qualified for a
/// software RFI is not thereby qualified for a medical-devices one, and the nullifier that stops
/// one entity bidding from two wallets is meaningless without a tender to scope it to.
///
/// The gate is in `_screenBidder`, which is the path every commit takes. There is no second route
/// in: `commitBid` and `commitBidWithPermit` both reach it, so a caller who skips this contract's
/// front door and calls the inherited function directly meets the same refusal. That is the
/// property worth testing, and it is tested.
contract QualifiedRFQRegistryV2 is RFQRegistry {
    ConcordiumQualifier public qualifierV2;

    /// Tenders that demand a Concordium check, set by the buyer when the tender is created.
    mapping(uint256 rfqId => bool) public requiresConcordium;

    event QualifierV2Set(address qualifier);
    event ConcordiumRequired(uint256 indexed rfqId);

    error ConcordiumQualifierNotSet();

    constructor(
        IERC20 usdc,
        IProcurementPolicy policy_,
        IAttestationLog attestationLog_,
        ISealedRFQAdapter adapter_,
        address admin
    ) RFQRegistry(usdc, policy_, attestationLog_, adapter_, admin) {}

    function setQualifierV2(ConcordiumQualifier q) external onlyRole(Roles.ADMIN) {
        qualifierV2 = q;
        emit QualifierV2Set(address(q));
    }

    /// @notice Demand a Concordium check for one tender.
    /// @dev The buyer's call, not the operator's. A tender that needs verified suppliers is a
    ///      procurement decision, and one deployment-wide switch would force it on tenders that do
    ///      not need it and cannot have it.
    function requireConcordium(uint256 rfqId) external {
        if (msg.sender != _rfq(rfqId).buyer) revert NotBuyer(msg.sender);
        requiresConcordium[rfqId] = true;
        emit ConcordiumRequired(rfqId);
    }

    /// @dev Runs V1's screening first and adds to it. Replacing it would silently drop the
    ///      buyer-cannot-bid and invite-only rules, which is the kind of regression an override
    ///      makes easy and a reviewer would not see.
    function _screenBidder(RFQ storage r, uint256 rfqId) internal view override {
        super._screenBidder(r, rfqId);
        if (!requiresConcordium[rfqId]) return;
        // Fails closed: a tender demanding a check that cannot be performed takes no bids, rather
        // than taking them unchecked.
        if (address(qualifierV2) == address(0)) revert ConcordiumQualifierNotSet();
        qualifierV2.requireQualified(msg.sender, rfqId);
    }
}
