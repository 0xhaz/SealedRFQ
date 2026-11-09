/**
 * Whether this deployment is accepting new commitments.
 *
 * Set while V2 is built, so the site stops inviting tenders against contracts that are no longer
 * being developed. Three rules shape what "paused" is allowed to mean:
 *
 * 1. It defaults to `live`. A pause has to be switched on deliberately, because a typo in an
 *    environment variable must not be able to take the site down by accident.
 * 2. It blocks **new commitments only**: posting a tender, and committing or revealing a bid.
 *    Money already committed must still be able to come out. The V2 architecture's own legacy-safety
 *    gate says a new deployment must not hide withdrawal paths, and a maintenance mode that also
 *    freezes withdrawals is precisely the thing that warns against. Balances are zero today, which
 *    is exactly why this is cheap to get right now rather than later.
 * 3. It never blocks reading. The board, the tender pages, the decision memos and the audit view
 *    stay up. A project whose whole claim is that its decisions are checkable cannot make them
 *    uncheckable while it rebuilds.
 */
export type SiteStatus = "live" | "paused";

export const SITE_STATUS: SiteStatus =
  process.env.NEXT_PUBLIC_SITE_STATUS === "paused" ? "paused" : "live";

export const isPaused = SITE_STATUS === "paused";

/** Why it is paused, shown wherever an action is refused. One place, so the reason cannot drift. */
export const PAUSE_REASON = {
  headline: "Not accepting new tenders",
  body:
    "This deployment is paused while the next version is built. The contracts stay on-chain and " +
    "everything here stays readable: tenders, decision memos and the audit trail. Payouts and " +
    "refunds still work, so anything already committed can still be withdrawn.",
} as const;
