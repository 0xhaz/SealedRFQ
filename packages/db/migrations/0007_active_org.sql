-- One active organization per request, not every organization the user belongs to.
--
-- 0002 scoped the procurement tables to `app.member_orgs()`, which is every organization the user
-- is in. For a user in two organizations that means both organizations' requests, responses and
-- documents appear in every query, whichever one they are working as. The user is not the tenant;
-- the organization they are acting for is.
--
-- Two functions now exist and they must not be merged back into one:
--
-- - `app.member_orgs()` answers "which organizations am I in?". It stays cross-organization on
--   purpose, because drawing an organization switcher is a read that has to span them. It keeps
--   guarding `users`, `organizations` and `memberships`, which are about who belongs, not about
--   procurement work.
-- - `app.active_org()` answers "which one am I acting as?". It guards the procurement tables. The
--   caller names the organization in `app.current_org_id`, but naming one is a claim, not a grant:
--   it is returned only if the memberships projection confirms the user is in it. A stale or
--   forged value therefore yields NULL, and NULL matches no row, which is the same fail-closed
--   default as an unset user.
--
-- Collapsing them would either hide the switcher's data or reopen the cross-organization read.

-- Every SECURITY DEFINER function here pins search_path. Without it `memberships` resolves against
-- the caller's path, which searches pg_temp first, and the app role may create temp tables: a
-- forged temp `memberships` would make active_org() confirm any organization and open every policy
-- below. Objects are therefore schema-qualified (public.*, app.*) rather than found by search.
CREATE OR REPLACE FUNCTION app.active_org() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT m.org_id FROM public.memberships m
    WHERE m.user_id = app.current_user_id()
      AND m.org_id = nullif(current_setting('app.current_org_id', true), '')::uuid $$;

-- member_orgs() is redefined only to pin its search_path; its meaning is unchanged from 0001.
CREATE OR REPLACE FUNCTION app.member_orgs() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT org_id FROM public.memberships WHERE user_id = app.current_user_id() $$;

GRANT EXECUTE ON FUNCTION app.active_org() TO sealedrfq_app;

-- The two helpers from 0002 asked "is any of my organizations the owner / invited?". Left alone
-- they would keep leaking across organizations through the visibility policies below, so they
-- ask about the active organization only.
CREATE OR REPLACE FUNCTION app.owns_request(req uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT EXISTS (
     SELECT 1 FROM public.requests r WHERE r.id = req AND r.org_id = app.active_org()
   ) $$;

CREATE OR REPLACE FUNCTION app.invited_to_request(req uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT EXISTS (
     SELECT 1 FROM public.request_invitations i WHERE i.request_id = req AND i.org_id = app.active_org()
   ) $$;

DROP POLICY requests_owner_or_invited ON requests;
DROP POLICY requests_owner_write ON requests;
CREATE POLICY requests_owner_or_invited ON requests FOR SELECT USING (
  org_id = app.active_org() OR app.invited_to_request(id)
);
CREATE POLICY requests_owner_write ON requests FOR ALL USING (org_id = app.active_org())
  WITH CHECK (org_id = app.active_org());

DROP POLICY invitations_visibility ON request_invitations;
CREATE POLICY invitations_visibility ON request_invitations FOR SELECT USING (
  org_id = app.active_org() OR app.owns_request(request_id)
);

DROP POLICY responses_author_or_buyer ON request_responses;
DROP POLICY responses_author_write ON request_responses;
CREATE POLICY responses_author_or_buyer ON request_responses FOR SELECT USING (
  org_id = app.active_org() OR app.owns_request(request_id)
);
CREATE POLICY responses_author_write ON request_responses FOR ALL USING (org_id = app.active_org())
  WITH CHECK (org_id = app.active_org());

DROP POLICY documents_owner_or_buyer ON documents;
DROP POLICY documents_owner_write ON documents;
CREATE POLICY documents_owner_or_buyer ON documents FOR SELECT USING (
  org_id = app.active_org() OR app.owns_request(request_id)
);
CREATE POLICY documents_owner_write ON documents FOR ALL USING (org_id = app.active_org())
  WITH CHECK (org_id = app.active_org());
