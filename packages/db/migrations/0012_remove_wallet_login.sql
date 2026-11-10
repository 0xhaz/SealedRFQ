-- Wallet login is gone; make the schema say so.
--
-- Clerk owns identity (0008) and a wallet is a link to an account (0011), so the machinery that made
-- a wallet the account has no caller. This migration removes it and tightens the constraints that
-- were deliberately left loose while it existed.
--
-- What is kept from 0003, and why. `app.issue_challenge` and `app.upsert_user` are dropped: they
-- were login, and nothing issues a login or creates a user by wallet any more. `app.consume_challenge`
-- and `wallet_challenges` stay, because `linkWallet` spends a challenge to prove control of an
-- address before attaching it, and that single-use claim is exactly what linking needs. Dropping the
-- table would leave wallet linking with nothing to prove control against. Nothing issues challenges
-- yet (the issuing side was login's), so the linking flow that adds an issuer must bring its own
-- SECURITY DEFINER function rather than resurrect the login one.
--
-- 0003 created `consume_challenge` without pinning a search_path, which every other SECURITY DEFINER
-- function here does: a definer function resolving names through the caller's path lets a session
-- that can create temp tables shadow `wallet_challenges`. It is re-created with the pin and
-- `public.*` names. The signature and result are unchanged, so `linkWallet` is unaffected.

DROP FUNCTION app.issue_challenge(text, interval);
DROP FUNCTION app.upsert_user(text);

CREATE OR REPLACE FUNCTION app.consume_challenge(p_nonce text)
  RETURNS TABLE (wallet text, expires_at timestamptz)
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
  UPDATE public.wallet_challenges SET consumed_at = pg_catalog.now()
   WHERE public.wallet_challenges.nonce = p_nonce
     AND public.wallet_challenges.consumed_at IS NULL
     AND public.wallet_challenges.expires_at > pg_catalog.now()
  RETURNING public.wallet_challenges.wallet, public.wallet_challenges.expires_at
$$;
REVOKE ALL ON FUNCTION app.consume_challenge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.consume_challenge(text) TO sealedrfq_app;

-- users.wallet moved to wallet_links in 0011's backfill. Dropping the column also drops its UNIQUE
-- constraint.
ALTER TABLE users DROP COLUMN wallet;

-- memberships.role is the original member_role enum. Task 4 pointed reads at clerk_role, which can
-- hold Clerk's custom roles that a four-value enum cannot, and nothing writes the old column.
ALTER TABLE memberships DROP COLUMN role;
DROP TYPE member_role;

-- Now true: every user and organization row is created from a Clerk id, since the only remaining
-- writers are app.sync_user and app.sync_organization. 0008 staged this until wallet login went.
ALTER TABLE users ALTER COLUMN clerk_user_id SET NOT NULL;
ALTER TABLE organizations ALTER COLUMN clerk_org_id SET NOT NULL;
