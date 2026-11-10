import { redirect } from "next/navigation";

// The bare organization URL, as a bookmark or a hand-typed address would arrive. The layout has
// already checked the slug, so this only has to pick where inside the organization to land.
export default async function OrgRoot({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  redirect(`/app/${org}/inbox`);
}
