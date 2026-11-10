/**
 * Records a qualification on Arc, and keeps apart the four ways that can fail to happen.
 *
 * Kept free of Nest so `scripts/concordium/record-qualification.mjs` runs exactly this code rather
 * than a second copy that could drift from it.
 *
 * What a recorded qualification means is stated in `ConcordiumQualifier.sol` and this file claims
 * no more. *Verified* on chain: the Concordium block the record names was finalized by a two-thirds
 * quorum and is recent. *Asserted*: that the subject's credential was checked honestly. Nothing
 * here can repeat that check. This module takes a subject that something upstream already
 * verified, so it is exactly as trustworthy as that upstream step and no more.
 */
import { deriveNullifier } from "@sealedrfq/concordium";
import { type Hex, decodeErrorResult, parseAbi } from "viem";

export const QUALIFIER_ABI = parseAbi([
  "function recordQualification(address bidder, uint256 tenderId, bytes32 nullifier, bytes32 blockHash, uint64 round, uint64 epoch, bytes members, bytes signerBits, bytes signature)",
  "function isQualified(address bidder, uint256 tenderId) view returns (bool)",
  "function qualificationOf(address bidder, uint256 tenderId) view returns ((bytes32 nullifier, uint64 checkedAtEpoch, uint64 expiresAt, bool present))",
  "function claimedBy(uint256 tenderId, bytes32 nullifier) view returns (address)",
  "error NullifierAlreadyUsed(uint256 tenderId, bytes32 nullifier, address claimedBy)",
  // Raised by the epoch registry inside verifyCertificate and bubbled up unchanged.
  "error StaleRegistry(uint64 expectedPeriod, uint64 latestRegistered)",
  "error CertificateTooOld(uint64 certificateEpoch, uint64 currentEpoch)",
  "error CertificateFromTheFuture(uint64 certificateEpoch, uint64 currentEpoch)",
  "error CommitteeMismatch()",
  "error BelowQuorum(uint256 signedStake, uint256 totalStake)",
  "error InvalidCertificate()",
  "error BadCommitteeEncoding()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
]);

/**
 * Why a qualification was not recorded. Each leads to a different action, so they are never one
 * error:
 *
 * - `nullifier-used`: another wallet already holds this credential for this tender. A legitimate
 *   outcome and the point of the nullifier. Tell the bidder; nothing to fix.
 * - `registry-behind`: Arc's committee registry has no committee for the current period (or the
 *   certificate is out of its window). Operational and not the supplier's fault: someone must run
 *   `update-committee.mjs`. It must never read as a bad proof.
 * - `below-quorum`: the certificate does not carry two thirds of stake. Refused off chain before
 *   any gas is spent, and by the registry if it ever got that far.
 * - `already-qualified`: same nullifier, same bidder, still unexpired. Nothing is sent.
 */
export type Refusal =
  | { status: "nullifier-used"; claimedBy: Hex; nullifier: Hex }
  | { status: "registry-behind"; detail: string }
  | { status: "below-quorum"; detail: string }
  | { status: "already-qualified"; nullifier: Hex; expiresAt: bigint };

export type Recorded = {
  status: "recorded";
  tx: Hex;
  nullifier: Hex;
  blockHash: Hex;
  epoch: bigint;
  signedStakeBps: number;
  isQualified: boolean;
  qualification: { nullifier: Hex; checkedAtEpoch: bigint; expiresAt: bigint; present: boolean };
};

export type QualifyResult = (Recorded | Refusal) & {
  /** Echoed so a synthetic record can never be mistaken for a real one downstream. */
  synthetic: boolean;
};

export type QualifyInput = {
  /**
   * The credential identifier a presentation verification returned. A subject, never a nullifier:
   * a caller that could pick the nullifier could dodge the one-principal rule with a fresh one.
   */
  subject: string;
  bidder: Hex;
  tenderId: bigint | number;
  /**
   * True when the subject was made up rather than produced by verifying a Web3 ID presentation.
   * Such a record proves the plumbing and the on-chain certificate check, and nothing about who
   * anyone is. Required to be stated, so that omitting it cannot pass for "verified".
   */
  synthetic: boolean;
};

export type FinalityProofLike = {
  blockHash: Hex;
  round: bigint;
  epoch: bigint;
  members: Hex;
  signerBits: Hex;
  signature: Hex;
  signedStakeBps: number;
};

export type QualifierDeps = {
  /** Fetched by the agent itself: the quorum and freshness claim is the agent's, not the caller's. */
  fetchProof: () => Promise<FinalityProofLike>;
  /** The secret only this agent holds. At least 32 bytes. */
  nullifierSecret: Uint8Array;
  qualifier: Hex;
  read: (call: { functionName: string; args: readonly unknown[] }) => Promise<unknown>;
  /** Simulate then send, as the CCD_QUALIFIER wallet. Throws the viem error on revert. */
  simulate: (args: readonly unknown[]) => Promise<void>;
  send: (args: readonly unknown[]) => Promise<Hex>;
  /** Skip sending; compute everything else. */
  dryRun?: boolean;
  log?: (message: string) => void;
};

