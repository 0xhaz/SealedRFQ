import { Injectable, Logger } from "@nestjs/common";
import {
  AttestationKinds,
  type DecisionMemo,
  MEMO_SCHEMA,
  checkRequirements,
  describeWindow,
  hashCanonical,
} from "@sealedrfq/shared";
import { eq, sql } from "drizzle-orm";
import { type Hex, stringToHex } from "viem";
import { db, schema } from "../../db/index.js";
import { ChainService } from "../chain/chain.service.js";
import { loadMetadata } from "./metadata.js";

export type Rubric = { price: number; delivery: number; quality: number };

const DEFAULT_RUBRIC: Rubric = { price: 50, delivery: 30, quality: 20 };
/**
 * What the memo records as the thing that made the decision.
 *
 * Named for what it is rather than for what it is not. The default scorer is weighted rubric
 * arithmetic over the published criteria, reproducible by anyone holding the same bids — and for a
 * decision that moves money and is anchored on-chain, that reproducibility is the feature, not a
 * gap waiting for a model. It was called `mock-rubric-v1`, which read as "unfinished" to everyone
 * who saw it on a tender and undersold the one property the audit endpoint depends on.
 *
 * `mock` is still accepted as a value so existing deployments keep working; `rubric` says the same
 * thing better. Anything else names a real provider and is recorded verbatim.
 *
 * Must fit in 31 bytes: the AttestationLog stores it as a `bytes32`.
 */
const DETERMINISTIC = "deterministic-rubric-v1";
const MODEL =
  !process.env.LLM_PROVIDER ||
  process.env.LLM_PROVIDER === "mock" ||
  process.env.LLM_PROVIDER === "rubric"
    ? DETERMINISTIC
    : process.env.LLM_PROVIDER;

/**
 * Scores revealed bids against the rubric the buyer published *before* bidding opened.
 *
 * The rubric's weights live in the RFQ metadata, not on-chain — only their hash is. So the scorer
 * reconstructs the rubric from the metadata and checks it against `rubricHash`; if it does not
 * match, it refuses to score rather than invent criteria after seeing the prices.
 *
 * The default scorer is deterministic rubric arithmetic and needs no API key. That is a deliberate
 * choice rather than a stand-in: the memo is hash-anchored and `/audit/:id` re-hashes it, so a
 * scorer that answers differently on a re-run would weaken the claim from "anyone can recompute
 * this decision" to "this is what a model said once". A model-backed scorer plugs in behind the
 * same interface, and where one earns its place — reading an unstructured proposal — it should
 * extract facts for this scorer to weigh rather than emit a score of its own.
 */
@Injectable()
export class EvaluatorService {
  private readonly log = new Logger(EvaluatorService.name);

  /** What the memo will record as the decider, so callers can read it without provoking one. */
  static modelId(): string {
    return MODEL;
  }

  constructor(private readonly chain: ChainService) {}

