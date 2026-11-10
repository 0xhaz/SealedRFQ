import { NewRequestForm } from "@/components/v2/NewRequestForm";
import { requireOrg } from "@/lib/v2/tenant";
import { myOrganizations } from "@sealedrfq/db/workspace";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewRequest({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { userId, orgId, orgSegment } = await requireOrg(org);

  // Offered only the organization actually acted as; the action ignores any other.
  const buying = (await myOrganizations(userId)).filter((o) => o.can_buy && o.id === orgId);

  return (
    <>
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
                This organisation cannot buy. <Link href={`/app/${orgSegment}/inbox`}>Back to the inbox</Link>.
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
    </>
  );
}
