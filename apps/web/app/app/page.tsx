import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppIndex() {
  const s = await auth();
  if (!s.userId) return s.redirectToSignIn();
  if (!s.orgId) redirect("/app/choose-organization");
  // Slugs are optional in Clerk; the id stands in so an organization without one still has a URL.
  redirect(`/app/${s.orgSlug || s.orgId}/inbox`);
}
