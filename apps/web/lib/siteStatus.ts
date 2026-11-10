/**
 * The banner on the landing page: whether this deployment says it is open for new tenders.
 *
 * It is a label and nothing more. It was written while V1 was live to gate posting, committing and
 * revealing, and it is kept honest here rather than describing gates it no longer has: those
 * surfaces were retired with V1, so there is nothing left for a flag to refuse. Reducing it to a
 * label was the alternative to deleting it, and it earns its place only as long as it over-claims
 * nothing — `app/page.tsx` is its one consumer.
 *
 * It defaults to `live`, which is the one behaviour worth keeping deliberate: a typo in an
 * environment variable must not be able to take the site's own description down with it.
 */
export type SiteStatus = "live" | "paused";

export const SITE_STATUS: SiteStatus =
  process.env.NEXT_PUBLIC_SITE_STATUS === "paused" ? "paused" : "live";

export const isPaused = SITE_STATUS === "paused";

/** What the banner says when paused. One place, so the reason cannot drift. */
export const PAUSE_REASON = {
  headline: "Not accepting new tenders",
  body:
    "This deployment is paused while the next version is built. The V1 contracts stay on-chain " +
    "and callable by anyone, and the record stays readable: the evidence pack, the decision " +
    "memos and the audit view.",
} as const;
