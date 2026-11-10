-- The write side of the memberships projection.
--
-- Clerk owns users, organizations and memberships, but `app.active_org()` reads `memberships` in
-- SQL, so Postgres holds a copy and a webhook keeps it current. That copy is the input to every
-- tenant policy, which makes whoever can write it the author of the tenant boundary.
--
-- The application role therefore never writes it. It has no write policy on users, organizations
-- or memberships (RLS already refuses), and the webhook route reaches them only through the four
-- functions below, which are the whole of what a public endpoint can do to the boundary. They
-- follow 0003 and 0006: SECURITY DEFINER, EXECUTE granted to the application role. They add what
-- 0007 established: a pinned search_path and public.* names, because a forged temp-schema
-- `memberships` would otherwise be found first. No table privilege is granted for them; the
-- definer's own rights do the writing.

-- A Clerk user has no wallet. The column was NOT NULL because wallet login was the only way in;
-- UNIQUE stays, and NULLs are distinct in a unique index, so wallet-only users are unaffected.
-- A placeholder would put a value that is not a wallet where the wallet-login lookup reads.
ALTER TABLE users ALTER COLUMN wallet DROP NOT NULL;

-- Why removal needs a record: a delete must stop a late-arriving create from resurrecting the
-- membership. Without this, `deleted(T2)` then `created(T1)` leaves a removed member with access,
-- and that is the one ordering failure that matters here. Clerk gives no ordering guarantee.
-- Kept apart from `memberships` so `active_org()` and the policies that read it stay untouched.
CREATE TABLE membership_removals (
  org_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  removed_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
ALTER TABLE membership_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON membership_removals FROM sealedrfq_app;

CREATE FUNCTION app.sync_user(p_clerk_user_id text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE v_id uuid;
BEGIN
  IF p_clerk_user_id IS NULL OR p_clerk_user_id = '' THEN
    RAISE EXCEPTION 'sync_user: clerk user id is required';
  END IF;
  -- A no-op SET so RETURNING yields the id on conflict as well as on insert.
  INSERT INTO public.users (clerk_user_id) VALUES (p_clerk_user_id)
  ON CONFLICT (clerk_user_id) DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- p_name NULL means "I do not know the name": a session knows the organization id but not its
-- name. It must never overwrite a real name with the id, so on conflict the stored name is kept.
CREATE FUNCTION app.sync_organization(p_clerk_org_id text, p_name text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE v_id uuid;
BEGIN
  IF p_clerk_org_id IS NULL OR p_clerk_org_id = '' THEN
    RAISE EXCEPTION 'sync_organization: clerk org id is required';
  END IF;
  INSERT INTO public.organizations (clerk_org_id, name)
  VALUES (p_clerk_org_id, coalesce(nullif(p_name, ''), p_clerk_org_id))
  ON CONFLICT (clerk_org_id) DO UPDATE
    SET name = coalesce(nullif(p_name, ''), public.organizations.name)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Ordering is decided here, in the statement, not in the caller: p_at is the event's own
-- timestamp and a write applies only if it is at least as new as what is stored. Duplicate and
-- out-of-order deliveries therefore converge. Ties go to removal, the fail-closed side.
CREATE FUNCTION app.sync_membership(
  p_clerk_user_id text, p_clerk_org_id text, p_role text, p_at timestamptz
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE v_user uuid; v_org uuid;
BEGIN
  IF p_at IS NULL OR p_role IS NULL OR p_role = '' THEN
    RAISE EXCEPTION 'sync_membership: role and event time are required';
  END IF;
  -- Clerk may deliver a membership before its user or organization; create the missing side.
  v_user := app.sync_user(p_clerk_user_id);
  v_org := app.sync_organization(p_clerk_org_id, NULL);
  -- Serialise events for one pair so the check and the write below cannot interleave.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text || v_user::text, 0));

  IF EXISTS (SELECT 1 FROM public.membership_removals r
              WHERE r.org_id = v_org AND r.user_id = v_user AND r.removed_at >= p_at) THEN
    RETURN;
  END IF;
  DELETE FROM public.membership_removals WHERE org_id = v_org AND user_id = v_user;

  INSERT INTO public.memberships (org_id, user_id, clerk_role, synced_at)
  VALUES (v_org, v_user, p_role, p_at)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET clerk_role = EXCLUDED.clerk_role, synced_at = EXCLUDED.synced_at
    WHERE public.memberships.synced_at <= EXCLUDED.synced_at;
END
$$;

CREATE FUNCTION app.remove_membership(
  p_clerk_user_id text, p_clerk_org_id text, p_at timestamptz
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE v_user uuid; v_org uuid;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'remove_membership: event time is required';
  END IF;
  v_user := app.sync_user(p_clerk_user_id);
  v_org := app.sync_organization(p_clerk_org_id, NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text || v_user::text, 0));

  -- A delete older than the row is stale: the member was (re)added after it.
  IF EXISTS (SELECT 1 FROM public.memberships m
              WHERE m.org_id = v_org AND m.user_id = v_user AND m.synced_at > p_at) THEN
    RETURN;
  END IF;
  DELETE FROM public.memberships WHERE org_id = v_org AND user_id = v_user;
  -- Recorded even when there was no row, so a create that overtook its own delete stays dead.
  INSERT INTO public.membership_removals (org_id, user_id, removed_at)
  VALUES (v_org, v_user, p_at)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET removed_at = greatest(public.membership_removals.removed_at, EXCLUDED.removed_at);
END
$$;

-- 0002 granted EXECUTE on every function then in `app`; these are newer, so grant by name, and
-- take PUBLIC's default away so the list below is the whole of it.
REVOKE ALL ON FUNCTION app.sync_user(text), app.sync_organization(text, text),
  app.sync_membership(text, text, text, timestamptz),
  app.remove_membership(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sync_user(text), app.sync_organization(text, text),
  app.sync_membership(text, text, text, timestamptz),
  app.remove_membership(text, text, timestamptz) TO sealedrfq_app;
