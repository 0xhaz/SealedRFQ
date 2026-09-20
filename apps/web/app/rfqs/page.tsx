import { formatUsdc } from "@sealedrfq/shared";
import Link from "next/link";
import { Header } from "@/components/Header";
import { PhaseBadge } from "@/components/PhaseBadge";
import { chain } from "@/lib/chain";
import { countdown, listRfqs } from "@/lib/rfq";

// Always read the chain: phases turn over on deadlines, not on deploys.
export const dynamic = "force-dynamic";

export default async function RfqBoard() {
  const rfqs = await listRfqs();
  const open = rfqs.filter((r) => r.phase === "Bidding" || r.phase === "Reveal");
  const escrowed = rfqs
    .filter((r) => r.status === 1)
    .reduce((sum, r) => sum + r.budget + r.buyerStake, 0n);
  const deposits = rfqs.reduce((sum, r) => sum + r.depositAmount * BigInt(r.commitCount), 0n);
  const awarded = rfqs.filter((r) => r.winner !== "0x0000000000000000000000000000000000000000");

  return (
    <div className="shell">
      <Header />

      <section className="desk-head" id="board">
        <h2 className="section-title">The RFQ board</h2>
        <p className="desk-head-sub">
          Live from {chain.name}. Sealed bids show only a count until their reveal window opens.
        </p>
      </section>

      <section className="stats">
        <div className="stat">
          <div className="label">Open RFQs</div>
          <div className="value">{open.length}</div>
        </div>
        <div className="stat">
          <div className="label">USDC in escrow</div>
          <div className="value">{formatUsdc(escrowed)}</div>
        </div>
        <div className="stat">
          <div className="label">Deposits posted</div>
          <div className="value">{formatUsdc(deposits)}</div>
        </div>
        <div className="stat">
          <div className="label">Awarded</div>
          <div className="value">{awarded.length}</div>
        </div>
      </section>

      <div className="panel">
        <div className="head">
          RFQs
          <span className="hint">
            {rfqs.length} total ·{" "}
            <Link className="linklike" href="/rfqs/new">
              post one →
            </Link>
          </span>
        </div>
        {rfqs.length === 0 ? (
          <div className="empty">
            No RFQs yet. <Link href="/rfqs/new">Post the first one →</Link>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>RFQ</th>
                <th>Category</th>
                <th className="num">Budget</th>
                <th className="num">Deposit</th>
                <th className="num">Bids</th>
                <th>Next deadline</th>
                <th>Phase</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.map((r) => {
                const next =
                  r.phase === "Bidding"
                    ? { label: "bids close", at: r.bidDeadline }
                    : r.phase === "Reveal"
                      ? { label: "reveal ends", at: r.revealDeadline }
                      : r.phase === "Award"
                        ? { label: "award window", at: r.awardDeadline }
                        : null;
                return (
                  <tr key={r.id}>
                    <td>
                      <Link className="linklike" href={`/rfqs/${r.id}`}>
                        № {r.id}
                      </Link>
                      {r.inviteOnly && <span className="badge"> invite</span>}
                    </td>
                    <td>{r.category || "—"}</td>
                    <td className="num">{formatUsdc(r.budget)}</td>
                    <td className="num">{formatUsdc(r.depositAmount)}</td>
                    <td className="num">
                      {r.phase === "Bidding" ? (
                        <span className="mono" title="sealed until the reveal window">
                          {"█ ".repeat(Math.min(r.commitCount, 5)).trim() || "—"}
                        </span>
                      ) : (
                        `${r.revealCount}/${r.commitCount}`
                      )}
                    </td>
                    <td className="muted">
                      {next ? `${next.label} in ${countdown(next.at)}` : "—"}
                    </td>
                    <td>
                      <PhaseBadge phase={r.phase} winner={r.winner} price={r.awardPrice} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
