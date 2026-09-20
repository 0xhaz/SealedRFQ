import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { type Abi, encodeAbiParameters, keccak256, parseAbiParameters, parseEventLogs } from "viem";
import { db, schema } from "../../db/index.js";
import { ChainService } from "../chain/chain.service.js";

/**
 * Two Arc RPC limits shape this indexer, and one of them lies about itself.
 *
 * 1. `eth_getLogs` rejects a topic filter that ORs more than ~8 event signatures, reporting it as
 *    "requested range too large" no matter how narrow the block span is (measured 2026-09-20:
 *    8 topics fine, 12 refused, even across 120 blocks). viem's getContractEvents sends every
 *    event in the ABI as one topic array — 14 for the registry — so it could never succeed. We
 *    therefore filter by address only and decode locally.
 * 2. The block span genuinely is limited, so chunks adapt: halve on rejection, ease back up after.
 */
const MAX_CHUNK = 5_000n;
const MIN_CHUNK = 128n;
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 4_000);

const label = (hex: string) =>
  Buffer.from(hex.slice(2).replace(/(00)+$/, ""), "hex")
    .toString("utf8")
    .replace(/[^\x20-\x7e]/g, "");

/**
 * Reads the contracts' events into SQLite so the web app and MCP tools can query history without
 * scanning the chain. Arc produces ~11 blocks a second, so a full rescan is never an option: the
 * cursor is persisted and only new blocks are read.
 *
 * Note both USDC Transfer events exist on Arc (EIP-7708 native at 18 decimals and the ERC-20 view
 * at 6). We index neither — balances come from contract state — which sidesteps double counting.
 */
