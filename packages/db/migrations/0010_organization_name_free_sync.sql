-- A name-free way to resolve an organization, for callers that hold only a Clerk session.
--
-- `app.sync_organization(text, text)` (0009) writes the name. A session knows the organization id
-- but never its name, so the code that resolves an organization from a session calls this form,
-- which cannot rename anything: it creates the row if missing and otherwise changes nothing.
--
-- This does not remove the name-writing form from the application role, and it cannot: the webhook
-- runs on the same pool and needs it. Keeping the writers away from every other session needs a
-- separate login role for the webhook; until then the name-writing form is reachable by anything
-- that can run SQL as the application role.
CREATE FUNCTION app.sync_organization(p_clerk_org_id text) RETURNS uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT app.sync_organization(p_clerk_org_id, NULL) $$;

REVOKE ALL ON FUNCTION app.sync_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sync_organization(text) TO sealedrfq_app;
