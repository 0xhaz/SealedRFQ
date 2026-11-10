import { verifyWebhook } from "@clerk/nextjs/webhooks";
import {
  removeMembership,
  upsertMembership,
  upsertOrganization,
  upsertUser,
} from "@sealedrfq/db/identity";
import type { NextRequest } from "next/server";

/**
 * Clerk's webhook, which keeps the Postgres copy of memberships current.
 *
 * That copy is what row-level security trusts to decide who may see which organization, so this
 * route writes the input to the tenant boundary and is reachable by the public internet. It
 * authenticates by signature alone, and nothing is read from the body until that passes.
 *
 * Status codes are chosen for Clerk's retry: 400 means "this will never work" (bad signature,
 * malformed event), 500 means "try again" (the database), and an event we do not handle is 200,
 * because Clerk retries any non-2xx and would otherwise retry it forever.
 */
export async function POST(req: NextRequest): Promise<Response> {
  // verifyWebhook throws for a missing secret exactly as it does for a bad signature. That is our
  // misconfiguration, not the sender's, so it must not be reported as a rejected request.
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    console.error("clerk webhook: CLERK_WEBHOOK_SIGNING_SECRET is not set");
    return new Response("webhook not configured", { status: 500 });
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(req);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  // Ordering is by the event's own time, so an event without one cannot be applied safely.
  const at = new Date(event.timestamp);
  if (!Number.isFinite(at.getTime())) return new Response("event has no timestamp", { status: 400 });

  try {
    switch (event.type) {
      case "user.created":
      case "user.updated":
        await upsertUser(event.data.id);
        break;
      case "organization.created":
      case "organization.updated":
        await upsertOrganization(event.data.id, event.data.name);
        break;
      case "organizationMembership.created":
      case "organizationMembership.updated": {
        const userId = event.data.public_user_data?.user_id;
        const orgId = event.data.organization?.id;
        if (!userId || !orgId || !event.data.role) {
          return new Response("malformed membership event", { status: 400 });
        }
        await upsertMembership({ clerkUserId: userId, clerkOrgId: orgId, role: event.data.role, at });
        break;
      }
      case "organizationMembership.deleted": {
        const userId = event.data.public_user_data?.user_id;
        const orgId = event.data.organization?.id;
        if (!userId || !orgId) return new Response("malformed membership event", { status: 400 });
        await removeMembership({ clerkUserId: userId, clerkOrgId: orgId, at });
        break;
      }
      default:
        return new Response("ignored", { status: 200 });
    }
  } catch (err) {
    console.error("clerk webhook: database write failed", err instanceof Error ? err.message : err);
    return new Response("database error", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}
