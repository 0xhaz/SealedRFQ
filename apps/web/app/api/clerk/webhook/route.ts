import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { applyClerkEvent } from "@sealedrfq/db/identity";
import type { NextRequest } from "next/server";

/**
 * Clerk's webhook, which keeps the Postgres copy of memberships current.
 *
 * That copy is what row-level security trusts to decide who may see which organization, so this
 * route writes the input to the tenant boundary and is reachable by the public internet. It
 * authenticates by signature alone, and nothing is read from the body until that passes.
 *
 * Status codes: Svix retries every non-2xx, 400 included, so none of them stops a retry. 400 is
 * for a request that is wrong however often it is sent (bad signature, a malformed event) and
 * will be retried a bounded number of times and then dropped. 500 is for our own failures (the
 * database, a missing secret). What stops retries is 200, which is why an event type we do not
 * project returns it: otherwise Clerk would keep redelivering something we will never handle.
 */

/** Ordering uses the event's own time; anything before this is a null/zero, not a real event. */
const MIN_EVENT_MS = 1_600_000_000_000;

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

  // A zero or null timestamp would become 1970: a create stamped then loses to everything, and a
  // removal stamped then is overridden by any later create. Neither ordering means anything.
  if (!Number.isFinite(event.timestamp) || event.timestamp < MIN_EVENT_MS) {
    return new Response("event has no usable timestamp", { status: 400 });
  }

  try {
    const outcome = await applyClerkEvent(event);
    if (outcome === "malformed") return new Response("malformed event", { status: 400 });
    return new Response(outcome === "ignored" ? "ignored" : "ok", { status: 200 });
  } catch (err) {
    console.error("clerk webhook: database write failed", err instanceof Error ? err.message : err);
    return new Response("database error", { status: 500 });
  }
}
