# V2 SaaS Refactor — Identity and Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace wallet-as-login with Clerk accounts and organizations, and make row-level security scope to one active organization instead of every organization a user belongs to.

**Architecture:** Clerk owns users, organizations, memberships and roles; Postgres keeps a membership projection synced by webhook because RLS policies cannot call an HTTP API. Access to procurement data requires the live Clerk session and the projection to agree, through a new `app.active_org()` that intersects them. Wallets stop being identity and become `wallet_links` rows, with `organization_signers` deciding who may transact.

**Tech Stack:** Next.js 16 (App Router, Turbopack), `@clerk/nextjs` v7+ (Core 3), PostgreSQL 16 with RLS, `pg`, vitest, biome.

**Spec:** [`docs/v2_saas_refactor.md`](./v2_saas_refactor.md)

**Covers spec steps 1 and 2.** Spec steps 3 (surfaces) and 4 (Qualification Agent) get their own plans; step 4's design is already recorded in the spec's "What this changes about the Qualification Agent".

## Global Constraints

- Migrations are **append-only**. Fix a mistake with a new file, never by editing one that has run. Next free number: `0007`.
- The application connects as `sealedrfq_app`, which owns nothing and has no `BYPASSRLS`. `assertNotPrivileged` must keep passing.
- An RLS policy must **never read another RLS-protected table directly**. Use a `SECURITY DEFINER` function in schema `app`, or Postgres rejects it with "infinite recursion detected in policy".
- Unset tenant settings mean NULL mean no rows. Fail closed is the existing default and must stay.
- Clerk System Permissions use their real slugs: `org:sys_memberships:manage`, `org:sys_profile:manage`, `org:sys_domains:manage`, `org:sys_billing:manage`. Custom permissions use `org:<resource>:<action>`. An invented slug makes `has()` return `false` forever and renders for nobody.
- Clerk metadata writes **replace**, not merge. Read, spread, write.
- Database tests run against real Postgres at `localhost:5433` and **skip** when it is unreachable, naming the command to start it. Never mock RLS.
- Seed fixtures through a privileged connection (`ADMIN_DATABASE_URL`), never through `sealedrfq_app`.
- Run `npx biome check --write <paths>` before each commit. `**/test/fixtures/**` is excluded from formatting and must stay excluded.
- Never print, log or commit a private key. `.env.*` is gitignored except `.env.example`.

## Review Focus

Five failure modes the spec implies that no task's happy path exercises. Each has its test assigned to the task that owns the code.

1. **A forged or unsigned Clerk webhook** mutates the membership projection, which is the RLS input — it must be rejected before any write. (Task 4)
2. **A duplicate or out-of-order webhook delivery** — `membership.deleted` arriving before its `.created`, or either delivered twice — must converge, not corrupt the projection. (Task 4)
3. **A signed-in user with no organization** must reach the choose-organization task, not a 500 or an empty workspace that looks broken. (Task 6)
4. **An existing `users.wallet` row that is a duplicate or not a valid address** must not be silently dropped when the column moves to `wallet_links`. The column is `NOT NULL` today, so every row migrates or the migration fails. (Task 5)
5. **A slug that exists but the user is not a member of, and a slug that does not exist** must behave identically — otherwise the difference enumerates other tenants' organization slugs. (Task 6)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0007_active_org.sql` | `app.active_org()`; procurement policies move to it |
| `packages/db/migrations/0008_clerk_identity.sql` | `clerk_user_id`, `clerk_org_id`, memberships projection columns, company profile columns |
| `packages/db/migrations/0009_wallet_links.sql` | `wallet_links`, `organization_signers`, drop `users.wallet` |
| `packages/db/src/index.ts` | `withTenant(userId, orgId)` and `withUser(userId)` |
| `packages/db/src/identity.ts` | projection upserts the webhook calls; wallet link and signer reads |
| `packages/db/test/activeOrg.test.ts` | the three negative tenancy tests |
| `packages/db/test/identity.test.ts` | projection idempotency and ordering |
| `apps/web/middleware.ts` | `clerkMiddleware`, public route matcher |
| `apps/web/app/layout.tsx` | `ClerkProvider`, `taskUrls` |
| `apps/web/lib/v2/tenant.ts` | `requireOrg()` — the single place a session becomes `(userId, orgId)` |
| `apps/web/app/api/clerk/webhook/route.ts` | signature verification then projection sync |
| `apps/web/app/app/[org]/layout.tsx` | slug invariant, org chrome, switcher |
| `apps/web/components/v2/OrgSwitcher.tsx` | `<OrganizationSwitcher hidePersonal />` wrapper |
| `scripts/v1/settle-and-withdraw.mjs` | drain the V1 testnet escrow before deleting its UI |

