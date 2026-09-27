import { describe, expect, it } from "vitest";
import { checkRequirements } from "../src/requirements.js";

const DAY = 86_400;
const bid = { deliverySeconds: 21 * DAY, completed: 0 };

describe("checkRequirements", () => {
  it("passes a bid that meets the checkable bar", () => {
    const r = checkRequirements(
      { deliverySeconds: 14 * DAY, completed: 3 },
      {
        maxDeliveryDays: 30,
        minCompletedEngagements: 2,
      },
    );
    expect(r.failed).toEqual([]);
  });

  it("fails a bid slower than the required delivery, quoting both numbers", () => {
    const r = checkRequirements(bid, { maxDeliveryDays: 14 });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toContain("21 days");
    expect(r.failed[0]).toContain("14 days");
  });

  it("fails a supplier with too little history here", () => {
    expect(checkRequirements(bid, { minCompletedEngagements: 1 }).failed).toHaveLength(1);
    expect(
      checkRequirements({ ...bid, completed: 1 }, { minCompletedEngagements: 1 }).failed,
    ).toHaveLength(0);
  });

  it("never marks a stated requirement as passed", () => {
    // The point of the split: a supplier ticking a box is not proof, so this must surface for a
    // person rather than quietly counting as satisfied.
    const r = checkRequirements(bid, { attestations: ["ISO 9001", "24-month warranty"] });
    expect(r.failed).toEqual([]);
    expect(r.unverified).toHaveLength(2);
    expect(r.unverified[0]).toMatch(/not provable/i);
  });

  it("is inert when the buyer set no requirements", () => {
    for (const none of [undefined, null, {}, "not an object", 42]) {
      expect(checkRequirements(bid, none)).toEqual({ failed: [], unverified: [] });
    }
  });

  it("ignores malformed requirements rather than failing every bid", () => {
    // A buyer publishing nonsense must not silently exclude every supplier.
    const r = checkRequirements(bid, { maxDeliveryDays: -5, minCompletedEngagements: "two" });
    expect(r.failed).toEqual([]);
  });

  it("is deterministic — the property that lets a loser re-check it", () => {
    const req = { maxDeliveryDays: 14, attestations: ["ISO 9001"] };
    expect(checkRequirements(bid, req)).toEqual(checkRequirements(bid, req));
  });
});

describe("supplier region", () => {
  it("is reported as declared, never as satisfied", () => {
    // An address has no country. Presenting this as checked would be the exact dishonesty the
    // unverified list exists to prevent.
    const r = checkRequirements(bid, { supplierRegion: "South East Asia" });
    expect(r.failed).toEqual([]);
    expect(r.unverified).toHaveLength(1);
    expect(r.unverified[0]).toContain("South East Asia");
    expect(r.unverified[0]).toMatch(/declared only/i);
  });

  it("sits alongside other stated requirements rather than replacing them", () => {
    const r = checkRequirements(bid, {
      supplierRegion: "EU",
      attestations: ["ISO 9001"],
    });
    expect(r.unverified).toHaveLength(2);
  });

  it("is absent when the buyer did not restrict it", () => {
    expect(checkRequirements(bid, { attestations: ["ISO 9001"] }).unverified).toHaveLength(1);
  });
});
