# @sealedrfq/db

Tenant state for V2 in PostgreSQL: the projection of Clerk's organizations and members, plus
requests, responses, documents, wallet links and organization signers.

## Running it locally

```bash
pnpm --filter @sealedrfq/db db:up        # Postgres 17 on :5433
pnpm --filter @sealedrfq/db db:migrate   # schema, policies, app role
pnpm --filter @sealedrfq/db test
```

Port 5433 rather than 5432, so a Postgres you already run locally does not have to be stopped and
cannot be connected to by mistake.

## How isolation is enforced

By row-level security in the database, not by `WHERE` clauses in application code. A query that
forgets its tenant filter returns nothing it should not, because the policies decide what the row
set contains in the first place.

Two conditions make that true, and both fail silently if broken, so both are tested:

**The application owns nothing.** It connects as `sealedrfq_app`, which has no `BYPASSRLS` and owns
no tables. A table owner bypasses its own policies, so connecting as the migration role would leave
every policy in place and inert. `assertNotPrivileged()` refuses to start in that case.

**The acting user and organization are set per transaction.** `withTenant(userId, orgId, fn)` sets
`app.current_user_id` and `app.current_org_id` transaction-locally, so they are discarded at commit
and cannot leak onto the next borrower of a pooled connection. An unset user matches nothing rather
than everything: an unauthenticated request sees zero rows instead of all of them.

**Procurement is scoped to one active organization, not to all of a user's.** `app.active_org()`
returns the named organization only if the `memberships` projection confirms the user is in it, and
the policies on `requests`, `request_invitations`, `request_responses` and `documents` (and the
`owns_request` / `invited_to_request` helpers) use it. `app.member_orgs()` stays cross-organization
for `users`, `organizations` and `memberships`, because listing which organizations you belong to is
the one legitimate cross-organization read; `withUser(userId, fn)` is the wrapper for it. A named
organization the user is not in, or no organization, matches nothing. These `SECURITY DEFINER`
functions pin `search_path` so a temp table cannot shadow `memberships`.

Policies never read another protected table directly. The first version had `requests` consult
`request_invitations` while `request_invitations` consulted `requests`, and Postgres rejected it
with `infinite recursion detected in policy`. Cross-table questions go through `SECURITY DEFINER`
functions in the `app` schema, which run as the owner and so do not re-enter the calling policy.

## Where identity comes from

Clerk, not this database. Accounts, organizations and memberships are created and revoked in Clerk;
Postgres keeps a **projection** of them, because a row-level security policy cannot call an HTTP API
and `app.active_org()` has to resolve membership in SQL. `docs/v2_saas_refactor.md` argues this out
as ADR-024, including what the projection does when a revocation webhook is late.

The projection is written only by Clerk's verified webhook, through four `SECURITY DEFINER`
functions in the `app` schema — `sync_user`, `sync_organization`, `sync_membership`,
`remove_membership` (migration `0009`) — wrapped by `src/identity.ts`. The application role has no
direct write access to `memberships`, because that table is the second of the two gates and must not
be writable by the side it is meant to check. Each function applies an event only if it is at least
as new as the stored row, and `remove_membership` leaves a `membership_removals` tombstone so a
replayed or reordered `organizationMembership.created` cannot resurrect a revoked member.

There is no login here any more. `0012` dropped `app.issue_challenge` and `app.upsert_user`; nothing
mints a user or signs anyone in by wallet.

## Linking a wallet

A wallet is now a capability attached to an account that already exists, not the account. `0011`
holds two tables for it:

- `wallet_links` — the addresses a *person* has proven control of, one row per namespace and chain
  (`eip155` for Arc, `ccd` for Concordium). Keyed on the user, so it stays yours whichever
  organization you are acting for.
- `organization_signers` — which of those wallets may be signed *for* an organization, with a scope
  and limits. Deliberately not a membership table: being in an organization decides what you may
  **see**, being a signer decides what may be **signed**. Folding them together would make every
  reader a spender.

`wallet_challenges` survives from the wallet-login era, repurposed. `app.consume_challenge` is the
one function left of the three: it spends a nonce single-use and short-lived, both rules in one
`UPDATE ... WHERE` so there is no window between checking and claiming. Two requests racing the same
nonce cannot both win, which is tested. The table itself is revoked from the application role
entirely, so that function is the only way in.

