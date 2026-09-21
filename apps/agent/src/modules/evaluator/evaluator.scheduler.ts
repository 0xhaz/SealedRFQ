import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { AwarderService } from "../awarder/awarder.service.js";
import { ChainService } from "../chain/chain.service.js";
import { EvaluatorService } from "./evaluator.service.js";

const TICK_MS = Number(process.env.EVALUATOR_TICK_MS ?? 15_000);
/** Awarding is the buyer's call by default; set AUTO_AWARD=true to let the awarder key act alone. */
const AUTO_AWARD = process.env.AUTO_AWARD === "true";

/**
 * Scores an RFQ as soon as its reveal window closes.
 *
 * Without this the evaluation only existed if someone called the endpoint by hand, so a buyer
 * watching the site would wait for a memo that was never coming. An award cannot be sent until a
 * recommendation is anchored, so the evaluation has to happen on its own for the flow to work.
 */
@Injectable()
export class EvaluatorScheduler implements OnModuleInit {
  private readonly log = new Logger(EvaluatorScheduler.name);
  private running = false;

  constructor(
    private readonly chain: ChainService,
    private readonly evaluator: EvaluatorService,
    private readonly awarder: AwarderService,
  ) {}

  onModuleInit() {
    if (process.env.EVALUATOR_ENABLED === "false") return;
    if (!this.chain.hasKey("EVALUATOR")) {
      this.log.warn("no EVALUATOR key: RFQs will not be scored by this agent");
      return;
    }
    void this.loop();
  }

  private async loop() {
    while (true) {
      try {
        await this.tick();
      } catch (e) {
        this.log.warn(`evaluator tick failed: ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Phases are judged by block.timestamp, so ask the chain what time it is. The host clock can
      // differ — a local chain gets warped, and any node can drift from the machine running this.
      const now = Number(
        (await this.chain.publicClient.getBlock({ blockTag: "latest" })).timestamp,
      );
      // Candidates: reveal window closed, award window still open, nothing awarded yet.
      const candidates = db
        .select()
        .from(schema.rfqs)
        .where(
          sql`${schema.rfqs.revealDeadline} <= ${now} and ${schema.rfqs.awardDeadline} > ${now} and ${schema.rfqs.winner} is null`,
        )
        .all();

      for (const rfq of candidates) {
        const alreadyScored = db
          .select()
          .from(schema.attestations)
          .where(
            sql`${schema.attestations.rfqId} = ${rfq.id} and ${schema.attestations.memo} is not null`,
          )
          .get();
        if (alreadyScored) continue;

        const revealed = db
          .select()
          .from(schema.bids)
          .where(sql`${schema.bids.rfqId} = ${rfq.id} and ${schema.bids.revealed} = 1`)
          .all();
        if (revealed.length === 0) continue; // nothing to score; closeNoAward will refund

        try {
          const { memo, tx } = await this.evaluator.evaluateAndAttest(rfq.id);
          this.log.log(
            `scored RFQ ${rfq.id}: ${memo.decision.outcome}${
              memo.decision.bidder ? ` ${memo.decision.bidder}` : ""
            }${tx ? ` (${tx})` : ""}`,
          );
          if (AUTO_AWARD && memo.decision.bidder) await this.awarder.award(rfq.id);
        } catch (e) {
          // One bad RFQ must not stop the others being scored.
          this.log.warn(`could not score RFQ ${rfq.id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
