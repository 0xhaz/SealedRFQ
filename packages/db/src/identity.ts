/**
 * Writes the Postgres projection of Clerk's users, organizations and memberships.
 *
 * Every write goes through a SECURITY DEFINER function in schema `app` (migration 0009), called
 * on the ordinary application pool. The memberships table is what `app.active_org()` trusts, so
 * the application role has no direct write access to it; these functions are the only door, and
 * the ordering rule (an event applies only if it is at least as new as the stored row) lives in
 * their SQL where concurrent deliveries cannot race it.
 */
import { pool, withUser } from "./index.js";

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

/**
 * Attach a wallet to a user, once control of it has been proven by a signed challenge.
 *
 * Check, then spend, then write, in one transaction. The challenge is consumed before the insert
 * so a replayed nonce links nothing; and it must have been issued for this address, or a nonce
 * obtained for a wallet you control could be spent to claim one you do not. The mismatch throws
 * after the spend, which rolls the spend back with everything else, so an honest retry is not
 * punished for a caller's bug. Verifying the signature itself is the caller's job.
 *
 * Runs as the user, not an organization: a wallet belongs to a person.
 */
export async function linkWallet(input: {
  userId: string;
  chainNamespace: string;
  chainId: number;
  address: string;
  challengeId: string;
}): Promise<string> {
  // Only EVM addresses are case-insensitive; a base58 address lowercased is a different address.
  const address = input.chainNamespace === "eip155" ? input.address.toLowerCase() : input.address;
  return withUser(input.userId, async (q) => {
    const spent = await q.query("SELECT wallet FROM app.consume_challenge($1)", [
      input.challengeId,
    ]);
    if (spent.rowCount === 0) throw new Error("linkWallet: challenge is unknown, spent or expired");
    if (spent.rows[0].wallet.toLowerCase() !== address.toLowerCase()) {
      throw new Error("linkWallet: challenge was issued for a different address");
    }
    const { rows } = await q.query(
      `INSERT INTO wallet_links
         (user_id, chain_namespace, chain_id, address, challenge_id, verified_at)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [input.userId, input.chainNamespace, input.chainId, address, input.challengeId],
    );
    return rows[0].id;
  });
}
