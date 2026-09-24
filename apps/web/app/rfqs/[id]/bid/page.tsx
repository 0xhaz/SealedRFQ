import { Clarifications } from "@/components/Clarifications";
import { Header } from "@/components/Header";
import { LineItems } from "@/components/LineItems";
import { PhaseBadge } from "@/components/PhaseBadge";
import { RequirementsPanel } from "@/components/RequirementsPanel";
import { TermsPanel } from "@/components/TermsPanel";
import { agent } from "@/lib/agent";
import { countdown, getRfq, getRfqCount } from "@/lib/rfq";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BidForm } from "./BidForm";

export const dynamic = "force-dynamic";

export default async function BidPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await getRfqCount())) notFound();
  const rfq = await getRfq(id);
  // The document lives off-chain; TermsPanel re-hashes it against the chain rather than trusting it.
  const indexed = await agent.rfq(id);

  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">
          Bid on RFQ № {id} <PhaseBadge phase={rfq.phase} />
        </h2>
        <p className="desk-head-sub">
          {rfq.phase === "Bidding"
            ? `Bidding closes in ${countdown(rfq.bidDeadline)}, then the reveal window opens for ${Math.round(
                (rfq.revealDeadline - rfq.bidDeadline) / 60,
              )} minutes.`
            : rfq.phase === "Reveal"
              ? `Reveal closes in ${countdown(rfq.revealDeadline)}. An unrevealed bid forfeits its deposit.`
              : "This RFQ is no longer taking bids."}
        </p>
      </section>

      <div className="grid">
        {/* One stack, in the order a supplier reads: what is wanted, on what terms, then bid. Left
            as bare children of .grid they were auto-placed across both columns by source order,
            which stranded short panels beside tall ones and left gaps between them. */}
        <div className="col">
          <div className="note">
            Pricing this offline? The{" "}
            <Link href={`/rfqs/${id}/pack`} className="linklike">
              tender pack
            </Link>{" "}
            has the full scope, terms, timetable and hashes on one printable page.
          </div>
          <LineItems metadataURI={"rfq" in indexed ? indexed.rfq?.metadataURI : null} />
          <RequirementsPanel metadataURI={"rfq" in indexed ? indexed.rfq?.metadataURI : null} />
          <TermsPanel
            metadataURI={"rfq" in indexed ? indexed.rfq?.metadataURI : null}
            metadataHash={rfq.metadataHash}
          />
          <Clarifications rfqId={id} buyer={rfq.buyer} biddingOpen={rfq.phase === "Bidding"} />
          <BidForm
            rfqId={id}
            phase={rfq.phase}
            deposit={rfq.depositAmount.toString()}
            budget={rfq.budget.toString()}
            deliveryWindow={rfq.deliveryWindow}
            bidMode={rfq.bidMode}
            requiresProposal={rfq.requiresProposal}
          />
        </div>
        <div className="right">
          <div className="panel">
            <div className="head">
              How sealed bidding works<span className="hint">commit → reveal → award</span>
            </div>
            <div className="note">
              <b>1. Commit.</b> Your price and delivery time are hashed with a secret salt. Only the
              hash goes on-chain, so no one — not the buyer, not the other bidders — can see your
              price while bidding is open.
            </div>
            <div className="note">
              <b>2. Deposit.</b> One signature posts the deposit and the commitment together. The
              deposit comes back when you reveal and do not win.
            </div>
            <div className="note">
              <b>3. Reveal.</b> After bidding closes you publish the price and salt. The contract
              re-hashes them and checks they match your commitment, so a bid cannot be changed after
              seeing the others.
            </div>
            <div className="note">
              <b>4. Award.</b> An evaluator scores the revealed bids against the rubric published
              before bidding opened. If you win, your deposit becomes the performance stake and is
              returned with the final milestone.
            </div>
          </div>
          <nav className="page-nav">
            <Link className="btn-nav" href={`/rfqs/${id}`}>
              ← RFQ details
            </Link>
            <Link className="btn-nav ghost" href="/rfqs">
              All RFQs
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
