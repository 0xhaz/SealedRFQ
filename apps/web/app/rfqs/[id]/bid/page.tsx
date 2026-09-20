import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { PhaseBadge } from "@/components/PhaseBadge";
import { countdown, getRfq, getRfqCount } from "@/lib/rfq";
import { BidForm } from "./BidForm";

export const dynamic = "force-dynamic";

export default async function BidPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await getRfqCount())) notFound();
  const rfq = await getRfq(id);

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
        <BidForm
          rfqId={id}
          phase={rfq.phase}
          deposit={rfq.depositAmount.toString()}
          budget={rfq.budget.toString()}
          requiresProposal={rfq.requiresProposal}
        />
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
