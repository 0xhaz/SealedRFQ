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
};

export type WorkItem = {
  key: string;
  kind: "reveal" | "award" | "invited";
  urgent: boolean;
  rfqId: number;
  deadline: number;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function deriveWork(rows: WorkRow[], me?: string): WorkItem[] {
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
  }

  return items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.deadline - b.deadline);
}
