-- Organizations, membership and the request objects that tenant isolation has to protect.
--
-- Row-level security is the boundary, not application code. Every query the product makes runs as
-- `sealedrfq_app`, which has no BYPASSRLS, so a forgotten WHERE clause leaks nothing: the policies
-- below decide what the row set even contains. The application states who is asking by setting
-- `app.current_user_id` for the duration of a transaction, and nothing else is trusted.

CREATE SCHEMA IF NOT EXISTS app;

-- Who is asking. NULL when unset, which every policy treats as "sees nothing" rather than
-- "sees everything": an unauthenticated connection must fail closed.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.current_user_id', true), '')::uuid $$;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet      text UNIQUE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  country     text NOT NULL DEFAULT '',
  -- An organization can buy and supply at once, so this is not an enum of one role.
  can_buy     boolean NOT NULL DEFAULT true,
  can_supply  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'approver', 'member');

CREATE TABLE memberships (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        member_role NOT NULL DEFAULT 'member',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

-- The organizations the current user belongs to. Written once and reused by every policy, so the
-- membership rule cannot drift between tables.
CREATE OR REPLACE FUNCTION app.member_orgs() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT org_id FROM memberships WHERE user_id = app.current_user_id() $$;

-- Sign-in challenges. Single-use and short-lived; a nonce that can be replayed is not a challenge.
CREATE TABLE wallet_challenges (
  nonce       text PRIMARY KEY,
  wallet      text NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX wallet_challenges_wallet ON wallet_challenges (wallet);

CREATE TYPE request_type AS ENUM ('RFI', 'RFQ', 'RFP');
CREATE TYPE request_status AS ENUM ('draft', 'open', 'closed', 'converted', 'cancelled');

CREATE TABLE requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type          request_type NOT NULL,
  status        request_status NOT NULL DEFAULT 'draft',
  title         text NOT NULL,
  -- An RFQ converted from an RFI keeps the link, so the lineage of a tender is never guesswork.
  parent_rfi_id uuid REFERENCES requests(id),
  -- Invite-only is the default. A request nobody was invited to is visible to its owner alone.
  invite_only   boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX requests_org ON requests (org_id);

CREATE TABLE request_invitations (
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, org_id)
);
CREATE INDEX request_invitations_org ON request_invitations (org_id);

-- A supplier's answer to an RFI. Private to the supplier that wrote it and the buyer that asked:
-- rival suppliers invited to the same request must not see each other's.
CREATE TABLE request_responses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  body        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_responses_request ON request_responses (request_id);

CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id  uuid REFERENCES requests(id) ON DELETE CASCADE,
  sha256      text NOT NULL,
  filename    text NOT NULL DEFAULT '',
  storage_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_org ON documents (org_id);
