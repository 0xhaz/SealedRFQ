"use server";

import { activeOrgId, currentUserId } from "@/lib/v2/session";
import {
  convertToTender,
  createRequest,
  invite,
  respond,
  setStatus,
} from "@sealedrfq/db/requests";
import { revalidatePath } from "next/cache";

/**
 * Server actions for the workspace.
 *
 * Each one reads the session itself rather than taking a user id from the caller. A user id passed
 * in from a form is a user id an attacker can change, and the whole tenant model rests on that
 * value being the server's own belief about who is asking.
 */
async function requireUser(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new Error("you are not signed in");
  return userId;
}

/** The user and the organization they act for; both are the server's belief, never the form's. */
async function requireTenant(): Promise<{ userId: string; orgId: string }> {
  const userId = await requireUser();
  const orgId = await activeOrgId(userId);
  if (!orgId) throw new Error("no active organization");
  return { userId, orgId };
}

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const fail = (e: unknown): ActionResult => ({
  ok: false,
  // The database's own refusals are written for a person and safe to show; anything else is not.
  error: e instanceof Error ? e.message : "something went wrong",
});

export async function createRequestAction(form: FormData): Promise<ActionResult> {
  try {
    const { userId, orgId } = await requireTenant();
    const title = String(form.get("title") ?? "").trim();
    if (!title) return { ok: false, error: "a request needs a title" };
    const row = await createRequest(userId, {
      // Not the form's orgId: the organization acted as is the session's, so a request cannot be
      // created somewhere the user then cannot see or act on.
      orgId,
      type: form.get("type") === "RFQ" ? "RFQ" : "RFI",
      title,
    });
    revalidatePath("/workspace");
    return { ok: true, id: row.id };
  } catch (e) {
    return fail(e);
  }
}

export async function setStatusAction(requestId: string, next: string): Promise<ActionResult> {
  try {
    const { userId, orgId } = await requireTenant();
    // The database holds the state machine; this does not second-guess which moves are legal.
    await setStatus(userId, orgId, requestId, next as never);
    revalidatePath(`/workspace/requests/${requestId}`);
    revalidatePath("/workspace");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function inviteAction(requestId: string, inviteeOrgId: string): Promise<ActionResult> {
  try {
    const tenant = await requireTenant();
    await invite(tenant.userId, tenant.orgId, requestId, inviteeOrgId);
    revalidatePath(`/workspace/requests/${requestId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function respondAction(
  requestId: string,
  _formOrgId: string,
  body: string,
): Promise<ActionResult> {
  try {
    // Responds as the session's organization; the argument is kept only so callers need not change.
    const { userId, orgId } = await requireTenant();
    const id = await respond(userId, { requestId, orgId, body });
    revalidatePath(`/workspace/requests/${requestId}`);
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Turn an RFI into a tender. Produces a new request rather than editing this one, because
 * suppliers answered the RFI knowing it bound them to nothing.
 */
export async function convertAction(rfiId: string, title: string): Promise<ActionResult> {
  try {
    const { userId, orgId } = await requireTenant();
    const { tender } = await convertToTender(userId, orgId, {
      rfiId,
      type: "RFQ",
      title: title.trim() || "Untitled tender",
    });
    revalidatePath("/workspace");
    return { ok: true, id: tender.id };
  } catch (e) {
    return fail(e);
  }
}
