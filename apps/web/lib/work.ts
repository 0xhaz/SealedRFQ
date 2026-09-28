/**
 * What a given wallet still has to do.
 *
 * Kept out of the component because each rule is obvious alone and the set is easy to get wrong:
 * an invitation is only worth showing to someone who has not already bid, a reveal reminder is
 * worthless outside the reveal window, and an award prompt must disappear the moment a winner
 * exists. Getting any of them wrong either nags people or, worse, stays silent while a deadline
 * that costs a deposit goes past.
 */
export type WorkRow = {
  id: number;
  phase: string;
  inviteOnly: boolean;
  buyer: string;
  winner: string;
  bidDeadline: number;
  revealDeadline: number;
  awardDeadline: number;
  /** From the chain, for the wallet in question. */
  invited?: boolean;
  hasBid?: boolean;
  revealed?: boolean;
  /** The live engagement, once this RFQ has been awarded and work is under way. */
  engagement?: {
    supplier: string;
    status: string;
    submittedAt: number;
    deliveryDeadline: number;
    acceptanceWindow: number;
    currentMilestone: number;
    milestoneCount: number;
  };
};

export type WorkItem = {
  key: string;
  kind: "reveal" | "award" | "invited" | "deliver" | "lapsed" | "accept" | "answer";
  urgent: boolean;
  rfqId: number;
  deadline: number;
  /** 1-based, for the milestone kinds. Undefined for the bidding ones. */
  milestone?: number;
  milestoneCount?: number;
  /** How many suppliers are waiting on an answer. Only on the `answer` kind. */
  questions?: number;
};

/**
 * How close a deadline has to be before it is shouted about.
 *
 * A reveal is always urgent because missing it forfeits a deposit outright. A delivery deadline is
 * different: it can be weeks away, and nagging from day one trains people to ignore the panel. One
 * day is the point where a supplier can still do something about it.
 */
const SOON = 24 * 60 * 60;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * `now` is injected rather than read here so the milestone rules are testable, and because the
 * caller may prefer chain time. The bidding rules above need no clock: `phase` already came from
 * the chain, which is the authority on whether a window is open.
 */
export function deriveWork(
  rows: WorkRow[],
  me?: string,
  now: number = Math.floor(Date.now() / 1000),
  /** Unanswered question counts by RFQ id, from the agent. Absent when it could not be reached. */
  unanswered: Record<string, number> = {},
): WorkItem[] {
  if (!me) return [];
  const who = me.toLowerCase();
  const items: WorkItem[] = [];

  for (const r of rows) {
    // Losing a deposit is the only consequence here that cannot be undone, so it leads.
    if (r.phase === "Reveal" && r.hasBid && !r.revealed) {
      items.push({
        key: `rev-${r.id}`,
        kind: "reveal",
        urgent: true,
        rfqId: r.id,
        deadline: r.revealDeadline,
      });
    }

    // An invitation nobody can be emailed about, shown to the one wallet it names.
    if (r.phase === "Bidding" && r.inviteOnly && r.invited && !r.hasBid) {
      items.push({
        key: `inv-${r.id}`,
        kind: "invited",
        urgent: false,
        rfqId: r.id,
        deadline: r.bidDeadline,
      });
    }

    if (
      r.phase === "Award" &&
      r.buyer.toLowerCase() === who &&
      r.winner.toLowerCase() === ZERO_ADDRESS
    ) {
      items.push({
        key: `aw-${r.id}`,
        kind: "award",
        urgent: true,
        rfqId: r.id,
        deadline: r.awardDeadline,
      });
    }

    /*
     * A question nobody answered. Not urgent — missing it costs no money — but it is the one item
     * here that somebody else is actively waiting on, and asking closes when bidding does. After
     * that the buyer cannot answer even if they want to, so it is listed only while it is still
     * possible to act on.
     */
    const waiting = unanswered[String(r.id)] ?? 0;
    if (waiting > 0 && r.phase === "Bidding" && r.buyer.toLowerCase() === who) {
      items.push({
        key: `q-${r.id}`,
        kind: "answer",
        urgent: false,
        rfqId: r.id,
        deadline: r.bidDeadline,
        questions: waiting,
      });
    }
  }

  for (const r of rows) {
    const e = r.engagement;
    // Only a live engagement has anything outstanding. A completed or abandoned one is history.
    if (!e || e.status !== "Active") continue;
    const milestone = { milestone: e.currentMilestone + 1, milestoneCount: e.milestoneCount };

    if (e.supplier.toLowerCase() === who && e.submittedAt === 0) {
      // The failure this panel exists to prevent. On testnet RFQ 4 the delivery window closed
      // overnight while the page still read "awaiting delivery", and the first anyone knew of it
      // was a reverted transaction the next morning.
      items.push(
        now > e.deliveryDeadline
          ? {
              key: `lapse-${r.id}`,
              kind: "lapsed",
              urgent: true,
              rfqId: r.id,
              deadline: e.deliveryDeadline,
              ...milestone,
            }
          : {
              key: `del-${r.id}`,
              kind: "deliver",
              urgent: e.deliveryDeadline - now < SOON,
              rfqId: r.id,
              deadline: e.deliveryDeadline,
              ...milestone,
            },
      );
    }

    // The buyer's window to review. Letting it lapse is not a disaster — it pays the supplier
    // automatically — but it should be a decision rather than an oversight.
    if (r.buyer.toLowerCase() === who && e.submittedAt > 0) {
      const releasesAt = e.submittedAt + e.acceptanceWindow;
      if (now < releasesAt) {
        items.push({
          key: `acc-${r.id}`,
          kind: "accept",
          urgent: releasesAt - now < SOON,
          rfqId: r.id,
          deadline: releasesAt,
          ...milestone,
        });
      }
    }
  }

  return items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.deadline - b.deadline);
}
