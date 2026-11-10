import { Header } from "@/components/Header";
import { NewRequestForm } from "@/components/v2/NewRequestForm";
import { activeOrgId, currentUserId } from "@/lib/v2/session";
import { myOrganizations } from "@sealedrfq/db/workspace";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewRequest() {
  const userId = await currentUserId();
  if (!userId) redirect("/workspace");

  // Offered only the organization actually acted as; the action ignores any other.
  const orgId = await activeOrgId(userId);
  const buying = (await myOrganizations(userId)).filter((o) => o.can_buy && o.id === orgId);

  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">New request</h2>
        <p className="desk-head-sub">
          Start with an RFI when you want to know what is possible, and convert it to a tender once
          you know what to ask for.
        </p>
      </section>

      <div className="grid">
        <div className="col">
          {buying.length === 0 ? (
            <div className="panel">
              <div className="head">Nothing to post from</div>
              <div className="note" style={{ margin: "0 20px 18px" }}>
                None of your organisations can buy. <Link href="/workspace">Back to the workspace</Link>.
              </div>
            </div>
          ) : (
            <NewRequestForm organisations={buying.map((o) => ({ id: o.id, name: o.name }))} />
          )}
        </div>

        <div className="right">
          <div className="panel">
            <div className="head">RFI or RFQ</div>
            <div className="note">
              An <b>RFI</b> gathers information. It takes no deposit, starts no escrow, awards
              nothing and binds no supplier to a price, so suppliers can answer openly.
            </div>
            <div className="note">
              An <b>RFQ</b> is binding and enters the sealed-bid lifecycle. Converting an RFI
              produces a new request rather than rewriting the old one, because the people who
              answered did so knowing it committed them to nothing.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
