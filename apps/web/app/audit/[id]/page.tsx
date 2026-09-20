import Link from "next/link";
import { Header } from "@/components/Header";
import { agent } from "@/lib/agent";
import { explorerAddress, explorerTx } from "@/lib/chain";

export const dynamic = "force-dynamic";

/**
 * "Prove the award wasn't rewritten."
 *
 * The published memo is re-hashed here and compared with the hash anchored on-chain. A memo edited
 * after the fact produces a different hash and fails, which is the whole point: the rationale is
 * checkable rather than merely readable.
 */
export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const audit = await agent.audit(id);

  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">
          Audit RFQ № {id}{" "}
          <span className={`badge ${audit.verified ? "p-awarded" : "p-noaward"}`}>
            {audit.verified ? "VERIFIED" : "NOT VERIFIED"}
          </span>
        </h2>
        <p className="desk-head-sub">
          The decision memo below is hashed and compared with the anchor recorded on Arc. Anyone can
          repeat this: canonicalise the memo (RFC 8785), take its SHA-256, and read the attestation
          from the contract.
        </p>
      </section>

      {!audit.verified && audit.reason ? (
        <div className="panel">
          <div className="head">Nothing to verify</div>
          <div className="note">{audit.reason}</div>
        </div>
      ) : (
        <div className="grid">
          <div className="panel">
            <div className="head">
              The memo<span className="hint">exactly as published</span>
            </div>
            <pre className="memo" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
              {JSON.stringify(audit.memo, null, 2)}
            </pre>
          </div>
          <div className="right">
            <div className="panel">
              <div className="head">
                Verification<span className="hint">re-hashed, not re-read</span>
              </div>
              <div className="kv">
                <span>Computed hash</span>
                <b className="mono" style={{ fontSize: 10 }}>
                  {audit.computedHash?.slice(0, 26)}…
                </b>
              </div>
              <div className="kv">
                <span>Anchored hash</span>
                <b className="mono" style={{ fontSize: 10 }}>
                  {audit.anchoredHash?.slice(0, 26)}…
                </b>
              </div>
              <div className="kv">
                <span>Match</span>
                <b className={audit.verified ? "" : "doc-bad"}>{audit.verified ? "yes" : "no"}</b>
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
              {audit.tx && (
                <div className="kv">
                  <span>Anchor tx</span>
                  <b>
                    <a href={explorerTx(audit.tx)} target="_blank" rel="noreferrer">
                      open ↗
                    </a>
                  </b>
                </div>
              )}
            </div>
            <p className="hero-links">
              <Link href={`/rfqs/${id}`}>← back to the RFQ</Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