@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly log = new Logger(IndexerService.name);
  private running = false;
  private chunk = MAX_CHUNK;

  constructor(private readonly chain: ChainService) {}

  onModuleInit() {
    if (process.env.INDEXER_ENABLED === "false") return;
    void this.loop();
  }

  private async loop() {
    while (true) {
      try {
        await this.tick();
      } catch (e) {
        this.log.warn(`indexer tick failed: ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const latest = await this.chain.publicClient.getBlockNumber();
      let from = BigInt(this.cursor() || this.chain.deployment.startBlock);
      while (from <= latest) {
        const to = from + this.chunk - 1n > latest ? latest : from + this.chunk - 1n;
        try {
          await this.readRange(from, to);
        } catch (e) {
          if (this.isRangeTooLarge(e) && this.chunk > MIN_CHUNK) {
            this.chunk = this.chunk / 2n > MIN_CHUNK ? this.chunk / 2n : MIN_CHUNK;
            this.log.log(`RPC refused the range; retrying with ${this.chunk}-block chunks`);
            continue; // same `from`, smaller span
          }
          throw e;
        }
        this.setCursor(to);
        from = to + 1n;
        // Creep back up so a single busy moment does not pin us at the floor forever.
        if (this.chunk < MAX_CHUNK)
          this.chunk = this.chunk * 2n > MAX_CHUNK ? MAX_CHUNK : this.chunk * 2n;
      }
    } finally {
      this.running = false;
    }
  }

  private isRangeTooLarge(e: unknown) {
    const msg = e instanceof Error ? `${e.message}` : String(e);
    return /range too large|limit exceeded|too many|query timeout|-32012/i.test(msg);
  }

  private cursor(): number {
    const row = db.select().from(schema.cursor).where(eq(schema.cursor.id, 1)).get();
    return row?.lastBlock ?? 0;
  }

  private setCursor(block: bigint) {
    db.insert(schema.cursor)
      .values({ id: 1, lastBlock: Number(block) })
      .onConflictDoUpdate({ target: schema.cursor.id, set: { lastBlock: Number(block) } })
      .run();
  }

  /** Address-only filter, decoded client-side (see the topic-limit note above). */
  private async logsFor(
    contract: { address: `0x${string}`; abi: readonly unknown[] },
    fromBlock: bigint,
    toBlock: bigint,
  ) {
    const logs = await this.chain.publicClient.getLogs({
      address: contract.address,
      fromBlock,
      toBlock,
    });
    return parseEventLogs({ abi: contract.abi as Abi, logs, strict: false });
  }

  private async readRange(fromBlock: bigint, toBlock: bigint) {
    const [registryLogs, adapterLogs, attestLogs] = await Promise.all([
      this.logsFor(this.chain.registry, fromBlock, toBlock),
      this.logsFor(this.chain.adapter, fromBlock, toBlock),
      this.logsFor(this.chain.attestationLog, fromBlock, toBlock),
    ]);

    for (const l of registryLogs) this.applyRegistry(l);
    for (const l of adapterLogs) this.applyAdapter(l);
    for (const l of attestLogs) this.applyAttestation(l);

    const total = registryLogs.length + adapterLogs.length + attestLogs.length;
    if (total) this.log.log(`indexed ${total} events in blocks ${fromBlock}–${toBlock}`);
  }

  // biome-ignore lint/suspicious/noExplicitAny: viem's decoded log union is per-event
  private applyRegistry(l: any) {
    const a = l.args ?? {};
    switch (l.eventName) {
      case "RFQCreated":
        db.insert(schema.rfqs)
          .values({
            id: Number(a.rfqId),
            buyer: a.buyer,
            category: label(a.category ?? "0x"),
            budget: String(a.budget),
            depositAmount: String(a.depositAmount),
            buyerStake: String(a.buyerStake),
            rubricHash: a.rubricHash,
            metadataURI: a.metadataURI ?? "",
            bidDeadline: Number(a.bidDeadline),
            revealDeadline: Number(a.revealDeadline),
            awardDeadline: Number(a.awardDeadline),
            createdTx: l.transactionHash,
            createdBlock: Number(l.blockNumber),
          })
          .onConflictDoNothing()
          .run();
        break;
      case "BidCommitted":
        db.insert(schema.bids)
          .values({
            rfqId: Number(a.rfqId),
            bidder: a.bidder,
            commitHash: a.commitHash,
            committedTx: l.transactionHash,
          })
          .onConflictDoUpdate({
            target: [schema.bids.rfqId, schema.bids.bidder],
            set: { commitHash: a.commitHash, committedTx: l.transactionHash },
          })
          .run();
        break;
      case "BidRevealed":
        db.update(schema.bids)
          .set({
            revealed: true,
            price: String(a.price),
            deliveryDays: Number(a.deliveryDays),
            proposalHash: a.proposalHash ?? null,
            revealedTx: l.transactionHash,
          })
          .where(
            sql`${schema.bids.rfqId} = ${Number(a.rfqId)} and ${schema.bids.bidder} = ${a.bidder}`,
          )
          .run();
        break;
      case "RFQAwarded":
        db.update(schema.rfqs)
          .set({
            winner: a.winner,
            awardPrice: String(a.price),
            evaluationHash: a.evaluationHash,
          })
          .where(eq(schema.rfqs.id, Number(a.rfqId)))
          .run();
        break;
      default:
        break;
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: viem's decoded log union is per-event
  private applyAdapter(l: any) {
    const a = l.args ?? {};
    const rfqId = Number(a.rfqId);
    switch (l.eventName) {
      case "EngagementStarted":
        db.insert(schema.engagements)
          .values({
            rfqId,
            supplier: a.supplier,
            price: String(a.price),
            milestoneCount: Number(a.milestones),
            startedTx: l.transactionHash,
          })
          .onConflictDoNothing()
          .run();
        break;
      case "MilestoneFunded":
        db.insert(schema.milestones)
          .values({
            rfqId,
            idx: Number(a.index),
            jobId: String(a.jobId),
            jobBudget: String(a.jobBudget),
            retention: String(a.retention),
            fundedTx: l.transactionHash,
          })
          .onConflictDoNothing()
          .run();
        break;
      case "MilestoneSubmitted":
        this.updateMilestone(rfqId, Number(a.index), {
          state: "Submitted",
          deliverable: a.deliverable,
          submittedTx: l.transactionHash,
        });
        break;
      case "MilestoneAccepted":
        this.updateMilestone(rfqId, Number(a.index), {
          state: "Accepted",
          reason: a.reason,
          automatic: Boolean(a.automatic),
          settledTx: l.transactionHash,
        });
        break;
      case "MilestoneRejected":
        this.updateMilestone(rfqId, Number(a.index), {
          state: "Rejected",
          reason: a.reason,
          settledTx: l.transactionHash,
        });
        db.update(schema.engagements)
          .set({ status: "Rejected" })
          .where(eq(schema.engagements.rfqId, rfqId))
          .run();
        break;
      case "EngagementCompleted":
        db.update(schema.engagements)
          .set({ status: "Completed" })
          .where(eq(schema.engagements.rfqId, rfqId))
          .run();
        break;
      case "EngagementAbandoned":
        db.update(schema.engagements)
          .set({ status: "Abandoned" })
          .where(eq(schema.engagements.rfqId, rfqId))
          .run();
        break;
      default:
        break;
    }
  }

  private updateMilestone(rfqId: number, idx: number, set: Record<string, unknown>) {
    db.update(schema.milestones)
      .set(set)
      .where(sql`${schema.milestones.rfqId} = ${rfqId} and ${schema.milestones.idx} = ${idx}`)
      .run();
  }

  // biome-ignore lint/suspicious/noExplicitAny: viem's decoded log union is per-event
  private applyAttestation(l: any) {
    // The log also emits AccessControl and KindRoleSet events; only Attested carries a memo hash.
    if (l.eventName !== "Attested") return;
    const a = l.args ?? {};
    const subjectId = String(a.subjectId);
    db.insert(schema.attestations)
      .values({
        subjectId,
        payloadHash: a.payloadHash,
        kind: label(a.kind ?? "0x"),
        actor: a.actor,
        model: label(a.model ?? "0x"),
        tx: l.transactionHash,
        ts: Number(l.blockNumber),
        ...this.resolveSubject(subjectId),
      })
      .onConflictDoNothing()
      .run();
  }

  /**
   * An attestation's subject is either an RFQ id (bid evaluations) or
   * keccak256(rfqId, winner) (award decisions, which bind the recommendation to one bidder).
   * Recover the RFQ either way so the API can answer "show me the reasoning for RFQ n".
   */
  private resolveSubject(subjectId: string): { rfqId?: number; winner?: string } {
    const asNumber = Number(subjectId);
    if (Number.isSafeInteger(asNumber) && asNumber > 0 && asNumber < 2 ** 32) {
      return { rfqId: asNumber };
    }
    const pairs = db
      .select({ rfqId: schema.bids.rfqId, bidder: schema.bids.bidder })
      .from(schema.bids)
      .all();
    for (const { rfqId, bidder } of pairs) {
      const subject = BigInt(
        keccak256(
          encodeAbiParameters(parseAbiParameters("uint256, address"), [
            BigInt(rfqId),
            bidder as `0x${string}`,
          ]),
        ),
      ).toString();
      if (subject === subjectId) return { rfqId, winner: bidder };
    }
    return {};
  }
}
