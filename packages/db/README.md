# @sealedrfq/db

Tenant state for V2: organizations, members, requests, responses and documents, in PostgreSQL.

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

**The acting user is set per transaction.** `withTenant(userId, fn)` sets `app.current_user_id` with
`SET LOCAL`, so it is discarded at commit and cannot leak onto the next borrower of a pooled
connection. An unset user matches nothing rather than everything: an unauthenticated request sees
zero rows instead of all of them.

Policies never read another protected table directly. The first version had `requests` consult
`request_invitations` while `request_invitations` consulted `requests`, and Postgres rejected it
with `infinite recursion detected in policy`. Cross-table questions go through `SECURITY DEFINER`
functions in the `app` schema, which run as the owner and so do not re-enter the calling policy.

## Signing in

Authentication is the one operation that cannot be tenant-scoped: the row being created *is* the
identity, so it cannot satisfy a policy keyed on the current user. The first attempt failed exactly
that way, with `new row violates row-level security policy for table "users"`.

The fix is not a permissive INSERT policy, which would let any session mint accounts. Sign-in goes
through three `SECURITY DEFINER` functions in the `app` schema that do the pre-auth work and nothing
else, so the privilege escalation is named and greppable rather than hidden in a policy that is
broader than it looks. `wallet_challenges` is revoked from the application role entirely; those
functions are the only way in.

A nonce is single-use and short-lived, and both rules live in one `UPDATE ... WHERE` so there is no
window between checking and claiming. Two requests racing the same nonce cannot both win, which is
tested. A wrong signature still burns the nonce, so a stolen one cannot be ground against.

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

## Checking the tests are real

They pass with the policies switched off unless they are written to fail. Confirm by breaking it:

```bash
docker exec sealedrfq-pg psql -U sealedrfq -d sealedrfq \
  -c "ALTER TABLE request_responses DISABLE ROW LEVEL SECURITY;"
pnpm --filter @sealedrfq/db test     # four tests should fail, including the rival-leak one
docker exec sealedrfq-pg psql -U sealedrfq -d sealedrfq \
  -c "ALTER TABLE request_responses ENABLE ROW LEVEL SECURITY;"
```

Without a database the suite skips rather than fails, so that "Docker is not running" and "isolation
is broken" do not look the same.

Test files run one at a time (`fileParallelism: false`). They share a single Postgres and each
resets the tables it uses, so in parallel one suite's reset wipes another's fixtures mid-run and the
failure surfaces in whichever file lost the race rather than the one that caused it.
