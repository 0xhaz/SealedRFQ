import { Injectable, Logger } from "@nestjs/common";
import { AttestationKinds, type DecisionMemo, MEMO_SCHEMA, hashCanonical } from "@sealedrfq/shared";
import { eq, sql } from "drizzle-orm";
import { type Hex, stringToHex } from "viem";
import { db, schema } from "../../db/index.js";
import { ChainService } from "../chain/chain.service.js";

export type Rubric = { price: number; delivery: number; quality: number };

const DEFAULT_RUBRIC: Rubric = { price: 50, delivery: 30, quality: 20 };
const MODEL =
  process.env.LLM_PROVIDER === "mock" || !process.env.LLM_PROVIDER
    ? "mock-rubric-v1"
    : process.env.LLM_PROVIDER;

/**
 * Scores revealed bids against the rubric the buyer published *before* bidding opened.
 *
 * The rubric's weights live in the RFQ metadata, not on-chain — only their hash is. So the scorer
 * reconstructs the rubric from the metadata and checks it against `rubricHash`; if it does not
 * match, it refuses to score rather than invent criteria after seeing the prices.
 *
 * `LLM_PROVIDER=mock` (the default) is a deterministic rubric scorer, so the pipeline and the
 * attestation path work with no API key. A model-backed scorer plugs in behind the same interface.
 */
@Injectable()
export class EvaluatorService {
  private readonly log = new Logger(EvaluatorService.name);

  constructor(private readonly chain: ChainService) {}

  /** Parse the rubric published with the RFQ and verify it against the on-chain hash. */
  rubricFor(metadataURI: string, rubricHash: string): { rubric: Rubric; verified: boolean } {
    try {
      const parsed = JSON.parse(metadataURI) as { rubric?: Rubric };
      if (parsed.rubric) {
        const hash = hashCanonical({ schema: "sealedrfq.rubric.v1", criteria: parsed.rubric });
        return { rubric: parsed.rubric, verified: hash.toLowerCase() === rubricHash.toLowerCase() };
      }
    } catch {
      // metadata is free text, not JSON
    }
    const hash = hashCanonical({ schema: "sealedrfq.rubric.v1", criteria: DEFAULT_RUBRIC });
    return { rubric: DEFAULT_RUBRIC, verified: hash.toLowerCase() === rubricHash.toLowerCase() };
  }

