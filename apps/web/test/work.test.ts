import { describe, expect, it } from "vitest";
import { type WorkRow, deriveWork } from "../lib/work.js";

const ME = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const OTHER = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
const ZERO = "0x0000000000000000000000000000000000000000";

const row = (over: Partial<WorkRow> = {}): WorkRow => ({
  id: 1,
  phase: "Bidding",
  inviteOnly: false,
  buyer: OTHER,
  winner: ZERO,
  bidDeadline: 200,
  revealDeadline: 300,
  awardDeadline: 400,
  ...over,
});

describe("deriveWork", () => {
  it("shows nothing when no wallet is connected", () => {
    expect(deriveWork([row({ phase: "Reveal", hasBid: true })], undefined)).toEqual([]);
  });

  it("urges a reveal on a sealed bid, which is the only deadline that costs a deposit", () => {
    const items = deriveWork([row({ phase: "Reveal", hasBid: true, revealed: false })], ME);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("reveal");
    expect(items[0].urgent).toBe(true);
  });

  it("stops urging once the bid is revealed", () => {
    expect(deriveWork([row({ phase: "Reveal", hasBid: true, revealed: true })], ME)).toEqual([]);
  });

  it("does not urge a reveal outside the reveal window", () => {
    // Nagging during bidding would teach people to ignore the panel.
    expect(deriveWork([row({ phase: "Bidding", hasBid: true })], ME)).toEqual([]);
    expect(deriveWork([row({ phase: "Awarded", hasBid: true })], ME)).toEqual([]);
  });

  it("surfaces an invitation only to an invited wallet that has not bid", () => {
    const invited = row({ inviteOnly: true, invited: true });
    expect(deriveWork([invited], ME)[0]?.kind).toBe("invited");
    expect(deriveWork([{ ...invited, hasBid: true }], ME)).toEqual([]);
    expect(deriveWork([{ ...invited, invited: false }], ME)).toEqual([]);
  });

  it("does not treat an open RFQ as an invitation", () => {
    expect(deriveWork([row({ inviteOnly: false, invited: true })], ME)).toEqual([]);
  });

  it("asks only the buyer to award, and only while no winner exists", () => {
    const awaiting = row({ phase: "Award", buyer: ME });
    expect(deriveWork([awaiting], ME)[0]?.kind).toBe("award");
    expect(deriveWork([{ ...awaiting, winner: OTHER }], ME)).toEqual([]);
    expect(deriveWork([awaiting], OTHER)).toEqual([]);
  });

  it("matches the buyer regardless of checksum casing", () => {
    const awaiting = row({ phase: "Award", buyer: ME.toLowerCase() });
    expect(deriveWork([awaiting], ME.toUpperCase().replace("0X", "0x"))).toHaveLength(1);
  });

  it("puts what cannot be undone first, then the soonest deadline", () => {
    const items = deriveWork(
      [
        row({ id: 1, inviteOnly: true, invited: true, bidDeadline: 100 }),
        row({ id: 2, phase: "Reveal", hasBid: true, revealDeadline: 999 }),
      ],
      ME,
    );
    expect(items.map((i) => i.kind)).toEqual(["reveal", "invited"]);
  });
});

const NOW = 1_000_000;
const DAY = 86_400;

const engaged = (over: Record<string, unknown> = {}) =>
  row({
    id: 7,
    phase: "Awarded",
    winner: ME,
    engagement: {
      supplier: ME,
      status: "Active",
      submittedAt: 0,
      deliveryDeadline: NOW + 10 * DAY,
      acceptanceWindow: 3 * DAY,
      currentMilestone: 1,
      milestoneCount: 3,
      ...over,
    },
  });

describe("deriveWork — milestone deadlines", () => {
  it("reminds the supplier to deliver, and names the milestone", () => {
    const items = deriveWork([engaged()], ME, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("deliver");
    // currentMilestone is 0-based on-chain; people count from one.
    expect(items[0].milestone).toBe(2);
    expect(items[0].milestoneCount).toBe(3);
  });

  it("stays quiet about a deadline ten days out, and shouts about one inside a day", () => {
    expect(deriveWork([engaged()], ME, NOW)[0].urgent).toBe(false);
    const soon = engaged({ deliveryDeadline: NOW + 3600 });
    expect(deriveWork([soon], ME, NOW)[0].urgent).toBe(true);
  });

  it("says the window has closed rather than still inviting a delivery", () => {
    // The RFQ 4 failure: the page read "awaiting delivery" long after the contract had stopped
    // accepting one, so the first sign of trouble was a reverted transaction.
    const late = engaged({ deliveryDeadline: NOW - 3600 });
    const items = deriveWork([late], ME, NOW);
    expect(items[0].kind).toBe("lapsed");
    expect(items[0].urgent).toBe(true);
  });

  it("drops the delivery reminder once something has been submitted", () => {
    const submitted = engaged({ submittedAt: NOW - 60 });
    expect(deriveWork([submitted], ME, NOW)).toEqual([]);
  });

  it("asks the buyer to review, but does not call it urgent while there is time", () => {
    const submitted = engaged({ submittedAt: NOW - 60 });
    const asBuyer = { ...submitted, buyer: ME, engagement: { ...submitted.engagement!, supplier: OTHER } };
    const items = deriveWork([asBuyer], ME, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("accept");
    expect(items[0].urgent).toBe(false);
    expect(items[0].deadline).toBe(NOW - 60 + 3 * DAY);
  });

  it("stops asking the buyer once the acceptance window has run out", () => {
    // Past this the supplier can be paid by anyone calling autoRelease, so there is nothing to ask.
    const stale = engaged({ submittedAt: NOW - 4 * DAY });
    const asBuyer = { ...stale, buyer: ME, engagement: { ...stale.engagement!, supplier: OTHER } };
    expect(deriveWork([asBuyer], ME, NOW)).toEqual([]);
  });

  it("says nothing to a wallet that is neither party", () => {
    const other = engaged({ supplier: OTHER });
    expect(deriveWork([other], ME, NOW)).toEqual([]);
  });

  it("ignores an engagement that is no longer active", () => {
    for (const status of ["Completed", "Abandoned", "Disputed"]) {
      expect(deriveWork([engaged({ status })], ME, NOW)).toEqual([]);
    }
  });
});
