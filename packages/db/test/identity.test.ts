import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyClerkEvent,
  linkWallet,
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
  it("refuses a user with no Clerk id, since every user now comes from Clerk", async () => {
    // 23502 is not_null_violation.
    await expect(admin.query("INSERT INTO users DEFAULT VALUES")).rejects.toMatchObject({
      code: "23502",
    });
  });

  it("refuses two users sharing a Clerk id", async () => {
    await admin.query("INSERT INTO users (clerk_user_id) VALUES ('user_dup')");
    await expect(
      admin.query("INSERT INTO users (clerk_user_id) VALUES ('user_dup')"),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("refuses an organization with no Clerk id", async () => {
    await expect(
      admin.query("INSERT INTO organizations (name) VALUES ('a')"),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("refuses two organizations sharing a Clerk id", async () => {
    await admin.query("INSERT INTO organizations (name, clerk_org_id) VALUES ('c','org_dup')");
    await expect(
      admin.query("INSERT INTO organizations (name, clerk_org_id) VALUES ('d','org_dup')"),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("defaults the company profile to self-declared and organization-only", async () => {
    await admin.query(
      "INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1,'Northwind','org_n')",
      [ORG],
    );
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
      admin.query(
        "INSERT INTO organizations (name, clerk_org_id, verification_status) VALUES ('x','org_x','trusted')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      admin.query(
        "INSERT INTO organizations (name, clerk_org_id, legal_profile_visibility) VALUES ('x','org_x','all')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it.each(["self_declared", "pending", "issuer_verified", "expired", "revoked"])(
    "accepts verification_status %s",
    async (v) => {
      await admin.query(
        "INSERT INTO organizations (name, clerk_org_id, verification_status) VALUES ('x','org_x',$1)",
        [v],
      );
    },
  );

  it.each(["public", "organization", "verification_only"])(
    "accepts legal_profile_visibility %s",
    async (v) => {
      await admin.query(
        "INSERT INTO organizations (name, clerk_org_id, legal_profile_visibility) VALUES ('x','org_x',$1)",
        [v],
      );
    },
  );

  it("keeps the legal profile unreadable by the application role, even when discoverable", async () => {
    await admin.query("INSERT INTO users (id, clerk_user_id) VALUES ($1,'user_u')", [USER]);
    await admin.query(
      `INSERT INTO organizations (id, name, clerk_org_id, discoverable, legal_name, jurisdiction, encrypted_company_number)
       VALUES ($1,'Open Co', 'org_open', true, 'Open Co Ltd', 'MY', 'ciphertext')`,
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
    await admin.query("INSERT INTO users (id, clerk_user_id) VALUES ($1,'user_u')", [USER]);
    await admin.query(
      "INSERT INTO organizations (id, name, clerk_org_id, discoverable) VALUES ($1,'Open Co','org_open', true)",
      [ORG],
    );
    await admin.query("INSERT INTO memberships (user_id, org_id) VALUES ($1,$2)", [USER, ORG]);
    expect((await directory(USER)).map((o) => o.name)).toEqual(["Open Co"]);
    expect((await myOrganizations(USER)).map((o) => o.name)).toEqual(["Open Co"]);
  });

  it("defaults membership role and sync time so (user_id, org_id) seeds still work", async () => {
    await admin.query("INSERT INTO users (id, clerk_user_id) VALUES ($1,'user_u')", [USER]);
    await admin.query(
      "INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1,'N','org_n')",
      [ORG],
    );
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

  it("reports a membership role as the organization list shows it: Clerk's key, not the old enum", async () => {
    const userId = await upsertUser("user_1");
    await upsertMembership({ ...ids, role: "org:admin", at: T1 });
    const orgs = await myOrganizations(userId);
    expect(orgs.map((o) => o.role)).toEqual(["org:admin"]);
  });

  it("the name-free form cannot rename an organization", async () => {
    await upsertOrganization("org_1", "Acme");
    await pool.query("SELECT app.sync_organization($1)", ["org_1"]);
    const { rows } = await admin.query("SELECT name FROM organizations WHERE clerk_org_id='org_1'");
    expect(rows[0].name).toBe("Acme");
  });
});

const T_MS = T1.getTime();
const memEvent = (type: string, timestamp: number, role = "org:member") => ({
  type,
  timestamp,
  data: {
    id: "orgmem_1",
    role,
    organization: { id: "org_1", name: "Acme" },
    public_user_data: { user_id: "user_1" },
  },
});

withDb("Applying verified Clerk events", () => {
  it("projects a membership with the event's time and the organization's real name", async () => {
    expect(await applyClerkEvent(memEvent("organizationMembership.created", T_MS))).toBe("applied");
    const m = await admin.query("SELECT clerk_role, synced_at FROM memberships");
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].synced_at).toEqual(T1);
    const o = await admin.query("SELECT name FROM organizations WHERE clerk_org_id='org_1'");
    expect(o.rows[0].name).toBe("Acme");
  });

  it("takes a renamed organization from organization.updated", async () => {
    await applyClerkEvent(memEvent("organizationMembership.created", T_MS));
    await applyClerkEvent({
      type: "organization.updated",
      timestamp: T_MS,
      data: { id: "org_1", name: "Acme Ltd" },
    });
    const o = await admin.query("SELECT name FROM organizations WHERE clerk_org_id='org_1'");
    expect(o.rows[0].name).toBe("Acme Ltd");
  });

  it("creates a user from user.created", async () => {
    await applyClerkEvent({ type: "user.created", timestamp: T_MS, data: { id: "user_9" } });
    expect((await admin.query("SELECT 1 FROM users WHERE clerk_user_id='user_9'")).rowCount).toBe(
      1,
    );
  });

  it("does not let a created that arrives after a newer deleted resurrect the member", async () => {
    await applyClerkEvent(memEvent("organizationMembership.deleted", T_MS + 2000));
    await applyClerkEvent(memEvent("organizationMembership.created", T_MS));
    expect(await memberships()).toHaveLength(0);
  });

  it("removes a membership on a newer delete", async () => {
    await applyClerkEvent(memEvent("organizationMembership.created", T_MS));
    await applyClerkEvent(memEvent("organizationMembership.deleted", T_MS + 1000));
    expect(await memberships()).toHaveLength(0);
  });

  it("ignores a type it does not project, writing nothing", async () => {
    expect(
      await applyClerkEvent({ type: "session.created", timestamp: T_MS, data: { id: "s" } }),
    ).toBe("ignored");
    expect((await admin.query("SELECT 1 FROM users")).rowCount).toBe(0);
    expect((await admin.query("SELECT 1 FROM organizations")).rowCount).toBe(0);
  });

  it("calls a signed membership event missing its ids malformed, writing nothing", async () => {
    const bad = {
      type: "organizationMembership.created",
      timestamp: T_MS,
      data: { role: "org:member" },
    };
    expect(await applyClerkEvent(bad)).toBe("malformed");
    expect((await admin.query("SELECT 1 FROM users")).rowCount).toBe(0);
  });
});

withDb("wallet links", () => {
  const U2 = "22222222-2222-2222-2222-222222222222";
  const ADDR = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";
  const CCD_ADDR = "3kBx2h5Y2veb4hZgAJWPrr8RyQESKm5TjzF3ti1QQ4VSYLwK1G";
  const BASE = { userId: USER, chainNamespace: "eip155", chainId: 5042002 };

  // A challenge issued for the address, as the linking flow will. Seeded privileged: the application
  // role has no access to the table, only to the functions over it.
  let n = 0;
  async function challengeFor(wallet: string, ttl = "5 minutes"): Promise<string> {
    const nonce = `nonce-${++n}-${Math.random()}`;
    await admin.query(
      "INSERT INTO wallet_challenges (nonce, wallet, expires_at) VALUES ($1,$2, now() + $3::interval)",
      [nonce, wallet, ttl],
    );
    return nonce;
  }
  const link = async (over: Partial<Parameters<typeof linkWallet>[0]> & { address: string }) =>
    linkWallet({
      ...BASE,
      challengeId: await challengeFor(over.address),
      ...over,
    });

  beforeEach(async () => {
    if (!reachable) return;
    await admin.query("TRUNCATE wallet_links, organization_signers, wallet_challenges CASCADE");
    await admin.query(
      "INSERT INTO users (id, clerk_user_id) VALUES ($1, 'user_1'), ($2, 'user_2')",
      [USER, U2],
    );
  });

  it("refuses the same address linked twice while both links are live", async () => {
    await link({ address: ADDR });
    await expect(link({ address: ADDR.toUpperCase().replace("0X", "0x") })).rejects.toThrow(
      /unique|duplicate/i,
    );
  });

  it("refuses a case-variant of a live address even when it reaches the table unnormalised", async () => {
    // Bypasses linkWallet's lowercasing to prove the index itself, on a non-eip155 namespace where
    // the CHECK does not force lowercase.
    await admin.query(
      `INSERT INTO wallet_links (user_id, chain_namespace, chain_id, address, verified_at)
       VALUES ($1,'other',1,'AbC',now())`,
      [USER],
    );
    await expect(
      admin.query(
        `INSERT INTO wallet_links (user_id, chain_namespace, chain_id, address, verified_at)
         VALUES ($1,'other',1,'aBc',now())`,
        [U2],
      ),
    ).rejects.toThrow(/wallet_links_live_address|unique|duplicate/i);
  });

  it("permits relinking an address whose previous link was revoked", async () => {
    const id = await link({ address: ADDR });
    await admin.query("UPDATE wallet_links SET revoked_at=now() WHERE id=$1", [id]);
    await expect(link({ address: ADDR })).resolves.toBeTruthy();
  });

  it("permits one user to link wallets on two namespaces", async () => {
    await link({ address: ADDR });
    await expect(
      link({ chainNamespace: "ccd", chainId: 0, address: CCD_ADDR }),
    ).resolves.toBeTruthy();
    const { rows } = await admin.query(
      "SELECT address FROM wallet_links WHERE chain_namespace='ccd'",
    );
    expect(rows[0].address).toBe(CCD_ADDR); // base58 case preserved
  });

  it("stores an EVM address lowercase", async () => {
    await link({ address: ADDR });
    const { rows } = await admin.query("SELECT address FROM wallet_links");
    expect(rows[0].address).toBe(ADDR.toLowerCase());
  });

  it("spends the challenge: the same nonce links nothing a second time", async () => {
    const challengeId = await challengeFor(ADDR);
    await linkWallet({ ...BASE, address: ADDR, challengeId });
    await expect(linkWallet({ ...BASE, address: CCD_ADDR, challengeId })).rejects.toThrow(
      /challenge/,
    );
    expect((await admin.query("SELECT 1 FROM wallet_links")).rowCount).toBe(1);
  });

  it("refuses a challenge issued for a different address, and leaves it unspent", async () => {
    const challengeId = await challengeFor("0x0000000000000000000000000000000000000001");
    await expect(linkWallet({ ...BASE, address: ADDR, challengeId })).rejects.toThrow(/different/);
    expect((await admin.query("SELECT 1 FROM wallet_links")).rowCount).toBe(0);
    const c = await admin.query("SELECT consumed_at FROM wallet_challenges WHERE nonce=$1", [
      challengeId,
    ]);
    expect(c.rows[0].consumed_at).toBeNull();
  });

  it("refuses an expired challenge", async () => {
    const challengeId = await challengeFor(ADDR, "-1 minute");
    await expect(linkWallet({ ...BASE, address: ADDR, challengeId })).rejects.toThrow(/challenge/);
  });

  it("shows a user only their own links through the application role", async () => {
    await link({ address: ADDR });
    await link({ userId: U2, address: "0x0000000000000000000000000000000000000002" });
    const mine = await withUser(USER, (q) => q.query("SELECT user_id FROM wallet_links"));
    expect(mine.rows.map((r) => r.user_id)).toEqual([USER]);
    const nobody = await withUser(null, (q) => q.query("SELECT 1 FROM wallet_links"));
    expect(nobody.rowCount).toBe(0);
    // And the truth, through the privileged pool, so the two zeroes above are not vacuous.
    expect((await admin.query("SELECT 1 FROM wallet_links")).rowCount).toBe(2);
  });

  it("cannot be used to link a wallet to someone else", async () => {
    await expect(
      withUser(USER, (q) =>
        q.query(
          `INSERT INTO wallet_links (user_id, chain_namespace, chain_id, address, verified_at)
           VALUES ($1,'eip155',1,'0xdead',now())`,
          [U2],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("records an EOA link by default and a contract link when told", async () => {
    const eoa = await link({ address: ADDR });
    const safe = await link({
      address: "0x0000000000000000000000000000000000005afe",
      accountType: "contract",
    });
    const { rows } = await withUser(USER, (q) =>
      q.query("SELECT id, account_type FROM wallet_links"),
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.account_type]));
    expect(byId[eoa]).toBe("eoa");
    expect(byId[safe]).toBe("contract");
  });

  it("refuses an account type outside the two known", async () => {
    await expect(
      admin.query(
        `INSERT INTO wallet_links (user_id, chain_namespace, chain_id, address, verified_at, account_type)
         VALUES ($1,'eip155',1,'0xbeef',now(),'multisig')`,
        [USER],
      ),
    ).rejects.toThrow(/account_type|check/i);
  });

  it("does not let the application role rewrite the account type", async () => {
    const id = await link({ address: ADDR });
    await expect(
      withUser(USER, (q) =>
        q.query("UPDATE wallet_links SET account_type='contract' WHERE id=$1", [id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets a contract-account link be an organization signer without further schema", async () => {
    const id = await link({
      address: "0x0000000000000000000000000000000000005afe",
      accountType: "contract",
    });
    await admin.query(
      `INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1,'Org','org_signer')
       ON CONFLICT DO NOTHING`,
      [ORG],
    );
    await expect(
      admin.query(
        `INSERT INTO organization_signers (organization_id, wallet_link_id, approval_scope)
         VALUES ($1,$2,'payments')`,
        [ORG, id],
      ),
    ).resolves.toBeTruthy();
  });

  it("gives the application role no access to organization_signers", async () => {
    await expect(
      withUser(USER, (q) => q.query("SELECT 1 FROM organization_signers")),
    ).rejects.toThrow(/permission denied/);
  });
});