What a successful check now means is "this user controls this address", not "you are this user".
`linkWallet` spends the challenge before inserting, so a replayed nonce links nothing, and it
refuses a challenge issued for a different address — otherwise a nonce obtained for a wallet you
control could be spent to claim one you do not. That refusal throws *after* the spend, inside the
transaction, so the spend rolls back with it: a caller's own bug does not burn the user's nonce. The
address is compared case-insensitively only for `eip155`, since a base58 address in different case
is a different account.

Unlike the projection, `wallet_links` is written through RLS as the user rather than by a privileged
function. It is ordinary tenant data; only the challenge needs the privileged door.

Verifying the signature is the caller's job, not this package's. `verifyWalletSignature` in
`@sealedrfq/shared` is the one to use: it handles contract accounts (a Safe) that ECDSA recovery
alone would reject.

## The request lifecycle

RFI, RFQ and RFP share one model with different powers. An RFI gathers information: it takes no
deposit, starts no escrow, awards nothing and binds no supplier to a price.

Converting one produces a **new** request rather than editing the RFI into a tender. Suppliers
answered the RFI knowing it bound them to nothing, and rewriting it in place would retroactively
change what they agreed to. The new request carries `parent_rfi_id` so the lineage is recoverable,
the RFI moves to `converted` and stops taking answers, and the tender arrives as a `draft`, because
a converted tender is a proposal to open one rather than an open one.

Legal moves live in one table in `requests.ts` instead of scattered `if` statements, so an illegal
move is refused in one place and the shape of the lifecycle is readable. `converted` and
`cancelled` are terminal.

## Private documents

Encrypted at rest with AES-256-GCM, and reachable only through a membership check.

Two things differ from the legacy public store. It is **not content-addressed**: V1 serves a
document at its sha256, which is right for a tender pack everyone should read and wrong for a
confidential one, because anyone holding a copy can compute the hash and fetch it. Possession of
the content becomes permission to read it. Here the storage key is random, and knowing it is still
not authorisation, since the row is behind row-level security either way.

And the bytes are encrypted, so a database dump, a stray backup or a misconfigured bucket yields
ciphertext. GCM's tag means an altered file is refused rather than returned changed. The sha256 is
still recorded, so a reader can verify they got the bytes that were stored; it is just not the
address.

`DOCUMENT_ENCRYPTION_KEY` is 32 bytes of hex and is required. A short key is refused rather than
padded, because padding one is a silent downgrade.

```bash
openssl rand -hex 32
```

## Discovery, the one hole in the boundary

A buyer cannot invite a supplier it cannot name, so discovery has to open something. What it opens
is one row, by that organization's own choice.

`organizations.discoverable` defaults to false, so being listed is opted into rather than imposed,
and the policy grants `SELECT` on the organization row and nothing else. Requests, responses,
documents and memberships keep the policies they already had. A listed supplier is **contactable,
not readable**, and a test asserts that a stranger browsing the directory still sees none of that
supplier's responses, documents or members.

Permissive policies are OR'd in Postgres, so this adds to the membership rule rather than replacing
it: a member still sees their own organization whether or not it is listed.

## Checking the tests are real

They pass with the policies switched off unless they are written to fail. Confirm by breaking it:

```bash
docker exec sealedrfq-pg psql -U sealedrfq -d sealedrfq \
  -c "ALTER TABLE request_responses DISABLE ROW LEVEL SECURITY;"
pnpm --filter @sealedrfq/db test     # five tests should fail, including the rival-leak one
docker exec sealedrfq-pg psql -U sealedrfq -d sealedrfq \
  -c "ALTER TABLE request_responses ENABLE ROW LEVEL SECURITY;"
```

Without a database the suite skips rather than fails, so that "Docker is not running" and "isolation
is broken" do not look the same.

Test files run one at a time (`fileParallelism: false`). They share a single Postgres and each
resets the tables it uses, so in parallel one suite's reset wipes another's fixtures mid-run and the
failure surfaces in whichever file lost the race rather than the one that caused it.
