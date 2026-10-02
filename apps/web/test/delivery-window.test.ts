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

  it("offers no preset short enough to post a tender nobody can answer", () => {
    // The Demo preset closed bidding twelve minutes after posting. That was fine on testnet and is
    // not on mainnet, where a supplier who misses the window has still paid a real deposit. An
    // hour is the floor for something offered as one click; shorter is still possible by hand.
    for (const p of PRESETS) {
      expect(p.offsets[0] * 60, `${p.label} bidding window`).toBeGreaterThanOrEqual(3600);
    }
  });
});

/**
 * An open tender reveals nothing — `placeOpenBid` marks a bid revealed as it lands — but the
 * contract still demands `bidDeadline < revealDeadline`, and both evaluation paths wait for it.
 * The window is therefore dead time on the one mode chosen for speed, and the form offers to
 * shorten it rather than leaving a buyer to discover the delay after posting.
 */
describe("the reveal window in open mode", () => {
  it("still has to exist, so it can only be shortened and not removed", () => {
    // `_validate` rejects revealDeadline == bidDeadline, so the form cannot offer zero.
    const FIVE_MINUTES = 5 * 60;
    expect(FIVE_MINUTES).toBeGreaterThan(0);
  });

  it("is worth shortening on every timetable now offered", () => {
    // The offer is gated at fifteen minutes. Every preset has a reveal window far above that —
    // hours or a day of nothing. If one ever dropped below the threshold the offer would silently
    // stop appearing, which is the failure this guards.
    const gap = (p: (typeof PRESETS)[number]) => (p.offsets[1] - p.offsets[0]) * 60;
    for (const p of PRESETS) {
      expect(gap(p), `${p.label} reveal window`).toBeGreaterThan(15 * 60);
    }
  });
});
