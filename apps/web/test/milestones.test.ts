import { describe, expect, it } from "vitest";
import { milestoneLedger, milestoneMeaning } from "../lib/milestones.js";

const AWARD = 2_800_000n; // 2.80 USDC
const SPLIT = [3000, 3000, 4000];

describe("milestoneLedger", () => {
  it("splits the award by the shares fixed when the RFQ opened", () => {
    const l = milestoneLedger(AWARD, SPLIT, 0);
    expect(l.lines.map((x) => x.gross)).toEqual([840_000n, 840_000n, 1_120_000n]);
    expect(l.total).toBe(AWARD);
  });

  it("holds retention back from every milestone, not from the last", () => {
    // The thing people assume is a bug: each payment is short, and the shortfall only arrives at
    // final acceptance.
    const l = milestoneLedger(AWARD, SPLIT, 1000); // 10%
    expect(l.lines.map((x) => x.retained)).toEqual([84_000n, 84_000n, 112_000n]);
    expect(l.lines.map((x) => x.net)).toEqual([756_000n, 756_000n, 1_008_000n]);
  });

  it("accounts for every unit: what is paid plus what is retained is the whole award", () => {
    for (const retention of [0, 500, 1000, 2500, 5000]) {
      const l = milestoneLedger(AWARD, SPLIT, retention);
      expect(l.paidAcrossMilestones + l.retentionHeld, `retention ${retention}`).toBe(l.total);
    }
  });

  it("reports the total as the sum of the lines, so rounding never looks like a missing cent", () => {
    // 3 equal shares of an amount that does not divide by three.
    const odd = 1_000_001n;
    const l = milestoneLedger(odd, [3333, 3333, 3334], 0);
    expect(l.total).toBe(l.lines.reduce((s, x) => s + x.gross, 0n));
    expect(l.total).toBeLessThanOrEqual(odd);
  });

  it("handles a single milestone and a zero award without dividing by nothing", () => {
    expect(milestoneLedger(AWARD, [10_000], 1000).lines).toHaveLength(1);
    expect(milestoneLedger(0n, SPLIT, 1000).total).toBe(0n);
  });
});

describe("milestoneMeaning", () => {
  it("names who acted when a payment was automatic", () => {
    // "Released" alone hides the most important fact: nobody looked at the work.
    expect(milestoneMeaning("Released", true)).toMatch(/did not respond/i);
    expect(milestoneMeaning("Released", false)).toMatch(/accepted and paid/i);
  });

  it("says what each state means for money", () => {
    expect(milestoneMeaning("Funded")).toMatch(/awaiting delivery/i);
    expect(milestoneMeaning("Submitted")).toMatch(/awaiting your decision/i);
    expect(milestoneMeaning("Rejected")).toMatch(/rejected/i);
  });

  it("falls back readably for a state it does not know", () => {
    expect(milestoneMeaning("Disputed")).toBe("disputed");
  });

  it("takes the platform fee from the post-retention amount, as the contract does", () => {
    // The escrow job is funded with gross - retention, and the fee is charged inside the job's
    // completion — so a fee on gross would overstate it and understate what the supplier gets.
    const l = milestoneLedger(AWARD, SPLIT, 1000, 250); // 10% retention, 2.5% fee
    for (const line of l.lines) {
      const budget = line.gross - line.retained;
      expect(line.fee).toBe((budget * 250n) / 10_000n);
      expect(line.net).toBe(budget - line.fee);
    }
  });

  it("never charges a fee on retention, which is credited directly", () => {
    // Final acceptance pays retention and the stake to the supplier without completing a job, so
    // the fee never sees it. Getting this wrong would under-report the supplier's total.
    const withFee = milestoneLedger(AWARD, SPLIT, 1000, 250);
    const noFee = milestoneLedger(AWARD, SPLIT, 1000, 0);
    expect(withFee.retentionHeld).toBe(noFee.retentionHeld);
    expect(withFee.platformFee).toBe(noFee.paidAcrossMilestones - withFee.paidAcrossMilestones);
  });

  it("reports what the supplier actually ends up with", () => {
    const l = milestoneLedger(AWARD, SPLIT, 1000, 250);
    expect(l.supplierReceives).toBe(l.paidAcrossMilestones + l.retentionHeld);
    // The quote minus the fee, give or take integer division across the lines.
    expect(l.total - l.supplierReceives).toBe(l.platformFee);
  });

  it("changes nothing when no fee is set, which is this deployment", () => {
    const l = milestoneLedger(AWARD, SPLIT, 1000);
    expect(l.platformFee).toBe(0n);
    expect(l.supplierReceives).toBe(l.total);
  });
});
