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
  const { rows } = await pool.query("SELECT app.sync_organization($1, $2) AS id", [
    clerkOrgId,
    name ?? null,
  ]);
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
