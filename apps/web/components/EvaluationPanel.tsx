import { formatUsdc } from "@sealedrfq/shared";
import Link from "next/link";
import type { AuditResult, Evaluation } from "@/lib/agent";
import { explorerTx } from "@/lib/chain";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * What the AI decided and whether the published reasoning still matches the chain.
 *
 * The verdict line is the point of the whole attestation design: the memo shown here is re-hashed
 * and compared with the anchor, so an edited rationale shows up as a mismatch rather than reading
 * plausibly.
 */
export function EvaluationPanel({
  rfqId,
  evaluation,
  audit,
}: {
  rfqId: number;
  evaluation: Evaluation;
  audit: AuditResult;
}) {
  if (evaluation.evaluated && evaluation.anchoredOnly) {
    // The chain has the decision; this agent simply does not hold the memo behind it.
    return (
      <div className="panel">
        <div className="head">
          AI evaluation<span className="hint">anchored on-chain</span>
        </div>
        <div className="note">
          A <b>{evaluation.kind?.replace(/_/g, " ").toLowerCase()}</b> was anchored by{" "}
          <span className="mono">{short(evaluation.actor ?? "")}</span>
          {evaluation.model ? ` using ${evaluation.model}` : ""}, and the award had to cite it. This
          agent does not hold the memo behind that hash, so the reasoning cannot be shown or
          re-hashed here — the decision was recorded by a different operator or by a script.
        </div>
        <div className="kv">
          <span>Decision hash</span>
          <b className="mono" style={{ fontSize: 11 }}>
            {evaluation.payloadHash?.slice(0, 26)}…
          </b>
        </div>
        {evaluation.tx && (
          <div className="kv">
            <span>Anchor tx</span>
            <b>
              <a href={explorerTx(evaluation.tx)} target="_blank" rel="noreferrer">
                open ↗
              </a>
            </b>
          </div>
        )}
      </div>
    );
  }

  if (!evaluation.evaluated || !evaluation.memo) {
    return (
      <div className="panel">
        <div className="head">
          AI evaluation<span className="hint">not scored yet</span>
        </div>
        <div className="note">
          Bids are scored once the reveal window closes — the evaluator runs on its own within a
          few seconds of it, and the buyer can also trigger it from the actions panel. It can only
          score against the rubric published before bidding opened, and its memo is anchored
          on-chain before anyone can award.
        </div>
      </div>
    );
  }

  const { memo } = evaluation;
  const recommended = memo.decision.bidder;

  return (
    <div className="panel">
      <div className="head">
        AI evaluation
        <span className="hint">
          {memo.model} · {new Date(memo.ts * 1000).toISOString().slice(0, 16).replace("T", " ")}
        </span>
      </div>

      <div className={`note ${audit.verified ? "" : "field-err"}`}>
        {audit.verified ? (
          <>
            <b>✓ Verified.</b> This memo re-hashes to the value anchored on-chain by{" "}
            <span className="mono">{short(audit.anchoredBy ?? "")}</span>, so the reasoning below is
            the reasoning that was recorded — not a later edit.{" "}
            {audit.tx && (
              <a href={explorerTx(audit.tx)} target="_blank" rel="noreferrer">
                anchor tx ↗
              </a>
            )}
          </>
        ) : (
          <>
            <b>Unverified.</b> {audit.reason ?? "The published memo does not match the on-chain anchor."}
          </>
        )}
      </div>

      <div className="memo">{memo.rationale}</div>

      <table>
        <thead>
          <tr>
            <th>Supplier</th>
            <th className="num">Price</th>
            <th className="num">Days</th>
            <th className="num">Score</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {memo.scores.map((s) => (
            <tr key={s.bidder}>
              <td className="mono">
                {short(s.bidder)}
                {s.bidder === recommended && <span className="badge p-awarded"> RECOMMENDED</span>}
              </td>
              <td className="num">{formatUsdc(BigInt(s.price))}</td>
              <td className="num">{s.deliveryDays}</td>
              <td className="num">
                <b>{(s.totalBps / 100).toFixed(1)}</b>
                <span className="muted">
                  {" "}
                  ({Object.entries(s.criteria)
                    .map(([k, v]) => `${k[0]}${Math.round(v)}`)
                    .join(" ")}
                  )
                </span>
              </td>
              <td className="muted" style={{ fontSize: 11 }}>
                {s.redFlags.length ? s.redFlags.join("; ") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="note">
        The evaluator recommends; it cannot award. The recommendation is anchored against this
        winner specifically, so whoever awards can only award the bidder that was recommended.{" "}
        <Link className="linklike" href={`/audit/${rfqId}`}>
          Check it yourself →
        </Link>
      </div>
    </div>
  );
}
