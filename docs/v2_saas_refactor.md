# V2 SaaS refactor: identity, tenancy and the application shell

Design for the move from a wallet-first application to the organization workspace the V2 RFC
specifies. Written 2026-11-10, against RFC v0.5.0 (`docs/architecture_sealedRFQ_V2.md`, gitignored).

Target: Concordium Trusted Agents Hackathon, **2026-12-09 23:59 UTC**. Twenty-nine days.

This decides *what the application is*, which the workplan assumed was settled and is not. Phase 1
of `workplan_v2.md` says "wallet-based identity becomes organization membership backed by
PostgreSQL" in one line; that line is this document.

## The gap, as it actually stands today

The RFC is explicit that identity must never collapse into a wallet address:

- §9.6 lists eight identity layers, and says the `User` layer "proves account control, **not** legal
  signing power", with `WalletLink` as a separate layer below it
- §5: "**Do not conflate user login with a verified company**"
- ADR-011: "A connected wallet is not a verified company nor a purchase approver"

The implementation does the thing those forbid. Checked, not assumed:

| What the RFC requires | What exists |
|---|---|
| `users(auth_provider_subject, email_normalized, …)` | `users.wallet text UNIQUE NOT NULL` — a user *is* a wallet |
| `wallet_links(user_id, chain_namespace, chain_id, address, …)` | absent |
| `organization_signers(organization_id, wallet_link_id, approval_scope, limits_json)` | absent |
| `agent_profiles` / `agent_delegations` | absent, and §12.2 P0 item 3 needs them |
| `qualification_receipts` | absent |
| Sign-in by email / passkey / SSO | `SignIn` tells the user "Signing in proves you control a wallet" |

So the V2 workspace at `/workspace` is a wallet login wearing a SaaS label. Every surface built on
top of it inherits that, which is why this has to be fixed before the remaining Phase 4 work rather
than after.

A second consequence, less obvious: it also makes the supplier experience look worse than the design
intends. Wallet-first implies a supplier needs a browser wallet to do anything. Under the RFC they
need an account; a wallet is a capability linked to it, and the Concordium wallet is needed only at
the qualification step on a gated tender.

## Clerk owns identity; Postgres owns procurement

Authentication, organizations, memberships, roles and workspace invitations move to Clerk.
Everything procurement stays in Postgres under row-level security.

| Concern | Source of truth | Why there |
|---|---|---|
| Users, sign-in, passkeys, enterprise SSO | Clerk | replaces the wallet signature as login. RFC §4.1 asks for email/passkey/SSO; Clerk supplies all three, and we configure none of the per-org SSO connections for the hackathon |
| Organizations: identity, name, slug, seat cap | Clerk | gives `orgId`/`orgSlug` in the session and the switcher for free |
| Memberships and roles | Clerk, **projected into Postgres** | see ADR-024 below; RLS cannot query Clerk |
| Workspace invitations (invite a person) | Clerk | distinct from tender invitations — see "Two words that mean two things" |
| Company procurement profile | Postgres | legal name, jurisdiction, encrypted company number, verification status, visibility |
| `wallet_links`, `organization_signers` | Postgres | Clerk has no concept of a wallet or a spending limit |
| Requests, responses, documents, qualification receipts, agent profiles and delegations, audit events | Postgres | the procurement data, under RLS |

### ADR-024 — Clerk is authoritative for membership; Postgres holds the enforcement copy

**Status:** proposed, decided here. Contradicts RFC §5 and ADR-011 on one point and should be
recorded in the RFC rather than left as an implementation detail.

RFC §5 says "PostgreSQL is authoritative for organization memberships". With Clerk that is no longer
true, and pretending otherwise would mean two writable sources for the same fact.

The constraint that forces it: `packages/db/migrations/0002_rls.sql` keys every policy on
`app.current_user_id()` and resolves organizations through `app.member_orgs()`, which reads the
`memberships` table **in SQL**. A Postgres policy cannot call an HTTP API. So membership has to
exist in Postgres for row-level security to function at all, and RLS is the tenant boundary — G4 is
a stop/go gate and this is the mechanism it gates.

