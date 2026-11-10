"use client";

import { OrganizationSwitcher } from "@clerk/nextjs";

/*
 * Personal accounts are hidden because the product is organization-only.
 *
 * The destination is built from the organization rather than from Clerk's `:slug` placeholder,
 * which interpolates empty for a slugless organization and sent the user to `/app//inbox` — a path
 * that matches no route. Clerk slugs are optional (`OrganizationResource.slug` is `string | null`),
 * so this applies the same slug-or-id rule as `segment` in lib/v2/tenant.ts. `requireOrg` then
 * redirects an id to the slug if the organization has one, so either form lands correctly.
 *
 * `afterSelectOrganizationUrl` and `afterCreateOrganizationUrl` both accept
 * `(organization) => string` as well as a `:field` placeholder; the function form is the one that
 * can express a fallback.
 */
export function OrgSwitcher() {
  return (
    <OrganizationSwitcher
      hidePersonal
      afterSelectOrganizationUrl={(org) => `/app/${org.slug || org.id}/inbox`}
      afterCreateOrganizationUrl={(org) => `/app/${org.slug || org.id}/inbox`}
      afterLeaveOrganizationUrl="/app/choose-organization"
    />
  );
}