---

## Task 1: Active organization in row-level security

The pre-existing bug, and independent of Clerk. `app.member_orgs()` returns every organization a user belongs to, so a user in two organizations currently sees both organizations' data in every query. Fixing this first makes every later task's isolation claim meaningful.

**Files:**
- Create: `packages/db/migrations/0007_active_org.sql`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/activeOrg.test.ts`

**Interfaces:**
- Consumes: `pool`, `assertNotPrivileged` from `packages/db/src/index.ts`; `app.current_user_id()` from `0001_tenancy.sql`
- Produces:
  - SQL `app.active_org() RETURNS uuid` — the session's organization, or NULL unless the projection confirms membership
  - `withTenant<T>(userId: string | null, orgId: string | null, fn: (q: pg.PoolClient) => Promise<T>): Promise<T>` — sets `app.current_user_id` and `app.current_org_id`; rejects a non-UUID for either
  - `withUser<T>(userId: string | null, fn: (q: pg.PoolClient) => Promise<T>): Promise<T>` — sets only the user, for listing your own organizations so the switcher can be drawn

- [ ] **Step 1: Write the failing tests**

In `packages/db/test/activeOrg.test.ts`, following the skip-if-unreachable and privileged-seed pattern in `packages/db/test/tenancy.test.ts`. Seed one user in two organizations, each owning one request.

```ts
it("shows only the active organization's requests to a user who belongs to two", async () => {
  const a = await withTenant(USER_BOTH, ORG_A, (q) => q.query("SELECT id FROM requests"));
  expect(a.rows.map((r) => r.id)).toEqual([REQ_A]);
  const b = await withTenant(USER_BOTH, ORG_B, (q) => q.query("SELECT id FROM requests"));
  expect(b.rows.map((r) => r.id)).toEqual([REQ_B]);
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @sealedrfq/db db:up && pnpm --filter @sealedrfq/db db:migrate && pnpm --filter @sealedrfq/db test activeOrg`
Expected: FAIL — `withUser` is not exported, `withTenant` takes two arguments.

- [ ] **Step 3: Write `0007_active_org.sql`**

Add `app.active_org()` as the spec gives it: select `m.org_id` from `memberships` where the user matches `app.current_user_id()` and `m.org_id` equals `nullif(current_setting('app.current_org_id', true), '')::uuid`. `LANGUAGE sql STABLE SECURITY DEFINER`, granted to `sealedrfq_app`.

Then `DROP POLICY` and recreate, substituting `app.active_org()` for `app.member_orgs()`, on the procurement tables only: `requests`, `request_invitations`, `request_responses`, `documents`. Leave `users`, `organizations` and `memberships` on `app.member_orgs()` — listing which organizations you belong to is the one legitimately cross-organization read.

Header comment must say why both functions exist, because a later reader will otherwise collapse them back into one.

- [ ] **Step 4: Change `withTenant` and add `withUser` in `packages/db/src/index.ts`**

`withTenant` gains `orgId` as its second parameter and sets `app.current_org_id` with the same `set_config(..., true)` transaction-local, parameterised form already used for the user. Apply the existing UUID guard to `orgId` too. `withUser` is the same transaction wrapper setting only the user.

- [ ] **Step 5: Update existing callers**

`packages/db/src/{documents,requests,workspace,auth}.ts`. Every call that reads procurement data takes an `orgId` through to `withTenant`; the organization listing in `workspace.ts` uses `withUser`. Thread `orgId` up through the exported function signatures rather than defaulting it — a default here is the fail-open this task exists to remove.

- [ ] **Step 6: Run the full db suite**

Run: `pnpm --filter @sealedrfq/db test`
Expected: PASS, including the existing `tenancy.test.ts` and `requests.test.ts`.

- [ ] **Step 7: Typecheck the dependents**

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors at every `withTenant` call site. Fix them by passing the organization resolved from the current session; until Task 6 that is the user's single membership. Re-run until clean.

- [ ] **Step 8: Commit**

```bash
npx biome check --write packages/db apps/web
git add packages/db apps/web
git commit -m "Scope row-level security to one active organization"
```

---

## Task 2: Clerk installed, organizations enabled

Authentication works and the switcher renders. Nothing else changes yet, so this is independently reviewable and independently revertable.

**Files:**
- Create: `apps/web/middleware.ts`, `apps/web/components/v2/OrgSwitcher.tsx`
- Modify: `apps/web/app/layout.tsx`, `apps/web/package.json`, `.env.example`
- Test: manual, plus the typecheck

**Interfaces:**
- Produces: `auth()` available in server components and route handlers, yielding `userId`, `orgId`, `orgSlug`, `orgRole`, `has()`; `<OrgSwitcher />` for the chrome

- [ ] **Step 1: Install and configure**

Add `@clerk/nextjs` (v7 or later, an exact version at least two weeks old) to `apps/web`. Enable Organizations — `clerk enable orgs`, or Dashboard → Organizations settings. Choose **`Membership required`**: this is a B2B-only product and personal accounts have no meaning in it.

Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` to `.env.example` with empty values and a comment saying where they come from. Real values go in `.env.local`, which is gitignored.

Create one custom role, **`org:approver`**, for the second-approver requirement in RFC §4.1 step 5 and ADR-011's dual control. Give it `org:sys_memberships:read` and no management permissions: an approver signs off on a request, which is not the same authority as adding people to the organization. Workspace role still does not grant spending authority — `organization_signers` decides that, in Task 5.

- [ ] **Step 2: Add `apps/web/middleware.ts`**

`clerkMiddleware()` with a public-route matcher covering `/`, `/sign-in`, `/sign-up`, `/evidence`, `/docs`, `/.well-known/agent-card.json` and `/api/clerk/webhook`. The webhook must be public: Clerk calls it unauthenticated and verifies itself by signature.

- [ ] **Step 3: Wrap the app**

`ClerkProvider` in `apps/web/app/layout.tsx`, with `taskUrls={{ 'choose-organization': '/app/choose-organization' }}`.

- [ ] **Step 4: Add `OrgSwitcher`**

A thin client wrapper around `<OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/app/:slug/inbox" afterCreateOrganizationUrl="/app/:slug/inbox" />`. Not used in the chrome until Task 6.

- [ ] **Step 5: Verify a real sign-in**

Run: `cd apps/web && npx next dev -p 3111`, then sign up, create an organization, and confirm `auth()` returns a non-null `orgId` and `orgSlug` from a scratch server component. An `orgId` of `undefined` for a signed-in user means Organizations are not enabled on the instance — fix the instance, not the code.

- [ ] **Step 6: Commit**

```bash
npx biome check --write apps/web
git add apps/web .env.example
git commit -m "Add Clerk with organizations enabled"
```

---

## Task 3: Identity columns and company profile

**Files:**
- Create: `packages/db/migrations/0008_clerk_identity.sql`
- Test: `packages/db/test/identity.test.ts`

**Interfaces:**
- Produces: `users.clerk_user_id text UNIQUE NOT NULL`; `organizations.clerk_org_id text UNIQUE NOT NULL`; `memberships.clerk_role text NOT NULL`, `memberships.synced_at timestamptz NOT NULL`; `organizations` company profile columns

- [ ] **Step 1: Write the failing test**

```ts
it("requires a clerk id on every user and organization", async () => {
  await expect(
    admin.query("INSERT INTO users (id) VALUES (gen_random_uuid())"),
  ).rejects.toThrow(/clerk_user_id/);
});

it("refuses two users sharing a clerk id", async () => {
  await admin.query("INSERT INTO users (clerk_user_id) VALUES ('user_dup')");
  await expect(
    admin.query("INSERT INTO users (clerk_user_id) VALUES ('user_dup')"),
  ).rejects.toThrow(/unique|duplicate/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sealedrfq/db test identity`
Expected: FAIL — the column does not exist.

- [ ] **Step 3: Write `0008_clerk_identity.sql`**

Add the columns above. Add to `organizations`: `legal_name text`, `jurisdiction text`, `encrypted_company_number text`, `verification_status text NOT NULL DEFAULT 'self_declared'` with a `CHECK` over `self_declared | pending | issuer_verified | expired | revoked` (the RFC §4.1 step 2 states), and `legal_profile_visibility text NOT NULL DEFAULT 'organization'` with a `CHECK` over `public | organization | verification_only`.

Existing rows: the local database is development-only and `db:reset` is available, so add the `NOT NULL` columns with a backfill of `'migrated:' || id::text` in the same statement rather than inventing a two-phase deploy for data that does not exist anywhere real. Say that in the header comment so it is a decision and not an oversight.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @sealedrfq/db db:migrate && pnpm --filter @sealedrfq/db test`
Expected: PASS, whole suite.

- [ ] **Step 5: Commit**

```bash
npx biome check --write packages/db
git add packages/db
git commit -m "Key users and organizations to Clerk, and hold the company profile"
```

---

## Task 4: Membership projection by webhook

The RLS input, written by an endpoint the public internet can reach. Review Focus items 1 and 2 land here.

**Files:**
- Create: `apps/web/app/api/clerk/webhook/route.ts`, `packages/db/src/identity.ts`
- Modify: `packages/db/package.json` (add the `./identity` export), `packages/db/test/identity.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `pool` from `@sealedrfq/db`
- Produces, from `@sealedrfq/db/identity`:
  - `upsertUser(clerkUserId: string): Promise<string>` — returns the Postgres UUID, idempotent
  - `upsertOrganization(clerkOrgId: string, name: string): Promise<string>` — returns the UUID, idempotent
  - `upsertMembership(input: { clerkUserId: string; clerkOrgId: string; role: string; at: Date }): Promise<void>`
  - `removeMembership(input: { clerkUserId: string; clerkOrgId: string; at: Date }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
it("is idempotent: the same membership event twice leaves one row", async () => {
  await upsertMembership({ clerkUserId: "user_1", clerkOrgId: "org_1", role: "org:admin", at: T1 });
  await upsertMembership({ clerkUserId: "user_1", clerkOrgId: "org_1", role: "org:admin", at: T1 });
  const r = await pool.query("SELECT count(*) FROM memberships");
  expect(r.rows[0].count).toBe("1");
});

it("ignores a delete that is older than the row it would remove", async () => {
  // Out-of-order delivery: a stale `deleted` must not undo a newer `created`.
  await upsertMembership({ clerkUserId: "user_1", clerkOrgId: "org_1", role: "org:member", at: T2 });
  await removeMembership({ clerkUserId: "user_1", clerkOrgId: "org_1", at: T1 });
  const r = await pool.query("SELECT count(*) FROM memberships");
  expect(r.rows[0].count).toBe("1");
});

it("applies a delete that is newer", async () => {
  await upsertMembership({ clerkUserId: "user_1", clerkOrgId: "org_1", role: "org:member", at: T1 });
  await removeMembership({ clerkUserId: "user_1", clerkOrgId: "org_1", at: T2 });
  const r = await pool.query("SELECT count(*) FROM memberships");
  expect(r.rows[0].count).toBe("0");
});

it("ignores a stale role update", async () => {
  await upsertMembership({ clerkUserId: "user_1", clerkOrgId: "org_1", role: "org:member", at: T2 });
  await upsertMembership({ clerkUserId: "user_1", clerkOrgId: "org_1", role: "org:admin", at: T1 });
  const r = await pool.query("SELECT clerk_role FROM memberships");
  expect(r.rows[0].clerk_role).toBe("org:member");
});
```

And for the route, in `apps/web/test/clerkWebhook.test.ts`:

```ts
it("rejects a body with no signature", async () => {
  const res = await POST(new Request("http://x/api/clerk/webhook", { method: "POST", body: "{}" }));
  expect(res.status).toBe(400);
});

it("rejects a body whose signature does not match", async () => {
  // A forged event would otherwise write the table row-level security reads.
  const res = await POST(signedWith("wrong-secret", EVENT));
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @sealedrfq/db test identity && cd apps/web && npx vitest run clerkWebhook`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/db/src/identity.ts`**

Ordering is enforced with `synced_at`: every write carries the event's timestamp and the `WHERE` clause requires it to be at least as new as the stored row. That is what makes duplicate and out-of-order delivery converge rather than flap, and it belongs in the SQL rather than in a queue the application would have to keep.

`upsertUser` and `upsertOrganization` use `INSERT … ON CONFLICT (clerk_user_id) DO UPDATE … RETURNING id`, so a webhook for an unknown user creates the row rather than failing — Clerk may deliver a membership before its user.

These run on a privileged connection, not `withTenant`: a webhook has no session and the projection is precisely the table the application role must not be able to forge.

- [ ] **Step 4: Implement the route**

Verify the signature with Clerk's `verifyWebhook` from `@clerk/nextjs/webhooks` before reading the body as an event, then dispatch on `type` over `user.created`, `user.updated`, `organization.created`, `organization.updated`, `organizationMembership.created`, `organizationMembership.updated` and `organizationMembership.deleted`. An unrecognised type returns 200 without writing — Clerk retries non-2xx, and retrying forever on an event we do not handle is a loop.

Return 400 on a verification failure and 500 only on a database error, so Clerk's retry means "try again" rather than "this will never work".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @sealedrfq/db test && cd apps/web && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx biome check --write packages/db apps/web
git add packages/db apps/web
git commit -m "Project Clerk memberships into Postgres, in event order"
```

---

## Task 5: Wallets become links, not identity

Review Focus item 4 lands here.

**Files:**
- Create: `packages/db/migrations/0009_wallet_links.sql`
- Modify: `packages/db/src/identity.ts`, `packages/db/test/identity.test.ts`

**Interfaces:**
- Produces:
  - `wallet_links(id, user_id, chain_namespace, chain_id, address, challenge_id, verified_at, revoked_at)`, unique on `(chain_namespace, chain_id, lower(address))` where `revoked_at IS NULL`
  - `organization_signers(id, organization_id, wallet_link_id, approval_scope, limits_json, expires_at, revoked_at)`
  - `linkWallet(input: { userId: string; chainNamespace: string; chainId: number; address: string; challengeId: string }): Promise<string>`

Reads over `organization_signers` are deliberately **not** in this plan. The table is created here because `wallet_links` is, and the first caller is the Qualification Agent in a later plan — adding an accessor now would be an untested function with no consumer.

- [ ] **Step 1: Write the failing tests**

```ts
it("moves every existing users.wallet row into wallet_links", async () => {
  // The column is NOT NULL today, so a row that fails to migrate is a row that loses its wallet.
  const before = await admin.query("SELECT count(*) FROM users");
  const links = await admin.query("SELECT count(*) FROM wallet_links WHERE chain_namespace='eip155'");
  expect(links.rows[0].count).toBe(before.rows[0].count);
});

it("refuses the same address linked twice while both links are live", async () => {
  await linkWallet({ ...BASE, address: ADDR });
  await expect(linkWallet({ ...BASE, address: ADDR.toUpperCase() })).rejects.toThrow(/unique|duplicate/i);
});

it("permits relinking an address whose previous link was revoked", async () => {
  const id = await linkWallet({ ...BASE, address: ADDR });
  await admin.query("UPDATE wallet_links SET revoked_at=now() WHERE id=$1", [id]);
  await expect(linkWallet({ ...BASE, address: ADDR })).resolves.toBeTruthy();
});

it("permits one user to link wallets on two namespaces", async () => {
  await linkWallet({ ...BASE, chainNamespace: "eip155", chainId: 5042002, address: ADDR });
  await expect(
    linkWallet({ ...BASE, chainNamespace: "ccd", chainId: 0, address: CCD_ADDR }),
  ).resolves.toBeTruthy();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @sealedrfq/db test identity`
Expected: FAIL — `wallet_links` does not exist.

- [ ] **Step 3: Write `0009_wallet_links.sql`**

Create both tables with RLS enabled. Policies key on `app.active_org()` for `organization_signers`; `wallet_links` keys on `user_id = app.current_user_id()`, because a wallet belongs to a person and only becomes an organization's business through a signer row.

Migrate in the same file, in this order: insert one `wallet_links` row per existing `users.wallet` with `chain_namespace='eip155'`, `chain_id` from `NEXT_PUBLIC_ARC_CHAIN_ID`'s default of 5042002, `verified_at = users.created_at`; **then** drop the column. Dropping first would discard the data the insert needs.

Store the address lowercase and index on `lower(address)`, so a checksummed and an unchecksummed form of one address cannot both be live.

- [ ] **Step 4: Implement `linkWallet` and `activeSigner`**

`linkWallet` consumes the wallet challenge first — reuse `app.consume_challenge` from `0003_auth.sql` — then inserts. Verification order matters the same way it does for presentations: check, then spend, then write.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @sealedrfq/db db:migrate && pnpm --filter @sealedrfq/db test`
Expected: PASS, whole suite.

- [ ] **Step 6: Commit**

```bash
npx biome check --write packages/db
git add packages/db
git commit -m "Make a wallet a link to an account rather than the account"
```

---

## Task 6: The `/app/[org]` shell

Review Focus items 3 and 5 land here.

**Files:**
- Create: `apps/web/lib/v2/tenant.ts`, `apps/web/app/app/[org]/layout.tsx`, `apps/web/app/app/choose-organization/page.tsx`, `apps/web/app/app/page.tsx`
- Modify: `apps/web/components/Header.tsx`
- Move: `apps/web/app/workspace/*` → `apps/web/app/app/[org]/`
- Test: `apps/web/test/tenant.test.ts`

**Interfaces:**
- Consumes: `auth()` from Clerk (Task 2); `withTenant` (Task 1); `upsertUser`, `upsertOrganization` (Task 4)
- Produces: `requireOrg(slug: string): Promise<{ userId: string; orgId: string; orgSlug: string; role: string }>` — the single place a Clerk session becomes a Postgres tenant. Redirects rather than returning on any failure.

- [ ] **Step 1: Write the failing tests**

```ts
it("redirects identically for an organization that exists and one that does not", async () => {
  // A difference here enumerates other tenants' slugs.
  const foreign = await capture(() => requireOrg("someone-elses-org"));
  const missing = await capture(() => requireOrg("no-such-org-at-all"));
  expect(foreign).toEqual(missing);
});

it("redirects a signed-in user with no active organization to the choose task", async () => {
  mockAuth({ userId: "user_1", orgId: null, orgSlug: null });
  await expect(capture(() => requireOrg("anything"))).resolves.toBe("/app/choose-organization");
});

it("redirects when the url slug and the session slug disagree", async () => {
  mockAuth({ userId: "user_1", orgId: "org_1", orgSlug: "acme" });
  await expect(capture(() => requireOrg("other"))).resolves.toBe("/app/acme/inbox");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && npx vitest run tenant`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `requireOrg` in `apps/web/lib/v2/tenant.ts`**

Read `userId`, `orgId`, `orgSlug`, `orgRole` from `auth()`. No `userId` → redirect to `/sign-in`. No `orgId` → redirect to `/app/choose-organization`. `orgSlug !== slug` → redirect to the session's own `/app/<orgSlug>/inbox`, which is why a foreign slug and a nonexistent slug are indistinguishable: neither is ever looked up.

Resolve the Postgres UUIDs through `upsertUser`/`upsertOrganization` rather than requiring the webhook to have arrived, so a first sign-in is not a race. The projection still gates data access through `app.active_org()`; this only resolves identifiers.

- [ ] **Step 4: Add the layout and the choose-organization page**

`apps/web/app/app/[org]/layout.tsx` calls `requireOrg(params.org)` once and renders the chrome with `<OrgSwitcher />`. Every page beneath it is then already scoped — the invariant lives in one file instead of being repeated and eventually forgotten.

`apps/web/app/app/choose-organization/page.tsx` renders `<TaskChooseOrganization redirectUrlComplete="/app" />`. `apps/web/app/app/page.tsx` redirects to the session organization's inbox.

- [ ] **Step 5: Move the workspace pages and demote the wallet chip**

Move `apps/web/app/workspace/*` under `apps/web/app/app/[org]/`, renaming `requests` as it stands. Replace `currentUserId()` with the layout's `requireOrg` result.

Remove `<WalletChip />` from `apps/web/components/Header.tsx`. Its presence in the chrome is what taught the application to treat a wallet as the identity. It returns only on the pages that transact.

- [ ] **Step 6: Verify against the running app**

Run: `cd apps/web && npx next dev -p 3111`. Sign in, confirm `/app` lands on the inbox; visit another slug and confirm the redirect; create a second organization and confirm the switcher moves between them and that each shows only its own requests.

- [ ] **Step 7: Run everything**

Run: `npx tsc --noEmit && npx vitest run` in `apps/web`, then `pnpm --filter @sealedrfq/db test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npx biome check --write apps/web
git add apps/web
git commit -m "Scope the application to one organization per route"
```

---

## Task 7: Retire V1

**Files:**
- Create: `scripts/v1/settle-and-withdraw.mjs`
- Delete: `apps/web/app/rfqs/`, `apps/web/app/suppliers/`, `apps/web/app/admin/`, `apps/web/components/AdminPanel.tsx` and the V1-only components no remaining page imports
- Modify: `README.md`

**Interfaces:**
- Consumes: `contracts/deployments/5042002.json`

- [ ] **Step 1: Drain the V1 testnet escrow**

Write `scripts/v1/settle-and-withdraw.mjs`: for each `rfqId` in 1..`rfqCount`, call `settleDeposit(rfqId, bidder)` for every bidder whose deposit is still `Held` on an RFQ that is `Awarded` or `NoAward`, then `withdraw()` from each credited beneficiary. `--dry-run` prints what it would send.

Verified before writing this plan: testnet holds 4.650000 USDC, being `totalWithdrawable` 0.250000 and `totalHeld` 4.400000. Mainnet holds zero with `rfqCount` zero.

Run: `node scripts/v1/settle-and-withdraw.mjs --dry-run`, then without the flag.
Expected: the registry's USDC balance, `totalHeld` and `totalWithdrawable` all read zero afterwards.

This is not about the money, which is worthless test USDC. It demonstrates the exit path works rather than asserting it would, which is what G7 is actually asking.

- [ ] **Step 2: Delete the V1 surfaces**

Delete the directories above. Then `cd apps/web && npx tsc --noEmit` and delete whatever components are now unimported, repeating until clean. Do not delete `components/MemoVerifier.tsx` or anything `/evidence` or `/audit` imports.

- [ ] **Step 3: Record the retirement in `README.md`**

Keep the V1 addresses, labelled legacy, with the two calls that still reach any funds: `settleDeposit(rfqId, bidder)` then `withdraw()`, both permissionless, on immutable contracts that stay deployed. State that mainnet `rfqCount` is 0 and every balance is 0, checked 2026-11-10. G7 forbids hiding a withdrawal path; it does not require keeping a UI, and this paragraph is the difference.

- [ ] **Step 4: Run everything**

Run: `pnpm test` at the root
Expected: PASS. Contract tests are unaffected — no contract changed.

- [ ] **Step 5: Commit**

```bash
npx biome check --write apps/web README.md
git add -A
git commit -m "Retire the V1 application surfaces, keeping the contracts readable"
```

---

## Exit conditions

From the spec, all five must hold:

1. Two organizations exist with two members each at distinct roles.
2. A member of one cannot read the other's requests through the API or by guessing a document URL. **G4, stop/go.**
3. A membership revoked in Clerk but left in the Postgres projection is refused. (Task 1, step 1)
4. A session naming an organization the user was never a member of is refused. (Task 1, step 1)
5. A user in two organizations with one active sees only the active one's data. (Task 1, step 1)

## Deliberately deferred from the spec's schema block

Three tables the spec lists are **not** created here, because nothing in these seven tasks reads or
writes them and a table with no consumer is a guess at its own shape:

| Table | Lands in |
|---|---|
| `agent_profiles`, `agent_delegations` | the Surfaces plan, with `/app/[org]/agents` |
| `qualification_receipts` | the Qualification Agent plan, which is what writes one |

## Follow-on plans

- **Surfaces** — inbox, New Request wizard, my agents, audit; directory and profile thin. Depends on Task 6, and brings `agent_profiles` and `agent_delegations`.
- **Qualification Agent** — the agent module in `apps/agent`, the dedicated `CCD_QUALIFIER` key with the role granted to it and revoked from the compromised admin, challenge purpose `tender:<id>:bid:<org>:<signer>`, and `qualification_receipts`. Designed in the spec's own section; depends on Task 5 for `organization_signers`.

Both must keep the spec's vocabulary split: a Clerk invitation invites a person to a workspace, a
`request_invitation` invites a supplier organization to a tender and is a contract gate on Arc under
ADR-022. They share a word and nothing else.