Therefore: Clerk is where membership is created and revoked. Postgres keeps a projection, synced by
Clerk webhooks (`organization.created`, `organization.updated`, `organizationMembership.created`,
`organizationMembership.updated`, `organizationMembership.deleted`), and RLS reads the projection.

**The asymmetry that matters.** A missed `organizationMembership.created` webhook fails closed:
Clerk admits the user, Postgres has no row, RLS denies. That is a bug but a safe one. A missed
`organizationMembership.deleted` webhook fails **open**: the user is gone from Clerk and the row
survives, so RLS would still admit them.

The mitigation is not "make webhooks reliable". It is that **the tenant is always taken from the
live, verified Clerk session, never from the projection**, and that access requires *both* to agree.

Today there is no mechanism for this, because there is no concept of an active organization at all.
`withTenant(userId)` sets only `app.current_user_id`, and `app.member_orgs()` returns
**every** organization the user belongs to:

```sql
-- as it stands, 0001_tenancy.sql
CREATE OR REPLACE FUNCTION app.member_orgs() RETURNS SETOF uuid ... AS
$$ SELECT org_id FROM memberships WHERE user_id = app.current_user_id() $$;
```

So a user in two organizations sees both organizations' data in every query. That is wrong once a
switcher exists, independently of Clerk, and fixing it is also what gives ADR-024 its teeth.

`withTenant` gains the active organization, set from the verified session alongside the user:

```sql
-- The session's organization, but only if the projection agrees the user is in it.
CREATE OR REPLACE FUNCTION app.active_org() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT m.org_id FROM memberships m
    WHERE m.user_id = app.current_user_id()
      AND m.org_id = nullif(current_setting('app.current_org_id', true), '')::uuid $$;
```

Procurement policies — requests, responses, documents, receipts, agents — switch from
`app.member_orgs()` to `app.active_org()`. `member_orgs()` survives for the one case that is
legitimately cross-organization: listing which organizations you belong to, so the switcher can be
drawn.

That is the whole of the two-gate argument, in SQL. A stale projection row grants nothing, because
the session must *also* name that organization and Clerk will not *issue* a token naming a revoked
one. A missing projection row denies. Unset means null means no rows, which is the existing
fail-closed default rather than a new one.

One clause has to be exact, because it is the failure this ADR exists to survive. A token issued
*before* the revocation keeps naming the organization for the rest of its lifetime — Clerk's
default is 60 seconds — so during that window the session gate is still satisfied and only the
projection can refuse. What makes it refuse is `0009`'s `app.remove_membership`: it deletes the row
and records a `membership_removals` tombstone, so a late or replayed `organizationMembership.created`
cannot resurrect it and the deny is permanent rather than a race the webhook order decides. So:
**neither side can admit anyone alone beyond the life of a session token already issued**, and the
tombstone is what holds the Postgres side shut once it has.

Two negative tests, not comments: revoke a membership in Clerk, leave the projection row, and assert
the organization's requests become unreadable; then set `app.current_org_id` to an organization the
user is not a member of and assert the same.

### Mechanics

`withTenant` throws unless the user id is a UUID, and Clerk ids look like `user_2abc…`. So `users`
keeps its UUID primary key and gains `clerk_user_id text UNIQUE`; the UUID guard stays meaningful
and nothing in the RLS layer has to learn about Clerk. `organizations` likewise gains
`clerk_org_id text UNIQUE`, holding the procurement profile that Clerk has no place for.

`users.wallet UNIQUE NOT NULL` is dropped. Its contents move to `wallet_links`, which permits many
wallets per user across namespaces (`eip155`, `ccd`) as RFC §9.6 requires.

`wallet_challenges` stays, repurposed rather than retired. It still proves control of an address by
signature; what changes is when. It used to be the login, and becomes the act of *linking* a wallet
to an account that already exists. The table and its single-use discipline are unchanged — only the
meaning of a successful check moves from "you are this user" to "this user controls this address",
which is the `WalletLink` layer RFC §9.6 asks for. The comment in `0006` already distinguishes the
two kinds of challenge for exactly this reason and stays accurate.

## Schema changes

