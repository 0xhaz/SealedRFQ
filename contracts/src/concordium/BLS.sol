// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title BLS12-381 verification over the EIP-2537 precompiles
/// @notice Verifies Concordium's aggregate signatures on Arc.
///
/// Concordium implements IRTF draft-irtf-cfrg-bls-signature-04 in the minimal-signature-size
/// variant: signatures are points in G1, public keys are points in G2, and verification is the
/// pairing identity e(sig, g2) == e(H(m), pk).
///
/// That identity is checked as a single product against one, e(sig, -g2) * e(H(m), pk) == 1,
/// because BLS12_PAIRING_CHECK answers "is this product the identity" rather than returning a
/// target-field element to compare. One call instead of two, and nothing to compare afterwards.
///
/// This is only possible because Arc runs Prague: EIP-2537 supplies the curve operations, verified
/// present and computing on Arc mainnet rather than assumed. On a pre-Prague EVM every one of these
/// would have to be written in Solidity field arithmetic, which is the difference between a library
/// and a research project.
library BLS {
    address internal constant G1ADD = address(0x0b);
    address internal constant PAIRING = address(0x0f);
    address internal constant MAP_FP_TO_G1 = address(0x10);
    address internal constant SHA256 = address(0x02);
    address internal constant MODEXP = address(0x05);

    /// Base field modulus p of BLS12-381.
    bytes internal constant P =
        hex"1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";

    error PrecompileFailed(address which);
    error BadLength();

    /// @notice Verify one signature against one public key.
    /// @param pk 256-byte G2 point, the signer's public key.
    /// @param message the signed bytes.
    /// @param sig 128-byte G1 point.
    /// @param dst the domain separation tag the signer hashed with.
    /// @param negG2 256-byte negated G2 generator, passed in so the caller can pin the constant.
    function verify(
        bytes memory pk,
        bytes memory message,
        bytes memory sig,
        bytes memory dst,
        bytes memory negG2
    ) internal view returns (bool) {
        if (pk.length != 256 || sig.length != 128 || negG2.length != 256) revert BadLength();
        bytes memory h = hashToG1(message, dst);
        // Two pairs, each a 128-byte G1 point followed by a 256-byte G2 point.
        bytes memory input = abi.encodePacked(sig, negG2, h, pk);
        (bool ok, bytes memory out) = PAIRING.staticcall(input);
        if (!ok || out.length != 32) revert PrecompileFailed(PAIRING);
        return abi.decode(out, (uint256)) == 1;
    }

    /// @notice hash_to_curve for G1, the SSWU random-oracle variant.
    /// @dev Two field elements are mapped and added, which is what makes the result indifferentiable
    ///      from a random oracle. Mapping one would be cheaper and would not be.
    function hashToG1(bytes memory message, bytes memory dst) internal view returns (bytes memory) {
        bytes memory uniform = expandMessageXmd(message, dst, 128);
        bytes memory q0 = mapToG1(reduceToFp(slice(uniform, 0, 64)));
        bytes memory q1 = mapToG1(reduceToFp(slice(uniform, 64, 64)));
        (bool ok, bytes memory out) = G1ADD.staticcall(abi.encodePacked(q0, q1));
        if (!ok || out.length != 128) revert PrecompileFailed(G1ADD);
        return out;
    }

    function mapToG1(bytes memory fp) private view returns (bytes memory) {
        (bool ok, bytes memory out) = MAP_FP_TO_G1.staticcall(fp);
        if (!ok || out.length != 128) revert PrecompileFailed(MAP_FP_TO_G1);
        return out;
    }

    /// @dev A 64-byte value reduced mod p, via modexp with exponent one. Writing a 512-bit
    ///      reduction by hand would be more code and more ways to be subtly wrong.
    function reduceToFp(bytes memory wide) private view returns (bytes memory) {
        // The exponent is declared as one byte long, so it must be supplied as one byte. Passing
        // uint256(1) here declares a length of 1 and supplies 32, and modexp then reads a zero
        // exponent and takes the rest of the word as the start of the modulus. It returns a
        // plausible 48 bytes either way, which is why this surfaced as a wrong curve point rather
        // than as an error.
        bytes memory input = abi.encodePacked(
            uint256(64), uint256(1), uint256(48), wide, uint8(1), P
        );
        (bool ok, bytes memory out) = MODEXP.staticcall(input);
        if (!ok || out.length != 48) revert PrecompileFailed(MODEXP);
        // EIP-2537 wants 64 bytes per field element: 16 zero bytes, then 48 big-endian.
        return abi.encodePacked(bytes16(0), out);
    }

    /// @notice expand_message_xmd with SHA-256, from RFC 9380.
    function expandMessageXmd(bytes memory message, bytes memory dst, uint256 lenInBytes)
        internal
        view
        returns (bytes memory)
    {
        uint256 ell = (lenInBytes + 31) / 32;
        // The DST length is appended as a single byte, so a tag over 255 bytes cannot be encoded.
        bytes memory dstPrime = abi.encodePacked(dst, uint8(dst.length));
        // b_0 = H(Z_pad || msg || l_i_b_str || 0 || dst_prime), Z_pad being one SHA-256 block.
        bytes32 b0 = sha(
            abi.encodePacked(new bytes(64), message, uint16(lenInBytes), uint8(0), dstPrime)
        );
        bytes32 b1 = sha(abi.encodePacked(b0, uint8(1), dstPrime));

        bytes memory out = new bytes(lenInBytes);
        writeAt(out, 0, b1, lenInBytes);
        bytes32 prev = b1;
        for (uint256 i = 2; i <= ell; ++i) {
            bytes32 bi = sha(abi.encodePacked(b0 ^ prev, uint8(i), dstPrime));
            writeAt(out, (i - 1) * 32, bi, lenInBytes);
            prev = bi;
        }
        return out;
    }

    function sha(bytes memory data) private view returns (bytes32) {
        (bool ok, bytes memory out) = SHA256.staticcall(data);
        if (!ok || out.length != 32) revert PrecompileFailed(SHA256);
        return abi.decode(out, (bytes32));
    }

    function writeAt(bytes memory dest, uint256 offset, bytes32 word, uint256 cap) private pure {
        uint256 n = cap - offset < 32 ? cap - offset : 32;
        for (uint256 j = 0; j < n; ++j) dest[offset + j] = word[j];
    }

    function slice(bytes memory data, uint256 start, uint256 len)
        private
        pure
        returns (bytes memory out)
    {
        out = new bytes(len);
        for (uint256 i = 0; i < len; ++i) out[i] = data[start + i];
    }
}
