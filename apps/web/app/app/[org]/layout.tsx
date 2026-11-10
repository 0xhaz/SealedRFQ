import { Header } from "@/components/Header";
import { OrgSwitcher } from "@/components/v2/OrgSwitcher";
import { requireOrg } from "@/lib/v2/tenant";
import { UserButton } from "@clerk/nextjs";

/**
 * Every page under `/app/[org]` is scoped by this one call. The invariant lives here rather than
 * in each page because a page that forgot it would still render.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  await requireOrg(org);
  return (
    <div className="shell">
      <Header />
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0" }}>
        <OrgSwitcher />
        <div className="spacer" />
        <UserButton />
      </div>
      {children}
    </div>
  );
}
