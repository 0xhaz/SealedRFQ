import { withTenant } from "./index.js";
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

export async function myOrganizations(userId: string): Promise<Organization[]> {
  return withTenant(userId, async (q) => {
    const { rows } = await q.query<Organization>(
      `SELECT o.id, o.name, o.country, o.can_buy, o.can_supply, m.role
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
 * Requests this user can see: the ones their organizations own, and the ones they were invited to.
 *
 * The counts come from the same tenant-scoped connection, so an invited supplier counts only the
 * responses it is allowed to read, which is its own. A buyer sees all of them. Nothing here has to
 * know that rule; the policies express it once.
 */
export async function visibleRequests(userId: string): Promise<RequestSummary[]> {
  return withTenant(userId, async (q) => {
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

export async function getRequest(userId: string, id: string): Promise<RequestSummary | null> {
  const all = await visibleRequests(userId);
  return all.find((r) => r.id === id) ?? null;
}

export type ResponseRow = {
  id: string;
  org_id: string;
  org_name: string;
  body: string;
  created_at: string;
};

export async function responsesFor(userId: string, requestId: string): Promise<ResponseRow[]> {
  return withTenant(userId, async (q) => {
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
