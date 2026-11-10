import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withUser } from "../src/index.js";
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
             organizations, users RESTART IDENTITY CASCADE`,
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
