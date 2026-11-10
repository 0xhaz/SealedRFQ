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
-- memberships.clerk_role and synced_at are NOT NULL with defaults, unlike the ids above:
-- fixtures and any pre-Clerk membership seed (user_id, org_id) only, and a default role of
-- 'org:member' is the least privileged truthful value. The membership projection (Task 4)
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
  -- Stored encrypted by the application; the database never sees the plaintext number.
  ADD COLUMN encrypted_company_number text,
  -- The states of RFC section 4.1 step 2. Self-declared is the default because nothing has been
  -- checked by an issuer at creation.
  ADD COLUMN verification_status text NOT NULL DEFAULT 'self_declared'
    CHECK (verification_status IN ('self_declared','pending','issuer_verified','expired','revoked')),
  -- Who may see the legal profile; the narrowest useful default is the organization itself.
  ADD COLUMN legal_profile_visibility text NOT NULL DEFAULT 'organization'
    CHECK (legal_profile_visibility IN ('public','organization','verification_only'));

ALTER TABLE memberships
  ADD COLUMN clerk_role text NOT NULL DEFAULT 'org:member',
  ADD COLUMN synced_at timestamptz NOT NULL DEFAULT now();
