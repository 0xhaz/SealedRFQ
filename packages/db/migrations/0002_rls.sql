-- Row-level security. This file is the tenant boundary.
--
-- Two things make it work, and both are easy to get wrong.
--
-- 1. The application connects as `sealedrfq_app`, which owns nothing and has no BYPASSRLS, so the
--    policies apply to it unconditionally. The migration role still owns the tables and therefore
--    still bypasses RLS, which is deliberate: the helper functions below depend on it. Connecting
--    the application as the owner would silently disable every policy here, so a test asserts the
--    app role is neither owner nor BYPASSRLS rather than leaving it to a code review.
--
-- 2. Policies never read another RLS-protected table directly. The first version of this file had
--    `requests` consult `request_invitations` while `request_invitations` consulted `requests`, and
--    Postgres rejected it with "infinite recursion detected in policy". The questions a policy
--    needs to ask are answered by SECURITY DEFINER functions instead, which run as the owner and so
--    see the underlying rows without re-entering the policy that called them.

CREATE ROLE sealedrfq_app NOLOGIN;
GRANT USAGE ON SCHEMA public, app TO sealedrfq_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sealedrfq_app;

-- Is the current user a member of the organization that owns this request?
CREATE OR REPLACE FUNCTION app.owns_request(req uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT EXISTS (
     SELECT 1 FROM requests r JOIN memberships m ON m.org_id = r.org_id
     WHERE r.id = req AND m.user_id = app.current_user_id()
   ) $$;

-- Is one of the current user's organizations invited to this request?
CREATE OR REPLACE FUNCTION app.invited_to_request(req uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT EXISTS (
     SELECT 1 FROM request_invitations i JOIN memberships m ON m.org_id = i.org_id
     WHERE i.request_id = req AND m.user_id = app.current_user_id()
   ) $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sealedrfq_app;

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships         ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_responses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents           ENABLE ROW LEVEL SECURITY;

-- You are yourself, and you can see people you share an organization with. Not the whole user
-- table: a supplier directory is a published thing, not a side effect of signing in.
CREATE POLICY users_self_and_colleagues ON users FOR SELECT USING (
  id = app.current_user_id()
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = users.id AND m.org_id IN (SELECT app.member_orgs())
  )
);

CREATE POLICY orgs_member_read ON organizations FOR SELECT USING (id IN (SELECT app.member_orgs()));
CREATE POLICY memberships_member_read ON memberships FOR SELECT USING (org_id IN (SELECT app.member_orgs()));

-- A request is visible to the organization that owns it and to an organization invited to it.
-- Nothing else grants sight of it: being verified, being a supplier, or knowing the id do not.
CREATE POLICY requests_owner_or_invited ON requests FOR SELECT USING (
  org_id IN (SELECT app.member_orgs()) OR app.invited_to_request(id)
);
CREATE POLICY requests_owner_write ON requests FOR ALL USING (org_id IN (SELECT app.member_orgs()))
  WITH CHECK (org_id IN (SELECT app.member_orgs()));

-- The buyer sees who was invited. An invited supplier sees only its own invitation, because the
-- guest list of a tender tells a bidder exactly who it is bidding against.
CREATE POLICY invitations_visibility ON request_invitations FOR SELECT USING (
  org_id IN (SELECT app.member_orgs()) OR app.owns_request(request_id)
);

-- A response belongs to the supplier who wrote it and the buyer who asked. Two suppliers invited to
-- the same request must never see each other's answer; that is the whole point of asking privately.
CREATE POLICY responses_author_or_buyer ON request_responses FOR SELECT USING (
  org_id IN (SELECT app.member_orgs()) OR app.owns_request(request_id)
);
CREATE POLICY responses_author_write ON request_responses FOR ALL USING (org_id IN (SELECT app.member_orgs()))
  WITH CHECK (org_id IN (SELECT app.member_orgs()));

-- Documents follow their owner. A document attached to a request is additionally visible to that
-- request's buyer, so a supplier's attachment reaches the person who asked for it and nobody else.
CREATE POLICY documents_owner_or_buyer ON documents FOR SELECT USING (
  org_id IN (SELECT app.member_orgs()) OR app.owns_request(request_id)
);
CREATE POLICY documents_owner_write ON documents FOR ALL USING (org_id IN (SELECT app.member_orgs()))
  WITH CHECK (org_id IN (SELECT app.member_orgs()));
