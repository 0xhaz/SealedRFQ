import canonicalize from "canonicalize";
import { type Hex, sha256, stringToBytes } from "viem";
import { z } from "zod";

/**
 * Canonical decision memo `sealedrfq.decision.v1`.
 *
 * Every AI decision (bid evaluation, award recommendation, rejection, milestone verdict) is
 * serialised with RFC 8785 JCS, hashed with SHA-256 and anchored on-chain (AttestationLog, and the
 * ERC-8183 `complete/reject(reason)`). Verification always re-hashes the stored memo and compares
 * it with the on-chain anchor. It never compares two stored strings.
 */

export const MEMO_SCHEMA = "sealedrfq.decision.v1" as const;

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed address");
/** 6-decimal USDC units as a decimal string (JSON has no bigint). */
const usdcUnits = z.string().regex(/^\d+$/, "expected integer USDC units as a string");

export const DecisionKind = z.enum([
  "BID_EVALUATION",
  "AWARD_RECOMMENDATION",
  "AWARD_REJECTION",
  "MILESTONE_ACCEPT",
  "MILESTONE_REJECT",
  "QUALIFICATION",
]);
export type DecisionKind = z.infer<typeof DecisionKind>;

export const BidScore = z.object({
  bidder: address,
  price: usdcUnits,
  /** Seconds — the unit the bid is stored in on-chain, so the memo and the chain agree. */
  deliverySeconds: z.number().int().nonnegative(),
  /** Per-criterion scores, 0–100, keyed by rubric criterion id. */
  criteria: z.record(z.string(), z.number().min(0).max(100)),
  /** Weighted total, 0–100 (two-decimal precision as an integer of basis points: 0–10000). */
  totalBps: z.number().int().min(0).max(10_000),
  redFlags: z.array(z.string()),
  /**
   * Requirements the buyer stated that a bid cannot prove — a certification, a warranty length.
   * Optional so memos anchored before this existed still re-hash to their recorded value; absent
   * is not the same as "nothing left to check by hand".
   */
  unverified: z.array(z.string()).optional(),
});
export type BidScore = z.infer<typeof BidScore>;

export const DecisionMemo = z.object({
  schema: z.literal(MEMO_SCHEMA),
  rfqId: z.string().regex(/^\d+$/),
  kind: DecisionKind,
  /** Signing role key that produced the decision (EVALUATOR, AWARDER, VERIFIER, ATTESTOR). */
  actor: address,
  /** Model id, or "deterministic-rubric-v1" for the rubric scorer. */
  model: z.string().min(1),
  /** Unix seconds. */
  ts: z.number().int().positive(),
  /** Hash of the inputs the decision was made on (rubric + revealed bids + deliverable, etc.). */
  inputsHash: hex32,
  /** Must equal the `rubricHash` stored on the RFQ at creation. */
  rubricHash: hex32,
  scores: z.array(BidScore),
  rationale: z.string().min(1),
  decision: z.object({
    outcome: z.enum(["RECOMMEND", "REJECT", "ACCEPT", "NO_AWARD"]),
    /** Recommended winner, if any. */
    bidder: address.optional(),
    amount: usdcUnits.optional(),
  }),
});
export type DecisionMemo = z.infer<typeof DecisionMemo>;

/** RFC 8785 canonical JSON of any JSON-safe value. */
export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("Value is not JSON-serialisable");
  return out;
}

/** sha256 over the canonical JSON: the value anchored on-chain as bytes32. */
export function hashCanonical(value: unknown): Hex {
  return sha256(stringToBytes(canonicalJson(value)));
}

/** Validate and hash a memo. Throws a ZodError on schema violations. */
export function hashMemo(memo: DecisionMemo): Hex {
  return hashCanonical(DecisionMemo.parse(memo));
}

/** Re-hash `memo` and compare with the on-chain anchor. */
export function verifyMemo(memo: unknown, onChainHash: Hex): { ok: boolean; computed: Hex } {
  const computed = hashCanonical(DecisionMemo.parse(memo));
  return { ok: computed.toLowerCase() === onChainHash.toLowerCase(), computed };
}
