import { Party } from "@/components/Party";
import { TeamAccount } from "@/components/TeamAccount";
import { ensNames } from "@/lib/ens";
import { DirectMessages } from "@/components/DirectMessages";
import { Proforma } from "@/components/Proforma";
import { DocumentCheck } from "@/components/DocumentCheck";
import { EvaluationPanel } from "@/components/EvaluationPanel";
import { Header } from "@/components/Header";
import { Payouts } from "@/components/Payouts";
import { PhaseBadge } from "@/components/PhaseBadge";
import { ReasonNote } from "@/components/ReasonNote";
import { RfqActions } from "@/components/RfqActions";
import { SettleDeposit } from "@/components/SettleDeposit";
import { agent } from "@/lib/agent";
import { chain, contracts, explorerAddress } from "@/lib/chain";
import { readLineItems } from "@/lib/lineItems";
import { milestoneLedger, milestoneMeaning } from "@/lib/milestones";
import { countdown, getBid, getBidders, getEngagement, getRfq, getRfqCount, getPlatformFeeBps} from "@/lib/rfq";
import { CATEGORIES, REGIONS, labelFor } from "@/lib/taxonomy";
import { formatUsdc, describeWindow} from "@sealedrfq/shared";
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
  const [evaluation, audit, indexed] = await Promise.all([
    agent.evaluation(id),
    agent.audit(id),
    agent.rfq(id),
  ]);
  const indexedMilestones = "milestones" in indexed ? (indexed.milestones ?? []) : [];

  // The published document, for the line items and shipment terms a proforma needs. A bare URI
  // rather than an inline document is not an error here — the proforma simply carries the totals.
  let published: Record<string, unknown> | null = null;
  try {
    const uri = "rfq" in indexed ? (indexed.rfq?.metadataURI ?? null) : null;
    published = uri ? (JSON.parse(uri) as Record<string, unknown>) : null;
  } catch {
    published = null;
  }
  const shipment = (published?.shipment ?? null) as {
    incoterm?: string;
    namedPlace?: string;
  } | null;
  const sealed = rfq.phase === "Bidding";
  // A quotation can now ride on a plain RFQ, not only an RFP, so the column follows the bids
  // rather than the mode: show it whenever any revealed bid actually carries a document.
  const hasDocuments =
    rfq.requiresProposal ||
    bids.some((b) => b.revealed && b.proposalHash !== `0x${"0".repeat(64)}`);
  const sorted = [...bids].sort((a, b) =>
    a.revealed && b.revealed ? Number(a.price - b.price) : a.revealed ? -1 : 1,
  );

  /*
   * Names for everyone shown on this page. Resolved here, on the server, so a reader's browser
   * never tells an Ethereum endpoint which tenders they are looking at — and so an endpoint that
   * is slow or missing costs one await rather than a render per row. Empty when ENS is not
   * configured, which is the default.
   */
  const names = await ensNames([rfq.buyer, ...bids.map((b) => b.bidder)]);
  const platformFeeBps = await getPlatformFeeBps();
  /*
   * The winning supplier's published profile, for the proforma's seller name. Signed by their own
   * wallet, so it is at least theirs to claim — still a claim, which is why the document says so
   * and the field stays editable.
   */
  const supplierProfile = engagement ? await agent.supplier(engagement.supplier) : null;

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
          <Party address={rfq.buyer} name={names[rfq.buyer.toLowerCase()]} />{" "}
          <TeamAccount address={rfq.buyer} />
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
                      <tr className="row" key={b.bidder}>
                        <td data-label="Supplier">
                          <Party
                            address={b.bidder}
                            name={names[b.bidder.toLowerCase()]}
                            badge={
                              b.bidder.toLowerCase() === rfq.winner.toLowerCase() ? (
                                <span className="badge badge-inline p-awarded">WON</span>
                              ) : null
                            }
                          />
                        </td>
                        <td className="num" data-label="Price">
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
                        <td className="num" data-label="Delivery">
                          {b.revealed && !sealed ? describeWindow(b.deliverySeconds) : "—"}
                        </td>
                        {hasDocuments && (
                          <td className="mono" style={{ fontSize: 11 }} data-label={rfq.requiresProposal ? "Proposal" : "Quotation"}>
                            {b.revealed && !sealed && b.proposalHash !== `0x${"0".repeat(64)}`
                              ? `${b.proposalHash.slice(0, 14)}…`
                              : "—"}
                          </td>
                        )}
                        <td data-label="Deposit">
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

          <Payouts buyer={rfq.buyer} supplier={engagement?.supplier} />

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
                <b>
                  {formatUsdc(engagement.retentionHeld)} USDC
                  {engagement.retentionHeld === 0n && engagement.status === "Completed" && (
                    // Zero here is ambiguous on a finished engagement: nothing was ever withheld,
                    // or it was withheld and has since been paid out. Only one of those is true.
                    <span className="hint"> · released to the supplier</span>
                  )}
                </b>
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
                  platformFeeBps,
                );
                return (
                  <table>
                    <thead>
                      <tr>
                        <th>Milestone</th>
                        <th className="num">Value</th>
                        <th className="num">Retained</th>
                        {platformFeeBps > 0 && <th className="num">Fee</th>}
                        <th className="num">Pays now</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.lines.map((l) => {
                        const done = l.index < engagement.currentMilestone;
                        const current = l.index === engagement.currentMilestone;
                        return (
                          <tr className="row" key={l.index}>
                            <td data-label="Milestone">
                              {l.index + 1} of {ledger.lines.length}
                              {current && <span className="badge badge-inline">current</span>}
                            </td>
                            <td className="num" data-label="Value">{formatUsdc(l.gross)}</td>
                            <td className="num" data-label="Retained">{formatUsdc(l.retained)}</td>
                            {platformFeeBps > 0 && (
                              <td className="num" data-label="Fee">−{formatUsdc(l.fee)}</td>
                            )}
                            <td className="num" data-label="Pays now">{formatUsdc(l.net)}</td>
                            <td className="muted" style={{ fontSize: 12 }} data-label="State">
                              {(() => {
                                const m = indexedMilestones.find((x) => x.idx === l.index);
                                return m
                                  ? milestoneMeaning(m.state, m.automatic)
                                  : done
                                    ? "paid"
                                    : current
                                      ? "in progress"
                                      : "not started";
                              })()}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="row">
                        <td data-label="Milestone">
                          <b>Retention</b>
                        </td>
                        <td className="num" data-label="Value">—</td>
                        <td className="num" data-label="Retained">{formatUsdc(ledger.retentionHeld)}</td>
                        {platformFeeBps > 0 && (
                          <td className="num" data-label="Fee">
                            <span className="muted">none</span>
                          </td>
                        )}
                        <td className="num" data-label="Pays now">
                          <b>{formatUsdc(ledger.retentionHeld)}</b>
                        </td>
                        <td className="muted" style={{ fontSize: 12 }} data-label="State">
                          {/*
                            The table is the schedule; the header above is the state. Once the
                            engagement completes, `retentionHeld` on-chain is zero while this row
                            still shows the figure it was — which reads as money still owed sitting
                            next to a header saying there is none.
                          */}
                          {/*
                            States that it was released, not that it is waiting. This table cannot
                            see `withdrawable`, so telling a supplier to go and claim something
                            they may have claimed already sends them to a panel saying nothing is
                            owed — which reads as money having gone missing.
                          */}
                          {engagement.retentionHeld === 0n && engagement.status === "Completed"
                            ? "released with the final milestone"
                            : "released at final acceptance"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
              {indexedMilestones
                .filter((m) => m.reason)
                .map((m) => (
                  <ReasonNote
                    key={`reason-${m.idx}`}
                    hash={m.reason}
                    label={`Milestone ${m.idx + 1} — ${m.state === "Rejected" ? "rejected" : "accepted"}:`}
                  />
                ))}
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

          {engagement && (
            <Proforma
              rfqId={id}
              buyer={rfq.buyer}
              supplier={engagement.supplier}
              awardPrice={engagement.price.toString()}
              retentionBps={rfq.retentionBps}
              milestoneBps={[...rfq.milestoneBps]}
              incoterm={shipment?.incoterm}
              namedPlace={shipment?.namedPlace}
              lineItems={readLineItems(published)}
              supplierName={supplierProfile?.profile?.name}
              supplierCountry={supplierProfile?.profile?.country || undefined}
            />
          )}

          {engagement && <DirectMessages buyer={rfq.buyer} supplier={engagement.supplier} />}
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
            commitCount={Number(rfq.commitCount)}
            status={rfq.status}
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
                    deliveryDeadline: engagement.deliveryDeadline,
                    receivedAt: engagement.receivedAt,
                    transitWindow: engagement.transitWindow,
                    // The same sum `_drain` computes, so the warning quotes the real figure
                    // rather than an approximation of it.
                    expiredPot: (
                      engagement.price -
                      engagement.allocated +
                      engagement.retentionHeld +
                      engagement.currentJobBudget +
                      engagement.performanceStake +
                      engagement.buyerStake
                    ).toString(),
                    performanceStake: engagement.performanceStake.toString(),
                    currentRetention: engagement.currentRetention.toString(),
                    excessCost: engagement.excessCost.toString(),
                    retentionHeld: engagement.retentionHeld.toString(),
                    deliverable: engagement.deliverable,
                    latestExtension: engagement.latestExtension,
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
