import { BoardFilters } from "@/components/BoardFilters";
import { Header } from "@/components/Header";
import { Payouts } from "@/components/Payouts";
import { PhaseBadge } from "@/components/PhaseBadge";
import { YourWork } from "@/components/YourWork";
import { applyBoardQuery, facetsOf, parseBoardQuery } from "@/lib/boardFilter";
import { chain } from "@/lib/chain";
import { countdown, listRfqs } from "@/lib/rfq";
import { CATEGORIES, labelFor } from "@/lib/taxonomy";
import { formatUsdc } from "@sealedrfq/shared";
import Link from "next/link";

// Always read the chain: phases turn over on deadlines, not on deploys.
export const dynamic = "force-dynamic";

export default async function RfqBoard({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; region?: string; open?: string }>;
}) {
  const all = await listRfqs();
  const params = await searchParams;
  const active = parseBoardQuery(params);
  const rfqs = applyBoardQuery(all, active);
  const open = all.filter((r) => r.phase === "Bidding" || r.phase === "Reveal");
  const escrowed = all
    .filter((r) => r.status === 1)
    .reduce((sum, r) => sum + r.budget + r.buyerStake, 0n);
  const deposits = all.reduce((sum, r) => sum + r.depositAmount * BigInt(r.commitCount), 0n);
  const awarded = all.filter((r) => r.winner !== "0x0000000000000000000000000000000000000000");

  return (
    <div className="shell">
      <Header />

      <section className="desk-head" id="board">
        <h2 className="section-title">The RFQ board</h2>
        <p className="desk-head-sub">
          Live from {chain.name}. Sealed bids show only a count until their reveal window opens.
        </p>
      </section>

      <YourWork
        rfqs={all.map((r) => ({
          id: r.id,
          phase: r.phase,
          inviteOnly: r.inviteOnly,
          buyer: r.buyer,
          winner: r.winner,
          bidDeadline: r.bidDeadline,
          revealDeadline: r.revealDeadline,
          awardDeadline: r.awardDeadline,
        }))}
      />

      <Payouts />

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
            {all.length} total ·{" "}
            <Link className="linklike" href="/rfqs/new">
              post one →
            </Link>
          </span>
        </div>
        {all.length > 0 && (
          <BoardFilters
            categories={facetsOf(all, (r) => r.category)}
            regions={facetsOf(all, (r) => r.region)}
            active={active}
            total={all.length}
            shown={rfqs.length}
          />
        )}
        {rfqs.length === 0 ? (
          <div className="empty">
            {all.length === 0 ? (
              <>
                No RFQs yet. <Link href="/rfqs/new">Post the first one →</Link>
              </>
            ) : (
              <>
                Nothing matches those filters.{" "}
                <Link className="linklike" href="/rfqs">
                  Show every RFQ →
                </Link>
              </>
            )}
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
                  // `row` + `data-label` opt this table into the card layout phones get: each
                  // cell becomes a labelled line instead of a column in a seven-wide table that
                  // would otherwise scroll sideways off the screen.
                  <tr className="row" key={r.id}>
                    <td data-label="RFQ">
                      <Link className="linklike" href={`/rfqs/${r.id}`}>
                        № {r.id}
                      </Link>
                      {r.inviteOnly && <span className="badge badge-inline">invite</span>}
                      {r.bidMode === "open" && (
                        <span className="badge badge-inline" title="Bids are public as they arrive">
                          open bids
                        </span>
                      )}
                    </td>
                    <td data-label="Category">{r.category ? labelFor(CATEGORIES, r.category) : "—"}</td>
                    <td className="num" data-label="Budget">{formatUsdc(r.budget)}</td>
                    <td className="num" data-label="Deposit">{formatUsdc(r.depositAmount)}</td>
                    <td className="num" data-label="Bids">
                      {r.phase === "Bidding" ? (
                        <span className="mono" title="sealed until the reveal window">
                          {"█ ".repeat(Math.min(r.commitCount, 5)).trim() || "—"}
                        </span>
                      ) : (
                        `${r.revealCount}/${r.commitCount}`
                      )}
                    </td>
                    <td className="muted" data-label="Next deadline">
                      {next ? `${next.label} in ${countdown(next.at)}` : "—"}
                    </td>
                    <td data-label="Phase">
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
