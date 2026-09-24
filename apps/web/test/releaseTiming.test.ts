import { describe, expect, it } from "vitest";

/**
 * The release rule, duplicated from `SealedRFQAdapter._releasesAt`.
 *
 * The interface shows a countdown built from this and the contract decides by its own copy, so the
 * two must agree. A drift here is not cosmetic: it either promises a supplier money that is not due
 * yet, or tells a buyer their window has closed while they can still reject.
 */
const releasesAt = (e: {
  submittedAt: number;
  receivedAt: number;
  transitWindow: number;
  acceptanceWindow: number;
}) =>
  (e.receivedAt > 0 ? e.receivedAt : e.submittedAt + e.transitWindow) + e.acceptanceWindow;

const DAY = 86_400;
const base = { submittedAt: 1_000_000, receivedAt: 0, transitWindow: 10 * DAY, acceptanceWindow: 2 * DAY };

describe("release timing", () => {
  it("waits out the transit allowance when the buyer says nothing", () => {
    expect(releasesAt(base)).toBe(1_000_000 + 10 * DAY + 2 * DAY);
  });

  it("runs from arrival once receipt is confirmed", () => {
    const received = base.submittedAt + 3 * DAY;
    expect(releasesAt({ ...base, receivedAt: received })).toBe(received + 2 * DAY);
  });

  it("confirming receipt never delays payment", () => {
    // The incentive has to point this way or no buyer would ever confirm. Checked across the whole
    // transit window, including arrival on the very last permitted day.
    for (let d = 0; d <= 10; d++) {
      const received = base.submittedAt + d * DAY;
      expect(releasesAt({ ...base, receivedAt: received })).toBeLessThanOrEqual(releasesAt(base));
    }
  });

  it("is identical to the old rule when nothing ships", () => {
    // transitWindow is zero for a deliverable that is a file, so a software tender is unaffected.
    const file = { ...base, transitWindow: 0 };
    expect(releasesAt(file)).toBe(file.submittedAt + file.acceptanceWindow);
  });

  it("gives the buyer their whole inspection window however late the goods arrive", () => {
    const late = base.submittedAt + 30 * DAY;
    expect(releasesAt({ ...base, receivedAt: late })).toBe(late + 2 * DAY);
  });
});
