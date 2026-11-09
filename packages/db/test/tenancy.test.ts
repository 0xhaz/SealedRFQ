import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertNotPrivileged, pool, withTenant } from "../src/index.js";

/**
 * Whether the local database is up.
 *
 * Without it these skip rather than fail, because "you have not started Docker" and "tenant
 * isolation is broken" deserve different reactions and a connection error reports neither. The
 * skip names the command, since the whole point is that the reader is missing one.
 */
const reachable = await pool
  .query("SELECT 1")
  .then(() => true)
  .catch(() => false);
if (!reachable) {
  console.warn(
    "\n  skipping tenant isolation tests: no database at localhost:5433." +
      "\n  start it with:  pnpm --filter @sealedrfq/db db:up && pnpm --filter @sealedrfq/db db:migrate\n",
  );
}
const withDb = reachable ? describe : describe.skip;

/**
 * Tenant isolation, which the V2 plan treats as a stop/go gate.
 *
 * These run against a real Postgres rather than a mock, because what is being tested is the
 * database's row-level security and not any code in this repository. A mock would pass while the
 * policies were switched off.
 */
const BUYER = "11111111-1111-1111-1111-111111111111";
const SUP_A = "22222222-2222-2222-2222-222222222222";
const SUP_B = "33333333-3333-3333-3333-333333333333";
const ORG_BUYER = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000002";
const ORG_B = "aaaaaaaa-0000-0000-0000-000000000003";
const OPEN_RFI = "bbbbbbbb-0000-0000-0000-000000000001";
const PRIVATE_DRAFT = "bbbbbbbb-0000-0000-0000-000000000002";

beforeAll(async () => {
  if (!reachable) return;
  // Seeded through a privileged connection on purpose: setting up two tenants is exactly the thing
  // the application role is not allowed to do.
  const admin = new (await import("pg")).default.Pool({
    connectionString:
      process.env.ADMIN_DATABASE_URL ?? "postgres://sealedrfq:localdev@localhost:5433/sealedrfq",
  });
  await admin.query(`
    TRUNCATE request_responses, request_invitations, documents, requests, memberships,
             organizations, users RESTART IDENTITY CASCADE;
    INSERT INTO users (id, wallet) VALUES
      ('${BUYER}','0xbuyer'), ('${SUP_A}','0xsupplierA'), ('${SUP_B}','0xsupplierB');
    INSERT INTO organizations (id, name) VALUES
      ('${ORG_BUYER}','Northwind'), ('${ORG_A}','Supplier A'), ('${ORG_B}','Supplier B');
    INSERT INTO memberships (org_id, user_id, role) VALUES
      ('${ORG_BUYER}','${BUYER}','owner'), ('${ORG_A}','${SUP_A}','owner'), ('${ORG_B}','${SUP_B}','owner');
    INSERT INTO requests (id, org_id, type, status, title) VALUES
      ('${OPEN_RFI}','${ORG_BUYER}','RFI','open','Route optimisation'),
      ('${PRIVATE_DRAFT}','${ORG_BUYER}','RFI','draft','Unsent private draft');
    INSERT INTO request_invitations (request_id, org_id) VALUES
      ('${OPEN_RFI}','${ORG_A}'), ('${OPEN_RFI}','${ORG_B}');
    INSERT INTO request_responses (request_id, org_id, body) VALUES
      ('${OPEN_RFI}','${ORG_A}','A: confidential approach'),
      ('${OPEN_RFI}','${ORG_B}','B: confidential approach');
    INSERT INTO documents (org_id, request_id, sha256, filename, storage_key) VALUES
      ('${ORG_A}','${OPEN_RFI}','aa','a-spec.pdf','k/a'),
      ('${ORG_B}','${OPEN_RFI}','bb','b-spec.pdf','k/b');
  `);
  await admin.end();
});

afterAll(async () => {
  await pool.end();
});

const bodies = (userId: string | null) =>
  withTenant(userId, async (q) =>
    (await q.query<{ body: string }>("SELECT body FROM request_responses ORDER BY body")).rows.map(
      (r) => r.body,
    ),
  );

withDb("the connection itself", () => {
  it("cannot bypass row-level security", async () => {
    // If this fails, every test below passes for the wrong reason.
    await expect(assertNotPrivileged()).resolves.toBeUndefined();
  });
});

withDb("a supplier invited to a request", () => {
  it("sees its own response and not a rival's", async () => {
    expect(await bodies(SUP_A)).toEqual(["A: confidential approach"]);
    expect(await bodies(SUP_B)).toEqual(["B: confidential approach"]);
  });

  it("sees the request it was invited to, and no other request the buyer owns", async () => {
    const titles = await withTenant(SUP_A, async (q) =>
      (await q.query<{ title: string }>("SELECT title FROM requests")).rows.map((r) => r.title),
    );
    expect(titles).toEqual(["Route optimisation"]);
  });

  it("cannot reach a rival's document by knowing its id", async () => {
    // The attack this models is URL guessing, which is why it asks for the row by primary key
    // rather than listing.
    const rows = await withTenant(SUP_A, async (q) =>
      (await q.query("SELECT filename FROM documents WHERE org_id = $1", [ORG_B])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("cannot write a response in another organization's name", async () => {
    await expect(
      withTenant(SUP_A, (q) =>
        q.query("INSERT INTO request_responses (request_id, org_id, body) VALUES ($1,$2,$3)", [
          OPEN_RFI,
          ORG_B,
          "forged",
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

withDb("the buyer who owns the request", () => {
  it("sees every response to it", async () => {
    expect(await bodies(BUYER)).toEqual(["A: confidential approach", "B: confidential approach"]);
  });

  it("sees its own unsent draft, which no supplier can", async () => {
    const mine = await withTenant(BUYER, async (q) =>
      (await q.query("SELECT id FROM requests WHERE id = $1", [PRIVATE_DRAFT])).rowCount,
    );
    const theirs = await withTenant(SUP_A, async (q) =>
      (await q.query("SELECT id FROM requests WHERE id = $1", [PRIVATE_DRAFT])).rowCount,
    );
    expect(mine).toBe(1);
    expect(theirs).toBe(0);
  });
});

withDb("an unauthenticated caller", () => {
  it("fails closed rather than open", async () => {
    expect(await bodies(null)).toEqual([]);
    const requests = await withTenant(null, async (q) =>
      (await q.query("SELECT id FROM requests")).rowCount,
    );
    expect(requests).toBe(0);
  });

  it("is refused a user id that is not a uuid", async () => {
    await expect(withTenant("'; SET ROLE sealedrfq; --", async () => 1)).rejects.toThrow(/uuid/);
  });
});
