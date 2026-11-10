/**
 * The Clerk webhook route's own behaviour: verification and status codes.
 *
 * Needs no database. What the route hands to the projection is mocked, so these can assert both
 * that a forged request is refused and that nothing was written. The projection itself is tested
 * against Postgres in `@sealedrfq/db`; a database test here would truncate tables shared with
 * that package's suites and race them across processes.
 *
 * Payloads are signed with a `whsec_` secret generated for the test. Svix signing is
 * deterministic (HMAC-SHA256 over `id.timestamp.body`), so this exercises the same verification
 * path as a live delivery; only the secret differs.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apply = vi.hoisted(() => vi.fn());
vi.mock("@sealedrfq/db/identity", () => ({ applyClerkEvent: apply }));

const SECRET_BYTES = randomBytes(24);
process.env.CLERK_WEBHOOK_SIGNING_SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

const { POST } = await import("../app/api/clerk/webhook/route");

let seq = 0;
function signed(secretBytes: Buffer, body: string, ageSeconds = 0) {
  const id = `msg_${++seq}`;
  const ts = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const sig = createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("http://x/api/clerk/webhook", {
    method: "POST",
    body,
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
  }) as unknown as NextRequest;
}

const T1 = 1_767_225_600_000;
const event = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "organizationMembership.created",
    object: "event",
    timestamp: T1,
    instance_id: "ins_test",
    event_attributes: { http_request: { client_ip: "", user_agent: "" } },
    data: { id: "orgmem_1" },
    ...over,
  });
const genuine = (body = event()) => signed(SECRET_BYTES, body);

beforeEach(() => {
  apply.mockReset();
  apply.mockResolvedValue("applied");
});

describe("webhook signature", () => {
  it("rejects a body with no signature", async () => {
    const res = await POST(
      new Request("http://x/api/clerk/webhook", { method: "POST", body: "{}" }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects a body signed with a different secret, and accepts the same body signed correctly", async () => {
    // A forged event would otherwise write the table row-level security reads. The identical
    // payload is accepted below, so the 400 is about the signature and nothing else.
    const forged = await POST(signed(randomBytes(24), event()));
    expect(forged.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();

    expect((await POST(genuine())).status).toBe(200);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("rejects a payload altered after signing", async () => {
    const original = genuine(event());
    const tampered = new Request("http://x/api/clerk/webhook", {
      method: "POST",
      body: event({ data: { id: "orgmem_attacker" } }),
      headers: {
        "svix-id": original.headers.get("svix-id") as string,
        "svix-timestamp": original.headers.get("svix-timestamp") as string,
        "svix-signature": original.headers.get("svix-signature") as string,
      },
    }) as unknown as NextRequest;
    expect((await POST(tampered)).status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects a stale delivery timestamp, which stops a captured request being replayed", async () => {
    expect((await POST(signed(SECRET_BYTES, event(), 3600))).status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("webhook outcomes", () => {
  it("passes the verified event to the projection", async () => {
    await POST(genuine());
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ type: "organizationMembership.created", timestamp: T1 }),
    );
  });

  it("returns 200 for an event type that is not projected, so Clerk stops retrying it", async () => {
    apply.mockResolvedValue("ignored");
    expect((await POST(genuine(event({ type: "session.created" })))).status).toBe(200);
  });

  it("returns 400 for a signed event the projection finds malformed", async () => {
    apply.mockResolvedValue("malformed");
    expect((await POST(genuine())).status).toBe(400);
  });

  it("returns 500 when the database write fails, so the retry means try again", async () => {
    apply.mockRejectedValue(new Error("connection refused"));
    expect((await POST(genuine())).status).toBe(500);
  });

  it.each([0, null, 1_000])("refuses an event whose timestamp (%s) cannot order anything", async (timestamp) => {
    expect((await POST(genuine(event({ timestamp })))).status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("webhook configuration", () => {
  it("answers 500, not 400, when the signing secret is not configured", async () => {
    const saved = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = "";
    try {
      expect((await POST(genuine())).status).toBe(500);
    } finally {
      process.env.CLERK_WEBHOOK_SIGNING_SECRET = saved;
    }
  });
});
