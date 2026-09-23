import { Injectable } from "@nestjs/common";
import { db, schema } from "../../db/index.js";

/**
 * What has actually happened on this deployment, counted from indexed events.
 *
 * Written for whoever operates the contracts and wants one screen rather than an explorer tab per
 * question. Everything here is a count or a sum over events the chain already published, so it is
 * an operator's convenience rather than privileged information — the same figures could be
 * recomputed by anyone, and the endpoint is left open for that reason.
 *
 * Deliberately not a dashboard of "revenue". The platform fee transfers straight to the treasury
 * wallet when a milestone releases, so nothing accrues inside the contracts and there is no balance
 * here to report. What the admin page shows instead is the *rate*, the destination and whether
 * either has ever been non-zero — which are the facts that actually bear on trusting the deployment.
 */
export type DeploymentStats = {
  rfqs: {
    total: number;
    awarded: number;
    /** Posted, then closed with nobody chosen. The deposit came back; the effort did not. */
    closedNoAward: number;
    budgetTotal: string;
    awardedValue: string;
  };
  bids: {
    total: number;
    revealed: number;
    /** Sealed and never opened: the deposit was forfeited, which is what binds a sealed bid. */
    abandoned: number;
    uniqueBidders: number;
  };
  engagements: {
    total: number;
    active: number;
    completed: number;
    /** A delivery window closed with nothing delivered. */
    abandoned: number;
    disputed: number;
  };
  milestones: {
    total: number;
    accepted: number;
    rejected: number;
    /** Released because the buyer said nothing, not because they approved. */
    automatic: number;
  };
  indexedBlock: number;
};

const sum = (rows: { v: string | null }[]) =>
  rows.reduce((acc, r) => acc + BigInt(r.v ?? "0"), 0n).toString();

@Injectable()
export class StatsService {
  overview(): DeploymentStats {
    const rfqs = db.select().from(schema.rfqs).all();
    const bids = db.select().from(schema.bids).all();
    const engagements = db.select().from(schema.engagements).all();
    const milestones = db.select().from(schema.milestones).all();
    const cursor = db.select().from(schema.cursor).all()[0];

    const awarded = rfqs.filter((r) => r.winner);

    return {
      rfqs: {
        total: rfqs.length,
        awarded: awarded.length,
        // An RFQ with no winner whose award deadline has passed is closed; the indexer does not
        // carry a status column, so this is the honest approximation and is labelled as one.
        closedNoAward: rfqs.filter(
          (r) => !r.winner && r.awardDeadline < Math.floor(Date.now() / 1000),
        ).length,
        budgetTotal: sum(rfqs.map((r) => ({ v: r.budget }))),
        awardedValue: sum(awarded.map((r) => ({ v: r.awardPrice }))),
      },
      bids: {
        total: bids.length,
        revealed: bids.filter((b) => b.revealed).length,
        abandoned: bids.filter((b) => !b.revealed).length,
        uniqueBidders: new Set(bids.map((b) => b.bidder.toLowerCase())).size,
      },
      engagements: {
        total: engagements.length,
        active: engagements.filter((e) => e.status === "Active").length,
        completed: engagements.filter((e) => e.status === "Completed").length,
        abandoned: engagements.filter((e) => e.status === "Abandoned").length,
        disputed: engagements.filter((e) => e.status === "Disputed").length,
      },
      milestones: {
        total: milestones.length,
        accepted: milestones.filter((m) => m.state === "Accepted").length,
        rejected: milestones.filter((m) => m.state === "Rejected").length,
        automatic: milestones.filter((m) => m.automatic).length,
      },
      indexedBlock: cursor?.lastBlock ?? 0,
    };
  }
}
