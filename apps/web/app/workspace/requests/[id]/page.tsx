import { Header } from "@/components/Header";
import { RequestActions } from "@/components/v2/RequestActions";
import { currentUserId } from "@/lib/v2/session";
import { getRequest, myOrganizations, responsesFor } from "@sealedrfq/db/workspace";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) redirect("/workspace");

  // Invisible and absent are the same answer here, deliberately. A request you were not invited to
  // should not be distinguishable from one that does not exist, or the id becomes an oracle.
  const request = await getRequest(userId, id);
  if (!request) notFound();

  const [orgs, responses] = await Promise.all([myOrganizations(userId), responsesFor(userId, id)]);
  const isOwner = orgs.some((o) => o.id === request.org_id);
  const mySupplierOrgs = orgs.filter((o) => o.can_supply && o.id !== request.org_id);

  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">{request.title}</h2>
        <p className="desk-head-sub">
          {request.type} from {request.org_name}, {request.status}
          {request.parent_rfi_id && (
            <>
              {" · converted from "}
              <Link className="linklike" href={`/workspace/requests/${request.parent_rfi_id}`}>
                the original RFI
              </Link>
            </>
          )}
        </p>
      </section>

      <div className="grid">
        <div className="col">
          <div className="panel">
            <div className="head">
              Responses
              <span className="hint">
                {isOwner ? "every answer to this request" : "yours only"}
              </span>
            </div>
            {responses.length === 0 ? (
              <div className="note" style={{ margin: "0 20px 18px" }}>
                {isOwner
                  ? "Nobody has answered yet. Invited suppliers see this request on their own workspace."
                  : "You have not answered yet."}
              </div>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Answer</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.org_name}</b>
                      </td>
                      <td>{r.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {isOwner && responses.length > 0 && (
              <div className="note" style={{ margin: "0 20px 18px" }}>
                Suppliers invited to the same request cannot see each other's answers. That is
                enforced by the database rather than by this page.
              </div>
            )}
          </div>
        </div>

        <div className="right">
          <RequestActions
            requestId={request.id}
            status={request.status}
            type={request.type}
            title={request.title}
            isOwner={isOwner}
            invitedCount={request.invited_count}
            supplierOrgs={mySupplierOrgs.map((o) => ({ id: o.id, name: o.name }))}
            hasResponded={responses.some((r) => mySupplierOrgs.some((o) => o.id === r.org_id))}
          />
        </div>
      </div>
    </div>
  );
}
