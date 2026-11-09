-- Who may invite.
--
-- 0002 gave request_invitations a read policy and no write policy, so the buyer could see an empty
-- guest list and never add to it. The first attempt to invite failed with "new row violates
-- row-level security policy", which is the right failure: with RLS on and no policy, a write is
-- denied rather than quietly allowed.
--
-- Scoped to INSERT, UPDATE and DELETE rather than ALL, so the existing SELECT rule keeps deciding
-- visibility on its own. An invited supplier still sees only its own invitation and not the rest of
-- the guest list, which would tell a bidder exactly who it is bidding against.
CREATE POLICY invitations_buyer_write ON request_invitations
  FOR INSERT WITH CHECK (app.owns_request(request_id));

CREATE POLICY invitations_buyer_revoke ON request_invitations
  FOR DELETE USING (app.owns_request(request_id));
