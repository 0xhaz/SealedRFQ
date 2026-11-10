import { requireOrg } from "@/lib/v2/tenant";
import { myOrganizations, visibleRequests } from "@sealedrfq/db/workspace";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PHASE: Record<string, string> = {
  draft: "not yet open",
  open: "taking responses",
  closed: "closed",
  converted: "converted to a tender",
  cancelled: "cancelled",
};

export default async function Inbox({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  // Run again here although the layout has: Next renders a layout and its page independently, so a
  // page cannot assume the layout's redirect happened. The call is memoised per request.
  const { userId, orgId, orgSlug, role } = await requireOrg(org);
  const [orgs, requests] = await Promise.all([
    myOrganizations(userId),
    visibleRequests(userId, orgId),
  ]);
  // Only the organization acted as. The others are one switch away, not on this page.
  const active = orgs.find((o) => o.id === orgId);

  return (
    <>
      <section className="desk-head">
        <h2 className="section-title">Inbox</h2>
        <p className="desk-head-sub">
          What you can see here is decided by the database, not by this page: the requests your
          active organisation owns and the ones it was invited to, and nothing else. Another of your
          organisations' requests will not appear until you switch to it.
        </p>
      </section>

      <div className="grid">
        <div className="col">
          <div className="panel">
            <div className="head">Acting as</div>
            {active ? (
              <table className="ledger">
                <tbody>
                  <tr className="row">
                    <td data-label="Organisation">
                      <b>{active.name}</b>
                      {active.country && <span className="hint"> {active.country}</span>}
                    </td>
                    <td className="mono-sm" data-label="Role">
                      {role}
                    </td>
                    <td className="hint" data-label="Can">
                      {[active.can_buy && "buy", active.can_supply && "supply"]
                        .filter(Boolean)
                        .join(" and ")}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="note" style={{ margin: "0 20px 18px" }}>
                Clerk says you are acting for this organisation, but the database has no membership
                for you in it yet. Membership is what grants sight of a request, so nothing will
                show until it arrives. That is the intended behaviour rather than an empty state to
                apologise for.
              </div>
            )}
          </div>

          <div className="panel">
            <div className="head">
              Requests
              <span className="hint">
                {requests.length === 0 ? "nothing visible" : `${requests.length} visible`}
              </span>
            </div>
            {requests.length === 0 ? (
              <div className="note" style={{ margin: "0 20px 18px" }}>
                No requests this organisation can see. A request is visible to the organisation that
                owns it and to any organisation invited to it.
              </div>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Responses</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr className="row" key={r.id}>
                      <td data-label="Title">
                        <Link className="linklike" href={`/app/${orgSlug}/requests/${r.id}`}>
                          {r.title}
                        </Link>
                        <span className="hint"> {r.org_name}</span>
                      </td>
                      <td className="mono-sm" data-label="Type">
                        {r.type}
                      </td>
                      <td className="hint" data-label="Status">
                        {PHASE[r.status] ?? r.status}
                      </td>
                      <td data-label="Responses">{r.response_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="right">
          <div className="panel">
            <div className="head">Actions</div>
            <div style={{ padding: "0 20px 18px" }}>
              {active?.can_buy && (
                <>
                  <Link className="btn-primary" href={`/app/${orgSlug}/requests/new`}>
                    New request
                  </Link>
                  <span className="under-button">
                    An RFI asks suppliers what is possible. It takes no deposit and binds nobody.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
