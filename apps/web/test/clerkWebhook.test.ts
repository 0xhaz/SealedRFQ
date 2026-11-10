/**
 * The Clerk webhook route, against a real database and real signatures.
 *
 * Payloads are signed here with a `whsec_` secret generated for the test. Svix signing is
 * deterministic (HMAC-SHA256 over `id.timestamp.body`), so this exercises the same verification
 * path as a live delivery; only the secret differs. Row counts are read through a privileged
 * pool: the application pool is subject to RLS and would report zero whatever was stored.
 */
import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type { NextRequest } from "next/server";

const SECRET_BYTES = randomBytes(24);
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
process.env.CLERK_WEBHOOK_SIGNING_SECRET = SECRET;

const { POST } = await import("../app/api/clerk/webhook/route");

const admin = new pg.Pool({
  connectionString:
    process.env.ADMIN_DATABASE_URL ?? "postgres://sealedrfq:localdev@localhost:5433/sealedrfq",
});
const reachable = await admin
  .query("SELECT 1")
  .then(() => true)
  .catch(() => false);
if (!reachable) console.warn("\n  skipping webhook tests: no database at localhost:5433.\n");
const withDb = reachable ? describe : describe.skip;

beforeEach(async () => {
  if (!reachable) return;
  await admin.query(
    `TRUNCATE request_responses, request_invitations, documents, requests, memberships,
             organizations, users, membership_removals RESTART IDENTITY CASCADE`,
  );
});
afterAll(() => admin.end());

let seq = 0;
function signed(secretBytes: Buffer, event: unknown, overrides: Record<string, string> = {}) {
  const body = JSON.stringify(event);
  const id = `msg_${++seq}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("http://x/api/clerk/webhook", {
    method: "POST",
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": `v1,${sig}`,
      ...overrides,
    },
  }) as unknown as NextRequest;
}
const ok = (event: unknown) => signed(SECRET_BYTES, event);

const T1 = 1_767_225_600_000;
const evt = (type: string, data: unknown, timestamp = T1) => ({
  type,
  object: "event",
  timestamp,
  instance_id: "ins_test",
  event_attributes: { http_request: { client_ip: "", user_agent: "" } },
  data,
});
const membershipData = (role = "org:member") => ({
  id: "orgmem_1",
  role,
  organization: { id: "org_1", name: "Acme" },
  public_user_data: { user_id: "user_1" },
});
const count = async (table: string) =>
  (await admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;

describe("webhook signature", () => {
  it("rejects a body with no signature", async () => {
    const res = await POST(
      new Request("http://x/api/clerk/webhook", { method: "POST", body: "{}" }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  withDb("when the signature is wrong", () => {
    it("rejects a body signed with a different secret and writes nothing", async () => {
      // A forged event would otherwise write the table row-level security reads. This also proves
      // the rejection is about the signature: the identical payload is accepted just below.
      const event = evt("organizationMembership.created", membershipData());
      const forged = await POST(signed(randomBytes(24), event));
      expect(forged.status).toBe(400);
      expect(await count("memberships")).toBe(0);
      expect(await count("users")).toBe(0);

      const genuine = await POST(ok(event));
      expect(genuine.status).toBe(200);
      expect(await count("memberships")).toBe(1);
    });

    it("rejects a payload altered after signing", async () => {
      const original = ok(evt("organizationMembership.created", membershipData("org:member")));
      const sig = original.headers.get("svix-signature") as string;
      const id = original.headers.get("svix-id") as string;
      const ts = original.headers.get("svix-timestamp") as string;
      const tampered = new Request("http://x/api/clerk/webhook", {
        method: "POST",
        body: JSON.stringify(evt("organizationMembership.created", membershipData("org:admin"))),
        headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": sig },
      }) as unknown as NextRequest;
      expect((await POST(tampered)).status).toBe(400);
      expect(await count("memberships")).toBe(0);
    });

    it("rejects a stale timestamp, which is what stops a captured delivery being replayed", async () => {
      const body = JSON.stringify(evt("organizationMembership.created", membershipData()));
      const ts = String(Math.floor(Date.now() / 1000) - 3600);
      const sig = createHmac("sha256", SECRET_BYTES).update(`msg_old.${ts}.${body}`).digest("base64");
      const res = await POST(
        new Request("http://x/api/clerk/webhook", {
          method: "POST",
          body,
          headers: { "svix-id": "msg_old", "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
        }) as unknown as NextRequest,
      );
      expect(res.status).toBe(400);
      expect(await count("memberships")).toBe(0);
    });
  });
});

withDb("webhook dispatch", () => {
  it("projects a membership, creating the user and organization", async () => {
    expect((await POST(ok(evt("organizationMembership.created", membershipData())))).status).toBe(200);
    const m = await admin.query("SELECT clerk_role, synced_at FROM memberships");
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].clerk_role).toBe("org:member");
    expect(m.rows[0].synced_at).toEqual(new Date(T1));
  });

  it("takes the organization's real name from organization.created", async () => {
    await POST(ok(evt("organizationMembership.created", membershipData())));
    await POST(ok(evt("organization.updated", { id: "org_1", name: "Acme Ltd" })));
    const o = await admin.query("SELECT name FROM organizations WHERE clerk_org_id='org_1'");
    expect(o.rows[0].name).toBe("Acme Ltd");
  });

  it("creates a user from user.created", async () => {
    await POST(ok(evt("user.created", { id: "user_9" })));
    expect(await count("users")).toBe(1);
  });

  it("applies deletes in event order, so a stale create after a delete does not resurrect", async () => {
    await POST(ok(evt("organizationMembership.deleted", membershipData(), T1 + 2000)));
    await POST(ok(evt("organizationMembership.created", membershipData(), T1)));
    expect(await count("memberships")).toBe(0);
  });

  it("removes a membership on a newer delete", async () => {
    await POST(ok(evt("organizationMembership.created", membershipData(), T1)));
    await POST(ok(evt("organizationMembership.deleted", membershipData(), T1 + 1000)));
    expect(await count("memberships")).toBe(0);
  });

  it("returns 200 without writing for an event it does not handle", async () => {
    const res = await POST(ok(evt("session.created", { id: "sess_1" })));
    expect(res.status).toBe(200);
    expect(await count("users")).toBe(0);
    expect(await count("organizations")).toBe(0);
  });

  it("returns 400 for a signed membership event missing its ids", async () => {
    const res = await POST(ok(evt("organizationMembership.created", { role: "org:member" })));
    expect(res.status).toBe(400);
  });
});

describe("webhook configuration", () => {
  it("answers 500, not 400, when the signing secret is not configured", async () => {
    const saved = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = "";
    try {
      expect((await POST(ok(evt("user.created", { id: "u" })))).status).toBe(500);
    } finally {
      process.env.CLERK_WEBHOOK_SIGNING_SECRET = saved;
    }
  });
});
