import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  removeMembership,
  upsertMembership,
  upsertOrganization,
  upsertUser,
} from "../src/identity.js";
import { pool, withTenant, withUser } from "../src/index.js";
import { directory, myOrganizations } from "../src/workspace.js";

const url =
  process.env.ADMIN_DATABASE_URL ?? "postgres://sealedrfq:localdev@localhost:5433/sealedrfq";
const admin = new pg.Pool({ connectionString: url });
const reachable = await admin
  .query("SELECT 1")
  .then(() => true)
  .catch(() => false);
if (!reachable) {
  console.warn(
    "\n  skipping identity tests: no database at localhost:5433." +
      "\n  start it with:  pnpm --filter @sealedrfq/db db:up && pnpm --filter @sealedrfq/db db:migrate\n",
  );
}
const withDb = reachable ? describe : describe.skip;

const USER = "11111111-1111-1111-1111-111111111111";
const ORG = "aaaaaaaa-0000-0000-0000-000000000001";

// Per test, not once: a sibling suite resetting the same database must not strand fixtures.
beforeEach(async () => {
  if (!reachable) return;
  await admin.query(
    `TRUNCATE request_responses, request_invitations, documents, requests, memberships,
             organizations, users, membership_removals RESTART IDENTITY CASCADE`,
  );
});
afterAll(() => admin.end());

