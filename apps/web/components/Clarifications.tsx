"use client";

import { type ClarificationEntry, agent } from "@/lib/agent";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

/**
 * The clarification round: suppliers ask, the buyer answers, everyone reads both.
 *
 * The asymmetry is the point. A question may be asked anonymously, because asking reveals
 * something — "can you accept ninety days?" tells rivals about your capacity. An answer never can
 * be, and no answer is ever shown to one bidder and withheld from another: that is the favour
 * sealed bidding exists to prevent, and a clarification round is where it usually creeps in.
 *
 * Authorised by signature rather than by an account, like everything else here. Signing costs no
 * gas, and the signature is stored with the message so a reader can recover the author themselves.
 */
export function Clarifications({
  rfqId,
  buyer,
  biddingOpen,
}: {
  rfqId: number;
  buyer: string;
  biddingOpen: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [entries, setEntries] = useState<ClarificationEntry[]>([]);
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBuyer = Boolean(address && address.toLowerCase() === buyer.toLowerCase());

  const load = () => agent.clarifications(rfqId).then((r) => setEntries(r.entries ?? []));
  useEffect(() => {
    load();
    // biome-ignore lint/correctness/useExhaustiveDependencies: load is stable for a given rfqId
  }, [rfqId]);

  async function send() {
    setError(null);
    setBusy(true);
    try {
      const ts = Math.floor(Date.now() / 1000);
      const message = [
        "SealedRFQ clarification",
        `rfq:${rfqId}`,
        `parent:${replyTo ?? "none"}`,
        `ts:${ts}`,
        "",
        body.trim(),
      ].join("\n");
      const signature = await signMessageAsync({ message });
      const res = await agent.addClarification(rfqId, {
        body: body.trim(),
        ts,
        signature,
        parentId: replyTo,
        anonymous: !isBuyer && anonymous,
      });
      if ("error" in res) throw new Error(res.error);
      setBody("");
      setReplyTo(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not post that");
    } finally {
      setBusy(false);
    }
  }

  const questions = entries.filter((e) => e.parentId === null);
  const answersTo = (id: number) => entries.filter((e) => e.parentId === id);

  const canAsk = isConnected && !isBuyer && biddingOpen;
  const canAnswer = isConnected && isBuyer;

  return (
    <div className="card">
      <div className="card-head">
        <h3>
          Questions and answers <span className="hint">{questions.length} asked</span>
        </h3>
      </div>
      <div className="card-body">
        <div className="note">
          Answers are published to every bidder. A question can be asked anonymously — asking can
          give away your approach — but nothing here is ever shown to one supplier and hidden from
          the rest.
        </div>

        {questions.length === 0 && <p className="note">No questions yet.</p>}

        {questions.map((q) => (
          <div key={q.id} className="qa">
            <div className="qa-q">
              <b>{q.author ? `${q.author.slice(0, 6)}…${q.author.slice(-4)}` : "A bidder"}</b>{" "}
              asked: {q.body}
            </div>
            {answersTo(q.id).map((a) => (
              <div key={a.id} className="qa-a">
                <b>Buyer:</b> {a.body}
              </div>
            ))}
            {answersTo(q.id).length === 0 && (
              <div className="qa-a hint">
                Not answered yet.
                {canAnswer && (
                  <>
                    {" "}
                    <button type="button" className="chip" onClick={() => setReplyTo(q.id)}>
                      answer this
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {(canAsk || canAnswer) && (
          <div className="qa-form">
            <textarea
              rows={2}
              placeholder={
                replyTo !== null
                  ? "Your answer — every bidder will see it"
                  : "Ask the buyer about the scope, the terms or the timetable"
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="filter-row">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !body.trim()}
                onClick={send}
              >
                {busy ? "Signing…" : replyTo !== null ? "Post answer" : "Ask"}
              </button>
              {replyTo !== null && (
                <button type="button" className="chip" onClick={() => setReplyTo(null)}>
                  cancel reply
                </button>
              )}
              {canAsk && replyTo === null && (
                <label className="hint">
                  <input
                    type="checkbox"
                    checked={anonymous}
                    onChange={(e) => setAnonymous(e.target.checked)}
                  />{" "}
                  ask anonymously
                </label>
              )}
              <span className="hint">Signing is free; it does not send a transaction.</span>
            </div>
            {error && (
              <div className="field-err" role="alert">
                {error}
              </div>
            )}
          </div>
        )}

        {!isConnected && <p className="hint">Connect a wallet to ask a question.</p>}
        {isConnected && !isBuyer && !biddingOpen && (
          <p className="hint">Bidding has closed, so the clarification round is over.</p>
        )}
      </div>
    </div>
  );
}
