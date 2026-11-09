import { z } from "zod";
import { hashCanonical } from "./memo.js";

/**
 * The frozen scoring rubric, `sealedrfq.rubric.v2`.
 *
 * A rubric is published and hashed before bidding opens, and the hash is what the contract checks
 * at award. That only means something if two people scoring the same bids against the same rubric
 * get the same answer, so scoring here is arithmetic with no floating point anywhere.
 *
 * Floats are the obvious way to write this and the reason it would not be reproducible: 0.1 + 0.2
 * differs from 0.3, summation order changes results, and a reader recomputing a score in another
 * language would get a number close to ours and not equal to it. "Close" fails a hash comparison
 * exactly as badly as "wrong". Every intermediate value below is an integer in basis points.
 */
export const RUBRIC_SCHEMA = "sealedrfq.rubric.v2" as const;

/** Which way is better. Price and delivery are lower-is-better; a track record is higher-is-better. */
export const Direction = z.enum(["lower_is_better", "higher_is_better"]);
export type Direction = z.infer<typeof Direction>;

export const Criterion = z.object({
  /** Stable key. Renaming one changes the rubric hash, which is the point. */
  id: z.string().min(1).max(64),
  label: z.string().min(1),
  /** Basis points. All criteria must total exactly 10000, so nothing is silently unweighted. */
  weightBps: z.number().int().min(0).max(10_000),
  direction: Direction,
});
export type Criterion = z.infer<typeof Criterion>;

export const Rubric = z.object({
  schema: z.literal(RUBRIC_SCHEMA),
  /** Bumped when the meaning of a field changes, never reused. */
  version: z.number().int().positive(),
  criteria: z.array(Criterion).min(1),
});
export type Rubric = z.infer<typeof Rubric>;

export class RubricError extends Error {}

/** Parse and check a rubric, refusing the ones that would score unevenly without saying so. */
export function parseRubric(value: unknown): Rubric {
  const rubric = Rubric.parse(value);
  const total = rubric.criteria.reduce((n, c) => n + c.weightBps, 0);
  if (total !== 10_000) {
    throw new RubricError(
      `rubric weights total ${total} basis points, not 10000. A rubric that does not add up scores every bid against a different denominator.`,
    );
  }
  const ids = rubric.criteria.map((c) => c.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new RubricError(`criterion "${dupe}" appears more than once`);
  return rubric;
}

export const hashRubric = (rubric: Rubric) => hashCanonical(parseRubric(rubric));

/**
 * A citation. Every score points at what it was read from, so a supplier can follow a number back
 * to the sentence that produced it rather than being told the model considered their submission.
 */
export const Evidence = z.object({
  criterionId: z.string(),
  /** Where the value came from: a bid field, a document, an RFI response. */
  source: z.enum(["bid", "document", "response", "chain"]),
  /** Identifier within that source, such as a document id or the field name on a bid. */
  ref: z.string().min(1),
  /** The raw value used, as text, so the arithmetic can be repeated by hand. */
  value: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

export type Candidate = {
  bidder: string;
  /** Integer measurements keyed by criterion id. Units are the criterion's own. */
  values: Record<string, bigint>;
  evidence?: Evidence[];
};

export type ScoredCandidate = {
  bidder: string;
  /** Per criterion, 0 to 10000 basis points. */
  criteria: Record<string, number>;
  totalBps: number;
  evidence: Evidence[];
};

/**
 * Score every candidate against the rubric, as a ratio to the best value seen for each criterion.
 *
 * Relative rather than absolute, because no buyer can say in advance what a good price is for work
 * they have not been quoted. The best bid on a criterion takes 10000, and the rest are measured
 * against it: at twice the best price a bid scores 5000, and the gap between bids matters more than
 * the weight alone.
 *
 * Returns candidates sorted best first, with ties broken by a published cascade rather than by
 * whatever order they arrived in, so the result is one a loser can recompute.
 */
export function scoreAll(rubricInput: Rubric, candidates: Candidate[]): ScoredCandidate[] {
  const rubric = parseRubric(rubricInput);
  if (candidates.length === 0) return [];

  for (const c of candidates) {
    for (const crit of rubric.criteria) {
      if (c.values[crit.id] === undefined) {
        throw new RubricError(`bid from ${c.bidder} has no value for criterion "${crit.id}"`);
      }
    }
  }

  const scored = candidates.map((c) => {
    const criteria: Record<string, number> = {};
    let totalBps = 0;
    for (const crit of rubric.criteria) {
      const bps = ratioBps(crit, candidates, c.values[crit.id] as bigint);
      criteria[crit.id] = bps;
      // Weighted in integers, divided once at the end of each term: dividing earlier would discard
      // the remainder and the totals would stop adding up.
      totalBps += Math.floor((bps * crit.weightBps) / 10_000);
    }
    return { bidder: c.bidder, criteria, totalBps, evidence: c.evidence ?? [] };
  });

  return scored.sort(compare);
}

/**
 * One criterion, as basis points against the best value in the field.
 *
 * The zero cases are the interesting ones. If every bid is identical the ratio is meaningless, so
 * they all take full marks and the criterion simply does not separate them. If the best value is
 * zero on a lower-is-better criterion, dividing by it would be a crash, so an exact match takes
 * full marks and anything else takes none.
 */
function ratioBps(crit: Criterion, all: Candidate[], mine: bigint): number {
  const values = all.map((c) => c.values[crit.id] as bigint);
  if (crit.direction === "lower_is_better") {
    const best = values.reduce((a, b) => (b < a ? b : a));
    if (best === 0n) return mine === 0n ? 10_000 : 0;
    return clamp(Number((best * 10_000n) / mine));
  }
  const best = values.reduce((a, b) => (b > a ? b : a));
  if (best === 0n) return 10_000; // nobody scored on it; it separates nobody
  return clamp(Number((mine * 10_000n) / best));
}

const clamp = (n: number) => Math.max(0, Math.min(10_000, n));

/**
 * The published tie-break: total, then each criterion in rubric order, then the bidder id.
 *
 * The last step is arbitrary and that is deliberate. Something has to decide, and a rule anyone can
 * recompute beats one that depends on which bid the indexer happened to read first.
 */
function compare(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.totalBps !== b.totalBps) return b.totalBps - a.totalBps;
  for (const id of Object.keys(a.criteria)) {
    const d = (b.criteria[id] ?? 0) - (a.criteria[id] ?? 0);
    if (d !== 0) return d;
  }
  return a.bidder.toLowerCase() < b.bidder.toLowerCase() ? -1 : 1;
}
