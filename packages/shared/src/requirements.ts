import { z } from "zod";

/**
 * Buyer requirements that a revealed bid can be screened against.
 *
 * These ride in the RFQ metadata document, whose sha256 is fixed on-chain when the RFQ opens, so
 * the bar cannot be moved after bids are in. They are checked at *reveal*, never at commit: until a
 * bid is revealed it is a hash and nobody can read it, including this software. Screening sealed
 * bids would mean an operator who can see them before the deadline, which is the thing this project
 * exists to make impossible.
 *
 * The split below is the honest part. `maxDeliveryDays` and `minCompletedEngagements` are decided
 * by arithmetic on values the chain now holds, so any losing bidder can recompute the verdict and
 * get the same answer. Anything else a buyer wants to demand — a certification, a warranty length,
 * payment terms — is not present in a bid and cannot be proved by one. Those are carried as
 * `attestations` and reported as *unverified*, never silently treated as passed. A screening tool
 * that quietly marks "ISO 9001: OK" because the supplier ticked a box is worse than one that says
 * plainly that a human still has to look.
 */
export const Requirements = z.object({
  /** Reject a bid promising delivery slower than this. Checked against the revealed deliveryDays. */
  maxDeliveryDays: z.number().int().positive().optional(),
  /** Completed engagements on this deployment, counted from the chain's own history. */
  minCompletedEngagements: z.number().int().nonnegative().optional(),
  /** Stated requirements no bid field can prove. Surfaced for a human; never auto-passed. */
  attestations: z.array(z.string().min(1)).optional(),
});
export type Requirements = z.infer<typeof Requirements>;

export type RequirementResult = {
  /** Checkable and failed — these belong in redFlags. */
  failed: string[];
  /** Stated but unprovable from a bid — these need a person. */
  unverified: string[];
};

export type BidFacts = {
  deliveryDays: number;
  /** Completed engagements this supplier already has on this deployment. */
  completed: number;
};

/**
 * Screens one revealed bid. Deterministic: same inputs, same output, forever — which is what lets
 * a rejected supplier check the reasoning instead of taking it on trust.
 */
export function checkRequirements(bid: BidFacts, requirements?: unknown): RequirementResult {
  const parsed = Requirements.safeParse(requirements ?? {});
  if (!parsed.success) return { failed: [], unverified: [] };
  const r = parsed.data;

  const failed: string[] = [];
  if (r.maxDeliveryDays !== undefined && bid.deliveryDays > r.maxDeliveryDays) {
    failed.push(
      `delivery of ${bid.deliveryDays} days is slower than the required ${r.maxDeliveryDays}`,
    );
  }
  if (r.minCompletedEngagements !== undefined && bid.completed < r.minCompletedEngagements) {
    failed.push(
      `${bid.completed} completed engagement(s) here, below the required ${r.minCompletedEngagements}`,
    );
  }

  return {
    failed,
    unverified: (r.attestations ?? []).map(
      (a) => `${a} — stated requirement, not provable from a bid`,
    ),
  };
}