  /**
   * Parse the rubric published with the RFQ and verify it against the on-chain hash.
   *
   * The metadata may be inline JSON or a URI pointing at it; both are read the same way here. A
   * fetch that fails is reported as unverified rather than thrown: an unreachable document is
   * indistinguishable from a wrong one as far as scoring goes, and either way the honest answer is
   * that the criteria could not be confirmed.
   */
  async rubricFor(
    metadataURI: string,
    rubricHash: string,
  ): Promise<{ rubric: Rubric; verified: boolean; published: unknown }> {
    let published: unknown = null;
    try {
      published = await loadMetadata(metadataURI);
      const parsed = published as { rubric?: Rubric } | null;
      if (parsed?.rubric) {
        const hash = hashCanonical({ schema: "sealedrfq.rubric.v1", criteria: parsed.rubric });
        return {
          rubric: parsed.rubric,
          verified: hash.toLowerCase() === rubricHash.toLowerCase(),
          published,
        };
      }
    } catch (e) {
      this.log.warn(`could not load metadata for scoring: ${e instanceof Error ? e.message : e}`);
    }
    const hash = hashCanonical({ schema: "sealedrfq.rubric.v1", criteria: DEFAULT_RUBRIC });
    return {
      rubric: DEFAULT_RUBRIC,
      verified: hash.toLowerCase() === rubricHash.toLowerCase(),
      published,
    };
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

    const { rubric, verified, published } = await this.rubricFor(rfq.metadataURI, rfq.rubricHash);
    const weightTotal = rubric.price + rubric.delivery + rubric.quality || 1;
    const budget = BigInt(rfq.budget);

    // Read from the chain rather than the index: `RFQCreated` does not carry the delivery window,
    // and an evaluation is rare enough that one extra call costs nothing.
    //
    // Zero means "do not measure delivery against anything", which covers both an RFQ that set no
    // window and a read that did not come back. Failing the whole evaluation because one advisory
    // field was unreadable would be the wrong trade: the deliverability check is this evaluator's
    // own policy, not a rule the contract enforces, so losing it degrades the memo rather than
    // invalidating it. It is logged so that absence is visible rather than assumed.
    let deliveryWindow = 0;
    try {
      const onChain = await this.chain.publicClient.readContract({
        ...this.chain.registry,
        functionName: "getRFQ",
        args: [BigInt(rfqId)],
      });
      deliveryWindow = Number(onChain.deliveryWindow ?? 0);
    } catch (e) {
      this.log.warn(
        `RFQ ${rfqId}: could not read the delivery window, so bids are not screened against it (${e instanceof Error ? e.message : e})`,
      );
    }
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
      // A bid that cannot be delivered inside the tender's own window is non-compliant in the same
      // way an over-budget bid is. It is worth catching here because the consequence lands on the
      // supplier: award them and the first milestone's deadline is already impossible, so they
      // forfeit the escrow and their performance stake for missing a date they never agreed to.
      if (deliveryWindow > 0 && days * 86_400 > deliveryWindow) {
        redFlags.push(
          `bid promises ${days} days but this tender allows ${describeWindow(deliveryWindow)}`,
        );
      }
      if (rfq.requiresProposal && !b.proposalHash) {
        redFlags.push("no proposal document bound to this bid");
      }
      if (price * 2n < bestPrice * 2n && price * 100n < budget * 40n) {
        redFlags.push("bid is under 40% of budget: check scope understanding");
      }
      if (completed === 0) redFlags.push("no completed engagements on this deployment");

      // Buyer requirements, screened at reveal. They live in the metadata document whose hash was
      // fixed before bidding, so the bar cannot have moved since. Checkable ones become red flags;
      // stated-but-unprovable ones are reported as needing a person rather than quietly passed.
      const { failed, unverified } = checkRequirements(
        { deliveryDays: days, completed },
        (published as { requirements?: unknown } | null)?.requirements,
      );
      redFlags.push(...failed);

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
        ...(unverified.length ? { unverified } : {}),
      };
    });

    scores.sort((a, b) => b.totalBps - a.totalBps);
    const best = scores[0];
    /**
     * Two kinds of non-compliance, kept apart because they are not the same kind of fact.
     *
     * Over budget is a rule the *contract* enforces: award it and the transaction reverts, so
     * recommending it would be recommending something impossible. Over the delivery window is a
     * rule the contract does not enforce — it would let the award through, and then the first
     * milestone's deadline would already be unreachable and the supplier would forfeit their stake
     * for it. Excluding that is this evaluator's judgement, not the chain's, and the memo says so
     * in those terms rather than claiming the contract would refuse.
     */
    const overBudget = (s: { price: string }) => BigInt(s.price) > budget;
    const overWindow = (s: { deliveryDays: number }) =>
      deliveryWindow > 0 && s.deliveryDays * 86_400 > deliveryWindow;
    const winner = scores.filter((s) => !overBudget(s) && !overWindow(s))[0];

    const inputsHash = hashCanonical({
      budget: String(budget),
      deliveryWindow,
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
        ? overBudget(best)
          ? ` ${best.bidder} scored higher overall but bids above the published budget, which the contract would reject.`
          : ` ${best.bidder} scored higher overall but promises ${best.deliveryDays} days against a ${describeWindow(deliveryWindow)} delivery window, so its first milestone would expire before it could be delivered.`
        : "";
    const rationale = !verified
      ? "The rubric published with this RFQ does not match the hash fixed on-chain, so the bids cannot be scored against the agreed criteria."
      : winner
        ? `${winner.bidder} scores highest within budget (${winner.totalBps / 100}/100) on price ${winner.criteria.price}, delivery ${winner.criteria.delivery}, quality ${winner.criteria.quality}.${runnerUp}`
        : scores.every(overBudget)
          ? "Every revealed bid is above the published budget; no award can be recommended."
          : `No revealed bid is both within the published budget and deliverable inside the ${describeWindow(deliveryWindow)} delivery window; no award can be recommended.`;

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
