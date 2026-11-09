import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * Encoding Concordium's finalization committee the way `ConcordiumEpochRegistry` expects it.
 *
 * The contract stores only a hash and recomputes it from whatever a caller supplies, so this
 * encoding is a consensus rule between two codebases in different languages. A disagreement of one
 * byte means every certificate is rejected, with nothing to indicate which side is wrong. The test
 * beside this file checks the output against a fixture the contract has already accepted on-chain,
 * rather than against a second copy of the same assumptions.
 *
 * Two conversions happen here and neither is cosmetic:
 *
 * Members are sorted by baker id, ascending. The node returns them in its own order, and the
 * contract hashes the bytes it is given, so the order has to be fixed somewhere.
 *
 * Keys are decompressed. Concordium serialises a G2 point in 96 bytes; EIP-2537 takes 256. Doing
 * that on-chain would be a square root in Fp2 per key, so it happens here, and a wrong point fails
 * the pairing anyway.
 */
export type CommitteeMember = {
  bakerId: number;
  /** As the node serves it: 96 bytes of compressed G2. */
  publicKey: Uint8Array;
  /** Effective stake in microCCD, which is what quorum is measured in. */
  stake: bigint;
};

export type EncodedCommittee = {
  /** 288 bytes per member: uncompressed G2 key, then the stake as a 32-byte word. */
  encoded: Uint8Array;
  hash: `0x${string}`;
  totalStake: bigint;
  /** Baker ids in the encoded order, so a caller can build a signer bitmap that lines up. */
  order: number[];
};

const FP = (x: bigint) => x.toString(16).padStart(96, "0").padStart(128, "0");

/** EIP-2537 G2: x.c0, x.c1, y.c0, y.c1, each 16 zero bytes then 48 big-endian. */
function uncompressG2(compressed: Uint8Array): string {
  if (compressed.length !== 96) {
    throw new Error(`a compressed G2 key is 96 bytes, got ${compressed.length}`);
  }
  const p = bls.G2.ProjectivePoint.fromHex(Buffer.from(compressed).toString("hex")).toAffine();
  return FP(p.x.c0) + FP(p.x.c1) + FP(p.y.c0) + FP(p.y.c1);
}

export function encodeCommittee(members: CommitteeMember[]): EncodedCommittee {
  if (members.length === 0) throw new Error("a committee with no members cannot be encoded");

  const ids = members.map((m) => m.bakerId);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  // A repeated baker would be counted twice toward quorum, which is the one encoding mistake that
  // weakens the check rather than breaking it.
  if (dupe !== undefined) throw new Error(`baker ${dupe} appears twice in the committee`);

  const sorted = [...members].sort((a, b) => a.bakerId - b.bakerId);
  let hex = "";
  let totalStake = 0n;
  for (const m of sorted) {
    if (m.stake < 0n) throw new Error(`baker ${m.bakerId} has a negative stake`);
    hex += uncompressG2(m.publicKey) + m.stake.toString(16).padStart(64, "0");
    totalStake += m.stake;
  }
  const encoded = Uint8Array.from(Buffer.from(hex, "hex"));
  return {
    encoded,
    hash: `0x${Buffer.from(keccak_256(encoded)).toString("hex")}`,
    totalStake,
    order: sorted.map((m) => m.bakerId),
  };
}

/**
 * A bit per committee member, in the encoded order, set when that member signed.
 *
 * Built from the same `order` the encoding produced rather than from a fresh sort, so the bitmap
 * cannot drift out of step with the bytes it describes.
 */
export function signerBitmap(order: number[], signatories: Iterable<number>): Uint8Array {
  const signed = new Set(signatories);
  const bits = new Uint8Array(Math.ceil(order.length / 8));
  order.forEach((id, i) => {
    if (signed.has(id)) bits[i >> 3] |= 1 << (i % 8);
  });
  return bits;
}

/** Which reward period an epoch falls in. One committee is registered per period, not per epoch. */
export const periodOf = (epoch: number, rewardPeriodEpochs = 24) =>
  Math.floor(epoch / rewardPeriodEpochs);
