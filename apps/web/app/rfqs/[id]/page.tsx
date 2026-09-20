import { formatUsdc } from "@sealedrfq/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvaluationPanel } from "@/components/EvaluationPanel";
import { Header } from "@/components/Header";
import { PhaseBadge } from "@/components/PhaseBadge";
import { RfqActions } from "@/components/RfqActions";
import { agent } from "@/lib/agent";
import { chain, contracts, explorerAddress } from "@/lib/chain";
import { countdown, getBid, getBidders, getEngagement, getRfq, getRfqCount } from "@/lib/rfq";

export const dynamic = "force-dynamic";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ts: number) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16);

export default async function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await getRfqCount())) notFound();

  const rfq = await getRfq(id);
  // Scan back from the bidding deadline and stop once every committed bid is found.
  const bidders = await getBidders(id, { until: rfq.bidDeadline, expected: rfq.commitCount });
  const bids = await Promise.all(
    bidders.map(async (b) => ({ bidder: b, ...(await getBid(id, b)) })),
  );
  const engagement = await getEngagement(id);
  // The agent supplies reasoning and the audit check; the chain above is the source of truth.
  const [evaluation, audit] = await Promise.all([agent.evaluation(id), agent.audit(id)]);
  const sealed = rfq.phase === "Bidding";
  const sorted = [...bids].sort((a, b) =>
    a.revealed && b.revealed ? Number(a.price - b.price) : a.revealed ? -1 : 1,
  );

  return (
    <div className="shell">
      <Header />

      <section className="desk-head">
        <h2 className="section-title">
          RFQ № {id} <PhaseBadge phase={rfq.phase} winner={rfq.winner} price={rfq.awardPrice} />
        </h2>
        <p className="desk-head-sub">
          {rfq.category || "—"}
          {rfq.region ? ` · ${rfq.region}` : ""} · buyer{" "}
          <a href={explorerAddress(rfq.buyer)} target="_blank" rel="noreferrer" className="mono">
            {short(rfq.buyer)}
          </a>
          {rfq.inviteOnly && " · invite only"}
          {rfq.requiresQualification && " · qualified suppliers only"}
          {rfq.requiresProposal ? " · RFP (proposal required)" : " · RFQ (price and delivery)"}
        </p>
      </section>

      <section className="stats">
        <div className="stat">
          <div className="label">Published budget</div>
          <div className="value">{formatUsdc(rfq.budget)} USDC</div>
        </div>
        <div className="stat">
          <div className="label">Bid deposit</div>
          <div className="value">{formatUsdc(rfq.depositAmount)}</div>
        </div>
        <div className="stat">
          <div className="label">Buyer stake</div>
          <div className="value">{formatUsdc(rfq.buyerStake)}</div>
        </div>
        <div className="stat">
          <div className="label">Retention</div>
          <div className="value">{rfq.retentionBps / 100}%</div>
        </div>
      </section>

      <div className="grid">
        <div className="panel">
          <div className="head">
            Sealed bids
            <span className="hint">
              {sealed
                ? `${rfq.commitCount} committed — prices open at the reveal window`
                : `${rfq.revealCount} of ${rfq.commitCount} revealed`}
            </span>
          </div>
          {bids.length === 0 ? (
            <div className="empty">
              No bids yet.{" "}
              <Link href={`/rfqs/${id}/bid`} className="linklike">
                Submit a sealed bid →
              </Link>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="num">Price</th>
                  <th className="num">Delivery</th>
                  {rfq.requiresProposal && <th>Proposal</th>}
                  <th>Deposit</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => (
                  <tr key={b.bidder}>
                    <td className="mono">
                      {short(b.bidder)}
                      {b.bidder.toLowerCase() === rfq.winner.toLowerCase() && (
                        <span className="badge p-awarded"> WON</span>
                      )}
                    </td>
                    <td className="num">
                      {sealed ? (
                        <span className="mono" title="sealed">
                          ███████
                        </span>
                      ) : b.revealed ? (
                        `${formatUsdc(b.price)} USDC`
                      ) : (
                        <span className="muted">not revealed</span>
                      )}
                    </td>
                    <td className="num">{b.revealed && !sealed ? `${b.deliveryDays} d` : "—"}</td>
                    {rfq.requiresProposal && (
                      <td className="mono" style={{ fontSize: 11 }}>
                        {b.revealed && !sealed && b.proposalHash !== `0x${"0".repeat(64)}`
                          ? `${b.proposalHash.slice(0, 14)}…`
                          : "—"}
                      </td>
                    )}
                    <td>
                      <span className="badge">{b.deposit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="right">
          <div className="panel">
            <div className="head">
              Timetable<span className="hint">every state has a clock</span>
            </div>
            <div className="kv">
              <span>Bids close</span>
              <b>
                {when(rfq.bidDeadline)}{" "}
                {rfq.phase === "Bidding" && <em>({countdown(rfq.bidDeadline)})</em>}
              </b>
            </div>
            <div className="kv">
              <span>Reveal ends</span>
              <b>
                {when(rfq.revealDeadline)}{" "}
                {rfq.phase === "Reveal" && <em>({countdown(rfq.revealDeadline)})</em>}
              </b>
            </div>
            <div className="kv">
              <span>Award window ends</span>
              <b>
                {when(rfq.awardDeadline)}{" "}
                {rfq.phase === "Award" && <em>({countdown(rfq.awardDeadline)})</em>}
              </b>
            </div>
            <div className="kv">
              <span>Delivery per milestone</span>
              <b>{Math.round(rfq.deliveryWindow / 60)} min</b>
            </div>
            <div className="kv">
              <span>Acceptance window</span>
              <b>{Math.round(rfq.acceptanceWindow / 60)} min, then auto-release</b>
            </div>
          </div>

          <div className="panel">
            <div className="head">
              Scoring rubric<span className="hint">fixed before bids opened</span>
            </div>
            <div className="note">
              The rubric hash is stored at creation, so it cannot be rewritten to fit a favoured
              bid. The award must cite an evaluation that matches it.
              {rfq.requiresProposal &&
                " In RFP mode each bid also seals a proposal document, so the method cannot be revised after rival bids are open."}
            </div>
            <div className="kv">
              <span>rubricHash</span>
              <b className="mono" style={{ fontSize: 11 }}>
                {rfq.rubricHash.slice(0, 22)}…
              </b>
            </div>
            <div className="kv">
              <span>scope hash</span>
              <b className="mono" style={{ fontSize: 11 }}>
                {rfq.metadataHash.slice(0, 22)}…
              </b>
            </div>
            <div className="kv">
              <span>milestones</span>
              <b>{rfq.milestoneBps.map((b) => `${b / 100}%`).join(" · ")}</b>
            </div>
          </div>
        </div>
      </div>

      <div className="grid">
        <EvaluationPanel rfqId={id} evaluation={evaluation} audit={audit} />
        <div className="right">
          <RfqActions
            rfqId={id}
            phase={rfq.phase}
            buyer={rfq.buyer}
            recommended={evaluation.memo?.decision?.bidder ?? null}
            evaluationHash={evaluation.payloadHash}
            rubricHash={rfq.rubricHash}
            engagement={
              engagement
                ? {
                    status: engagement.status,
                    supplier: engagement.supplier,
                    currentMilestone: engagement.currentMilestone,
                    milestoneCount: engagement.milestoneCount,
                    currentJobId: engagement.currentJobId.toString(),
                    submittedAt: engagement.submittedAt,
                    acceptanceWindow: engagement.acceptanceWindow,
                    currentJobBudget: engagement.currentJobBudget.toString(),
                  }
                : null
            }
          />
        </div>
      </div>

      {engagement && (
        <div className="panel">
          <div className="head">
            Engagement
            <span className="hint">
              {engagement.status} · milestone {engagement.currentMilestone + 1} of{" "}
              {engagement.milestoneCount}
            </span>
          </div>
          <div className="kv">
            <span>Supplier</span>
            <b className="mono">{short(engagement.supplier)}</b>
          </div>
          <div className="kv">
            <span>Award price</span>
            <b>{formatUsdc(engagement.price)} USDC</b>
          </div>
          <div className="kv">
            <span>Retention held</span>
            <b>{formatUsdc(engagement.retentionHeld)} USDC</b>
          </div>
          <div className="kv">
            <span>Performance stake</span>
            <b>{formatUsdc(engagement.performanceStake)} USDC</b>
          </div>
          <div className="kv">
            <span>Current escrow job</span>
            <b className="mono">#{engagement.currentJobId.toString()}</b>
          </div>
          {engagement.submittedAt > 0 && (
            <div className="kv">
              <span>Submitted</span>
              <b>
                {when(engagement.submittedAt)} · auto-releases in{" "}
                {countdown(engagement.submittedAt + engagement.acceptanceWindow)}
              </b>
            </div>
          )}
        </div>
      )}

      <p className="hero-links">
        <Link href="/rfqs">← back to the board</Link>
        {(rfq.phase === "Bidding" || rfq.phase === "Reveal") && (
          <Link href={`/rfqs/${id}/bid`}>
            {rfq.phase === "Bidding" ? "Submit a sealed bid →" : "Reveal your bid →"}
          </Link>
        )}
        <a
          href={explorerAddress(contracts.RFQRegistry)}
          target="_blank"
          rel="noreferrer"
          title={`RFQRegistry on ${chain.name}`}
        >
          contract ↗
        </a>
      </p>
    </div>
  );
}
