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
