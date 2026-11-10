/**
 * The one fact that spans both chains: a key bound in Concordium's CIS-8 registry and an address
 * that holds a role on Arc are the same entity.
 *
 * The badge claims the agent controls the key Arc accepts recommendations from. That claim is only
 * worth something if it can be checked, and checking it means deriving an Ethereum address from a
 * compressed secp256k1 point — decompress, Keccak-256 the 64-byte public key, keep the last 20
 * bytes. Nobody does that by hand, so the evidence dashboard does it in the request and shows both
 * sides.
 *
 * Free of `@concordium/web-sdk` on purpose, like the rest of the default entry: a server component
 * imports this, and the SDK's wasm has no business in that bundle.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * The Arc/Ethereum address a CIS-8 secp256k1 key corresponds to, lowercase and 0x-prefixed.
 *
 * Throws rather than returning a sentinel: a caller comparing a sentinel against a real address
 * would silently report "not the same key", which is a finding, when the truth is that the input
 * was not a key at all.
 */
export function arcAddressForKey(publicKeyHex: string): `0x${string}` {
  const hex = publicKeyHex.startsWith("0x") ? publicKeyHex.slice(2) : publicKeyHex;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("a public key must be an even-length hex string");
  }
  // 33 bytes compressed, 65 uncompressed with its 0x04 tag. Both are CIS-8 key types, and both
  // describe the same point, so both must derive the same address.
  if (hex.length !== 66 && hex.length !== 130) {
    throw new Error(
      `expected a 33-byte compressed or 65-byte uncompressed secp256k1 key, got ${hex.length / 2} bytes`,
    );
  }
  // Rejects a point that is not on the curve, which is the case worth refusing: a well-formed
  // 33-byte string that is not a key would otherwise hash to a plausible-looking address.
  const point = secp256k1.Point.fromHex(hex);
  const uncompressed = point.toBytes(false).subarray(1);
  const digest = keccak_256(uncompressed);
  return `0x${Buffer.from(digest).subarray(12).toString("hex")}`;
}

/** Whether a CIS-8 key and an Arc address are the same entity. Case-insensitive, never throws. */
export function keyMatchesArcAddress(
  publicKeyHex: string,
  address: string,
): { ok: boolean; derived?: `0x${string}`; reason?: string } {
  let derived: `0x${string}`;
  try {
    derived = arcAddressForKey(publicKeyHex);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { ok: derived === address.toLowerCase(), derived };
}
