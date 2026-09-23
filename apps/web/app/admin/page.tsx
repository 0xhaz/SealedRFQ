import { AdminPanel } from "@/components/AdminPanel";
import { Header } from "@/components/Header";
import { agent } from "@/lib/agent";
import { chain } from "@/lib/chain";
import { formatUsdc } from "@sealedrfq/shared";

export const dynamic = "force-dynamic";

/**
 * The operator's own view of the deployment.
 *
 * Unlisted rather than protected, and that is the honest description: everything read here is
 * public, so there is nothing to protect. The counts come from events anyone can index and the
 * roles from `hasRole`, which anyone can call. The only part that needs a key is acting, and the
 * contracts enforce that themselves — a visitor who opens this page sees the same figures and no
 * buttons they can use.
 *
 * Deliberately not called a revenue dashboard. On this deployment the fee is zero and, even when
 * it is not, nothing accrues inside the contracts to be withdrawn.
 */
export default async function AdminPage() {
  const stats = await agent.stats();

  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

  return (
    <div className="shell">
      <Header />

      <section className="desk-head">
        <h2 className="section-title">Operator</h2>
        <p className="desk-head-sub">
          What has happened on {chain.name}, what this wallet can do about it, and how to give that
          up. Every figure here is public; the roles below are enforced by the contracts, not by
          this page.
        </p>
      </section>

      <div className="supplier-list">
        <div className="panel">
          <div className="head">
            Tenders
            <span className="hint">indexed to block {stats.indexedBlock.toLocaleString()}</span>
          </div>
          <div className="kv">
            <span>Posted</span>
            <b>{stats.rfqs.total}</b>
          </div>
          <div className="kv">
            <span>Awarded</span>
            <b>
              {stats.rfqs.awarded} <span className="hint">{pct(stats.rfqs.awarded, stats.rfqs.total)}</span>
            </b>
          </div>
          <div className="kv">
            <span>Closed with no award</span>
            <b>{stats.rfqs.closedNoAward}</b>
          </div>
          <div className="kv">
            <span>Budget published</span>
            <b>{formatUsdc(BigInt(stats.rfqs.budgetTotal))} USDC</b>
          </div>
          <div className="kv">
            <span>Awarded value</span>
            <b>{formatUsdc(BigInt(stats.rfqs.awardedValue))} USDC</b>
          </div>
        </div>

        <div className="panel">
          <div className="head">
            Bidding
            <span className="hint">{stats.bids.uniqueBidders} distinct wallets</span>
          </div>
          <div className="kv">
            <span>Bids sealed</span>
            <b>{stats.bids.total}</b>
          </div>
          <div className="kv">
            <span>Revealed</span>
            <b>
              {stats.bids.revealed} <span className="hint">{pct(stats.bids.revealed, stats.bids.total)}</span>
            </b>
          </div>
          <div className="kv">
            <span>Never revealed — deposit forfeited</span>
            <b className={stats.bids.abandoned > 0 ? "warn-text" : ""}>{stats.bids.abandoned}</b>
          </div>
          <div className="note">
            A high abandonment rate is the number to watch. It usually means reveal windows are too
            short for people switching wallets by hand, not that bidders are gaming anything.
          </div>
        </div>

        <div className="panel">
          <div className="head">Delivery</div>
          <div className="kv">
            <span>Engagements started</span>
            <b>{stats.engagements.total}</b>
          </div>
          <div className="kv">
            <span>Active</span>
            <b>{stats.engagements.active}</b>
          </div>
          <div className="kv">
            <span>Completed</span>
            <b>{stats.engagements.completed}</b>
          </div>
          <div className="kv">
            <span>Abandoned — nothing delivered in time</span>
            <b className={stats.engagements.abandoned > 0 ? "warn-text" : ""}>
              {stats.engagements.abandoned}
            </b>
          </div>
          <div className="kv">
            <span>Disputed</span>
            <b>{stats.engagements.disputed}</b>
          </div>
          <div className="kv">
            <span>Milestones accepted / rejected</span>
            <b>
              {stats.milestones.accepted} / {stats.milestones.rejected}
            </b>
          </div>
          <div className="kv">
            <span>Released because the buyer said nothing</span>
            <b>{stats.milestones.automatic}</b>
          </div>
          <div className="note">
            The last line is the liveness guarantee doing its job, not a fault — but a buyer who
            never answers is worth knowing about before they post the next tender.
          </div>
        </div>

        <AdminPanel />
      </div>
    </div>
  );
}
