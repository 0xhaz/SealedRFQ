import { Controller, Get, Param, Post } from "@nestjs/common";
import { hashCanonical } from "@sealedrfq/shared";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { AwarderService } from "../awarder/awarder.service.js";
import { ChainService } from "../chain/chain.service.js";
import { EvaluatorService } from "../evaluator/evaluator.service.js";
import { IndexerService } from "../indexer/indexer.service.js";
import { X402Middleware } from "../x402/x402.middleware.js";

@Controller()
export class ApiController {
  constructor(
    private readonly chain: ChainService,
    private readonly indexer: IndexerService,
    private readonly evaluator: EvaluatorService,
    private readonly awarder: AwarderService,
    private readonly x402: X402Middleware,
  ) {}

  @Get("health")
  health() {
    const cursor = db.select().from(schema.cursor).where(eq(schema.cursor.id, 1)).get();
    return { ok: true, indexedBlock: cursor?.lastBlock ?? 0 };
  }

  /** What this agent is and what it can do — which roles it actually holds keys for. */
  @Get("meta")
  meta() {
    return {
      chainId: this.chain.chainId,
      chain: this.chain.chain.name,
      explorer: this.chain.chain.blockExplorers.default.url,
      contracts: this.chain.deployment,
      llmProvider: process.env.LLM_PROVIDER ?? "mock",
      // Advertised so a buying agent can price the call before it makes one, rather than having to
      // provoke a 402 to find out. Absent when the endpoint is free.
      x402: this.x402.config
        ? {
            resource: "POST /rfqs/:id/evaluate",
            price: this.x402.config.price,
            network: this.x402.config.network,
            payTo: this.x402.config.payTo,
            asset: "USDC",
            facilitator: this.x402.config.facilitatorUrl,
            description: this.x402.config.description,
            free: ["GET /rfqs/:id/evaluation", "GET /audit/:id"],
          }
        : null,
      roles: {
        EVALUATOR: this.chain.address("EVALUATOR"),
        AWARDER: this.chain.address("AWARDER"),
        VERIFIER: this.chain.address("VERIFIER"),
        ARBITER: this.chain.address("ARBITER"),
      },
    };
  }

  @Get("rfqs")
  rfqs() {
    return db.select().from(schema.rfqs).orderBy(desc(schema.rfqs.id)).all();
  }

  @Get("rfqs/:id")
  rfq(@Param("id") id: string) {
    const rfqId = Number(id);
    return {
      rfq: db.select().from(schema.rfqs).where(eq(schema.rfqs.id, rfqId)).get() ?? null,
      bids: db.select().from(schema.bids).where(eq(schema.bids.rfqId, rfqId)).all(),
      engagement:
        db.select().from(schema.engagements).where(eq(schema.engagements.rfqId, rfqId)).get() ??
        null,
      milestones: db
        .select()
        .from(schema.milestones)
        .where(eq(schema.milestones.rfqId, rfqId))
        .all(),
      attestations: db
        .select()
        .from(schema.attestations)
        .where(eq(schema.attestations.rfqId, rfqId))
        .all(),
    };
  }

  /**
   * The published memo behind an award recommendation.
   *
   * A decision can be anchored on-chain without this agent holding the memo — the demo scripts
   * attest directly, and another operator's evaluator would too. That is reported as
   * `anchoredOnly`, not as "not scored": claiming an award had no evaluation when the chain says
   * otherwise would be the wrong kind of wrong.
   */
  @Get("rfqs/:id/evaluation")
  evaluation(@Param("id") id: string) {
    const row = db
      .select()
      .from(schema.attestations)
      .where(
        sql`${schema.attestations.rfqId} = ${Number(id)} and ${schema.attestations.memo} is not null`,
      )
      .get();
    if (!row) {
      const anchored = db
        .select()
        .from(schema.attestations)
        .where(sql`${schema.attestations.rfqId} = ${Number(id)}`)
        .all();
      if (anchored.length === 0) return { evaluated: false };
      // An RFQ can carry several award recommendations — the firewall demo anchors one the
      // contract then rejects. Prefer the one naming the bidder that actually won.
      const rfq = db
        .select()
        .from(schema.rfqs)
        .where(eq(schema.rfqs.id, Number(id)))
        .get();
      const awards = anchored.filter((a) => a.kind.startsWith("AWARD"));
      const decision =
        awards.find((a) => a.winner && a.winner.toLowerCase() === rfq?.winner?.toLowerCase()) ??
        awards.at(-1) ??
        anchored[0];
      return {
        evaluated: true,
        anchoredOnly: true,
        kind: decision.kind,
        winner: decision.winner,
        payloadHash: decision.payloadHash,
        actor: decision.actor,
        model: decision.model,
        tx: decision.tx,
      };
    }
    return {
      evaluated: true,
      kind: row.kind,
      winner: row.winner,
      payloadHash: row.payloadHash,
      tx: row.tx,
      memo: JSON.parse(row.memo ?? "{}"),
    };
  }

