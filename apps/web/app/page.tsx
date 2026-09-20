import Link from "next/link";
import { Header } from "@/components/Header";
import { HeroRFQ } from "@/components/landing/HeroRFQ";
import { chain, contracts, explorerAddress, explorerTx } from "@/lib/chain";
import evidence from "@/lib/deployments/evidence-5042002.json";

const FIREWALL_TX = evidence.steps.find((s) => s.status === "0x0")?.tx ?? "";

export default function Home() {
  return (
    <div className="shell">
      <Header />

      <div className="desk-status live">
        <div className="desk-status-main">
          <span className="ds-pill live">
            <i /> LIVE · {chain.name.toUpperCase()}
          </span>
          <span className="ds-text">
            Every RFQ, sealed bid and payout on this site is a <b>real Arc transaction</b>, settled
            in USDC.
          </span>
        </div>
      </div>

      <section className="hero">
        <div>
          {/* One clause per line: leaving the breaks to the browser split "Sealed bids. AI /
              scores." and lost the rhythm the line is built on. */}
          <h1>
            <span className="h1-line">Sealed bids.</span>
            <span className="h1-line">AI scores.</span>
            <span className="h1-line">Arc awards.</span>
            <span className="h1-line accent">Suppliers get paid.</span>
          </h1>
          <p className="hero-sub">
            SealedRFQ is sealed-bid procurement for B2B buyers. Suppliers commit sealed bids backed
            by a refundable <span className="arc-word">USDC</span> deposit. An AI evaluator scores
            them against a rubric published before bidding opened, an on-chain policy decides
            whether the award is allowed, and the winner is paid milestone by milestone.
          </p>
          <p className="hero-tagline">
            An AI can recommend the winner. <b>Only the contract can award.</b>
          </p>
          <div className="hero-cta">
            <Link className="btn-primary" href="/rfqs">
              ▶ Browse open RFQs
            </Link>
            <Link className="btn-outline" href="/rfqs/new">
              Post an RFQ
            </Link>
          </div>
          <p className="hero-links">
            <a href={explorerAddress(contracts.RFQRegistry)} target="_blank" rel="noreferrer">
              View the contracts &amp; transaction evidence →
            </a>
          </p>
          <div className="hero-metrics">
            <div className="hm-red">
              <b>{evidence.steps.length}</b>
              <span>real Arc txs in one full lifecycle</span>
            </div>
            <div>
              <b>Sealed</b>
              <span>no price is visible until the reveal window</span>
            </div>
            <div>
              <b>On-chain</b>
              <span>award limits the AI cannot cross</span>
            </div>
          </div>
        </div>
        <HeroRFQ />
      </section>

      {/* ---- One RFQ, sealed bids, two gates, paid by milestone ---- */}
      <section className="story">
        <h2 className="section-title">One RFQ. Sealed bids. Two gates. Paid by milestone.</h2>
        <p className="story-lede">
          Northwind needs a vendor. Three suppliers bid without seeing each other&apos;s prices.
          Before any money moves, the award has to pass two gates — and after that, payment follows
          delivery. Every arrow below runs on <span className="arc-word">Arc</span>.
        </p>
        <div className="flow">
          <div className="flow-step">
            <span className="flow-n">STEP 01 · SEALED</span>
            <h3>Bids go on-chain as hashes</h3>
            <p>
              Each supplier posts a commitment and a USDC deposit. Prices stay invisible until the
              reveal window, and a supplier that never reveals <b>forfeits its deposit</b>.
            </p>
            <div className="gate-verdicts">
              <span className="gv ok">REVEAL ✓</span>
              <span className="gv no">NO-SHOW ✕</span>
            </div>
          </div>

          <div className="flow-step">
            <span className="flow-n">STEP 02 · GATE 1 · AI</span>
            <h3>The model scores against a published rubric</h3>
            <p>
              The rubric&apos;s hash is fixed when the RFQ opens, so it cannot be rewritten to fit a
              favoured bid. The memo is anchored whether it recommends or rejects.
            </p>
            <div className="gate-verdicts">
              <span className="gv no">REJECT ✕</span>
              <span className="gv ok">RECOMMEND →</span>
            </div>
          </div>

          <div className="flow-step is-gate">
            <span className="flow-n">STEP 03 · GATE 2 · ARC</span>
            <h3>The contract decides if the award is allowed</h3>
            <p>
              Budget cap, minimum bidders, deposit ratio, rubric match and concentration limits are
              enforced inside <span className="mono-sm">award()</span>. An over-budget
              recommendation reverts with <span className="mono-sm">AwardExceedsBudget</span>.
            </p>
            <div className="gate-verdicts">
              <span className="gv no">BLOCK ⛔</span>
              <span className="gv ok">AWARD →</span>
            </div>
            {FIREWALL_TX && (
              <div className="flow-links">
                <a href={explorerTx(FIREWALL_TX)} target="_blank" rel="noreferrer">
                  Open the real reverted transaction ↗
                </a>
              </div>
            )}
          </div>

          <div className="flow-step">
            <span className="flow-n">STEP 04 · MILESTONES</span>
            <h3>Payment follows delivery</h3>
            <p>
              One escrow job per milestone. The supplier submits a deliverable hash; the buyer
              accepts or rejects with a reason. If the buyer goes silent, payment{" "}
              <b>auto-releases</b>. Retention is held until final acceptance.
            </p>
            <div className="gate-verdicts">
              <span className="gv ok">ACCEPT ↗</span>
              <span className="gv ok">SILENCE ⏱</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---- What makes it different ---- */}
      <section className="caps">
        <h2 className="section-title">What makes it different</h2>
        <div className="caps-list">
          <div className="cap-row">
            <h3>
              <i>⛔</i> AI proposes, the contract disposes
            </h3>
            <p>
              Six caps live inside <span className="mono-sm">award()</span>. An AI-recommended bid
              above the published budget is <b>rejected by the contract itself</b>, and the
              evaluator&apos;s recommendation is bound to one winner — so an awarder key cannot
              quietly redirect it to someone else.
            </p>
          </div>
          <div className="cap-row">
            <h3>
              <i>🔒</i> Sealed until the reveal
            </h3>
            <p>
              Commit-reveal bids backed by USDC deposits. In RFP mode the proposal document is
              sealed alongside the price, so neither the number nor the method can be revised after
              rival bids open. Losing bidders are refunded automatically; the winner&apos;s deposit
              becomes a <b>performance stake</b>.
            </p>
          </div>
          <div className="cap-row">
            <h3>
              <i>⏱</i> Neither side can stall the other
            </h3>
            <p>
              Every state has a clock. No award means deposits refund. Buyer silence auto-releases
              payment, so a supplier who delivered is never held hostage by someone who stops
              answering. A missed delivery deadline ends the engagement in the buyer&apos;s favour.
            </p>
          </div>
          <div className="cap-row">
            <h3>
              <i>🔑</i> Least-privilege keys
            </h3>
            <p>
              The evaluator scores but cannot award. The awarder awards but cannot choose. The
              verifier releases payment but can never refund a deposit. Compromising one key does
              not compromise the outcome.
            </p>
          </div>
          <div className="cap-row">
            <h3>
              <i>🧾</i> Audit any award
            </h3>
            <p>
              Every AI decision is anchored as a hash. Re-hash the published memo and compare it
              with the chain: an edited rationale fails the check instead of reading plausibly.
              Rejections are recorded exactly like approvals.
            </p>
          </div>
          <div className="cap-row">
            <h3>
              <i>💵</i> USDC end to end
            </h3>
            <p>
              Budgets, deposits and payouts are all USDC, which is also the gas on Arc. Buyers fund
              an RFQ in a single signature with ERC-2612 <span className="mono-sm">permit</span>,
              and payouts are pull-only so no recipient can block a milestone.
            </p>
          </div>
        </div>
      </section>

      {/* ---- Evidence ---- */}
      <section className="runit">
        <div className="runit-card">
          <div>
            <h2>Don&apos;t take our word for it. Open every transaction.</h2>
            <p>
              A complete lifecycle ran on {chain.name}: {evidence.steps.length} transactions from
              sealed bids to the final milestone, including the policy firewall rejecting an
              AI-recommended over-budget award. Every contract ended at a zero balance.
            </p>
          </div>
          <a
            className="btn-primary big"
            href={explorerAddress(contracts.RFQRegistry)}
            target="_blank"
            rel="noreferrer"
          >
            ▶ OPEN THE EVIDENCE
          </a>
        </div>
      </section>

      <footer className="foot">
        <span className="foot-label">Contracts on {chain.name}</span>
        <nav className="page-nav">
          {(
            [
              ["RFQRegistry", contracts.RFQRegistry],
              ["SealedRFQAdapter", contracts.SealedRFQAdapter],
              ["AgenticCommerce · ERC-8183", contracts.AgenticCommerce],
              ["ProcurementPolicy", contracts.ProcurementPolicy],
              ["AttestationLog", contracts.AttestationLog],
            ] as const
          ).map(([name, address]) => (
            <a
              key={name}
              className="btn-nav ghost"
              href={explorerAddress(address)}
              target="_blank"
              rel="noreferrer"
              title={address}
            >
              {name} ↗
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
