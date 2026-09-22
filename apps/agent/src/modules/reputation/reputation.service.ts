import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";

/**
 * A counterparty's record, counted from what the chain already holds.
 *
 * Deliberately not a score. A single number would be the one thing on this site nobody could
 * recompute — every other claim here can be checked against the chain, and a reputation figure
 * derived by a formula only we know would be exactly the unaccountable judgement the project argues
 * against. These are events that happened, each traceable to a transaction, and a reader is left to
 * weigh them.
 *
 * Both sides are counted. Procurement writes about supplier risk and rarely about buyer risk, yet a
 * supplier choosing whether to spend a deposit is taking one: `acceptedOnTime` against
 * `leftToAutoRelease` says whether this buyer answers at all, which no credit check would tell them.
 */
export type TrackRecord = {
  address: string;
  asSupplier: {
    bidsPlaced: number;
    bidsRevealed: number;
    /** Sealed and never revealed: the deposit was forfeited. */
    bidsAbandoned: number;
    awards: number;
    engagementsCompleted: number;
    milestonesDelivered: number;
    milestonesRejected: number;
  };
  asBuyer: {
    rfqsPosted: number;
    rfqsAwarded: number;
    /** Opened, then closed with no winner. Deposits refunded, but a supplier's effort was spent. */
    rfqsClosedWithoutAward: number;
    milestonesAcceptedOnTime: number;
    /** The buyer stayed silent and the clock paid the supplier instead. */
    milestonesLeftToAutoRelease: number;
  };
};

const lower = (a: string) => a.toLowerCase();

@Injectable()
export class ReputationService {
  record(address: string): TrackRecord {
    const who = lower(address);

    const bids = db
      .select()
      .from(schema.bids)
      .where(sql`lower(${schema.bids.bidder}) = ${who}`)
      .all();

    const engagements = db
      .select()
      .from(schema.engagements)
      .where(sql`lower(${schema.engagements.supplier}) = ${who}`)
      .all();

    const rfqsAsBuyer = db
      .select()
      .from(schema.rfqs)
      .where(sql`lower(${schema.rfqs.buyer}) = ${who}`)
      .all();

    const suppliedRfqIds = new Set(engagements.map((e) => e.rfqId));
    const boughtRfqIds = new Set(rfqsAsBuyer.map((r) => r.id));
    const milestones = db.select().from(schema.milestones).all();

    const settled = milestones.filter((m) => m.state === "Released" || m.state === "Accepted");

    return {
      address,
      asSupplier: {
        bidsPlaced: bids.length,
        bidsRevealed: bids.filter((b) => b.revealed).length,
        bidsAbandoned: bids.filter((b) => !b.revealed).length,
        awards: rfqsAsBuyerAwardsFor(who),
        engagementsCompleted: engagements.filter((e) => e.status === "Completed").length,
        milestonesDelivered: milestones.filter((m) => suppliedRfqIds.has(m.rfqId) && m.submittedTx)
          .length,
        milestonesRejected: milestones.filter(
          (m) => suppliedRfqIds.has(m.rfqId) && m.state === "Rejected",
        ).length,
      },
      asBuyer: {
        rfqsPosted: rfqsAsBuyer.length,
        rfqsAwarded: rfqsAsBuyer.filter((r) => r.winner).length,
        rfqsClosedWithoutAward: rfqsAsBuyer.filter(
          (r) => !r.winner && r.awardDeadline < Math.floor(Date.now() / 1000),
        ).length,
        milestonesAcceptedOnTime: settled.filter((m) => boughtRfqIds.has(m.rfqId) && !m.automatic)
          .length,
        milestonesLeftToAutoRelease: settled.filter((m) => boughtRfqIds.has(m.rfqId) && m.automatic)
          .length,
      },
    };
  }

  /**
   * Suppliers this buyer has already completed work with.
   *
   * The point of keeping a record: a buyer running a second tender should be able to invite the
   * people who delivered the first without going to find their addresses. Completed only — an
   * award that never finished is not a recommendation.
   */
  partners(buyer: string): { supplier: string; completed: number; lastRfqId: number }[] {
    const mine = db
      .select()
      .from(schema.rfqs)
      .where(sql`lower(${schema.rfqs.buyer}) = ${lower(buyer)}`)
      .all();
    const ids = new Set(mine.map((r) => r.id));

    const bySupplier = new Map<string, { completed: number; lastRfqId: number }>();
    for (const e of db.select().from(schema.engagements).all()) {
      if (!ids.has(e.rfqId) || e.status !== "Completed") continue;
      const prev = bySupplier.get(e.supplier) ?? { completed: 0, lastRfqId: 0 };
      bySupplier.set(e.supplier, {
        completed: prev.completed + 1,
        lastRfqId: Math.max(prev.lastRfqId, e.rfqId),
      });
    }

    return [...bySupplier.entries()]
      .map(([supplier, v]) => ({ supplier, ...v }))
      .sort((a, b) => b.completed - a.completed || b.lastRfqId - a.lastRfqId);
  }
}

/** Awards are recorded on the RFQ, not the bid, so they are counted from the winner column. */
function rfqsAsBuyerAwardsFor(who: string): number {
  return db.select().from(schema.rfqs).where(sql`lower(${schema.rfqs.winner}) = ${who}`).all()
    .length;
}
