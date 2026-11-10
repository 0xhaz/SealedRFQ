"use client";

import { OrganizationSwitcher } from "@clerk/nextjs";

/*
 * Personal accounts are hidden because the product is organization-only; `:slug` is filled in by
 * Clerk with the slug of the organization just selected or created.
 */
export function OrgSwitcher() {
  return (
    <OrganizationSwitcher
      hidePersonal
      afterSelectOrganizationUrl="/app/:slug/inbox"
      afterCreateOrganizationUrl="/app/:slug/inbox"
    />
  );
}
