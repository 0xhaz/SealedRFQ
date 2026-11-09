-- Sign-in, which is the one operation that cannot be tenant-scoped.
--
-- Everything else in this schema answers "what may this user see", but authentication runs before
-- there is a user to ask about: the row being created is the identity itself. That cannot satisfy a
-- policy keyed on `app.current_user_id`, and the first attempt failed exactly that way with
-- "new row violates row-level security policy for table users".
--
-- The answer is not a permissive INSERT policy, which would let any authenticated session mint
-- accounts. It is a small number of SECURITY DEFINER functions that do precisely the pre-auth work
-- and nothing else. The escalation is then named, greppable and reviewable, rather than spread
-- across a policy that is broader than it looks.

-- Challenges hold no tenant data, but they are the input to authentication, so direct access is
-- removed entirely: RLS on with no policy denies every row to the application role. The functions
-- below are the only route in.
ALTER TABLE wallet_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_challenges FROM sealedrfq_app;

CREATE OR REPLACE FUNCTION app.issue_challenge(p_wallet text, p_ttl interval)
  RETURNS TABLE (nonce text, expires_at timestamptz)
  LANGUAGE sql VOLATILE SECURITY DEFINER AS
$$
  INSERT INTO wallet_challenges (nonce, wallet, expires_at)
  VALUES (gen_random_uuid()::text, p_wallet, now() + p_ttl)
  RETURNING wallet_challenges.nonce, wallet_challenges.expires_at
$$;

-- Claim a nonce, once. Both rules live in the WHERE clause so there is no window between checking
-- and claiming: two requests racing the same nonce cannot both win.
CREATE OR REPLACE FUNCTION app.consume_challenge(p_nonce text)
  RETURNS TABLE (wallet text, expires_at timestamptz)
  LANGUAGE sql VOLATILE SECURITY DEFINER AS
$$
  UPDATE wallet_challenges SET consumed_at = now()
   WHERE wallet_challenges.nonce = p_nonce
     AND wallet_challenges.consumed_at IS NULL
     AND wallet_challenges.expires_at > now()
  RETURNING wallet_challenges.wallet, wallet_challenges.expires_at
$$;

-- Called only after a signature has been checked against a consumed challenge. It creates nothing
-- an attacker wants on its own: an account with no memberships sees no tenant data at all.
CREATE OR REPLACE FUNCTION app.upsert_user(p_wallet text)
  RETURNS uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER AS
$$
  INSERT INTO users (wallet) VALUES (p_wallet)
  ON CONFLICT (wallet) DO UPDATE SET wallet = EXCLUDED.wallet
  RETURNING id
$$;

GRANT EXECUTE ON FUNCTION app.issue_challenge(text, interval) TO sealedrfq_app;
GRANT EXECUTE ON FUNCTION app.consume_challenge(text) TO sealedrfq_app;
GRANT EXECUTE ON FUNCTION app.upsert_user(text) TO sealedrfq_app;
