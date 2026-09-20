import { Injectable, Logger } from "@nestjs/common";
import { hashCanonical } from "@sealedrfq/shared";
import { eq, sql } from "drizzle-orm";
import type { Hex } from "viem";
import { db, schema } from "../../db/index.js";
import { ChainService } from "../chain/chain.service.js";
import { EvaluatorService } from "../evaluator/evaluator.service.js";

/**
 * Turns an attested recommendation into an award.
 *
 * The prefilter below is a courtesy, not a control: it mirrors ProcurementPolicy so the agent does
 * not burn gas on an award the contract will reject. The contract is the authority, and the award
 * still reverts on-chain if this check is ever wrong or out of date.
 */
@Injectable()
export class AwarderService {
  private readonly log = new Logger(AwarderService.name);

  constructor(
    private readonly chain: ChainService,
    private readonly evaluator: EvaluatorService,
  ) {}

  async prefilter(rfqId: number, winner: Hex, price: bigint) {
    const rfq = db.select().from(schema.rfqs).where(eq(schema.rfqs.id, rfqId)).get();
    if (!rfq) throw new Error(`RFQ ${rfqId} is not indexed`);
    const policy = await this.chain.publicClient.readContract({
      address: this.chain.deployment.ProcurementPolicy,
      abi: [
        {
          type: "function",
          name: "policy",
          stateMutability: "view",
          inputs: [],
          outputs: [
            {
              type: "tuple",
              components: [
                { name: "maxAwardBps", type: "uint16" },
                { name: "minRevealedBids", type: "uint16" },
                { name: "minDepositBps", type: "uint16" },
                { name: "minBuyerStakeBps", type: "uint16" },
                { name: "maxSupplierShareBps", type: "uint16" },
                { name: "concentrationFloor", type: "uint128" },
              ],
            },
          ],
        },
      ] as const,
      functionName: "policy",
    });

    const revealed = db
      .select()
      .from(schema.bids)
      .where(sql`${schema.bids.rfqId} = ${rfqId} and ${schema.bids.revealed} = 1`)
      .all().length;

    const cap = (BigInt(rfq.budget) * BigInt(policy.maxAwardBps)) / 10_000n;
    const requiredDeposit = (price * BigInt(policy.minDepositBps) + 9_999n) / 10_000n;

    const problems: string[] = [];
    if (price > cap) problems.push(`price ${price} exceeds the policy cap ${cap}`);
    if (revealed < policy.minRevealedBids) {
      problems.push(`only ${revealed} revealed bids, policy needs ${policy.minRevealedBids}`);
    }
    if (BigInt(rfq.depositAmount) < requiredDeposit) {
      problems.push(`deposit ${rfq.depositAmount} is below the required ${requiredDeposit}`);
    }
    return problems;
  }

  /** Evaluate if needed, then award the recommended bidder. */
  async award(rfqId: number) {
    const stored = db
      .select()
      .from(schema.attestations)
      .where(
        sql`${schema.attestations.rfqId} = ${rfqId} and ${schema.attestations.kind} = 'AWARD_RECOMMENDATION'`,
      )
      .get();

    const attested = stored?.memo
      ? { memo: JSON.parse(stored.memo), payloadHash: stored.payloadHash as Hex }
      : await this.evaluator.evaluateAndAttest(rfqId).then((r) => ({
          memo: r.memo,
          payloadHash: r.payloadHash,
        }));

    const winner = attested.memo.decision?.bidder as Hex | undefined;
    if (!winner) throw new Error(`No award recommended for RFQ ${rfqId}`);
    const price = BigInt(attested.memo.decision.amount ?? "0");

    const problems = await this.prefilter(rfqId, winner, price);
    if (problems.length) {
      this.log.warn(`skipping award for RFQ ${rfqId}: ${problems.join("; ")}`);
      return { awarded: false, problems, winner, payloadHash: attested.payloadHash };
    }

    // Re-hash the stored memo rather than trusting the stored hash: the anchor is the memo.
    const payloadHash = hashCanonical(attested.memo);
    const rfq = db.select().from(schema.rfqs).where(eq(schema.rfqs.id, rfqId)).get();
    const tx = await this.chain.send("AWARDER", {
      ...this.chain.registry,
      functionName: "award",
      args: [BigInt(rfqId), winner, payloadHash, rfq?.rubricHash as Hex],
    });
    this.log.log(`awarded RFQ ${rfqId} to ${winner}: ${tx}`);
    return { awarded: true, problems: [], winner, payloadHash, tx };
  }
}