```text
users              + clerk_user_id text UNIQUE NOT NULL
                   - wallet                      (moves to wallet_links)
organizations      + clerk_org_id text UNIQUE NOT NULL
                   + legal_name, jurisdiction, encrypted_company_number,
                     verification_status, legal_profile_visibility
memberships          becomes a projection: + clerk_role text, + synced_at
                     (kept, because RLS reads it — ADR-024)

wallet_links       (id, user_id, chain_namespace, chain_id, address,
                    challenge_id, verified_at, revoked_at)
                   unique (chain_namespace, chain_id, address) where revoked_at is null

organization_signers (id, organization_id, wallet_link_id, approval_scope,
                      limits_json, expires_at, revoked_at)

qualification_receipts (id, organization_id, request_id, principal_scope, issuer_id,
                        nullifier, expires_at, revocation_state, chain_tx, created_at)

agent_profiles     (id, organization_id, name, a2a_endpoint, concordium_agent_id,
                    card_digest, key_binding, status, verification_checked_at)
agent_delegations  (id, agent_id, organization_id, granted_by, allowed_actions,
                    tender_scope, max_amount, daily_limit, expires_at, revoked_at)
```

Plus the tenancy change ADR-024 turns on: `app.active_org()` added, `withTenant` gains an active
organization argument and sets `app.current_org_id`, and the procurement policies move from
`app.member_orgs()` to `app.active_org()`.

RLS on every new table, policies keyed through `app.active_org()`, and never reading another
RLS-protected table directly — `0002_rls.sql` already records why that caused "infinite recursion
detected in policy" the first time, and the new tables are exactly the kind that would do it again.

`company_smart_accounts` is **not** in this refactor. ADR-023 wants a company-controlled smart
account as the stable bidder; it is an accepted target and a testnet gate, not something that fits in
twenty-nine days alongside everything else. Until it exists, the bidder is an
`organization_signers` row and agents may draft but not submit unattended, which is what ADR-013's
mandatory implementation gate already requires.

## Routes

```
/                          public notice board — open tenders only, no account needed
/sign-in  /sign-up         Clerk
/app                       → /app/[org]/inbox, or the choose-organization task
/app/[org]/inbox           Draft→Approval→Open→Commit→Reveal→Evaluation→Award→Milestones→Closed
/app/[org]/requests/new    wizard: RFI|RFQ|RFP → Open|Invited → type-specific fields
/app/[org]/requests/[id]   phase-aware; respond, bid and reveal live here
/app/[org]/agents          my agents: badge, key binding, delegations, limits, revoke
/app/[org]/directory       supplier discovery and tender invitations
/app/[org]/profile         company profile: public / private / credential status
/app/[org]/settings        members and roles (Clerk) · wallets and signers (Postgres)
/app/[org]/audit/[id]      role-scoped evidence pack
/evidence                  system-level cross-chain evidence — public, already built
```

**The slug invariant.** Every org-scoped page asserts `orgSlug === params.slug` and redirects
otherwise. Without it a stale `orgSlug` in a session reaches another organization's URL. This is the
documented way the route-per-org pattern breaks, so it belongs in a shared layout check rather than
being repeated per page and forgotten once.

`WalletChip` comes out of the global header. A wallet belongs on the pages that transact — funding
escrow, committing a bid — not on every page, because its presence in the chrome is what taught the
whole application to treat a wallet as the identity.

## Roles and permissions

`org:admin` and `org:member` exist by default. Add one custom role, `org:approver`, for the
second-approver requirement in RFC §4.1 step 5 and ADR-011's dual control.

System permissions use their real slugs — `org:sys_memberships:manage`, `org:sys_profile:manage`,
and so on. Invented slugs such as `org:manage_members` are not errors: `has()` returns `false`
forever and the page simply never renders for anyone, which is a hard failure to notice.

Workspace role is not spending authority. Membership decides what you can *see*;
`organization_signers` decides who may create, approve or move money. RFC §9.6 states this directly
and it is the whole point of keeping signers in Postgres rather than inferring them from a role.

## Two words that mean two things

**Invitation.** Clerk invites a *person* to a workspace. RFC `request_invitations` invites a
*supplier organization* to a tender, and under ADR-022 that is a contract gate: Arc V2's `commitBid`
must reject an uninvited supplier even holding valid qualification. These share a word and nothing
else. They must not share code, types or vocabulary in the UI.

