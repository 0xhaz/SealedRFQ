/**
 * Fetching a real quorum certificate, and checking it means what the contract will read it as.
 *
 * The contract verifies the BLS aggregate itself, so the test that matters is not "did the fetch
 * return something" but "does what it returned actually verify". That is done here with an
 * independent implementation — noble, over the message Concordium's consensus signs — so a
 * mistake in assembling the committee or the bitmap shows up here rather than as a reverted
 * transaction on Arc.
 *
 * CCD_LIVE=1 pnpm --filter @sealedrfq/concordium test
 */
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { beforeAll, describe, expect, it } from "vitest";
import { type FinalityProof, fetchFinalityProof } from "../src/finality.js";

const live = process.env.CCD_LIVE === "1";
const DST = "CONCORDIUM-hashtoG1-with-BLS12381G1_XMD:SHA-256_SSWU_RO";

let client: ConcordiumGRPCNodeClient;
let proof: FinalityProof;
let eraGenesis: Buffer;
let originalGenesis: Buffer;

/** Undo the EIP-2537 padding: 16 zero bytes before each 48-byte field element. */
function fromUncompressedG2(key: Uint8Array) {
  const h = Buffer.from(key).toString("hex");
  return bls.G2.ProjectivePoint.fromAffine({
    x: { c0: BigInt(`0x${h.slice(32, 128)}`), c1: BigInt(`0x${h.slice(160, 256)}`) },
    y: { c0: BigInt(`0x${h.slice(288, 384)}`), c1: BigInt(`0x${h.slice(416, 512)}`) },
  });
}

/**
 * `"QUORUM." ‖ eraGenesisHash ‖ blockHash ‖ round ‖ epoch`, the message Concordium's consensus
 * signs. Both integers big-endian, and the genesis is the CURRENT ERA's, not the original — the
 * chain is on protocol 10, so using the original genesis produces a signature over the wrong bytes.
 */
function quorumMessage(p: FinalityProof, genesis: Buffer): Buffer {
  const be = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(n);
    return b;
  };
  return Buffer.concat([
    Buffer.from("QUORUM.", "ascii"),
    genesis,
    Buffer.from(p.blockHash.slice(2), "hex"),
    be(p.round),
    be(p.epoch),
  ]);
}

/** Pull the uncompressed G2 keys back out of the encoded committee, 288 bytes per member. */
function membersFromEncoding(encoded: string): { key: Uint8Array; index: number }[] {
  const bytes = Buffer.from(encoded.slice(2), "hex");
  const out = [];
  for (let i = 0; i * 288 < bytes.length; i++) {
    out.push({ key: bytes.subarray(i * 288, i * 288 + 256), index: i });
  }
  return out;
}

describe.skipIf(!live)("a live quorum certificate", () => {
  beforeAll(async () => {
    client = new ConcordiumGRPCNodeClient(
      "grpc.testnet.concordium.com",
      20000,
      credentials.createSsl(),
    );
    const consensus = await client.getConsensusStatus();
    eraGenesis = Buffer.from(consensus.currentEraGenesisBlock.buffer);
    originalGenesis = Buffer.from(consensus.genesisBlock.buffer);
    proof = await fetchFinalityProof(client);
  }, 120_000);

  it("carries more than two thirds of effective stake", () => {
    // Quorum is measured in stake, not in headcount, which is the detail most descriptions skip.
    expect(proof.signedStakeBps).toBeGreaterThan(6_667);
    expect(proof.signedStake).toBeLessThanOrEqual(proof.totalStake);
  });

  it("is encoded the way the contract reads it", () => {
    const members = membersFromEncoding(proof.members);
    expect(members.length).toBeGreaterThan(0);
    // 288 bytes per member: a 256-byte uncompressed G2 key then a 32-byte stake.
    expect((proof.members.length - 2) / 2).toBe(members.length * 288);
    // One bit per member, rounded up to whole bytes.
    expect((proof.signerBits.length - 2) / 2).toBe(Math.ceil(members.length / 8));
    // G1 uncompressed is two 64-byte field elements.
    expect((proof.signature.length - 2) / 2).toBe(128);
  });

  it("actually verifies, against the message consensus signs", async () => {
    // The check the contract will do, done here first with an independent implementation.
    // Aggregate the keys of exactly the members the bitmap marks, then compare the two pairings
    // directly rather than going through `bls.verify`, which expects encoded bytes and the
    // minimal-pubkey-size convention. Concordium is the other way round: signatures in G1.
    const bits = Buffer.from(proof.signerBits.slice(2), "hex");
    const members = membersFromEncoding(proof.members);
    const signers = members.filter((m) => (bits[m.index >> 3] ?? 0) & (1 << (m.index % 8)));
    expect(signers.length).toBeGreaterThan(0);

    let aggregate = fromUncompressedG2(signers[0].key);
    for (const s of signers.slice(1)) aggregate = aggregate.add(fromUncompressedG2(s.key));

    const sigHex = proof.signature.slice(2);
    const signature = bls.G1.ProjectivePoint.fromAffine({
      x: BigInt(`0x${sigHex.slice(32, 128)}`),
      y: BigInt(`0x${sigHex.slice(160, 256)}`),
    });

    const verifies = (message: Buffer) => {
      const H = bls.G1.hashToCurve(message, { DST });
      const lhs = bls.pairing(signature, bls.G2.ProjectivePoint.BASE);
      const rhs = bls.pairing(H, aggregate);
      return bls.fields.Fp12.eql(lhs, rhs);
    };

    // Which genesis the message commits to is settled by trying both rather than by assuming.
    const againstEra = verifies(quorumMessage(proof, eraGenesis));
    const againstOriginal = verifies(quorumMessage(proof, originalGenesis));
    expect(againstEra).toBe(true);
    // Worth pinning: the two differ at protocol 10, and the CIS-8 registry commits to the
    // original genesis while consensus signs against the current era's. Confusing them is silent.
    expect(againstOriginal).toBe(false);
  }, 60_000);

  it("names the block the certificate speaks for, not the one it was found in", async () => {
    // The certificate in a block certifies its parent. Using the containing block's identifiers
    // produces something that verifies against nothing, and the test above is what would catch it.
    const info = await client.getBlockInfo();
    expect(proof.blockHash.slice(2)).not.toBe(info.blockHash.toString());
  }, 60_000);
});
