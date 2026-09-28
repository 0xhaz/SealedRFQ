import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { hashCanonical } from "@sealedrfq/shared";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { TokenGuard } from "../auth/token.guard.js";
import { AwarderService } from "../awarder/awarder.service.js";
import { ChainService } from "../chain/chain.service.js";
import { ClarificationsService } from "../clarifications/clarifications.service.js";
import { DocumentsService } from "../documents/documents.service.js";
import { EvaluatorService } from "../evaluator/evaluator.service.js";
import { IndexerService } from "../indexer/indexer.service.js";
import { DirectoryService } from "../reputation/directory.service.js";
import { ReputationService } from "../reputation/reputation.service.js";
import { StatsService } from "../reputation/stats.service.js";
import { X402Middleware } from "../x402/x402.middleware.js";

@Controller()
export class ApiController {
  constructor(
    private readonly chain: ChainService,
    private readonly indexer: IndexerService,
    private readonly evaluator: EvaluatorService,
    private readonly awarder: AwarderService,
    private readonly x402: X402Middleware,
    private readonly documents: DocumentsService,
    private readonly reputation: ReputationService,
    private readonly clarifications: ClarificationsService,
    private readonly directory: DirectoryService,
    private readonly stats: StatsService,
  ) {}

  /** The clarification thread. Public by design: an answer only one bidder can read is a favour. */
  @Get("rfqs/:id/clarifications")
  clarificationThread(@Param("id") id: string) {
    return { entries: this.clarifications.thread(Number(id)) };
  }

  /**
   * Ask a question, or answer one as the buyer. Authorised by signature rather than by a session:
   * there are no accounts here, and the wallet is the identity everywhere else.
   */
  /**
   * How many questions are waiting on this buyer, per tender.
   *
   * Public, like the thread itself — it only counts what anyone can already read. The board calls
   * it once for the connected wallet rather than opening every tender to look.
   */
  @Get("buyers/:address/questions")
  openQuestions(@Param("address") address: string, @Query("rfqIds") rfqIds?: string) {
    const ids = (rfqIds ?? "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 200);
    return { unanswered: this.clarifications.unansweredByRfq(ids) };
  }

  @Post("rfqs/:id/clarifications")
  addClarification(
    @Param("id") id: string,
    @Body()
    body: {
      body: string;
      ts: number;
      signature: `0x${string}`;
      parentId?: number | null;
      anonymous?: boolean;
    },
  ) {
    return this.clarifications.add({ rfqId: Number(id), ...body });
  }

  /**
   * What has happened on this deployment, counted from indexed events.
   *
   * Open rather than token-gated: every figure is a count over events the chain already published,
   * so gating it would protect nothing and would make the operator's own dashboard the one page on
   * this site that cannot be independently checked.
   */
  @Get("stats")
  overview() {
    return this.stats.overview();
  }

  /**
   * The supplier directory.
   *
   * Listed because the chain saw them bid, never because they registered — a directory that anyone
   * can add themselves to is a directory of people who have done nothing. Counted facts and claimed
   * ones come back in separate fields and are never blended into a score.
   */
  @Get("suppliers")
  suppliers() {
    return { suppliers: this.directory.list() };
  }

  @Get("suppliers/:address")
  supplier(@Param("address") address: string) {
    return this.directory.entry(address);
  }

  /** Publish your own profile. Signature-authorised: a wallet may only describe itself. */
  @Post("suppliers/:address/profile")
  publishProfile(
    @Param("address") address: string,
    @Body()
    body: {
      name: string;
      country?: string;
      categories?: string;
      website?: string;
      contact?: string;
      about?: string;
      ts: number;
      signature: `0x${string}`;
    },
  ) {
    return this.directory.publish({ address, ...body });
  }

  /** A counterparty's record, counted from the chain. Free: it is evidence, not a product. */
  @Get("reputation/:address")
  record(@Param("address") address: string) {
    return this.reputation.record(address);
  }

  /** Suppliers this buyer has completed work with, for inviting them to the next tender. */
  @Get("reputation/:address/partners")
  partners(@Param("address") address: string) {
    return { partners: this.reputation.partners(address) };
  }

  /**
   * Store a tender document and return the hash to publish with the RFQ.
   *
   * Open to callers on purpose: a buyer posting an RFQ has no credential here, and gating this
   * would put the terms back behind an email. The limits are what protect it — an allowlist of
   * document types, a size cap, and storage keyed by content hash so the same file uploaded twice
   * occupies one entry rather than two.
   */
  @Post("documents")
  async upload(
    // biome-ignore lint/suspicious/noExplicitAny: the raw Express request, read as a stream
    @Req() req: any,
    @Headers("content-type") contentType: string,
  ) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      // Stop reading a body that is already over the cap rather than buffering all of it.
      if (total > 10 * 1024 * 1024 + 1024) break;
      chunks.push(chunk as Buffer);
    }
    return this.documents.store(Buffer.concat(chunks), contentType ?? "");
  }

  /** Serve it back. Callers re-hash what they receive; this endpoint is not the authority. */
  @Get("documents/:sha256")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  // biome-ignore lint/suspicious/noExplicitAny: the raw Express response, for a binary body
  document(@Param("sha256") sha256: string, @Res() res: any) {
    const { bytes, contentType } = this.documents.read(sha256);
    res.setHeader("Content-Type", contentType);
    res.send(bytes);
  }

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
      // What actually signed the last decision, not the raw env value: `mock`, `rubric` and unset
      // all mean the same deterministic scorer, and a caller should see which one it was.
      llmProvider: EvaluatorService.modelId(),
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

  /** Spends the AWARDER key, so it is token-gated and disabled until one is configured. */
  @Post("rfqs/:id/award")
  @UseGuards(TokenGuard)
  award(@Param("id") id: string) {
    return this.awarder.award(Number(id));
  }

  /** Force an indexer pass (the loop also runs on a timer). Token-gated: it costs RPC budget. */
  @Post("reindex")
  @UseGuards(TokenGuard)
  async reindex() {
    await this.indexer.tick();
    return this.health();
  }
}
