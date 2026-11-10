-- A wallet is a capability linked to an account, not the account.
--
-- Until now `users.wallet` made the wallet the login: one address, one chain, one person. Clerk now
-- owns identity, so a wallet is something a person attaches, and one person can attach several
-- across chains (an Arc address and a Concordium one are both legitimate). `wallet_links` holds
-- them; `organization_signers` records which of those wallets may transact for an organization.
--
-- The two are separate on purpose, and `organization_signers` is not a membership table. Being in
-- an organization decides what you may SEE; being a signer decides what may be SIGNED for it. An
-- analyst can read every bid and must not be able to spend; a treasurer can authorise payments
-- and need not read the tender. Folding one into the other would make every reader a spender.
--
-- `users.wallet` is NOT dropped here. `app.upsert_user` (0003) still inserts into it for wallet
-- login, and the auth tests exercise that path; the drop belongs with the change that removes
-- wallet login. The column is only copied from, below.

CREATE TABLE wallet_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- CAIP-2 namespace and reference: `eip155` + 5042002 for Arc, `ccd` + 0 for Concordium.
  chain_namespace text NOT NULL CHECK (length(chain_namespace) BETWEEN 1 AND 32),
  chain_id        integer NOT NULL,
  address         text NOT NULL CHECK (length(address) BETWEEN 1 AND 128),
  -- The wallet challenge spent to link it. Kept as evidence of how control was proven; no foreign
  -- key, because challenges are swept and a link must outlive the row that vouched for it.
  challenge_id    text,
  verified_at     timestamptz NOT NULL,
  revoked_at      timestamptz,
  -- EVM addresses are case-insensitive (checksum casing is only a typo guard), so they are stored
  -- lowercase. Other namespaces are not: Concordium addresses are base58, where case is data and
  -- lowercasing one would silently produce a different, unusable address.
  CHECK (chain_namespace <> 'eip155' OR address = lower(address))
);

-- Live links only: revoking frees the address to be linked again, by this user or another. The
-- index is on lower(address) so a checksummed and an unchecksummed form of one address cannot
-- both be live, whatever a caller forgot to normalise.
CREATE UNIQUE INDEX wallet_links_live_address
  ON wallet_links (chain_namespace, chain_id, lower(address)) WHERE revoked_at IS NULL;
CREATE INDEX wallet_links_user ON wallet_links (user_id);

CREATE TABLE organization_signers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wallet_link_id  uuid NOT NULL REFERENCES wallet_links(id) ON DELETE CASCADE,
  -- What this signer may do and up to how much; shaped by the first consumer, so left open.
  approval_scope  text NOT NULL,
  limits_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at      timestamptz,
  revoked_at      timestamptz
);
CREATE INDEX organization_signers_org ON organization_signers (organization_id);
CREATE INDEX organization_signers_wallet ON organization_signers (wallet_link_id);

ALTER TABLE wallet_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_signers ENABLE ROW LEVEL SECURITY;

-- A wallet belongs to a person, so it is keyed on the user and not on any organization: it stays
-- yours whichever organization you are acting for.
CREATE POLICY wallet_links_own ON wallet_links FOR ALL
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

-- Keyed directly on the organization column, so the policy reads no other protected table.
CREATE POLICY organization_signers_active_org ON organization_signers FOR ALL
  USING (organization_id = app.active_org()) WITH CHECK (organization_id = app.active_org());

-- 0002's blanket grant covered only the tables that existed then, so these start with nothing.
-- The application may link a wallet and read its own; it cannot UPDATE or DELETE, so a link is
-- revoked only by a privileged path (nothing in the application needs to yet). It gets no access
-- to organization_signers at all: nothing reads or writes signers yet, and authority to transact
-- should be granted by the change that adds the first caller, not left open in advance. The
-- policy above is already in place for that day.
GRANT SELECT, INSERT ON wallet_links TO sealedrfq_app;

-- Existing wallet logins become links, so the account keeps the wallet it signed in with. Rows
-- with no wallet (Clerk users) are skipped: a link with a null address would be meaningless.
-- verified_at is the account's creation time, the moment the wallet was proven by signing in.
-- Arc is chain 5042002, the NEXT_PUBLIC_ARC_CHAIN_ID default.
INSERT INTO wallet_links (user_id, chain_namespace, chain_id, address, verified_at)
  SELECT id, 'eip155', 5042002, lower(wallet), created_at FROM users WHERE wallet IS NOT NULL;