  /**
   * Build the decision memo. Deterministic and explainable: price and delivery are scored relative
   * to the best revealed bid, and "quality" uses the supplier's own completed history on this
   * deployment rather than an opinion the contract cannot check.
   */
  async evaluate(rfqId: number): Promise<{ memo: DecisionMemo; rubricVerified: boolean }> {
    const rfq = db.select().from(schema.rfqs).where(eq(schema.rfqs.id, rfqId)).get();
    if (!rfq) throw new Error(`RFQ ${rfqId} is not indexed yet`);
    const revealed = db
      .select()
      .from(schema.bids)
      .where(sql`${schema.bids.rfqId} = ${rfqId} and ${schema.bids.revealed} = 1`)
      .all();
    if (revealed.length === 0) throw new Error(`RFQ ${rfqId} has no revealed bids`);

    const { rubric, verified } = this.rubricFor(rfq.metadataURI, rfq.rubricHash);
    const weightTotal = rubric.price + rubric.delivery + rubric.quality || 1;
    const budget = BigInt(rfq.budget);
    const bestPrice = revealed.reduce(
      (m, b) => (BigInt(b.price ?? "0") < m ? BigInt(b.price ?? "0") : m),
      BigInt(revealed[0].price ?? "0"),
    );
    const bestDays = Math.min(...revealed.map((b) => b.deliveryDays ?? 9999));

    const scores = revealed.map((b) => {
      const price = BigInt(b.price ?? "0");
      const days = b.deliveryDays ?? 9999;
      const priceScore = price > 0n ? Number((bestPrice * 10_000n) / price) / 100 : 0;
      const deliveryScore = days > 0 ? (bestDays / days) * 100 : 0;
      const completed = db
        .select()
        .from(schema.engagements)
        .where(
          sql`${schema.engagements.supplier} = ${b.bidder} and ${schema.engagements.status} = 'Completed'`,
        )
        .all().length;
      const qualityScore = Math.min(100, 50 + completed * 10);

      const redFlags: string[] = [];
      if (price > budget) redFlags.push(`bid ${price} exceeds the published budget ${budget}`);
      if (rfq.requiresProposal && !b.proposalHash) {
        redFlags.push("no proposal document bound to this bid");
      }
      if (price * 2n < bestPrice * 2n && price * 100n < budget * 40n) {
        redFlags.push("bid is under 40% of budget: check scope understanding");
      }
      if (completed === 0) redFlags.push("no completed engagements on this deployment");

      const totalBps = Math.round(
        ((priceScore * rubric.price +
          deliveryScore * rubric.delivery +
          qualityScore * rubric.quality) /
          weightTotal) *
          100,
      );
      return {
        bidder: b.bidder,
        price: String(price),
        deliveryDays: days,
        criteria: {
          price: Math.round(priceScore * 100) / 100,
          delivery: Math.round(deliveryScore * 100) / 100,
          quality: qualityScore,
        },
        totalBps: Math.max(0, Math.min(10_000, totalBps)),
        redFlags,
      };
    });

    scores.sort((a, b) => b.totalBps - a.totalBps);
    const best = scores[0];
    const withinBudget = scores.filter((s) => BigInt(s.price) <= budget);
    const winner = withinBudget[0];

    const inputsHash = hashCanonical({
      budget: String(budget),
      rubric,
      bids: revealed.map((b) => ({
        bidder: b.bidder,
        price: b.price,
        days: b.deliveryDays,
        proposalHash: b.proposalHash,
      })),
    });

    const runnerUp =
      best.bidder !== winner?.bidder
        ? ` ${best.bidder} scored higher overall but bids above the published budget, which the contract would reject.`
        : "";
    const rationale = !verified
      ? "The rubric published with this RFQ does not match the hash fixed on-chain, so the bids cannot be scored against the agreed criteria."
      : winner
        ? `${winner.bidder} scores highest within budget (${winner.totalBps / 100}/100) on price ${winner.criteria.price}, delivery ${winner.criteria.delivery}, quality ${winner.criteria.quality}.${runnerUp}`
        : "Every revealed bid is above the published budget; no award can be recommended.";

    const memo: DecisionMemo = {
      schema: MEMO_SCHEMA,
      rfqId: String(rfqId),
      kind: "AWARD_RECOMMENDATION",
      actor: (this.chain.address("EVALUATOR") ??
        "0x0000000000000000000000000000000000000000") as Hex,
      model: MODEL,
      ts: Math.floor(Date.now() / 1000),
      inputsHash,
      rubricHash: rfq.rubricHash as Hex,
      scores,
      rationale,
      decision:
        verified && winner
          ? { outcome: "RECOMMEND", bidder: winner.bidder as Hex, amount: winner.price }
          : { outcome: "NO_AWARD" },
    };
    return { memo, rubricVerified: verified };
  }

  /** Anchor the memo on-chain and store it, so anyone can re-hash it against the anchor. */
  async evaluateAndAttest(rfqId: number) {
    const { memo, rubricVerified } = await this.evaluate(rfqId);
    const payloadHash = hashCanonical(memo);
    const winner = memo.decision.bidder;

    const subject = winner
      ? await this.chain.publicClient.readContract({
          ...this.chain.registry,
          functionName: "awardSubject",
          args: [BigInt(rfqId), winner as Hex],
        })
      : BigInt(rfqId);

    const kind = winner ? AttestationKinds.AWARD_RECOMMENDATION : AttestationKinds.AWARD_REJECTION;
    const existing = db
      .select()
      .from(schema.attestations)
      .where(sql`${schema.attestations.payloadHash} = ${payloadHash}`)
      .get();

    let tx = existing?.tx ?? null;
    if (!existing) {
      tx = await this.chain.send("EVALUATOR", {
        ...this.chain.attestationLog,
        functionName: "attest",
        args: [kind, subject, payloadHash, stringToHex(MODEL.slice(0, 31), { size: 32 })],
      });
      this.log.log(`attested ${winner ? "recommendation" : "no-award"} for RFQ ${rfqId}: ${tx}`);
    }

    db.insert(schema.attestations)
      .values({
        subjectId: String(subject),
        payloadHash,
        kind: winner ? "AWARD_RECOMMENDATION" : "AWARD_REJECTION",
        actor: memo.actor,
        model: MODEL,
        rfqId,
        winner: winner ?? null,
        memo: JSON.stringify(memo),
        tx: tx ?? "",
        ts: memo.ts,
      })
      .onConflictDoUpdate({
        target: [schema.attestations.subjectId, schema.attestations.payloadHash],
        set: { memo: JSON.stringify(memo), rfqId, winner: winner ?? null },
      })
      .run();

    return { memo, payloadHash, tx, rubricVerified, subject: String(subject) };
  }
}
