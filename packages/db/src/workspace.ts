import { withTenant, withUser } from "./index.js";
import type { RequestRow } from "./requests.js";

/**
 * Reads for the workspace screens.
 *
 * None of these filter by organization in their SQL, and that is the point rather than an
 * oversight: row-level security has already decided what this user can see, so a `WHERE org_id`
 * here would either agree with the policy, in which case it is noise, or disagree with it, in
 * which case one of them is wrong and only the policy is enforced.
 */
export type Organization = {
  id: string;
  name: string;
  country: string;
  can_buy: boolean;
  can_supply: boolean;
  role: string;
};

/**
 * Every organization the user belongs to: the one read that spans organizations, so no active one.
 *
 * `role` is Clerk's role key (`org:admin`, or any custom `org:*` key), read from `clerk_role`,
 * which the membership webhook keeps current. The older `memberships.role` enum is not written by
 * that projection and cannot represent Clerk's custom roles; it is to be dropped in the sweep that
 * removes `users.wallet`, and must not be read for display.
 */
export async function myOrganizations(userId: string): Promise<Organization[]> {
  return withUser(userId, async (q) => {
    const { rows } = await q.query<Organization>(
      `SELECT o.id, o.name, o.country, o.can_buy, o.can_supply, m.clerk_role AS role
         FROM organizations o
         JOIN memberships m ON m.org_id = o.id AND m.user_id = $1
        ORDER BY o.name`,
      [userId],
    );
    return rows;
  });
}

export type RequestSummary = RequestRow & {
  org_name: string;
  response_count: number;
  invited_count: number;
};

/**
 * Requests the active organization can see: the ones it owns, and the ones they were invited to.
 *
 * The counts come from the same tenant-scoped connection, so an invited supplier counts only the
 * responses it is allowed to read, which is its own. A buyer sees all of them. Nothing here has to
 * know that rule; the policies express it once.
 */
export async function visibleRequests(userId: string, orgId: string): Promise<RequestSummary[]> {
  return withTenant(userId, orgId, async (q) => {
    const { rows } = await q.query<RequestSummary>(
      `SELECT r.*, o.name AS org_name,
              (SELECT count(*) FROM request_responses rr WHERE rr.request_id = r.id) AS response_count,
              (SELECT count(*) FROM request_invitations ri WHERE ri.request_id = r.id) AS invited_count
         FROM requests r
         JOIN organizations o ON o.id = r.org_id
        ORDER BY r.created_at DESC`,
    );
    return rows.map((r) => ({
      ...r,
      response_count: Number(r.response_count),
      invited_count: Number(r.invited_count),
    }));
  });
}

export async function getRequest(
  userId: string,
  orgId: string,
  id: string,
): Promise<RequestSummary | null> {
  const all = await visibleRequests(userId, orgId);
  return all.find((r) => r.id === id) ?? null;
}

export type ResponseRow = {
  id: string;
  org_id: string;
  org_name: string;
  body: string;
  created_at: string;
};

export async function responsesFor(
  userId: string,
  orgId: string,
  requestId: string,
): Promise<ResponseRow[]> {
  return withTenant(userId, orgId, async (q) => {
    const { rows } = await q.query<ResponseRow>(
      `SELECT rr.id, rr.org_id, o.name AS org_name, rr.body, rr.created_at
         FROM request_responses rr
         JOIN organizations o ON o.id = rr.org_id
        WHERE rr.request_id = $1
        ORDER BY rr.created_at`,
      [requestId],
    );
    return rows;
  });
}

export type DirectoryEntry = {
  id: string;
  name: string;
  country: string;
  can_supply: boolean;
};

/**
 * Organizations that have chosen to be findable.
 *
 * This is the one query that deliberately reaches outside the caller's own organizations, so it is
 * worth being exact about how far. The policy behind it grants a row in `organizations` and nothing
 * else: a supplier listed here is findable, and its requests, responses, documents and membership
 * remain as invisible as before. Being discoverable is a decision to be contactable, not a decision
 * to be read.
 */
export async function directory(
  userId: string | null,
  opts: { supplying?: boolean } = {},
): Promise<DirectoryEntry[]> {
  return withUser(userId, async (q) => {
    const { rows } = await q.query<DirectoryEntry>(
      `SELECT id, name, country, can_supply
         FROM organizations
        WHERE discoverable
          AND ($1::boolean IS NOT TRUE OR can_supply)
        ORDER BY name`,
      [opts.supplying ?? false],
    );
    return rows;
  });
}
