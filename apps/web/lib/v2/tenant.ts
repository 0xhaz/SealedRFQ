import { upsertOrganization, upsertUser } from "@sealedrfq/db/identity";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cache } from "react";

export type Tenant = { userId: string; orgId: string; orgSlug: string; role: string };

type Session = Awaited<ReturnType<typeof auth>>;

async function resolve(s: Session & { userId: string; orgId: string; orgSlug: string }): Promise<Tenant> {
  // Upserted rather than looked up, so a first sign-in does not race the webhook. No name is passed:
  // auth() does not carry one, and the webhook supplies it.
  const [userId, orgId] = await Promise.all([upsertUser(s.userId), upsertOrganization(s.orgId)]);
  return { userId, orgId, orgSlug: s.orgSlug, role: (s.orgRole ?? "").replace(/^org:/, "") };
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
 * into an error result.
 */
export async function sessionTenant(): Promise<Tenant | null> {
  const s = await auth();
  if (!s.userId || !s.orgId || !s.orgSlug) return null;
  return resolve({ ...s, userId: s.userId, orgId: s.orgId, orgSlug: s.orgSlug });
}

/**
 * Resolve the tenant for the URL's organization, or redirect.
 *
 * A slug that differs from the session's is sent to the session's own inbox without being looked
 * up, so a real foreign organization and one that never existed are indistinguishable. Doing the
 * lookup would turn the redirect into an oracle for other tenants' slugs.
 */
export const requireOrg = cache(async (slug: string): Promise<Tenant> => {
  const s = await auth();
  if (!s.userId) redirect("/sign-in");
  if (!s.orgId || !s.orgSlug) redirect("/app/choose-organization");
  if (s.orgSlug !== slug) redirect(`/app/${s.orgSlug}/inbox`);
  return resolve({ ...s, userId: s.userId, orgId: s.orgId, orgSlug: s.orgSlug });
});