withDb("Clerk identity columns", () => {
  it("accepts a user with no Clerk id yet, because wallet login still creates them", async () => {
    // NOT NULL lands in Task 6, when wallet login is removed and the claim becomes true.
    await expect(admin.query("INSERT INTO users (wallet) VALUES ('0xabc')")).resolves.toBeTruthy();
  });

  it("refuses two users sharing a Clerk id", async () => {
    await admin.query("INSERT INTO users (wallet, clerk_user_id) VALUES ('0x1','user_dup')");
    await expect(
      admin.query("INSERT INTO users (wallet, clerk_user_id) VALUES ('0x2','user_dup')"),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("allows many users with no Clerk id, since NULLs are distinct in a unique index", async () => {
    // This is the property that lets the column be unique and nullable at once.
    await admin.query("INSERT INTO users (wallet) VALUES ('0x3'), ('0x4')");
    const { rows } = await admin.query("SELECT count(*)::int AS n FROM users");
    expect(rows[0].n).toBe(2);
  });

  it("refuses two organizations sharing a Clerk id, but allows many without one", async () => {
    await admin.query("INSERT INTO organizations (name) VALUES ('a'), ('b')");
    await admin.query("INSERT INTO organizations (name, clerk_org_id) VALUES ('c','org_dup')");
    await expect(
      admin.query("INSERT INTO organizations (name, clerk_org_id) VALUES ('d','org_dup')"),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("defaults the company profile to self-declared and organization-only", async () => {
    await admin.query("INSERT INTO organizations (id, name) VALUES ($1,'Northwind')", [ORG]);
    const { rows } = await admin.query(
      "SELECT verification_status, legal_profile_visibility FROM organizations WHERE id=$1",
      [ORG],
    );
    expect(rows[0]).toEqual({
      verification_status: "self_declared",
      legal_profile_visibility: "organization",
    });
  });

  it("rejects values outside the verification and visibility vocabularies", async () => {
    // 23514 is check_violation; matching the SQLSTATE avoids passing on any error that says "check".
    await expect(
      admin.query("INSERT INTO organizations (name, verification_status) VALUES ('x','trusted')"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      admin.query("INSERT INTO organizations (name, legal_profile_visibility) VALUES ('x','all')"),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it.each(["self_declared", "pending", "issuer_verified", "expired", "revoked"])(
    "accepts verification_status %s",
    async (v) => {
      await admin.query("INSERT INTO organizations (name, verification_status) VALUES ('x',$1)", [
        v,
      ]);
    },
  );

  it.each(["public", "organization", "verification_only"])(
    "accepts legal_profile_visibility %s",
    async (v) => {
      await admin.query(
        "INSERT INTO organizations (name, legal_profile_visibility) VALUES ('x',$1)",
        [v],
      );
    },
  );

  it("keeps the legal profile unreadable by the application role, even when discoverable", async () => {
    await admin.query("INSERT INTO users (id, wallet) VALUES ($1,'0xu')", [USER]);
    await admin.query(
      `INSERT INTO organizations (id, name, discoverable, legal_name, jurisdiction, encrypted_company_number)
       VALUES ($1,'Open Co', true, 'Open Co Ltd', 'MY', 'ciphertext')`,
      [ORG],
    );
    // 42501 is insufficient_privilege. Each column alone, since a refusal of one must not hide a
    // leak of another.
    for (const col of ["legal_name", "jurisdiction", "encrypted_company_number"]) {
      await expect(
        withUser(USER, (q) => q.query(`SELECT ${col} FROM organizations`)),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      withUser(USER, (q) => q.query("SELECT * FROM organizations")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("still serves the directory and the organization switcher", async () => {
    await admin.query("INSERT INTO users (id, wallet) VALUES ($1,'0xu')", [USER]);
    await admin.query(
      "INSERT INTO organizations (id, name, discoverable) VALUES ($1,'Open Co', true)",
      [ORG],
    );
    await admin.query("INSERT INTO memberships (user_id, org_id) VALUES ($1,$2)", [USER, ORG]);
    expect((await directory(USER)).map((o) => o.name)).toEqual(["Open Co"]);
    expect((await myOrganizations(USER)).map((o) => o.name)).toEqual(["Open Co"]);
  });

  it("defaults membership role and sync time so (user_id, org_id) seeds still work", async () => {
    await admin.query("INSERT INTO users (id, wallet) VALUES ($1,'0xu')", [USER]);
    await admin.query("INSERT INTO organizations (id, name) VALUES ($1,'N')", [ORG]);
    await admin.query("INSERT INTO memberships (user_id, org_id) VALUES ($1,$2)", [USER, ORG]);
    const { rows } = await admin.query(
      "SELECT clerk_role, synced_at IS NOT NULL AS synced FROM memberships",
    );
    expect(rows[0]).toEqual({ clerk_role: "org:member", synced: true });
  });
});

const T1 = new Date("2026-01-01T00:00:00.000Z");
const T2 = new Date("2026-01-01T00:00:01.000Z");
const T3 = new Date("2026-01-01T00:00:02.000Z");
const ids = { clerkUserId: "user_1", clerkOrgId: "org_1" };

// Counted through the admin pool. `pool` connects as sealedrfq_app, which is subject to RLS and
// sees no memberships without a tenant context, so counting through it would read 0 whatever the
// table held and every assertion below would be about the wrong thing.
const memberships = async () =>
  (await admin.query("SELECT clerk_role, synced_at FROM memberships")).rows;

withDb("Membership projection", () => {
  it("measures through a pool that can see the rows the app pool cannot", async () => {
    // Guards the guard: if this fails, the counts below mean nothing.
    await upsertMembership({ ...ids, role: "org:admin", at: T1 });
    expect(await memberships()).toHaveLength(1);
    const asApp = await pool.query("SELECT count(*)::int AS n FROM memberships");
    expect(asApp.rows[0].n).toBe(0);
  });

  it("is idempotent: the same membership event twice leaves one row", async () => {
    await upsertMembership({ ...ids, role: "org:admin", at: T1 });
    await upsertMembership({ ...ids, role: "org:admin", at: T1 });
    expect(await memberships()).toHaveLength(1);
  });

  it("stamps synced_at from the event, not from the clock", async () => {
    await upsertMembership({ ...ids, role: "org:member", at: T1 });
    expect((await memberships())[0].synced_at).toEqual(T1);
  });

  it("ignores a stale role update", async () => {
    await upsertMembership({ ...ids, role: "org:member", at: T2 });
    await upsertMembership({ ...ids, role: "org:admin", at: T1 });
    expect((await memberships())[0].clerk_role).toBe("org:member");
  });

  it("applies a newer role update", async () => {
    await upsertMembership({ ...ids, role: "org:member", at: T1 });
    await upsertMembership({ ...ids, role: "org:admin", at: T2 });
    const rows = await memberships();
    expect(rows).toHaveLength(1);
    expect(rows[0].clerk_role).toBe("org:admin");
  });

  it("ignores a delete that is older than the row it would remove", async () => {
    await upsertMembership({ ...ids, role: "org:member", at: T2 });
    await removeMembership({ ...ids, at: T1 });
    expect(await memberships()).toHaveLength(1);
  });

  it("applies a delete that is newer", async () => {
    await upsertMembership({ ...ids, role: "org:member", at: T1 });
    await removeMembership({ ...ids, at: T2 });
    expect(await memberships()).toHaveLength(0);
  });

  it("does not let a create that arrives after a newer delete resurrect the member", async () => {
    // Out-of-order delivery: deleted(T2) overtakes created(T1). Without a record of the removal
    // the late create would restore access to someone who has been removed.
    await removeMembership({ ...ids, at: T2 });
    await upsertMembership({ ...ids, role: "org:admin", at: T1 });
    expect(await memberships()).toHaveLength(0);
  });

  it("lets a member removed and later re-added back in, and then ignores the old delete", async () => {
    await upsertMembership({ ...ids, role: "org:member", at: T1 });
    await removeMembership({ ...ids, at: T2 });
    await upsertMembership({ ...ids, role: "org:member", at: T3 });
    expect(await memberships()).toHaveLength(1);
    await removeMembership({ ...ids, at: T2 }); // a redelivery of the old delete
    expect(await memberships()).toHaveLength(1);
  });

  it("lets a delete win a tie with a create", async () => {
    await upsertMembership({ ...ids, role: "org:member", at: T1 });
    await removeMembership({ ...ids, at: T1 });
    expect(await memberships()).toHaveLength(0);
    await upsertMembership({ ...ids, role: "org:member", at: T1 });
    expect(await memberships()).toHaveLength(0);
  });

  it("creates the user and organization when the membership arrives first", async () => {
    await upsertMembership({ ...ids, role: "org:member", at: T1 });
    const u = await admin.query(
      "SELECT count(*)::int AS n FROM users WHERE clerk_user_id='user_1'",
    );
    const o = await admin.query("SELECT name FROM organizations WHERE clerk_org_id='org_1'");
    expect(u.rows[0].n).toBe(1);
    expect(o.rows[0].name).toBe("org_1");
  });

  it("returns the same id for the same user and organization", async () => {
    expect(await upsertUser("user_1")).toBe(await upsertUser("user_1"));
    expect(await upsertOrganization("org_1")).toBe(await upsertOrganization("org_1", "Acme"));
  });

  it("does not replace a stored organization name with the id when no name is given", async () => {
    await upsertOrganization("org_1", "Acme");
    await upsertOrganization("org_1");
    const { rows } = await admin.query("SELECT name FROM organizations WHERE clerk_org_id='org_1'");
    expect(rows[0].name).toBe("Acme");
    await upsertOrganization("org_1", "Acme Ltd");
    const again = await admin.query("SELECT name FROM organizations WHERE clerk_org_id='org_1'");
    expect(again.rows[0].name).toBe("Acme Ltd");
  });

  it("makes the member visible to the tenant gate only through the projection", async () => {
    const userId = await upsertUser("user_1");
    const orgId = await upsertOrganization("org_1", "Acme");
    await upsertMembership({ ...ids, role: "org:member", at: T1 });
    const seen = await withTenant(userId, orgId, (q) => q.query("SELECT app.active_org() AS o"));
    expect(seen.rows[0].o).toBe(orgId);
    await removeMembership({ ...ids, at: T2 });
    const gone = await withTenant(userId, orgId, (q) => q.query("SELECT app.active_org() AS o"));
    expect(gone.rows[0].o).toBeNull();
  });

  it("refuses empty identifiers", async () => {
    await expect(upsertUser("")).rejects.toThrow(/required/);
    await expect(upsertOrganization("")).rejects.toThrow(/required/);
  });

  it("gives the application role no way to write the projection except the functions", async () => {
    const userId = await upsertUser("user_1");
    const orgId = await upsertOrganization("org_1", "Acme");
    await expect(
      pool.query("INSERT INTO memberships (org_id, user_id) VALUES ($1, $2)", [orgId, userId]),
    ).rejects.toThrow(/row-level security|permission denied/i);
    await expect(pool.query("SELECT * FROM membership_removals")).rejects.toThrow(
      /permission denied/i,
    );
    expect(await memberships()).toHaveLength(0);
  });
});
