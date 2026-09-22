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
  /** Paid on acceptance of this milestone. */
  net: bigint;
};

export type Ledger = {
  lines: MilestoneLine[];
  /** Sum of every line's `net` — what is paid out as work is accepted. */
  paidAcrossMilestones: bigint;
  /** Released in one go when the last milestone is accepted. */
  retentionHeld: bigint;
  total: bigint;
};

const BPS = 10_000n;

export function milestoneLedger(
  awardPrice: bigint,
  milestoneBps: readonly number[],
  retentionBps: number,
): Ledger {
  const lines: MilestoneLine[] = milestoneBps.map((bps, index) => {
    const gross = (awardPrice * BigInt(bps)) / BPS;
    const retained = (gross * BigInt(retentionBps)) / BPS;
    return { index, bps, gross, retained, net: gross - retained };
  });

  return {
    lines,
    paidAcrossMilestones: lines.reduce((s, l) => s + l.net, 0n),
    retentionHeld: lines.reduce((s, l) => s + l.retained, 0n),
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
