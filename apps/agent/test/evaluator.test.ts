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

/**
 * The delivery window the stubbed chain reports for the RFQ under test.
 *
 * It is not in the index — `RFQCreated` does not carry it — so the evaluator reads it from the
 * chain, and a test that wants the deliverability screen has to say what the chain would answer.
 * Zero means "no window", which is also what a failed read degrades to.
 */
let chainDeliveryWindow = 0;

beforeAll(async () => {
  ({ db, schema } = await import("../src/db/index.js"));
  const { EvaluatorService } = await import("../src/modules/evaluator/evaluator.service.js");
  const chain = {
    address: () => EVALUATOR,
    registry: { address: EVALUATOR, abi: [] },
    publicClient: { readContract: async () => ({ deliveryWindow: chainDeliveryWindow }) },
  } as never;
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
  chainDeliveryWindow = 0;
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

  it("flags a bid that cannot be delivered inside the tender's window", async () => {
    // The window is the buyer's term; the days are the supplier's quote. Nothing on-chain compares
    // them, which is exactly why the evaluator has to.
    chainDeliveryWindow = 900; // 15 minutes
    seedRfq(10);
    seedBid(10, S1, "2800000", 14);
    const { memo } = await evaluator.evaluate(10);

    const flagged = memo.scores.find((s: { bidder: string }) => s.bidder === S1);
    expect(flagged.redFlags.join(" ")).toContain("14 days");
    expect(flagged.redFlags.join(" ")).toContain("15 minutes");
  });

  it("will not recommend an undeliverable bid, and does not blame the contract for it", async () => {
    chainDeliveryWindow = 86_400; // one day
    seedRfq(11);
    // S1 has to actually top the ranking for the runner-up sentence to be reached, so its price
    // advantage must outweigh the delivery points it loses: 100/50/50 → 75 against S2's 34.5/100/50
    // → 57.25 under the 50/30/20 rubric. It is still two days against a one-day window.
    seedBid(11, S1, "1000000", 2);
    seedBid(11, S2, "2900000", 1);
    const { memo } = await evaluator.evaluate(11);

    expect(memo.decision.bidder).toBe(S2);
    // The contract would happily award S1 — over-budget is the only thing it refuses — so the memo
    // must not claim otherwise. Saying "the contract would reject" here would be a plain lie.
    expect(memo.rationale).not.toContain("the contract would reject");
    expect(memo.rationale).toContain("expire before it could be delivered");
  });

  it("recommends normally when the quote fits the window", async () => {
    chainDeliveryWindow = 30 * 86_400;
    seedRfq(12);
    seedBid(12, S1, "2800000", 21);
    const { memo } = await evaluator.evaluate(12);

    expect(memo.decision.outcome).toBe("RECOMMEND");
    expect(memo.scores[0].redFlags.join(" ")).not.toContain("this tender allows");
  });

  it("skips the delivery screen entirely when no window is known", async () => {
    // A failed chain read degrades to zero. That must not quietly disqualify every bidder.
    chainDeliveryWindow = 0;
    seedRfq(13);
    seedBid(13, S1, "2800000", 9999);
    const { memo } = await evaluator.evaluate(13);

    expect(memo.decision.outcome).toBe("RECOMMEND");
    expect(memo.scores[0].redFlags.join(" ")).not.toContain("this tender allows");
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

  it("screens revealed bids against the buyer's stated requirements", async () => {
    // Requirements ride in the metadata whose hash was fixed before bidding, so the bar cannot have
    // moved since. S1 is too slow; S2 meets it.
    seedRfq(8, {
      metadataURI: JSON.stringify({
        scope: "test",
        rubric: RUBRIC,
        mode: "RFQ",
        requirements: { maxDeliveryDays: 20, attestations: ["ISO 9001"] },
      }),
    });
    seedBid(8, S1, "2800000", 30);
    seedBid(8, S2, "2900000", 14);
    const { memo } = await evaluator.evaluate(8);

    const slow = memo.scores.find((x: { bidder: string }) => x.bidder === S1);
    const ok = memo.scores.find((x: { bidder: string }) => x.bidder === S2);
    expect(slow.redFlags.join(" ")).toMatch(/slower than the required 20/);
    expect(ok.redFlags.join(" ")).not.toMatch(/slower/);

    // A stated requirement is never reported as satisfied — it is handed to a person.
    for (const score of memo.scores) {
      expect(score.unverified.join(" ")).toMatch(/ISO 9001/);
      expect(score.unverified.join(" ")).toMatch(/not provable/);
    }
  });

  it("leaves the memo unchanged when the buyer set no requirements", async () => {
    seedRfq(9);
    seedBid(9, S1, "2800000", 21);
    seedBid(9, S2, "2900000", 14);
    const { memo } = await evaluator.evaluate(9);
    // Absent, not an empty array: the field only appears when there is something to say.
    expect(memo.scores[0].unverified).toBeUndefined();
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
