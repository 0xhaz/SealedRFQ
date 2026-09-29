/**
 * What each milestone is worth, and what is held back from it.
 *
 * A buyer asked to accept a delivery is being asked to release money, so the figure should be in
 * front of them rather than derivable from a percentage and a total. Retention makes it worse than
 * arithmetic: every milestone pays less than its share, and the difference only arrives at final
 * acceptance, which is exactly the sort of gap people assume is a bug.
 *
 * Computed from the award price and the splits fixed when the RFQ opened, so the numbers here are
 * the same ones the contract will move.
 */
export type MilestoneLine = {
  index: number;
  /** Share of the award, in basis points. */
  bps: number;
  /** The milestone's full value. */
  gross: bigint;
  /** Held back from this payment until final acceptance. */
  retained: bigint;
  /**
   * The platform's cut of this milestone.
   *
   * Charged on `gross - retained`, because that is what the escrow job is funded with and the fee
   * is taken inside the job's completion. Zero unless a fee is configured, which it is not on this
   * deployment.
   */
  fee: bigint;
  /** Reaches the supplier on acceptance of this milestone, after retention and fee. */
  net: bigint;
};

export type Ledger = {
  lines: MilestoneLine[];
  /** Sum of every line's `net` — what is paid out as work is accepted. */
  paidAcrossMilestones: bigint;
  /**
   * Released in one go when the last milestone is accepted, and **not** charged a platform fee:
   * final acceptance credits the supplier directly rather than completing an escrow job, so the
   * fee never sees it.
   */
  retentionHeld: bigint;
  /** The platform's total cut across the engagement. */
  platformFee: bigint;
  /** What the supplier ends up with if every milestone is accepted: payments plus retention. */
  supplierReceives: bigint;
  total: bigint;
};

const BPS = 10_000n;

export function milestoneLedger(
  awardPrice: bigint,
  milestoneBps: readonly number[],
  retentionBps: number,
  /**
   * The platform fee in basis points, as the escrow contract holds it.
   *
   * Defaults to none, which is this deployment. It is a parameter rather than a constant because
   * the figure lives on-chain and can be changed until the admin role is renounced — a display
   * that hardcoded zero would quietly overstate what a supplier receives the day it stopped being
   * zero, which is the worst moment for it to be wrong.
   */
  platformFeeBps = 0,
): Ledger {
  const lines: MilestoneLine[] = milestoneBps.map((bps, index) => {
    const gross = (awardPrice * BigInt(bps)) / BPS;
    const retained = (gross * BigInt(retentionBps)) / BPS;
    // Mirrors the contract: the job is funded with gross - retention, and the fee comes out of
    // that, not out of gross.
    const budget = gross - retained;
    const fee = (budget * BigInt(platformFeeBps)) / BPS;
    return { index, bps, gross, retained, fee, net: budget - fee };
  });

  const retentionHeld = lines.reduce((s, l) => s + l.retained, 0n);
  const paidAcrossMilestones = lines.reduce((s, l) => s + l.net, 0n);

  return {
    lines,
    paidAcrossMilestones,
    retentionHeld,
    platformFee: lines.reduce((s, l) => s + l.fee, 0n),
    supplierReceives: paidAcrossMilestones + retentionHeld,
    // Deliberately the sum of the parts rather than awardPrice: integer division drops remainders,
    // and a total that does not equal what the lines add up to would look like a rounding error in
    // the contract rather than in this display.
    total: lines.reduce((s, l) => s + l.gross, 0n),
  };
}

/** What a milestone's recorded state means for money, in a word a buyer reads rather than an enum. */
export function milestoneMeaning(state: string, automatic?: boolean | null): string {
  switch (state) {
    case "Funded":
      return "awaiting delivery";
    case "Submitted":
      return "delivered — awaiting your decision";
    case "Released":
    case "Accepted":
      return automatic ? "paid automatically, you did not respond" : "accepted and paid";
    case "Rejected":
      return "rejected with a reason";
    default:
      return state.toLowerCase();
  }
}

/**
 * The most milestones the contract will accept, mirrored from `RFQBase.MAX_MILESTONES`.
 *
 * Checked here as well as there because a tenth-and-first milestone is not a revert anyone can
 * read: `InvalidMilestones` arrives after the wallet has been opened and the gas paid.
 */
export const MAX_MILESTONES = 10;

export type MilestoneCheck = {
  /** Basis points per milestone, in order. Empty when nothing parses. */
  bps: number[];
  /** Their sum in basis points. 10,000 is a complete split. */
  totalBps: number;
  ok: boolean;
  /** Why it is not acceptable, phrased for the person typing. Null when it is. */
  problem: string | null;
};

/**
 * Parse and check a milestone split, for the form and its submit path both.
 *
 * One function deliberately. The form used to check the split again at submit time in its own
 * inline arithmetic, which is how a field shows no complaint and then throws on the last click —
 * the two only agree for as long as somebody keeps them in step.
 */
export function checkMilestones(input: string): MilestoneCheck {
  const parts = input
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const bps = parts.map((m) => Math.round(Number(m) * 100));
  const totalBps = bps.reduce((a, b) => a + b, 0);

  const problem =
    parts.length === 0
      ? "Enter at least one milestone."
      : bps.some((n) => !Number.isFinite(n))
        ? "Every milestone must be a number."
        : bps.some((n) => n <= 0)
          ? "Every milestone must be above zero — a milestone worth nothing still has to be delivered and accepted."
          : parts.length > MAX_MILESTONES
            ? `At most ${MAX_MILESTONES} milestones; this has ${parts.length}. The contract refuses more.`
            : totalBps !== 10_000
              ? `These add up to ${totalBps / 100}%, not 100%.`
              : null;

  return { bps, totalBps, ok: problem === null, problem };
}

/**
 * What an abandoned engagement actually pays out, mirroring `SealedRFQAdapter._abandon`.
 *
 * The whole escrowed pot is *not* the buyer's. Damages are capped at what re-procuring would have
 * cost — the next-cheapest revealed bid less the award — and whatever the supplier staked above
 * that comes back to them. §6c's position in one line: a security covers a loss, it is not
 * confiscated because one occurred.
 *
 * Computed here rather than quoted as `pot` because the difference is the supplier's money, and a
 * warning that tells them they lose a stake they are going to get back is worse than saying
 * nothing.
 */
export function abandonSplit(e: {
  pot: bigint;
  performanceStake: bigint;
  retentionHeld: bigint;
  currentRetention: bigint;
  excessCost: bigint;
}): { toBuyer: bigint; toSupplier: bigint; damages: bigint; atRisk: bigint } {
  // Retention is withheld when a milestone opens, not when it is accepted, so the running total
  // includes the milestone nobody delivered. Only the part held back from accepted work is the
  // supplier's to have returned.
  const earnedRetention = e.retentionHeld - e.currentRetention;
  const atRisk = e.performanceStake + earnedRetention;
  // Zero excess cost means the winner was not the cheapest bid, so there is no runner-up to
  // measure against and the whole stake answers for it.
  const damages = e.excessCost === 0n ? atRisk : atRisk < e.excessCost ? atRisk : e.excessCost;
  return { toBuyer: e.pot - (atRisk - damages), toSupplier: atRisk - damages, damages, atRisk };
}