/** Find a decodable custom error anywhere in a viem error chain. */
export function revertName(err: unknown): { name: string; args: readonly unknown[] } | null {
  let cur = err as { data?: unknown; cause?: unknown; walk?: unknown } | undefined;
  const seen = new Set<unknown>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const data = (cur as { data?: unknown }).data;
    const candidate =
      typeof data === "string"
        ? data
        : typeof (data as { data?: unknown })?.data === "string"
          ? (data as { data: string }).data
          : null;
    if (candidate?.startsWith("0x") && candidate.length >= 10) {
      try {
        const d = decodeErrorResult({ abi: QUALIFIER_ABI, data: candidate as Hex });
        return { name: d.errorName, args: (d.args ?? []) as readonly unknown[] };
      } catch {
        // not one of ours; keep walking
      }
    }
    cur = cur.cause as typeof cur;
  }
  return null;
}

/** Turn a revert into a refusal, or null if it is something this module has no name for. */
export function refusalFromRevert(err: unknown, nullifier: Hex): Refusal | null {
  const r = revertName(err);
  if (!r) return null;
  switch (r.name) {
    case "NullifierAlreadyUsed":
      return { status: "nullifier-used", claimedBy: r.args[2] as Hex, nullifier };
    case "StaleRegistry":
    case "CertificateTooOld":
    case "CertificateFromTheFuture":
      return { status: "registry-behind", detail: `${r.name}(${r.args.join(", ")})` };
    case "BelowQuorum":
      return { status: "below-quorum", detail: `${r.name}(${r.args.join(", ")})` };
    default:
      return null;
  }
}

export async function qualify(input: QualifyInput, deps: QualifierDeps): Promise<QualifyResult> {
  const log = deps.log ?? (() => {});
  const { synthetic } = input;
  const tenderId = BigInt(input.tenderId);
  const tag = synthetic
    ? "SYNTHETIC SUBJECT: proves plumbing only, not identity"
    : "verified subject";
  const done = <T extends Recorded | Refusal>(r: T): T & { synthetic: boolean } => ({
    ...r,
    synthetic,
  });

  // The agent derives the nullifier from a secret it alone holds; the caller never supplies one.
  const nullifier = await deriveNullifier({
    subject: input.subject,
    tenderId: tenderId.toString(),
    secret: deps.nullifierSecret,
  });
  log(`${tag}; nullifier ${nullifier}`);

  // Already qualified with the same nullifier and unexpired: nothing to do, so send nothing.
  const existing = (await deps.read({
    functionName: "qualificationOf",
    args: [input.bidder, tenderId],
  })) as Recorded["qualification"];
  const stillValid = await deps.read({
    functionName: "isQualified",
    args: [input.bidder, tenderId],
  });
  if (existing.present && stillValid && existing.nullifier === nullifier) {
    return done({
      status: "already-qualified",
      nullifier,
      expiresAt: existing.expiresAt,
    });
  }

  let proof: FinalityProofLike;
  try {
    proof = await deps.fetchProof();
  } catch (e) {
    // fetchFinalityProof refuses a certificate below 6667 bps rather than returning it.
    const message = e instanceof Error ? e.message : String(e);
    if (/quorum|bps|signed/i.test(message)) {
      return done({ status: "below-quorum", detail: message });
    }
    throw e;
  }

  const args = [
    input.bidder,
    tenderId,
    nullifier,
    proof.blockHash,
    proof.round,
    proof.epoch,
    proof.members,
    proof.signerBits,
    proof.signature,
  ] as const;

  // Simulate first: a refusal then costs no gas and no nonce, and is read from the revert data
  // rather than guessed from a failed receipt.
  try {
    await deps.simulate(args);
    if (deps.dryRun) {
      throw new DryRun();
    }
    const tx = await deps.send(args);
    const [isQualified, qualification] = await Promise.all([
      deps.read({ functionName: "isQualified", args: [input.bidder, tenderId] }),
      deps.read({ functionName: "qualificationOf", args: [input.bidder, tenderId] }),
    ]);
    return done({
      status: "recorded",
      tx,
      nullifier,
      blockHash: proof.blockHash,
      epoch: proof.epoch,
      signedStakeBps: proof.signedStakeBps,
      isQualified: isQualified as boolean,
      qualification: qualification as Recorded["qualification"],
    });
  } catch (e) {
    if (e instanceof DryRun) throw e;
    const refusal = refusalFromRevert(e, nullifier);
    if (refusal) return done(refusal);
    throw e;
  }
}

/** Thrown by a dry run once simulation has passed, so callers can say "would have sent". */
export class DryRun extends Error {
  constructor() {
    super("dry run: simulation passed, nothing sent");
  }
}
