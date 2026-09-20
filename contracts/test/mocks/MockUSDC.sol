// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @notice Local stand-in for Arc USDC (0x3600…): 6 decimals, EIP-712 name "USDC" version "2",
///         ERC-2612 permit, and a blocklist that makes transfers to/from listed addresses revert,
///         which is how Arc's protocol-level blocklist surfaces to contracts.
/// @dev OZ ERC20Permit pins EIP-712 version "1", so permit is implemented here with version "2".
contract MockUSDC is ERC20, IERC20Permit, EIP712, Nonces {
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    mapping(address => bool) public blocklisted;

    error Blocklisted(address account);
    error PermitExpired(uint256 deadline);
    error PermitInvalidSigner(address signer, address owner);

    constructor() ERC20("USDC", "USDC") EIP712("USDC", "2") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp > deadline) revert PermitExpired(deadline);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (signer != owner) revert PermitInvalidSigner(signer, owner);
        _approve(owner, spender, value);
    }

    function nonces(address owner) public view override(IERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocklisted(address account, bool listed) external {
        blocklisted[account] = listed;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocklisted[from]) revert Blocklisted(from);
        if (blocklisted[to]) revert Blocklisted(to);
        super._update(from, to, value);
    }
}
