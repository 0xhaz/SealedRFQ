-- Tie Postgres rows to Clerk identities, and hold the company profile Clerk has no place for.
--
-- Why clerk_user_id and clerk_org_id are nullable, and when that changes: NOT NULL here would
-- assert "every user came from Clerk". That is false while wallet login still creates users
-- (`app.login_wallet` in 0003 inserts by wallet alone), and a placeholder value would put
-- something that looks like a Clerk identity into the column the identity model keys on, where
-- Task 4's `ON CONFLICT (clerk_user_id)` would happily match it. A nullable column says the true
-- thing: some rows have a Clerk identity and some do not yet. UNIQUE still holds, because NULLs
-- are distinct in a unique index, so wallet-only rows coexist. NOT NULL is staged for Task 6,
-- when wallet login is removed and the claim becomes true. It is deferred, not forgotten.
--
-- memberships.clerk_role and synced_at are NOT NULL with defaults, unlike the ids above: every
-- existing insert supplies only (user_id, org_id), and bare NOT NULL would break them all.
-- 'org:member' is the least privileged truthful role. The membership projection (Task 4)
-- overwrites both on every sync.
--
-- No backfill and no two-phase deploy: nothing here needs one, and this database exists only in
-- local development, where `db:reset` recreates it.

ALTER TABLE users
  ADD COLUMN clerk_user_id text UNIQUE;

ALTER TABLE organizations
  ADD COLUMN clerk_org_id text UNIQUE,
  ADD COLUMN legal_name text,
  ADD COLUMN jurisdiction text,
  -- Intended to hold ciphertext. That is a contract the schema cannot verify: any text passes.
  -- The encryption is added by a later task, alongside the reader below.
  ADD COLUMN encrypted_company_number text,
  -- The states of RFC section 4.1 step 2. Self-declared is the default because nothing has been
  -- checked by an issuer at creation.
  ADD COLUMN verification_status text NOT NULL DEFAULT 'self_declared'
    CHECK (verification_status IN ('self_declared','pending','issuer_verified','expired','revoked')),
  -- The intended audience for the legal profile. This column enforces nothing by itself; the
  -- withheld grant below is what keeps the profile unreadable, and a later SECURITY DEFINER
  -- reader is expected to consult this value.
  ADD COLUMN legal_profile_visibility text NOT NULL DEFAULT 'organization'
    CHECK (legal_profile_visibility IN ('public','organization','verification_only'));

ALTER TABLE memberships
  ADD COLUMN clerk_role text NOT NULL DEFAULT 'org:member',
  ADD COLUMN synced_at timestamptz NOT NULL DEFAULT now();

-- Withhold the legal profile from the application role. `orgs_discoverable_read` (0005) is
-- row-level only and 0002 granted table-wide SELECT, so without this any session could read
-- these three columns of every discoverable organization. A column-level REVOKE does not undo a
-- table-level grant, so the table-level SELECT is dropped and every other column re-granted.
-- Fails closed: a column added later is unreadable until someone grants it on purpose. The only
-- way to these three is a SECURITY DEFINER reader that a later task adds; it must pin
-- `search_path = pg_catalog, pg_temp` and use `public.*` names like the other app functions.
-- Writes are left as they were: INSERT/UPDATE are already gated by row policies, and writing a
-- value discloses nothing. Revisit when the definer reader is added.
REVOKE SELECT ON organizations FROM sealedrfq_app;
GRANT SELECT (id, name, country, can_buy, can_supply, created_at, discoverable,
              clerk_org_id, verification_status, legal_profile_visibility)
  ON organizations TO sealedrfq_app;
