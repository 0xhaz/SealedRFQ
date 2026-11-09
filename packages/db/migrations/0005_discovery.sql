-- Supplier discovery: the first deliberate hole in the tenant boundary.
--
-- Until now an organization was visible only to its own members, which makes inviting anyone
-- impossible: a buyer cannot invite a supplier it cannot name. Discovery has to open something.
--
-- What it opens is one row, by that organization's own choice. `discoverable` defaults to false, so
-- being listed is something an organization opts into rather than something it is subjected to, and
-- the policy below grants SELECT on the organizations row and nothing else. Requests, responses,
-- documents and memberships keep the policies they already had, so a discoverable supplier is
-- findable without any of its business becoming readable. That distinction is the point, and the
-- test beside this file is written to fail if it ever stops being true.
ALTER TABLE organizations ADD COLUMN discoverable boolean NOT NULL DEFAULT false;

-- Permissive policies are OR'd, so this adds to the membership rule rather than replacing it: a
-- member still sees their own organization whether or not it is listed.
CREATE POLICY orgs_discoverable_read ON organizations FOR SELECT USING (discoverable);

-- A directory is read far more often than it is written, and always filtered to suppliers.
CREATE INDEX organizations_discoverable ON organizations (discoverable) WHERE discoverable;
