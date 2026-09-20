import Link from "next/link";
import { Header } from "@/components/Header";
import { MemoVerifier } from "@/components/MemoVerifier";
import { agent } from "@/lib/agent";
import { explorerAddress, explorerTx } from "@/lib/chain";

export const dynamic = "force-dynamic";

const BADGE = {
  verified: { cls: "p-awarded", label: "VERIFIED" },
  mismatch: { cls: "p-noaward", label: "ALTERED" },
  "anchored-only": { cls: "p-award", label: "ANCHORED · MEMO NOT HELD HERE" },
  none: { cls: "p-none", label: "NOTHING ANCHORED YET" },
} as const;

/**
 * "Prove the award wasn't rewritten."
 *
 * Every AI decision is anchored on-chain as the hash of its memo, so a rationale edited afterwards
 * hashes differently and fails this check. The four outcomes stay visually distinct: an altered
 * memo is a serious finding and must not look like this agent merely lacking a copy.
 */
export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const audit = await agent.audit(id);
  const state = (audit.state ?? (audit.verified ? "verified" : "none")) as keyof typeof BADGE;
  const badge = BADGE[state] ?? BADGE.none;

  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">
          Audit RFQ № {id} <span className={`badge ${badge.cls}`}>{badge.label}</span>
        </h2>
        <p className="desk-head-sub">
          An award has to cite a decision anchored on-chain before it. This page re-hashes the
          published memo and compares it with that anchor, so a rationale edited after the fact fails
          the check instead of simply reading well. Anyone can repeat it: canonicalise the memo
          (RFC 8785), take its SHA-256, and read the attestation from the contract.
        </p>
      </section>

      <div className="grid">
        <div className="col">
          {state === "verified" && audit.memo ? (
            <div className="panel">
              <div className="head">
                The memo<span className="hint">exactly as published</span>
              </div>
              <div className="note">
                This document hashes to the value anchored on-chain, so it is the reasoning recorded
                at the time — not a later rewrite.
              </div>
              <pre className="memo" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
                {JSON.stringify(audit.memo, null, 2)}
              </pre>
            </div>
          ) : null}

          {state === "mismatch" ? (
            <div className="panel">
              <div className="head">
                Memo does not match the chain<span className="hint">treat with suspicion</span>
              </div>
              <div className="note warn">
                <b>{audit.reason}</b> The anchor is the authority: whoever published this copy changed
                it after the decision was recorded, or it belongs to a different decision.
              </div>
              {audit.memo ? (
                <pre className="memo" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
                  {JSON.stringify(audit.memo, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}

          {state === "anchored-only" ? (
            <div className="panel">
              <div className="head">
                Decision anchored, memo held elsewhere
                <span className="hint">nothing is wrong here</span>
              </div>
              <div className="note">
                The chain records that a <b>{audit.kind?.replace(/_/g, " ").toLowerCase()}</b> was
                anchored, and the award had to cite it. This agent does not hold the memo behind that
                hash — the decision came from a different operator, or from one of the demo scripts,
                and each keeps its own memos.
              </div>
              <div className="note">
                That does not make the decision unverifiable. Ask whoever produced it for the memo and
                check it below: the hash on-chain settles the argument, not who hosts the document.
              </div>
            </div>
          ) : null}

          {state === "none" ? (
            <div className="panel">
              <div className="head">
                Nothing anchored yet<span className="hint">no decision to audit</span>
              </div>
              <div className="note">
                No evaluation has been anchored for this RFQ. Bids are scored once the reveal window
                closes and the memo is anchored before anyone can award, so there is nothing to check
                until then.
              </div>
            </div>
          ) : null}

          {audit.anchoredHash ? <MemoVerifier expected={audit.anchoredHash} /> : null}
        </div>

        <div className="right">
          <div className="panel">
            <div className="head">
              Verification<span className="hint">re-hashed, not re-read</span>
            </div>
            {audit.computedHash ? (
              <div className="kv">
                <span>Computed hash</span>
                <b className="mono" style={{ fontSize: 10 }}>
                  {audit.computedHash.slice(0, 26)}…
                </b>
              </div>
            ) : null}
            <div className="kv">
              <span>Anchored hash</span>
              <b className="mono" style={{ fontSize: 10 }}>
                {audit.anchoredHash ? `${audit.anchoredHash.slice(0, 26)}…` : "—"}
              </b>
            </div>
            <div className="kv">
              <span>Anchored by</span>
              <b className="mono">
                {audit.anchoredBy ? (
                  <a href={explorerAddress(audit.anchoredBy)} target="_blank" rel="noreferrer">
                    {audit.anchoredBy.slice(0, 10)}…
                  </a>
                ) : (
                  "—"
                )}
              </b>
            </div>
            <div className="kv">
              <span>Model</span>
              <b>{audit.model ?? "—"}</b>
            </div>
            {audit.tx ? (
              <div className="kv">
                <span>Anchor tx</span>
                <b>
                  <a href={explorerTx(audit.tx)} target="_blank" rel="noreferrer">
                    open ↗
                  </a>
                </b>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="head">
              Why this exists<span className="hint">least privilege, by design</span>
            </div>
            <div className="note">
              The evaluator can score and anchor but cannot award. The awarder can award, but only the
              bidder named in an anchored recommendation. Neither can rewrite the reasoning
              afterwards, because the hash was fixed before the award existed.
            </div>
          </div>
        </div>
      </div>

      <nav className="page-nav">
        <Link className="btn-nav" href={`/rfqs/${id}`}>
          ← Back to the RFQ
        </Link>
        <Link className="btn-nav ghost" href="/rfqs">
          All RFQs
        </Link>
      </nav>
    </div>
  );
}
