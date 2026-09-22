import { DocumentCheck } from "@/components/DocumentCheck";
import { EvaluationPanel } from "@/components/EvaluationPanel";
import { Header } from "@/components/Header";
import { Payouts } from "@/components/Payouts";
import { PhaseBadge } from "@/components/PhaseBadge";
import { RfqActions } from "@/components/RfqActions";
import { SettleDeposit } from "@/components/SettleDeposit";
import { agent } from "@/lib/agent";
import { chain, contracts, explorerAddress } from "@/lib/chain";
import { milestoneLedger } from "@/lib/milestones";
import { countdown, getBid, getBidders, getEngagement, getRfq, getRfqCount } from "@/lib/rfq";
import { CATEGORIES, REGIONS, labelFor } from "@/lib/taxonomy";
import { formatUsdc } from "@sealedrfq/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ts: number) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16);

export default async function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await getRfqCount())) notFound();

  const rfq = await getRfq(id);
  // Scan back from the chain head and stop once every committed bid is found.
  const bidders = await getBidders(id, { expected: rfq.commitCount });
  const bids = await Promise.all(
    bidders.map(async (b) => ({ bidder: b, ...(await getBid(id, b)) })),
  );
  const engagement = await getEngagement(id);
  // The agent supplies reasoning and the audit check; the chain above is the source of truth.
  const [evaluation, audit] = await Promise.all([agent.evaluation(id), agent.audit(id)]);
  const sealed = rfq.phase === "Bidding";
  // A quotation can now ride on a plain RFQ, not only an RFP, so the column follows the bids
  // rather than the mode: show it whenever any revealed bid actually carries a document.
  const hasDocuments =
    rfq.requiresProposal ||
    bids.some((b) => b.revealed && b.proposalHash !== `0x${"0".repeat(64)}`);
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
          {rfq.category ? labelFor(CATEGORIES, rfq.category) : "—"}
          {rfq.region ? ` · ${labelFor(REGIONS, rfq.region)}` : ""} · buyer{" "}
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

      {/* One grid, two independent column stacks: with separate grid rows the short left panel
          still reserved the height of the taller right column, leaving dead space beneath it. */}
      <div className="grid">
        <div className="col">
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
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="num">Price</th>
                      <th className="num">Delivery</th>
                      {hasDocuments && <th>{rfq.requiresProposal ? "Proposal" : "Quotation"}</th>}
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
                        <td className="num">
                          {b.revealed && !sealed ? `${b.deliveryDays} d` : "—"}
                        </td>
                        {hasDocuments && (
                          <td className="mono" style={{ fontSize: 11 }}>
                            {b.revealed && !sealed && b.proposalHash !== `0x${"0".repeat(64)}`
                              ? `${b.proposalHash.slice(0, 14)}…`
                              : "—"}
                          </td>
                        )}
                        <td>
                          <span className="badge">{b.deposit}</span>{" "}
                          {b.deposit === "Held" &&
                            (rfq.phase === "Awarded" || rfq.phase === "NoAward") && (
                              <SettleDeposit rfqId={id} bidder={b.bidder} />
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!sealed &&
                  sorted
                    .filter((b) => b.revealed && b.proposalHash !== `0x${"0".repeat(64)}`)
                    .map((b) => (
                      <div key={`check-${b.bidder}`} style={{ padding: "12px 20px 4px" }}>
                        <DocumentCheck
                          expected={b.proposalHash}
                          label={`Verify the ${rfq.requiresProposal ? "proposal" : "quotation"} from ${short(b.bidder)}`}
                          hint="Check the file this supplier sent you against the hash sealed with their price."
                        />
                      </div>
                    ))}
              </>
            )}
          </div>

          <Payouts />

          <EvaluationPanel rfqId={id} evaluation={evaluation} audit={audit} />

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
              {engagement.submittedAt > 0 && engagement.deliverable && (
                <div className="kv">
                  <span>Deliverable hash</span>
                  <b className="mono" style={{ fontSize: 11 }}>
                    {engagement.deliverable.slice(0, 26)}…
                  </b>
                </div>
              )}
              {engagement.submittedAt > 0 && (
                <div className="kv">
                  <span>Submitted</span>
                  <b>
                    {when(engagement.submittedAt)} · auto-releases in{" "}
                    {countdown(engagement.submittedAt + engagement.acceptanceWindow)}
                  </b>
                </div>
              )}
              {(() => {
                const ledger = milestoneLedger(
                  engagement.price,
                  rfq.milestoneBps,
                  rfq.retentionBps,
                );
                return (
                  <table>
                    <thead>
                      <tr>
                        <th>Milestone</th>
                        <th className="num">Value</th>
                        <th className="num">Retained</th>
                        <th className="num">Pays now</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.lines.map((l) => {
                        const done = l.index < engagement.currentMilestone;
                        const current = l.index === engagement.currentMilestone;
                        return (
                          <tr key={l.index}>
                            <td>
                              {l.index + 1} of {ledger.lines.length}
                              {current && <span className="badge"> current</span>}
                            </td>
                            <td className="num">{formatUsdc(l.gross)}</td>
                            <td className="num">{formatUsdc(l.retained)}</td>
                            <td className="num">{formatUsdc(l.net)}</td>
                            <td className="muted" style={{ fontSize: 11 }}>
                              {done ? "paid" : current ? "in progress" : "not started"}
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td>
                          <b>Retention</b>
                        </td>
                        <td className="num">—</td>
                        <td className="num">{formatUsdc(ledger.retentionHeld)}</td>
                        <td className="num">
                          <b>{formatUsdc(ledger.retentionHeld)}</b>
                        </td>
                        <td className="muted" style={{ fontSize: 11 }}>
                          released at final acceptance
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
              <div className="note">
                Every milestone pays less than its share because retention is held back from each
                one; the difference arrives in a single release when the last is accepted. Money
                released is credited to the supplier, not transferred — it waits under{" "}
                <b>Your payouts</b> until they withdraw it.
              </div>
              {engagement.deliverable && engagement.deliverable !== `0x${"0".repeat(64)}` && (
                <div style={{ padding: "12px 20px 4px" }}>
                  <DocumentCheck
                    expected={engagement.deliverable}
                    label="Verify a delivered document"
                    hint="anyone can check a copy against the chain"
                  />
                </div>
              )}
            </div>
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
                    deliverable: engagement.deliverable,
                  }
                : null
            }
          />
        </div>
      </div>

      <nav className="page-nav">
        <Link className="btn-nav" href="/rfqs">
          ← Back to the board
        </Link>
        {(rfq.phase === "Bidding" || rfq.phase === "Reveal") && (
          <Link className="btn-nav primary" href={`/rfqs/${id}/bid`}>
            {rfq.phase === "Bidding" ? "Submit a sealed bid →" : "Reveal your bid →"}
          </Link>
        )}
        <Link className="btn-nav" href={`/rfqs/${id}/pack`}>
          Tender pack ↓
        </Link>
        <Link className="btn-nav" href={`/audit/${id}`}>
          Audit the decision
        </Link>
        <a
          className="btn-nav ghost"
          href={explorerAddress(contracts.RFQRegistry)}
          target="_blank"
          rel="noreferrer"
          title={`RFQRegistry on ${chain.name}`}
        >
          Contract ↗
        </a>
      </nav>
    </div>
  );
}
