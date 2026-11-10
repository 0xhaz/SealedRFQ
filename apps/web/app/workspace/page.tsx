import { Header } from "@/components/Header";
import { SignIn } from "@/components/v2/SignIn";
import { SignOut } from "@/components/v2/SignOut";
import { activeOrgId, currentUserId } from "@/lib/v2/session";
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

export default async function Workspace() {
  const userId = await currentUserId();

  if (!userId) {
    return (
      <div className="shell">
        <Header />
        <section className="desk-head">
          <h2 className="section-title">Workspace</h2>
          <p className="desk-head-sub">
            Organisations, requests and responses. Signing in proves you control a wallet; it does
            not move funds and costs nothing.
          </p>
        </section>
        <div className="grid">
          <div className="col">
            <div className="panel">
              <div className="head">Sign in</div>
              <div style={{ padding: "0 20px 18px" }}>
                <SignIn />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const orgId = await activeOrgId(userId);
  const [orgs, requests] = await Promise.all([
    myOrganizations(userId),
    orgId ? visibleRequests(userId, orgId) : [],
  ]);

  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">Workspace</h2>
        <p className="desk-head-sub">
          What you can see here is decided by the database, not by this page: you see your
          organisations' requests and the ones you were invited to, and nothing else.
        </p>
      </section>

      <div className="grid">
        <div className="col">
          <div className="panel">
            <div className="head">
              Your organisations
              <span className="hint">{orgs.length === 0 ? "none yet" : `${orgs.length}`}</span>
            </div>
            {orgs.length === 0 ? (
              <div className="note" style={{ margin: "0 20px 18px" }}>
                This wallet is not a member of any organisation. Membership is what grants sight of
                a request, so until someone adds you there is nothing to show. That is the intended
                behaviour rather than an empty state to apologise for.
              </div>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Organisation</th>
                    <th>Role</th>
                    <th>Can</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <b>{o.name}</b>
                        {o.country && <span className="hint"> {o.country}</span>}
                      </td>
                      <td className="mono-sm">{o.role.replace(/^org:/, "")}</td>
                      <td className="hint">
                        {[o.can_buy && "buy", o.can_supply && "supply"].filter(Boolean).join(" and ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                No requests you can see. A request is visible to the organisation that owns it and
                to any organisation invited to it.
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
                    <tr key={r.id}>
                      <td>
                        <Link className="linklike" href={`/workspace/requests/${r.id}`}>
                          {r.title}
                        </Link>
                        <span className="hint"> {r.org_name}</span>
                      </td>
                      <td className="mono-sm">{r.type}</td>
                      <td className="hint">{PHASE[r.status] ?? r.status}</td>
                      <td>{r.response_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="right">
          <div className="panel">
            <div className="head">Signed in</div>
            <div style={{ padding: "0 20px 18px" }}>
              {orgs.some((o) => o.can_buy) && (
                <>
                  <Link className="btn-primary" href="/workspace/requests/new">
                    New request
                  </Link>
                  <span className="under-button">
                    An RFI asks suppliers what is possible. It takes no deposit and binds nobody.
                  </span>
                </>
              )}
              <div style={{ marginTop: 14 }}>
                <SignOut />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
