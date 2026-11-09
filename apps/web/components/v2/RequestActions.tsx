"use client";

import {
  convertAction,
  inviteAction,
  respondAction,
  setStatusAction,
} from "@/app/workspace/requests/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * What this viewer may do with this request.
 *
 * The buttons shown are a convenience, not the rule. Every action is re-checked on the server
 * against the session and the database policies, so hiding one here is a courtesy to the reader
 * rather than a control: a supplier who crafts the call themselves is refused by the same check
 * that would have refused the button.
 */
export function RequestActions(props: {
  requestId: string;
  status: string;
  type: string;
  title: string;
  isOwner: boolean;
  invitedCount: number;
  supplierOrgs: { id: string; name: string }[];
  directory: { id: string; name: string; country: string }[];
  hasResponded: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, go?: (id?: string) => void) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "that did not work");
      return;
    }
    go ? go(r.id) : router.refresh();
  }

  const [inviteId, setInviteId] = useState("");
  const [answer, setAnswer] = useState("");
  const [tenderTitle, setTenderTitle] = useState(`${props.title} (tender)`);

  if (props.isOwner) {
    return (
      <div className="panel">
        <div className="head">
          Yours to run
          <span className="hint">{props.invitedCount} invited</span>
        </div>
        <div style={{ padding: "0 20px 18px" }}>
          {props.status === "draft" && (
            <>
              <button type="button" className="btn-primary" disabled={busy}
                onClick={() => run(() => setStatusAction(props.requestId, "open"))}>
                Open for responses
              </button>
              <span className="under-button">
                A draft is visible only to your organisation. Opening it lets invited suppliers
                answer.
              </span>
            </>
          )}

          {props.status === "open" && (
            <>
              <div className="field full" style={{ marginBottom: 12 }}>
                <label htmlFor="inviteOrg">Invite a supplier</label>
                {props.directory.length === 0 ? (
                  <>
                    <input
                      id="inviteOrg"
                      value={inviteId}
                      placeholder="organisation id"
                      onChange={(e) => setInviteId(e.target.value)}
                    />
                    <span className="field-hint">
                      No supplier has listed itself yet, so there is nothing to choose from. An
                      organisation appears here only after opting in, which is why an empty list is
                      the expected state early on rather than a fault.
                    </span>
                  </>
                ) : (
                  <>
                    <select
                      id="inviteOrg"
                      value={inviteId}
                      onChange={(e) => setInviteId(e.target.value)}
                    >
                      <option value="">Choose a supplier…</option>
                      {props.directory.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.country ? ` · ${d.country}` : ""}
                        </option>
                      ))}
                    </select>
                    <span className="field-hint">
                      Suppliers that chose to be listed. Listing makes an organisation contactable,
                      not readable: nothing of its work becomes visible by appearing here.
                    </span>
                  </>
                )}
              </div>
              <div className="button-row">
                <button type="button" className="btn-outline" disabled={busy || !inviteId}
                  onClick={() => run(() => inviteAction(props.requestId, inviteId.trim()))}>
                  Invite
                </button>
                <button type="button" className="chip" disabled={busy}
                  onClick={() => run(() => setStatusAction(props.requestId, "closed"))}>
                  stop taking responses
                </button>
              </div>
            </>
          )}

          {props.type === "RFI" && (props.status === "open" || props.status === "closed") && (
            <div style={{ marginTop: 18 }}>
              <div className="field full">
                <label htmlFor="tenderTitle">Convert to a tender</label>
                <input id="tenderTitle" value={tenderTitle}
                  onChange={(e) => setTenderTitle(e.target.value)} />
                <span className="field-hint">
                  This creates a new request and leaves the RFI as it was. The people who answered
                  did so knowing it bound them to nothing, so it is not rewritten into something
                  that does.
                </span>
              </div>
              <button type="button" className="btn-primary" disabled={busy}
                onClick={() =>
                  run(
                    () => convertAction(props.requestId, tenderTitle),
                    (id) => router.push(`/workspace/requests/${id}`),
                  )
                }>
                Convert to RFQ
              </button>
            </div>
          )}

          {props.status === "converted" && (
            <div className="note">
              Converted. This RFI keeps its answers and takes no more.
            </div>
          )}

          {error && <div className="note warn" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="head">You were invited</div>
      <div style={{ padding: "0 20px 18px" }}>
        {props.status !== "open" ? (
          <div className="note">This request is {props.status} and takes no responses.</div>
        ) : props.hasResponded ? (
          <div className="note">
            Your answer is recorded. Other invited suppliers cannot see it.
          </div>
        ) : (
          <>
            <div className="field full">
              <label htmlFor="answer">Your answer</label>
              <input id="answer" value={answer} placeholder="What you can do, and roughly how"
                onChange={(e) => setAnswer(e.target.value)} />
              <span className="field-hint">
                An RFI answer binds you to nothing and sets no price.
              </span>
            </div>
            <button type="button" className="btn-primary"
              disabled={busy || !answer.trim() || props.supplierOrgs.length === 0}
              onClick={() =>
                run(() => respondAction(props.requestId, props.supplierOrgs[0]?.id ?? "", answer))
              }>
              {busy ? "Sending…" : "Answer"}
            </button>
          </>
        )}
        {error && <div className="note warn" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
