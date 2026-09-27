import { describe, expect, it } from "vitest";
import { PRESETS } from "../lib/deadlines.js";
import { DELIVERY_UNITS, MIN_DELIVERY_SECONDS, toSeconds } from "../lib/duration.js";

/**
 * A bid carries `uint32 deliveryDays`, and `RFQRegistry.award` refuses a bid whose days exceed the
 * RFQ's delivery window. The smallest bid anyone can place is one whole day, so a window below a
 * day cannot be met by *any* bid: the tender takes deposits, reveals normally, and then refuses
 * every award. It looks like a tender that simply attracted no acceptable offer.
 */
describe("delivery window against what a bid can express", () => {
  it("offers only units a whole-day bid can satisfy", () => {
    for (const u of DELIVERY_UNITS) expect(u.seconds).toBeGreaterThanOrEqual(MIN_DELIVERY_SECONDS);
    expect(DELIVERY_UNITS.map((u) => u.value)).not.toContain("minutes");
    expect(DELIVERY_UNITS.map((u) => u.value)).not.toContain("hours");
  });

  it("gives every timetable preset a deliverable window", () => {
    // The Demo preset used to set 15 minutes, which made every demo tender unawardable.
    for (const p of PRESETS) {
      const secs = toSeconds(p.windows.delivery[0], p.windows.delivery[1]);
      expect(secs, `${p.label} delivery window`).toBeGreaterThanOrEqual(MIN_DELIVERY_SECONDS);
    }
  });

  it("leaves the acceptance window free to be short", () => {
    // Acceptance is the buyer's own clock and is stored in seconds, so minutes are legitimate
    // there — a demo run needs to get past it without waiting a day.
    const demo = PRESETS.find((p) => p.label === "Demo");
    expect(toSeconds(demo!.windows.accept[0], demo!.windows.accept[1])).toBeLessThan(3600);
  });
});
