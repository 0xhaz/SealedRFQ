import { upsertOrganization, upsertUser } from "@sealedrfq/db/identity";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cache } from "react";

/** `orgSegment` is a Clerk slug *or* a Clerk organization id; `segment` below says why. */
export type Tenant = { userId: string; orgId: string; orgSegment: string; role: string };

/**
 * The segment that names this organization in a URL.
 *
 * Clerk slugs are optional: an organization made through the Backend API or CLI can be active with
 * no slug at all. Falling back to the id keeps such a session usable instead of dead-ending, and
 * stays collision-free because an id cannot equal another organization's slug.
 *
 * Called a segment rather than a slug because it is sometimes not one. Anything building an
 * `/app/…` link has to apply this same rule: `components/v2/OrgSwitcher.tsx` was written against
 * Clerk's `:slug` placeholder and dead-ended on `/app//inbox` for a slugless organization.
 */
const segment = (orgSlug: string | null | undefined, orgId: string) => orgSlug || orgId;

async function resolve(
  s: { userId: string; orgId: string; orgRole?: string | null },
  segmentValue: string,
): Promise<Tenant> {
  // Upserted rather than looked up, so a first sign-in does not race the webhook. No name is passed:
  // auth() does not carry one, and the webhook supplies it.
  const [userId, orgId] = await Promise.all([upsertUser(s.userId), upsertOrganization(s.orgId)]);
  return { userId, orgId, orgSegment: segmentValue, role: (s.orgRole ?? "").replace(/^org:/, "") };
}

/**
 * The single place a Clerk session becomes a Postgres tenant.
 *
 * Access rests on two independent facts: Clerk says this session is acting for an organization,
 * and Postgres holds a membership row for that user in that organization. `app.active_org()` is
 * the intersection. That only holds if the organization comes from the verified session here, and
 * never from the membership projection: reading it back out of the projection would make both
 * gates the same gate, and a resurrected membership row would then grant access on its own.
 *
 * Returns null instead of redirecting, for server actions, where a redirect would be swallowed
 * into an error result. Memoised per request so five actions in one render pay for one lookup.
 */
export const sessionTenant = cache(async (): Promise<Tenant | null> => {
  const s = await auth();
  if (!s.userId || !s.orgId) return null;
  return resolve({ ...s, userId: s.userId, orgId: s.orgId }, segment(s.orgSlug, s.orgId));
});

/**
 * Resolve the tenant for the URL's organization, or redirect.
 *
 * A segment that differs from the session's is sent to the session's own inbox without being looked
 * up, so a real foreign organization and one that never existed are indistinguishable. Doing the
 * lookup would turn the redirect into an oracle for other tenants' slugs.
 */
export const requireOrg = cache(async (slug: string): Promise<Tenant> => {
  const s = await auth();
  // Clerk treats a session that still owes the organization task as signed out, so with this
  // instance's configuration that is where a user without an organization arrives: here, not at
  // the branch below. redirectToSignIn knows the instance's sign-in URL and the pending-task page,
  // which a hard-coded path would not.
  if (!s.userId) return s.redirectToSignIn();
  // Defence in depth: this configuration enforces the task, so a signed-in session without an
  // organization should not reach here, but an instance that stops enforcing it would.
  if (!s.orgId) redirect("/app/choose-organization");
  const seg = segment(s.orgSlug, s.orgId);
  if (seg !== slug) redirect(`/app/${seg}/inbox`);
  return resolve({ ...s, userId: s.userId, orgId: s.orgId }, seg);
});
