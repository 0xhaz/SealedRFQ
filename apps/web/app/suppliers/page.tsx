import { Header } from "@/components/Header";
import { SupplierProfile } from "@/components/SupplierProfile";
import { agent } from "@/lib/agent";
import { explorerAddress } from "@/lib/chain";
import { CATEGORIES, REGIONS, labelFor } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Who has bid here, and what is known about them.
 *
 * The page is laid out to keep two kinds of statement apart, because a procurement directory is
 * exactly where they usually get blended into a badge. The left of each row is what a company says
 * about itself, signed but unverified by anyone. The right is counted from the chain and can be
 * recomputed by the reader. Nothing is combined into a rating: a single number would be the one
 * claim on this site nobody could check.
 *
 * An address is listed because it bid on something, never because it registered. A directory anyone
 * can add themselves to fills up with companies that have never done anything, which is the failure
 * mode of every self-registration registry — and it is also the easiest one to game.
 */
export default async function SupplierDirectory() {
  const { suppliers } = await agent.suppliers();

  return (
    <div className="shell">
      <Header />

      <section className="desk-head">
        <h2 className="section-title">Suppliers</h2>
        <p className="desk-head-sub">
          Everyone the chain has seen bid. What a company says about itself is signed but checked by
          nobody; what it has done is counted from tenders and can be recomputed by anyone.
        </p>
      </section>

      <div className="panel-stack">
        {suppliers.length === 0 && (
          <div className="panel">
            <div className="note">
              Nobody has bid yet — or the agent is unreachable, in which case this list is empty
              rather than wrong. Suppliers appear here once they commit their first sealed bid.
            </div>
          </div>
        )}

        {suppliers.map((s) => {
          const r = s.record.asSupplier;
          const claimed = s.profile;
          return (
            <div className="panel" key={s.address}>
              <div className="head">
                {claimed?.name ?? short(s.address)}
                <span className="hint">
                  {claimed ? "says about itself · unverified" : "no profile published"}
                </span>
              </div>

              <div className="kv">
                <span>Wallet</span>
                <a
                  className="mono"
                  href={explorerAddress(s.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(s.address)} ↗
                </a>
              </div>

              {claimed && (
                <>
                  {claimed.country && (
                    <div className="kv">
                      <span>Country</span>
                      <b>{labelFor(REGIONS, claimed.country)}</b>
                    </div>
                  )}
                  {claimed.categories.length > 0 && (
                    <div className="kv">
                      <span>Supplies</span>
                      <b>{claimed.categories.map((c) => labelFor(CATEGORIES, c)).join(", ")}</b>
                    </div>
                  )}
                  {claimed.website && (
                    <div className="kv">
                      <span>Website</span>
                      <a href={claimed.website} target="_blank" rel="noreferrer nofollow">
                        {claimed.website}
                      </a>
                    </div>
                  )}
                  {claimed.contact && (
                    <div className="kv">
                      <span>Contact</span>
                      <b>{claimed.contact}</b>
                    </div>
                  )}
                  {claimed.about && <div className="note">{claimed.about}</div>}
                </>
              )}

              <div className="note">
                <b>Counted from the chain</b> — {r.bidsPlaced} bid{r.bidsPlaced === 1 ? "" : "s"}{" "}
                placed, {r.bidsRevealed} revealed, {r.awards} won, {r.engagementsCompleted} engagement
                {r.engagementsCompleted === 1 ? "" : "s"} completed, {r.milestonesDelivered} milestone
                {r.milestonesDelivered === 1 ? "" : "s"} delivered
                {r.milestonesRejected > 0 && `, ${r.milestonesRejected} rejected`}
                {r.bidsAbandoned > 0 && (
                  <>
                    {" "}
                    — and <b>{r.bidsAbandoned}</b> sealed bid
                    {r.bidsAbandoned === 1 ? "" : "s"} never revealed, forfeiting the deposit
                  </>
                )}
                .
              </div>

              {claimed && (
                <div className="note">
                  Nothing above the counted line is verified by this site. A buyer who needs proof of
                  a certification or a company registration should ask for it directly.
                </div>
              )}

              <SupplierProfile
                address={s.address}
                initial={
                  claimed
                    ? {
                        name: claimed.name,
                        country: claimed.country,
                        categories: claimed.categories,
                        website: claimed.website,
                        contact: claimed.contact,
                        about: claimed.about,
                      }
                    : null
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
