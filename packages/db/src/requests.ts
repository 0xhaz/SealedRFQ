import type { PoolClient } from "pg";
import { withTenant } from "./index.js";

/**
 * The request lifecycle: RFI, RFQ and RFP as one model with different powers.
 *
 * An RFI gathers information. It takes no deposit, starts no escrow, awards nothing and binds no
 * supplier to a price. Turning what it learned into a binding tender is a separate, approved act
 * that produces a *new* request, because a document people answered must not quietly become a
 * document they are held to. The RFI is marked converted and keeps its own responses; the RFQ
 * records which RFI it came from and who approved it.
 */
export type RequestType = "RFI" | "RFQ" | "RFP";
export type RequestStatus = "draft" | "open" | "closed" | "converted" | "cancelled";

export type RequestRow = {
  id: string;
  org_id: string;
  type: RequestType;
  status: RequestStatus;
  title: string;
  parent_rfi_id: string | null;
  invite_only: boolean;
};

/**
 * Which moves are legal.
 *
 * Written down rather than implied by scattered `if` statements, so the shape of the lifecycle is
 * one readable thing and an illegal move is refused in one place. `converted` and `cancelled` are
 * terminal: a tender that has produced a binding RFQ cannot reopen for more answers.
 */
const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  draft: ["open", "cancelled"],
  open: ["closed", "converted", "cancelled"],
  closed: ["converted", "cancelled"],
  converted: [],
  cancelled: [],
};

export class WorkflowError extends Error {}

export async function createRequest(
  userId: string,
  input: { orgId: string; type: RequestType; title: string; inviteOnly?: boolean },
): Promise<RequestRow> {
  return withTenant(userId, async (q) => {
    const { rows } = await q.query<RequestRow>(
      `INSERT INTO requests (org_id, type, title, invite_only)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.orgId, input.type, input.title, input.inviteOnly ?? true],
    );
    // RLS refuses an insert for an organization the user is not in, so reaching here means they are.
    const row = rows[0];
    if (!row) throw new WorkflowError("could not create the request");
    return row;
  });
}

export async function setStatus(
  userId: string,
  requestId: string,
  next: RequestStatus,
): Promise<RequestRow> {
  return withTenant(userId, async (q) => {
    const current = await loadOwned(q, requestId);
    assertTransition(current.status, next);
    const { rows } = await q.query<RequestRow>(
      "UPDATE requests SET status = $2 WHERE id = $1 RETURNING *",
      [requestId, next],
    );
    const row = rows[0];
    if (!row) throw new WorkflowError("could not update the request");
    return row;
  });
}

export async function invite(userId: string, requestId: string, orgId: string): Promise<void> {
  await withTenant(userId, async (q) => {
    await loadOwned(q, requestId); // only the buying organization invites
    await q.query(
      `INSERT INTO request_invitations (request_id, org_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [requestId, orgId],
    );
  });
}

export async function respond(
  userId: string,
  input: { requestId: string; orgId: string; body: string },
): Promise<string> {
  return withTenant(userId, async (q) => {
    // Visible through RLS only if this user's organization owns the request or was invited to it,
    // so an uninvited supplier cannot answer a request it should not know exists.
    const seen = await q.query("SELECT status FROM requests WHERE id = $1", [input.requestId]);
    const row = seen.rows[0] as { status: RequestStatus } | undefined;
    if (!row) throw new WorkflowError("no such request, or you were not invited to it");
    if (row.status !== "open") throw new WorkflowError(`a ${row.status} request takes no responses`);
    const { rows } = await q.query<{ id: string }>(
      "INSERT INTO request_responses (request_id, org_id, body) VALUES ($1, $2, $3) RETURNING id",
      [input.requestId, input.orgId, input.body],
    );
    const created = rows[0];
    if (!created) throw new WorkflowError("could not record the response");
    return created.id;
  });
}

/**
 * Turn an RFI into a binding request, as a new document.
 *
 * The RFI is not edited into an RFQ. Suppliers answered the RFI knowing it bound them to nothing,
 * and rewriting it in place would retroactively change what they agreed to. The new request carries
 * `parent_rfi_id` so the lineage is recoverable, and the RFI moves to `converted` so it stops
 * taking answers.
 */
export async function convertToTender(
  userId: string,
  input: { rfiId: string; type: "RFQ" | "RFP"; title: string },
): Promise<{ tender: RequestRow; rfi: RequestRow }> {
  return withTenant(userId, async (q) => {
    const rfi = await loadOwned(q, input.rfiId);
    if (rfi.type !== "RFI") throw new WorkflowError("only an RFI can be converted");
    assertTransition(rfi.status, "converted");

    const { rows: created } = await q.query<RequestRow>(
      `INSERT INTO requests (org_id, type, title, parent_rfi_id, invite_only, status)
       VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING *`,
      [rfi.org_id, input.type, input.title, rfi.id, rfi.invite_only],
    );
    const { rows: closed } = await q.query<RequestRow>(
      "UPDATE requests SET status = 'converted' WHERE id = $1 RETURNING *",
      [rfi.id],
    );
    const tender = created[0];
    const updated = closed[0];
    if (!tender || !updated) throw new WorkflowError("could not convert the request");
    // Draft on purpose: a converted tender is a proposal to open one, not an open one. Opening it
    // is the separate human act, which is where an approval belongs.
    return { tender, rfi: updated };
  });
}

function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    const allowed = TRANSITIONS[from];
    throw new WorkflowError(
      allowed.length
        ? `a ${from} request cannot become ${to}; it can only become ${allowed.join(" or ")}`
        : `a ${from} request is final and cannot become ${to}`,
    );
  }
}

/** Load a request this user's organization owns. An invited supplier gets no write access here. */
async function loadOwned(q: PoolClient, requestId: string): Promise<RequestRow> {
  const { rows } = await q.query<RequestRow>(
    `SELECT r.* FROM requests r
      WHERE r.id = $1 AND r.org_id IN (SELECT app.member_orgs())`,
    [requestId],
  );
  const row = rows[0];
  if (!row) throw new WorkflowError("no such request, or it is not yours to change");
  return row;
}
