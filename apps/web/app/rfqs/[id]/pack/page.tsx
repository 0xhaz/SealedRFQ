import { TenderPackActions } from "@/components/TenderPackActions";
import { agent } from "@/lib/agent";
import { chain, contracts, explorerAddress } from "@/lib/chain";
import { hashText, sameHash } from "@/lib/docHash";
import { readLineItems } from "@/lib/lineItems";
import { getRfq, getRfqCount } from "@/lib/rfq";
import { CATEGORIES, REGIONS, labelFor } from "@/lib/taxonomy";
import { formatUsdc } from "@sealedrfq/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The tender pack: everything a supplier needs to decide whether to bid, on one printable page.
 *
 * Separate from the RFQ page on purpose. That one is a live dashboard with actions and countdowns;
 * this is the document you send to the people who will price it, so it carries no buttons, no
 * state that goes stale in an inbox, and every hash needed to prove the copy is genuine.
 */
export default async function TenderPack({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await getRfqCount())) notFound();

  const rfq = await getRfq(id);
  const indexed = await agent.rfq(id);
  const metadataURI = "rfq" in indexed ? (indexed.rfq?.metadataURI ?? null) : null;

  let published: Record<string, unknown> | null = null;
  try {
    published = metadataURI ? (JSON.parse(metadataURI) as Record<string, unknown>) : null;
  } catch {
    published = null; // a bare URI rather than an inline document
  }

  const lineItems = readLineItems(published);
  const terms = (published?.terms ?? null) as {
    summary?: string;
    uri?: string;
    name?: string;
    sha256?: string;
  } | null;
  const requirements = (published?.requirements ?? null) as {
    maxDeliveryDays?: number;
    minCompletedEngagements?: number;
    attestations?: string[];
  } | null;
  const rubric = (published?.rubric ?? null) as Record<string, number> | null;
  const scope = typeof published?.scope === "string" ? published.scope : null;
  const documentMatches = metadataURI ? sameHash(hashText(metadataURI), rfq.metadataHash) : false;

  const row = (k: string, v: React.ReactNode) => (
    <tr key={k}>
      <th style={{ textAlign: "left", width: "38%", fontWeight: 500 }}>{k}</th>
      <td>{v}</td>
    </tr>
  );

  return (
    <div className="shell pack">
      <div className="pack-head">
        <div>
          <h1>
            Request for {rfq.requiresProposal ? "Proposal" : "Quotation"} № {id}
          </h1>
          <p className="pack-sub">
            {labelFor(CATEGORIES, rfq.category)} · {labelFor(REGIONS, rfq.region)} · {chain.name} ·
            issued by <span className="mono">{rfq.buyer}</span>
          </p>
        </div>
        <TenderPackActions rfqId={id} metadataURI={metadataURI} />
      </div>

      {!documentMatches && (
        <div className="note warn">
          <b>This pack could not be verified against the chain.</b> The published document does not
          hash to the value recorded when the RFQ opened, or the agent did not serve it. Ask the
          buyer for the original before quoting.
        </div>
      )}

      <section>
        <h2>1. What is being bought</h2>
        <p>{scope ?? "No scope published with this RFQ."}</p>
        {lineItems.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th>Unit</th>
                <th style={{ width: "22%" }}>Your unit price</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((l, i) => (
                <tr key={`${l.item}-${i}`}>
                  <td>{i + 1}</td>
                  <td>{l.item}</td>
                  <td style={{ textAlign: "right" }}>{l.qty ?? "—"}</td>
                  <td>{l.uom ?? "—"}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="pack-note">
          Bid <b>one total</b> for the whole list. The breakdown belongs in your quotation document,
          which is hashed and sealed with your price.
        </p>
      </section>

      <section>
        <h2>2. Commercial terms</h2>
        <table>
          <tbody>
            {row(
              "Published budget",
              `${formatUsdc(rfq.budget)} USDC — bids above this are rejected by the contract`,
            )}
            {row(
              "Bid deposit",
              `${formatUsdc(rfq.depositAmount)} USDC, refunded unless you fail to reveal`,
            )}
            {row(
              "Buyer's stake",
              `${formatUsdc(rfq.buyerStake)} USDC, held until final acceptance`,
            )}
            {row(
              "Retention",
              `${rfq.retentionBps / 100}% of each milestone, released at final acceptance`,
            )}
            {row("Milestones", rfq.milestoneBps.map((b) => `${b / 100}%`).join(" · "))}
            {row("Delivery window", `${rfq.deliveryWindow / 60} minutes per milestone`)}
            {row(
              "Acceptance window",
              `${rfq.acceptanceWindow / 60} minutes, after which payment auto-releases`,
            )}
            {row("Settlement", `USDC on ${chain.name}. Payouts are pull-only.`)}
          </tbody>
        </table>
      </section>

      <section>
        <h2>3. Timetable</h2>
        <table>
          <tbody>
            {row("Bidding closes", when(rfq.bidDeadline))}
            {row(
              "Revealing closes",
              `${when(rfq.revealDeadline)} — an unrevealed bid forfeits its deposit`,
            )}
            {row("Award deadline", when(rfq.awardDeadline))}
          </tbody>
        </table>
        <p className="pack-note">
          Deadlines are judged by block timestamp, not by your computer&apos;s clock. Bidding is two
          steps: seal a bid before the first deadline, then <b>return and reveal it</b> before the
          second.
        </p>
      </section>

      <section>
        <h2>4. Terms and conditions</h2>
        {terms?.summary ? <p>{terms.summary}</p> : <p>No terms published with this RFQ.</p>}
        {terms?.uri && (
          <p>
            Document:{" "}
            <a href={terms.uri} target="_blank" rel="noreferrer noopener">
              {terms.name ?? terms.uri}
            </a>
          </p>
        )}
        {terms?.sha256 && (
          <p className="pack-note">
            Terms document sha256 <span className="mono">{terms.sha256}</span> — check the file you
            were sent against this before quoting.
          </p>
        )}
        <p className="pack-note">
          Submitting a bid accepts these terms as published here. They cannot be revised afterwards
          without changing the hash below, which every bidder can see.
        </p>
      </section>

      <section>
        <h2>5. Requirements</h2>
        {requirements ? (
          <table>
            <tbody>
              {requirements.maxDeliveryDays !== undefined &&
                row("Delivery required within", `${requirements.maxDeliveryDays} days`)}
              {requirements.minCompletedEngagements !== undefined &&
                row(
                  "Completed jobs on this deployment",
                  `at least ${requirements.minCompletedEngagements}`,
                )}
              {requirements.attestations?.length
                ? row(
                    "Stated requirements",
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {requirements.attestations.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>,
                  )
                : null}
            </tbody>
          </table>
        ) : (
          <p>No additional requirements published.</p>
        )}
        <p className="pack-note">
          The first two are screened automatically when bids are revealed. The rest are recorded
          against every bid as still needing a human check — nothing is ever marked satisfied
          because a bid says so.
        </p>
      </section>

      <section>
        <h2>6. How the winner is chosen</h2>
        {rubric ? (
          <table>
            <tbody>{Object.entries(rubric).map(([k, v]) => row(`Weight — ${k}`, `${v}`))}</tbody>
          </table>
        ) : (
          <p>No rubric published.</p>
        )}
        <p className="pack-note">
          An evaluator scores every revealed bid against this rubric and publishes a signed memo.
          The buyer awards; the contract refuses an award that exceeds the budget, that names a
          bidder the evaluator did not recommend, or that breaks any other published rule. Losing
          bids are scored too, and the reasoning can be re-hashed against the chain by anyone.
        </p>
      </section>

      <section>
        <h2>7. Verification</h2>
        <table>
          <tbody>
            {row("RFQ metadata sha256", <span className="mono">{rfq.metadataHash}</span>)}
            {row("Rubric sha256", <span className="mono">{rfq.rubricHash}</span>)}
            {row(
              "Registry contract",
              <a href={explorerAddress(contracts.RFQRegistry)} target="_blank" rel="noreferrer">
                {contracts.RFQRegistry}
              </a>,
            )}
            {row("Visibility", rfq.inviteOnly ? "Invited suppliers only" : "Open to any supplier")}
          </tbody>
        </table>
      </section>

      <div className="pack-foot no-print">
        <Link className="btn-outline" href={`/rfqs/${id}`}>
          ← Back to the RFQ
        </Link>
        <Link className="btn-primary" href={`/rfqs/${id}/bid`}>
          Bid on this RFQ →
        </Link>
      </div>
    </div>
  );
}
