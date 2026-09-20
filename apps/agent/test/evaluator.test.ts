import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashCanonical } from "@sealedrfq/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// The db module reads DATABASE_URL when it is first imported, so point it at a scratch file first.
process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "sealedrfq-")), "test.db")}`;

const EVALUATOR = "0x90aD2B03aD46Ef7E413261FCdc5D82f9870Ca91F";
const RUBRIC = { price: 50, delivery: 30, quality: 20 };
const RUBRIC_HASH = hashCanonical({ schema: "sealedrfq.rubric.v1", criteria: RUBRIC });
const metadata = JSON.stringify({ scope: "test", rubric: RUBRIC, mode: "RFQ" });

const S1 = "0x1111111111111111111111111111111111111111";
const S2 = "0x2222222222222222222222222222222222222222";
const S3 = "0x3333333333333333333333333333333333333333";

// biome-ignore lint/suspicious/noExplicitAny: the service only uses address() in these paths
let evaluator: any;
// biome-ignore lint/suspicious/noExplicitAny: imported after env setup
let db: any;
// biome-ignore lint/suspicious/noExplicitAny: imported after env setup
let schema: any;

beforeAll(async () => {
  ({ db, schema } = await import("../src/db/index.js"));
  const { EvaluatorService } = await import("../src/modules/evaluator/evaluator.service.js");
  const chain = { address: () => EVALUATOR } as never;
  evaluator = new EvaluatorService(chain);
});

function seedRfq(id: number, overrides: Record<string, unknown> = {}) {
  db.insert(schema.rfqs)
    .values({
      id,
      buyer: "0x9999999999999999999999999999999999999999",
      category: "SOFTWARE",
      budget: "3000000",
      depositAmount: "250000",
      buyerStake: "150000",
      rubricHash: RUBRIC_HASH,
      metadataURI: metadata,
      bidDeadline: 1,
      revealDeadline: 2,
      awardDeadline: 3,
      createdTx: "0xtx",
      createdBlock: 1,
      ...overrides,
    })
    .run();
}

function seedBid(rfqId: number, bidder: string, price: string, deliveryDays: number) {
  db.insert(schema.bids)
    .values({
      rfqId,
      bidder,
      commitHash: "0xhash",
      price,
      deliveryDays,
      revealed: true,
      committedTx: "0xtx",
    })
    .run();
}

beforeEach(() => {
  db.delete(schema.bids).run();
  db.delete(schema.rfqs).run();
  db.delete(schema.engagements).run();
});

describe("evaluator scoring", () => {
  it("recommends the best bid within budget and explains why", async () => {
    seedRfq(1);
    seedBid(1, S1, "2800000", 21);
    seedBid(1, S2, "2950000", 14);
    const { memo, rubricVerified } = await evaluator.evaluate(1);

    expect(rubricVerified).toBe(true);
    expect(memo.decision.outcome).toBe("RECOMMEND");
    expect(memo.scores).toHaveLength(2);
    expect(memo.rationale).toContain(memo.decision.bidder);
    // Scores are ordered best first, and every bid is scored — including the loser.
    expect(memo.scores[0].totalBps).toBeGreaterThanOrEqual(memo.scores[1].totalBps);
  });

  it("never recommends a bid above the published budget, however well it scores", async () => {
    seedRfq(2);
    // The over-budget bid is the fastest, so on delivery alone it would win.
    seedBid(2, S3, "3400000", 2);
    seedBid(2, S1, "2800000", 40);
    const { memo } = await evaluator.evaluate(2);

    expect(memo.decision.bidder).toBe(S1);
    expect(BigInt(memo.decision.amount)).toBeLessThanOrEqual(3_000_000n);
    const over = memo.scores.find((s: { bidder: string }) => s.bidder === S3);
    expect(over.redFlags.join(" ")).toContain("exceeds the published budget");
    // The memo says out loud that a higher scorer was passed over, rather than quietly dropping it.
    expect(memo.rationale).toContain("above the published budget");
  });

  it("recommends no award when every bid is over budget", async () => {
    seedRfq(3);
    seedBid(3, S1, "3100000", 10);
    seedBid(3, S2, "3400000", 12);
    const { memo } = await evaluator.evaluate(3);

    expect(memo.decision.outcome).toBe("NO_AWARD");
    expect(memo.decision.bidder).toBeUndefined();
  });

  it("refuses to score when the published rubric does not hash to the on-chain value", async () => {
    // A buyer (or a compromised host) swapping the weights after bids are visible must not work.
    seedRfq(4, {
      metadataURI: JSON.stringify({ rubric: { price: 10, delivery: 10, quality: 80 } }),
    });
    seedBid(4, S1, "2800000", 21);
    seedBid(4, S2, "2900000", 14);
    const { memo, rubricVerified } = await evaluator.evaluate(4);

    expect(rubricVerified).toBe(false);
    expect(memo.decision.outcome).toBe("NO_AWARD");
    expect(memo.rationale).toContain("does not match the hash");
  });

  it("produces a stable hash for the same inputs, and a different one for changed reasoning", async () => {
    seedRfq(5);
    seedBid(5, S1, "2800000", 21);
    seedBid(5, S2, "2950000", 14);
    const a = await evaluator.evaluate(5);
    const b = await evaluator.evaluate(5);

    // ts moves, so compare the parts an auditor re-hashes deterministically.
    expect(hashCanonical({ ...a.memo, ts: 0 })).toBe(hashCanonical({ ...b.memo, ts: 0 }));
    expect(hashCanonical({ ...a.memo, ts: 0, rationale: "reworded later" })).not.toBe(
      hashCanonical({ ...a.memo, ts: 0 }),
    );
  });

  it("flags a supplier with no completed history rather than silently trusting it", async () => {
    seedRfq(6);
    seedBid(6, S1, "2800000", 21);
    seedBid(6, S2, "2900000", 20);
    const { memo } = await evaluator.evaluate(6);
    for (const score of memo.scores) {
      expect(score.redFlags).toContain("no completed engagements on this deployment");
    }
  });

  it("raises the quality score once a supplier has completed work here", async () => {
    seedRfq(7);
    seedBid(7, S1, "2800000", 21);
    seedBid(7, S2, "2800000", 21);
    db.insert(schema.engagements)
      .values({
        rfqId: 99,
        supplier: S1,
        price: "1000000",
        milestoneCount: 1,
        status: "Completed",
        startedTx: "0xtx",
      })
      .run();

    const { memo } = await evaluator.evaluate(7);
    const withHistory = memo.scores.find((s: { bidder: string }) => s.bidder === S1);
    const without = memo.scores.find((s: { bidder: string }) => s.bidder === S2);
    expect(withHistory.criteria.quality).toBeGreaterThan(without.criteria.quality);
    // Identical price and delivery, so history is what separates them.
    expect(memo.decision.bidder).toBe(S1);
  });
});
