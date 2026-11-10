import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, withTenant, withUser } from "../src/index.js";

/**
 * Whether the local database is up; see tenancy.test.ts for why these skip rather than fail.
 */
const reachable = await pool
  .query("SELECT 1")
  .then(() => true)
  .catch(() => false);
if (!reachable) {
  console.warn(
    "\n  skipping active organization tests: no database at localhost:5433." +
      "\n  start it with:  pnpm --filter @sealedrfq/db db:up && pnpm --filter @sealedrfq/db db:migrate\n",
  );
}
const withDb = reachable ? describe : describe.skip;

/**
 * A user in two organizations, which is the case the single-tenant policies got wrong: both
 * organizations' work appeared in every query. Real Postgres, because the thing under test is the
 * policy and a mock would pass with it switched off.
 */
const USER_BOTH = "11111111-1111-1111-1111-111111111111";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "aaaaaaaa-0000-0000-0000-000000000002";
const ORG_STRANGER = "aaaaaaaa-0000-0000-0000-000000000003";
const REQ_A = "bbbbbbbb-0000-0000-0000-000000000001";
const REQ_B = "bbbbbbbb-0000-0000-0000-000000000002";
const SUPPLIER = "aaaaaaaa-0000-0000-0000-000000000004";
const REQ_Z = "bbbbbbbb-0000-0000-0000-000000000003";

const admin = new pg.Pool({
  connectionString:
    process.env.ADMIN_DATABASE_URL ?? "postgres://sealedrfq:localdev@localhost:5433/sealedrfq",
});

// Per test, not once: a sibling suite resetting the same database must not strand these fixtures.
beforeEach(async () => {
  if (!reachable) return;
  // Privileged on purpose: seeding two tenants is exactly what the application role cannot do.
  await admin.query(`
    TRUNCATE request_responses, request_invitations, documents, requests, memberships,
             organizations, users RESTART IDENTITY CASCADE;
    INSERT INTO users (id, wallet) VALUES ('${USER_BOTH}','0xboth');
    INSERT INTO organizations (id, name) VALUES
      ('${ORG_A}','Org A'), ('${ORG_B}','Org B'), ('${ORG_STRANGER}','Stranger'), ('${SUPPLIER}','Supplier');
    INSERT INTO memberships (user_id, org_id) VALUES
      ('${USER_BOTH}','${ORG_A}'), ('${USER_BOTH}','${ORG_B}');
    INSERT INTO requests (id, org_id, type, status, title) VALUES
      ('${REQ_A}','${ORG_A}','RFI','open','A work'),
      ('${REQ_B}','${ORG_B}','RFI','open','B work'),
      ('${REQ_Z}','${ORG_STRANGER}','RFI','open','Z work');
    -- ORG_B is invited to Z, and a supplier has answered B's request: the two helper functions
    -- must not let that reach the user while acting as A.
    INSERT INTO request_invitations (request_id, org_id) VALUES
      ('${REQ_Z}','${ORG_B}'), ('${REQ_B}','${SUPPLIER}');
    INSERT INTO request_responses (request_id, org_id, body) VALUES
      ('${REQ_Z}','${ORG_B}','B answers Z'), ('${REQ_B}','${SUPPLIER}','supplier answers B');
  `);
});

afterAll(async () => {
  await admin.end();
  await pool.end();
});

withDb("a user who belongs to two organizations", () => {
  it("shows only the active organization's requests", async () => {
    const a = await withTenant(USER_BOTH, ORG_A, (q) => q.query("SELECT id FROM requests"));
    expect(a.rows.map((r) => r.id)).toEqual([REQ_A]);
    const b = await withTenant(USER_BOTH, ORG_B, (q) => q.query("SELECT id FROM requests"));
    // B also sees Z, which invited it; that is the invitation rule, not a leak from A.
    expect(b.rows.map((r) => r.id).sort()).toEqual([REQ_B, REQ_Z]);
  });

  it("does not inherit another of its organizations' invitations", async () => {
    // Fails if invited_to_request() asks about every membership instead of the active one.
    const r = await withTenant(USER_BOTH, ORG_A, (q) => q.query("SELECT id FROM requests"));
    expect(r.rows.map((x) => x.id)).not.toContain(REQ_Z);
  });

  it("does not read responses to a request another of its organizations owns", async () => {
    // Fails if owns_request() asks about every membership instead of the active one.
    const r = await withTenant(USER_BOTH, ORG_A, (q) =>
      q.query("SELECT body FROM request_responses"),
    );
    expect(r.rows).toEqual([]);
  });

  it("sees those same rows when it is acting as the organization they belong to", async () => {
    // The control: without it the two tests above would also pass against an empty database.
    const r = await withTenant(USER_BOTH, ORG_B, (q) =>
      q.query("SELECT body FROM request_responses ORDER BY body"),
    );
    expect(r.rows.map((x) => x.body)).toEqual(["B answers Z", "supplier answers B"]);
  });

  it("cannot be fooled by a temp table shadowing memberships", async () => {
    // active_org() pins its search_path; without that this forged row would confirm ORG_STRANGER.
    const r = await withTenant(USER_BOTH, ORG_STRANGER, async (q) => {
      await q.query("CREATE TEMP TABLE memberships (org_id uuid, user_id uuid, role text)");
      await q.query("INSERT INTO pg_temp.memberships VALUES ($1,$2,'owner')", [
        ORG_STRANGER,
        USER_BOTH,
      ]);
      return q.query("SELECT id FROM requests");
    });
    expect(r.rows).toEqual([]);
  });

  it("sees nothing when an organization is named but no user is", async () => {
    const r = await withTenant(null, ORG_A, (q) => q.query("SELECT id FROM requests"));
    expect(r.rows).toEqual([]);
  });

  it("sees no procurement work with no active organization", async () => {
    const r = await withUser(USER_BOTH, (q) => q.query("SELECT id FROM requests"));
    expect(r.rows).toEqual([]);
  });

  it("cannot write into the organization it is not acting as", async () => {
    await expect(
      withTenant(USER_BOTH, ORG_A, (q) =>
        q.query("INSERT INTO requests (org_id, type, title) VALUES ($1,'RFI','x')", [ORG_B]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("refuses an organization the user is not a member of", async () => {
    const r = await withTenant(USER_BOTH, ORG_STRANGER, (q) => q.query("SELECT id FROM requests"));
    expect(r.rows).toEqual([]);
  });

  it("refuses when the projection has no membership row, even with the org named", async () => {
    await admin.query("DELETE FROM memberships WHERE user_id=$1 AND org_id=$2", [USER_BOTH, ORG_A]);
    const r = await withTenant(USER_BOTH, ORG_A, (q) => q.query("SELECT id FROM requests"));
    expect(r.rows).toEqual([]);
  });

  it("still lists both organizations through withUser, so the switcher can be drawn", async () => {
    const r = await withUser(USER_BOTH, (q) => q.query("SELECT id FROM organizations ORDER BY id"));
    expect(r.rows).toHaveLength(2);
  });

  it("rejects a non-uuid organization id", async () => {
    await expect(withTenant(USER_BOTH, "org_2abc", async () => 1)).rejects.toThrow(/uuid/);
  });
});
