/**
 * Writes the Postgres projection of Clerk's users, organizations and memberships.
 *
 * Every write goes through a SECURITY DEFINER function in schema `app` (migration 0009), called
 * on the ordinary application pool. The memberships table is what `app.active_org()` trusts, so
 * the application role has no direct write access to it; these functions are the only door, and
 * the ordering rule (an event applies only if it is at least as new as the stored row) lives in
 * their SQL where concurrent deliveries cannot race it.
 */
import { pool } from "./index.js";

/** The Postgres id for a Clerk user, creating the row if the webhook has not delivered it yet. */
export async function upsertUser(clerkUserId: string): Promise<string> {
  const { rows } = await pool.query("SELECT app.sync_user($1) AS id", [clerkUserId]);
  return rows[0].id;
}

/**
 * The Postgres id for a Clerk organization. `name` is optional because a session carries the
 * organization id but not its name; omitting it never overwrites a name already stored, and a
 * new row falls back to the id until the organization webhook supplies the real one.
 */
export async function upsertOrganization(clerkOrgId: string, name?: string): Promise<string> {
  // The one-argument form cannot rename, so a session-driven caller cannot overwrite a real name.
  const { rows } =
    name === undefined
      ? await pool.query("SELECT app.sync_organization($1) AS id", [clerkOrgId])
      : await pool.query("SELECT app.sync_organization($1, $2) AS id", [clerkOrgId, name]);
  return rows[0].id;
}

export async function upsertMembership(input: {
  clerkUserId: string;
  clerkOrgId: string;
  role: string;
  at: Date;
}): Promise<void> {
  await pool.query("SELECT app.sync_membership($1, $2, $3, $4)", [
    input.clerkUserId,
    input.clerkOrgId,
    input.role,
    input.at,
  ]);
}

export async function removeMembership(input: {
  clerkUserId: string;
  clerkOrgId: string;
  at: Date;
}): Promise<void> {
  await pool.query("SELECT app.remove_membership($1, $2, $3)", [
    input.clerkUserId,
    input.clerkOrgId,
    input.at,
  ]);
}

/** The part of a verified Clerk webhook event this projection reads. */
export type ClerkEvent = {
  type: string;
  timestamp: number;
  data: {
    id?: string;
    name?: string;
    role?: string;
    organization?: { id?: string; name?: string };
    public_user_data?: { user_id?: string };
  };
};

/**
 * Apply one already-verified event. Lives here rather than in the route so it can be tested
 * against the database from this package: a route test that truncates shared tables from another
 * package would race this package's suites on the one database.
 *
 * "ignored" is for types we do not project; "malformed" is a signed event missing what it needs.
 */
export async function applyClerkEvent(
  event: ClerkEvent,
): Promise<"applied" | "ignored" | "malformed"> {
  const at = new Date(event.timestamp);
  const d = event.data;
  switch (event.type) {
    case "user.created":
    case "user.updated":
      if (!d?.id) return "malformed";
      await upsertUser(d.id);
      return "applied";
    case "organization.created":
    case "organization.updated":
      if (!d?.id) return "malformed";
      await upsertOrganization(d.id, d.name);
      return "applied";
    case "organizationMembership.created":
    case "organizationMembership.updated":
    case "organizationMembership.deleted": {
      const clerkUserId = d?.public_user_data?.user_id;
      const clerkOrgId = d?.organization?.id;
      if (!clerkUserId || !clerkOrgId) return "malformed";
      if (event.type === "organizationMembership.deleted") {
        await removeMembership({ clerkUserId, clerkOrgId, at });
        return "applied";
      }
      if (!d.role) return "malformed";
      // Every membership event carries the organization in full; use its name so an organization
      // first seen through a membership is not left named after its id.
      await upsertOrganization(clerkOrgId, d.organization?.name);
      await upsertMembership({ clerkUserId, clerkOrgId, role: d.role, at });
      return "applied";
    }
    default:
      return "ignored";
  }
}
