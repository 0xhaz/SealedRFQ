/**
 * Fetching the finality proof the Arc qualifier demands.
 *
 * `ConcordiumQualifier.recordQualification` verifies a quorum certificate itself rather than
 * trusting the agent that supplies it, so the agent's job is to assemble a genuine one: the block,
 * its certificate, the committee that signed it, and a bitmap saying which members did.
 *
 * Three things here are easy to get wrong and silent when you do.
 *
 * The certificate found in a block certifies a *different* block — its parent — and carries that
 * block's hash, round and epoch. Using the containing block's identifiers instead produces a
 * certificate that verifies against nothing.
 *
 * The committee must be the one in force for the certified block, not the one in force now. It is
 * fixed per reward period, so the two differ for most of a day after a boundary.
 *
 * And the node serves BLS points compressed, while EIP-2537 takes them uncompressed. That
 * conversion belongs off-chain, which is here.
 */
import type { ConcordiumGRPCClient } from "@concordium/web-sdk";
import { BlockHash } from "@concordium/web-sdk";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { type CommitteeMember, encodeCommittee, signerBitmap } from "./committee.js";

export type FinalityProof = {
  /** The block the certificate speaks for, which is not the block it was found in. */
  blockHash: `0x${string}`;
  round: bigint;
  epoch: bigint;
  /** The committee, encoded as the contract reads it. */
  members: `0x${string}`;
  membersHash: `0x${string}`;
  signerBits: `0x${string}`;
  /** The aggregate signature, G1, uncompressed for EIP-2537. */
  signature: `0x${string}`;
  totalStake: bigint;
  signedStake: bigint;
  /** Basis points of effective stake that signed. Quorum is two thirds, so above 6667. */
  signedStakeBps: number;
};

const hex = (b: Uint8Array): `0x${string}` => `0x${Buffer.from(b).toString("hex")}`;
const FP = (x: bigint) => x.toString(16).padStart(96, "0").padStart(128, "0");

/** EIP-2537 G1: x then y, each 16 zero bytes followed by 48 big-endian. */
function uncompressG1(compressed: Uint8Array): `0x${string}` {
  if (compressed.length !== 48) {
    throw new Error(`a compressed G1 signature is 48 bytes, got ${compressed.length}`);
  }
  const p = bls.G1.ProjectivePoint.fromHex(Buffer.from(compressed).toString("hex")).toAffine();
  return `0x${FP(p.x)}${FP(p.y)}`;
}

/**
 * Assemble a proof that some recent block was finalized by a quorum.
 *
 * Walks back from the last finalized block until it finds one carrying a quorum certificate. A
 * block whose previous round timed out carries a timeout certificate instead, so the first block
 * looked at is not always usable and giving up on it would make this fail intermittently.
 */
export async function fetchFinalityProof(
  client: ConcordiumGRPCClient,
  options: { maxBlocksBack?: number } = {},
): Promise<FinalityProof> {
  const maxBack = options.maxBlocksBack ?? 8;
  const consensus = await client.getConsensusStatus();
  let cursor = consensus.lastFinalizedBlock;

  for (let i = 0; i < maxBack; i++) {
    const certificates = await client.getBlockCertificates(cursor);
    const qc = certificates.quorumCertificate;
    if (!qc) {
      // No quorum certificate: the previous round timed out. Step back and try its parent.
      const info = await client.getBlockInfo(cursor);
      cursor = info.blockParent;
      continue;
    }

    const certified = BlockHash.fromHexString(qc.blockHash);
    // The committee for the certified block's reward period, not for the chain's head.
    const members: CommitteeMember[] = [];
    for await (const baker of client.getBakersRewardPeriod(certified)) {
      if (!baker.isFinalizer) continue;
      members.push({
        bakerId: Number(baker.baker.bakerId),
        publicKey: Buffer.from(baker.baker.aggregationKey, "hex"),
        stake: baker.effectiveStake.microCcdAmount,
      });
    }
    if (members.length === 0) {
      throw new Error(`no finalizers reported for block ${qc.blockHash}`);
    }

    const committee = encodeCommittee(members);
    const signatories = qc.signatories.map((s) => Number(s));
    const bits = signerBitmap(committee.order, signatories);

    const signed = new Set(signatories);
    const signedStake = members
      .filter((m) => signed.has(m.bakerId))
      .reduce((sum, m) => sum + m.stake, 0n);
    const signedStakeBps = Number((signedStake * 10_000n) / committee.totalStake);
    // Two thirds of effective stake, not of headcount. A certificate below that was never valid,
    // and sending it on would waste a transaction to be told so by the contract.
    if (signedStakeBps <= 6_667) {
      throw new Error(
        `certificate for ${qc.blockHash} carries only ${signedStakeBps} bps of stake, below quorum`,
      );
    }

    return {
      blockHash: `0x${qc.blockHash}`,
      round: BigInt(qc.round),
      epoch: BigInt(qc.epoch),
      members: hex(committee.encoded),
      membersHash: committee.hash,
      signerBits: hex(bits),
      signature: uncompressG1(Buffer.from(qc.aggregateSignature, "hex")),
      totalStake: committee.totalStake,
      signedStake,
      signedStakeBps,
    };
  }

  throw new Error(`no quorum certificate found within ${maxBack} blocks of the last finalized one`);
}
