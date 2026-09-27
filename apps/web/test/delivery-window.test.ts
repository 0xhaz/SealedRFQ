import { describe, expect, it } from "vitest";
import { PRESETS } from "../lib/deadlines.js";
import { DURATION_UNITS, MIN_DELIVERY_SECONDS, toSeconds } from "../lib/duration.js";

/**
 * Delivery was once a whole number of days on a bid while the buyer's window was seconds, so the
 * smallest bid anyone could place was 86,400 seconds and no bid could satisfy a window shorter
 * than a day. Such a tender took deposits, revealed normally, then refused every award — it looked
 * like a tender that merely attracted no acceptable offer. Both sides are seconds now, and these
 * assert the property that made the mismatch possible is gone.
 */
describe("a bid can express any window a buyer can set", () => {
  it("offers the same units to both sides", () => {
    // The buyer's window selector and the supplier's delivery selector read the same list; if they
    // ever diverge again, some window becomes unquotable and the symptom is silent.
    expect(DURATION_UNITS.map((u) => u.value)).toEqual([
      "minutes",
      "hours",
      "days",
      "weeks",
      "months",
    ]);
  });

  it("allows a sub-day window, because a bid can now answer one", () => {
    expect(MIN_DELIVERY_SECONDS).toBeLessThan(86_400);
    expect(toSeconds("90", "minutes")).toBeGreaterThanOrEqual(MIN_DELIVERY_SECONDS);
  });

  it("gives every preset a window a bid could meet", () => {
    for (const p of PRESETS) {
      const secs = toSeconds(p.windows.delivery[0], p.windows.delivery[1]);
      expect(secs, `${p.label} delivery window`).toBeGreaterThanOrEqual(MIN_DELIVERY_SECONDS);
    }
  });

  it("keeps the Demo preset fast enough to walk in one sitting", () => {
    const demo = PRESETS.find((p) => p.label === "Demo");
    expect(toSeconds(demo!.windows.delivery[0], demo!.windows.delivery[1])).toBeLessThan(3600);
    expect(toSeconds(demo!.windows.accept[0], demo!.windows.accept[1])).toBeLessThan(3600);
  });
});