**Member.** A Clerk organization member is a human with a login. A tender's bidder is an
organization signer. Conflating them reintroduces "wallet possession implies authority", which is
exactly what ADR-011 exists to forbid.

## Retiring V1

Checked on chain today, because G7 requires a recheck before retiring any interface:

| | Arc mainnet | Arc testnet |
|---|---|---|
| `rfqCount` | 0 | 6 |
| `RFQRegistry` USDC | 0 | **4.650000** |
| `SealedRFQAdapter` / `AgenticCommerce` | 0 / 0 | 0 / 0 |

The testnet balance is fully accounted for: `totalWithdrawable` 0.25 and `totalHeld` 4.40, from our
own six walkthroughs. Nothing is stranded and none of it is real value.

**Removing the UI does not hide a withdrawal path.** `BidDeposit.settleDeposit` is permissionless
once an RFQ is Awarded or NoAward, and `PullPayments.withdraw` is callable by the beneficiary
directly. Both contracts are immutable and stay deployed, so both calls remain available to anyone
indefinitely through `cast`. G7 forbids a new deployment hiding withdrawal paths; it never required
keeping React pages, and documenting the addresses plus those two calls satisfies it.

Order: settle the testnet 4.40 and withdraw the 0.25 first — not because the money matters, but
because doing it demonstrates the exit path works instead of asserting that it would. Then delete
`/rfqs/*`, `/suppliers`, `/admin` and the V1-only components. The README keeps the V1 addresses
labelled legacy, with the two calls written down.

## What this changes about the Qualification Agent

The design sketched before this document binds a presentation to "the session's proven wallet". That
is the V1 assumption and would bake in the thing being removed.

Under this design the bidder is an **organization signer**. The challenge purpose becomes
`tender:<id>:bid:<org>:<signer-address>`, still within the existing 200-character `purpose` column
and still checked by `verifyQualificationPresentation`, so no schema change. The receipt belongs to
the organization, which is what `qualification_receipts(organization_id, …)` already said.

Everything else from that design survives: the agent module in `apps/agent`, the dedicated
`CCD_QUALIFIER` key with the role granted to it and revoked from the compromised admin, the caller
supplying a subject and never a nullifier, the agent fetching its own finality proof, and the four
refusals kept apart. It resumes after step 2 below.

## Order of work

1. **Identity layer.** Clerk installed and organizations enabled; `clerk_user_id` and
   `clerk_org_id`; `wallet_links` and `organization_signers`; membership projection by webhook;
   tenant taken from the live session; `users.wallet` dropped. Load-bearing — every later surface is
   scoped by `organization_id`.
2. **Route shell.** `/app/[org]/…`, switcher in the chrome, slug invariant in a shared layout, V1
   deleted, `WalletChip` demoted.
3. **Surfaces, in demo-storyboard order.** Inbox, New Request wizard, agents, audit. Directory and
   profile thin.
4. **Qualification Agent**, against the real organization and signer model.

## Exit conditions

Step 1 is done when all five hold:

1. Two organizations exist with two members each at distinct roles.
2. A member of one cannot read the other's requests through the API **or** by guessing a document
   URL. This is G4, and it is a stop/go gate.
3. A membership revoked in Clerk but left in the Postgres projection is refused.
4. A session naming an organization the user was never a member of is refused.
5. A user belonging to two organizations, with one active, sees only the active one's data — the
   behaviour that does not exist today at all.

Three and four are the tests ADR-024 turns on. Five is the one most likely to be assumed working
because it reads correctly in the UI while the query underneath returns both organizations' rows.

Step 2 is done when no route outside `/app/[org]/…` reads organization-scoped data, and a signed-in
user visiting another organization's slug is redirected rather than served.

## Out of scope before Dec 9

`company_smart_accounts` and unattended agent submission (ADR-023, ADR-013 gate); enterprise SSO
configuration beyond what Clerk gives without per-org setup; Clerk Billing; two-envelope RFP;
real KYB issuers; the supplier directory at any depth beyond search and invite; multi-tenant
billing. Stated here so that leaving them out is a decision on the record rather than an omission.
