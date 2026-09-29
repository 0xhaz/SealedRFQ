import { describe, expect, it } from "vitest";
import { abandonSplit } from "../lib/milestones.js";

/**
 * Mirrors `SealedRFQAdapter._abandon`. The figure this produces appears in a warning a supplier
 * reads while deciding whether they have already lost everything — so it being optimistic for the
 * buyer is not a cosmetic error, it is telling one party their money is gone when it is not.
 */
describe("abandonSplit", () => {
  const base = {
    pot: 2_444_000n,
    performanceStake: 250_000n,
    retentionHeld: 168_000n,
    currentRetention: 84_000n,
    excessCost: 150_000n, // 2.95 runner-up less the 2.80 award
  };

  it("caps damages at what re-procuring would have cost", () => {
    const r = abandonSplit(base);
    // at risk: 0.25 stake + 0.084 retention earned on accepted work = 0.334
    expect(r.atRisk).toBe(334_000n);
    expect(r.damages).toBe(150_000n);
    // the surplus above the loss is the supplier's
    expect(r.toSupplier).toBe(184_000n);
    expect(r.toBuyer).toBe(base.pot - 184_000n);
  });

  it("forfeits the whole stake when there is no runner-up to measure against", () => {
    // excessCost is zero when the winner was not the cheapest bid, so nothing bounds the loss.
    const r = abandonSplit({ ...base, excessCost: 0n });
    expect(r.toSupplier).toBe(0n);
    expect(r.toBuyer).toBe(base.pot);
  });

  it("never returns more than was ever at risk", () => {
    // A runner-up far above the award must not hand the supplier a windfall.
    const r = abandonSplit({ ...base, excessCost: 9_000_000n });
    expect(r.damages).toBe(r.atRisk);
    expect(r.toSupplier).toBe(0n);
  });

  it("excludes retention held against the milestone that was never delivered", () => {
    // That money belongs with the milestone it was taken from, and that milestone goes to the buyer.
    const r = abandonSplit({ ...base, currentRetention: base.retentionHeld });
    expect(r.atRisk).toBe(base.performanceStake);
  });
});