  /**
   * Re-hash the published memo and compare it with the anchor the chain holds.
   *
   * Four outcomes, deliberately distinct: a rewritten memo (mismatch) is a serious finding and must
   * not look the same as this agent simply not holding the memo. Reporting "not verified" for a
   * decision the chain plainly recorded would cry wolf.
   */
  @Get("audit/:id")
  async audit(@Param("id") id: string) {
    const rfqId = Number(id);
    const withMemo = db
      .select()
      .from(schema.attestations)
      .where(
        sql`${schema.attestations.rfqId} = ${rfqId} and ${schema.attestations.memo} is not null`,
      )
      .get();

    if (!withMemo?.memo) {
      const anchored = db
        .select()
        .from(schema.attestations)
        .where(sql`${schema.attestations.rfqId} = ${rfqId}`)
        .all();
      if (anchored.length === 0) {
        return {
          state: "none" as const,
          verified: false,
          reason: "No decision has been anchored for this RFQ yet.",
        };
      }
      const rfq = db.select().from(schema.rfqs).where(eq(schema.rfqs.id, rfqId)).get();
      const awards = anchored.filter((a) => a.kind.startsWith("AWARD"));
      const decision =
        awards.find((a) => a.winner && a.winner.toLowerCase() === rfq?.winner?.toLowerCase()) ??
        awards.at(-1) ??
        anchored[0];
      return {
        state: "anchored-only" as const,
        verified: false,
        reason:
          "The decision is anchored on-chain, but this agent does not hold the memo behind the hash.",
        anchoredHash: decision.payloadHash,
        anchoredBy: decision.actor,
        kind: decision.kind,
        model: decision.model,
        tx: decision.tx,
      };
    }

    const memo = JSON.parse(withMemo.memo);
    const computed = hashCanonical(memo);
    const onChain = await this.chain.publicClient.readContract({
      ...this.chain.attestationLog,
      functionName: "getAttestation",
      args: [BigInt(withMemo.subjectId), computed as `0x${string}`],
    });
    const matches = computed.toLowerCase() === withMemo.payloadHash.toLowerCase();
    const anchoredOnChain = onChain.ts > 0n;

    return {
      state: matches && anchoredOnChain ? ("verified" as const) : ("mismatch" as const),
      verified: matches && anchoredOnChain,
      reason: matches
        ? undefined
        : "The published memo does not hash to the value anchored on-chain: it has been altered since the decision.",
      computedHash: computed,
      anchoredHash: withMemo.payloadHash,
      anchoredBy: anchoredOnChain ? onChain.actor : withMemo.actor,
      anchoredAt: Number(onChain.ts),
      kind: withMemo.kind,
      model: withMemo.model,
      tx: withMemo.tx,
      memo,
    };
  }

  @Post("rfqs/:id/evaluate")
  evaluate(@Param("id") id: string) {
    return this.evaluator.evaluateAndAttest(Number(id));
  }

  @Post("rfqs/:id/award")
  award(@Param("id") id: string) {
    return this.awarder.award(Number(id));
  }

  /** Force an indexer pass (the loop also runs on a timer). */
  @Post("reindex")
  async reindex() {
    await this.indexer.tick();
    return this.health();
  }
}
