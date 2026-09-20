// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISupplierQualifier
/// @notice Gate for RFQs with `requiresQualification`. Implemented by the thin SupplierRegistry
///         over the ERC-8004 Validation Registry (🔶). RFQRegistry reads it at commit time.
interface ISupplierQualifier {
    function isQualified(address supplier) external view returns (bool);
}
