import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeCommittee, periodOf, signerBitmap } from "../src/committee.js";

/**
 * The encoder has to agree with `ConcordiumEpochRegistry` byte for byte, in a different language.
 *
 * So it is checked against the fixture the contract has already accepted on-chain, not against a
 * second copy of the same assumptions written here. If this hash matches, the bytes this produces
 * are the bytes that verified a real mainnet certificate.
 */
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../contracts/test/fixtures/concordium-qc.json", import.meta.url),
    "utf8",
  ),
);

/** Recover the members from the fixture's encoding, as the node would have supplied them. */
function membersFromFixture() {
  const bytes = Buffer.from(fixture.members.slice(2), "hex");
  const out: { bakerId: number; publicKey: Uint8Array; stake: bigint }[] = [];
  for (let i = 0; i * 288 < bytes.length; i++) {
    const off = i * 288;
    // Re-compress the key so the encoder is exercised on the form the node actually serves.
    const x = [bytes.subarray(off, off + 64), bytes.subarray(off + 64, off + 128)];
    out.push({
      bakerId: i,
      publicKey: recompress(bytes.subarray(off, off + 256)),
      stake: BigInt(`0x${bytes.subarray(off + 256, off + 288).toString("hex")}`),
    });
    void x;
  }
  return out;
}

function recompress(uncompressed: Buffer): Uint8Array {
  // Lazily: go back through noble rather than implementing compression by hand.
  const { bls12_381 } = require("@noble/curves/bls12-381.js");
  const fp = (b: Buffer) => BigInt(`0x${b.subarray(16).toString("hex")}`);
  const p = bls12_381.G2.ProjectivePoint.fromAffine({
    x: { c0: fp(uncompressed.subarray(0, 64)), c1: fp(uncompressed.subarray(64, 128)) },
    y: { c0: fp(uncompressed.subarray(128, 192)), c1: fp(uncompressed.subarray(192, 256)) },
  });
  return p.toRawBytes(true);
}

describe("encoding the committee", () => {
  it("produces the bytes the contract verified a real certificate against", () => {
    const { encoded, hash, totalStake } = encodeCommittee(membersFromFixture());
    expect(`0x${Buffer.from(encoded).toString("hex")}`).toBe(fixture.members);
    expect(hash).toBe(fixture.membersHash);
    expect(totalStake).toBe(BigInt(fixture.totalStake));
  });

  it("sorts by baker id, so the node's ordering cannot change the hash", () => {
    const members = membersFromFixture();
    const shuffled = [...members].reverse();
    expect(encodeCommittee(shuffled).hash).toBe(encodeCommittee(members).hash);
  });

  it("refuses a committee listing one baker twice", () => {
    const members = membersFromFixture();
    // Counted twice, that baker's stake counts twice toward quorum: the one encoding mistake that
    // weakens the check instead of breaking it, so it fails loudly here.
    expect(() => encodeCommittee([...members, members[0]])).toThrow(/appears twice/);
  });

  it("refuses an empty committee rather than hashing nothing", () => {
    expect(() => encodeCommittee([])).toThrow(/no members/);
  });

  it("refuses a key that is not a compressed G2 point", () => {
    const members = membersFromFixture();
    members[0].publicKey = new Uint8Array(48);
    expect(() => encodeCommittee(members)).toThrow(/96 bytes/);
  });
});

describe("the signer bitmap", () => {
  it("matches the one the contract accepted", () => {
    const { order } = encodeCommittee(membersFromFixture());
    // The fixture's bakers were renumbered 0..n by membersFromFixture, so reconstruct which
    // positions were set and check the bitmap round-trips to the same bytes.
    const expected = Buffer.from(fixture.signerBits.slice(2), "hex");
    const signers = order.filter((_, i) => (expected[i >> 3] & (1 << (i % 8))) !== 0);
    expect(Buffer.from(signerBitmap(order, signers))).toEqual(expected);
  });

  it("is built from the encoded order, so it cannot drift from the bytes", () => {
    const order = [5, 1, 9];
    // Position, not baker id: baker 9 is third, so bit two.
    expect(signerBitmap(order, [9])[0]).toBe(0b100);
  });
});

describe("reward periods", () => {
  it("puts the fixture's epoch in the period the contract used", () => {
    expect(periodOf(Number(fixture.epoch))).toBe(Math.floor(Number(fixture.epoch) / 24));
  });
});
