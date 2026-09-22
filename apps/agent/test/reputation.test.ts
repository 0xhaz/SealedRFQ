import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "rep-")), "test.db")}`;

const BUYER = "0x3a9a536533fb2e33E0a6F6254B88065F6351C88E";
const S1 = "0xC6FD9B17137945b0399a0e923F45056fE107851D";
const S2 = "0x4592DC5fdE2c2D7BDb5570F343c30aC5baA1dF99";

// biome-ignore lint/suspicious/noExplicitAny: imported after env setup
let rep: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let db: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let schema: any;

beforeAll(async () => {
  ({ db, schema } = await import("../src/db/index.js"));
  const { ReputationService } = await import("../src/modules/reputation/reputation.service.js");
  rep = new ReputationService();
});

const past = Math.floor(Date.now() / 1000) - 3600;

function rfq(id: number, buyer: string, winner?: string) {
  db.insert(schema.rfqs)
    .values({
      id,
      buyer,
      category: "SOFTWARE",
      budget: "3000000",
      depositAmount: "250000",
      buyerStake: "150000",
      rubricHash: "0xr",
      metadataURI: "{}",
      bidDeadline: past,
      revealDeadline: past,
      awardDeadline: past,
      winner: winner ?? null,
      createdTx: "0xtx",
      createdBlock: 1,
    })
    .run();
}

beforeEach(() => {
  for (const t of ["milestones", "engagements", "bids", "rfqs"]) db.delete(schema[t]).run();
});

describe("supplier record", () => {
  it("separates a revealed bid from one abandoned after sealing", () => {
    // One bid per supplier per RFQ: re-committing replaces the hash rather than adding a bid.
    rfq(1, BUYER);
    rfq(2, BUYER);
    db.insert(schema.bids)
      .values([
        { rfqId: 1, bidder: S1, commitHash: "0xa", revealed: true, committedTx: "0x1" },
        { rfqId: 2, bidder: S1, commitHash: "0xb", revealed: false, committedTx: "0x2" },
      ])
      .run();
    const r = rep.record(S1).asSupplier;
    expect(r.bidsPlaced).toBe(2);
    expect(r.bidsRevealed).toBe(1);
    // The forfeited deposit is the whole reason this is worth recording separately.
    expect(r.bidsAbandoned).toBe(1);
  });

  it("counts awards and completed engagements", () => {
    rfq(1, BUYER, S1);
    rfq(2, BUYER, S1);
    db.insert(schema.engagements)
      .values([
        {
          rfqId: 1,
          supplier: S1,
          price: "1",
          milestoneCount: 1,
          status: "Completed",
          startedTx: "0x",
        },
        {
          rfqId: 2,
          supplier: S1,
          price: "1",
          milestoneCount: 1,
          status: "Active",
          startedTx: "0x",
        },
      ])
      .run();
    const r = rep.record(S1).asSupplier;
    expect(r.awards).toBe(2);
    // An award that has not finished is not a delivery.
    expect(r.engagementsCompleted).toBe(1);
  });

  it("matches an address regardless of checksum casing", () => {
    rfq(1, BUYER, S1.toLowerCase());
    expect(rep.record(S1).asSupplier.awards).toBe(1);
    expect(rep.record(S1.toLowerCase()).asSupplier.awards).toBe(1);
  });

  it("does not attribute another supplier's work", () => {
    rfq(1, BUYER, S1);
    db.insert(schema.engagements)
      .values({
        rfqId: 1,
        supplier: S1,
        price: "1",
        milestoneCount: 1,
        status: "Completed",
        startedTx: "0x",
      })
      .run();
    expect(rep.record(S2).asSupplier.engagementsCompleted).toBe(0);
  });
});

describe("buyer record", () => {
  it("distinguishes a buyer who answers from one who lets the clock pay", () => {
    rfq(1, BUYER, S1);
    db.insert(schema.milestones)
      .values([
        {
          rfqId: 1,
          idx: 0,
          jobId: "1",
          jobBudget: "1",
          retention: "0",
          state: "Released",
          automatic: false,
        },
        {
          rfqId: 1,
          idx: 1,
          jobId: "2",
          jobBudget: "1",
          retention: "0",
          state: "Released",
          automatic: true,
        },
        {
          rfqId: 1,
          idx: 2,
          jobId: "3",
          jobBudget: "1",
          retention: "0",
          state: "Released",
          automatic: true,
        },
      ])
      .run();
    const b = rep.record(BUYER).asBuyer;
    // This is the number a supplier actually wants before spending a deposit.
    expect(b.milestonesAcceptedOnTime).toBe(1);
    expect(b.milestonesLeftToAutoRelease).toBe(2);
  });

  it("counts an RFQ that closed with no winner", () => {
    rfq(1, BUYER, S1);
    rfq(2, BUYER);
    const b = rep.record(BUYER).asBuyer;
    expect(b.rfqsPosted).toBe(2);
    expect(b.rfqsAwarded).toBe(1);
    expect(b.rfqsClosedWithoutAward).toBe(1);
  });
});

describe("partners", () => {
  it("lists only suppliers who completed work for this buyer", () => {
    rfq(1, BUYER, S1);
    rfq(2, BUYER, S2);
    db.insert(schema.engagements)
      .values([
        {
          rfqId: 1,
          supplier: S1,
          price: "1",
          milestoneCount: 1,
          status: "Completed",
          startedTx: "0x",
        },
        {
          rfqId: 2,
          supplier: S2,
          price: "1",
          milestoneCount: 1,
          status: "Active",
          startedTx: "0x",
        },
      ])
      .run();
    const p = rep.partners(BUYER);
    // An award that never finished is not a recommendation.
    expect(p.map((x: { supplier: string }) => x.supplier)).toEqual([S1]);
    expect(p[0].completed).toBe(1);
  });

  it("does not leak another buyer's suppliers", () => {
    rfq(1, "0x1111111111111111111111111111111111111111", S1);
    db.insert(schema.engagements)
      .values({
        rfqId: 1,
        supplier: S1,
        price: "1",
        milestoneCount: 1,
        status: "Completed",
        startedTx: "0x",
      })
      .run();
    expect(rep.partners(BUYER)).toEqual([]);
  });
});
