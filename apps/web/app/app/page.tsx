import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppIndex() {
  const { userId, orgSlug } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgSlug) redirect("/app/choose-organization");
  redirect(`/app/${orgSlug}/inbox`);
}
