/**
 * The trust boundary, stated in the product rather than buried in a README.
 *
 * Systems like this mislead people by implying that because an AI scored something and a contract
 * settled it, the goods must be real. Nothing here inspects physical reality. Saying so plainly is
 * part of being safe to use on mainnet.
 */
export function TrustBoundary() {
  return (
    <section className="trust">
      <h2 className="section-title">What this proves — and what it doesn&apos;t</h2>
      <p className="story-lede">
        SealedRFQ settles money against rules and hashes. It cannot see a warehouse. Knowing exactly
        where the guarantees stop is what makes the parts that are guaranteed worth relying on.
      </p>

      <div className="trust-grid">
        <div className="trust-col">
          <div className="trust-tag">THE AI CHECKS</div>
          <ul>
            <li>Bids against the rubric published before bidding opened</li>
            <li>Price, delivery and consistency across competing bids</li>
            <li>Red flags it can see in the numbers: over budget, no track record</li>
          </ul>
          <p className="trust-note">
            It scores <b>bids before an award</b>. It never sees what is delivered afterwards.
          </p>
        </div>

        <div className="trust-col">
          <div className="trust-tag">THE CONTRACT ENFORCES</div>
          <ul>
            <li>Budget caps, minimum bidders, deposit ratios, concentration limits</li>
            <li>That a price stays sealed until the reveal window</li>
            <li>That escrow exists before bidding, and that every state has a deadline</li>
            <li>That a document hash cannot change after submission</li>
          </ul>
          <p className="trust-note">
            It enforces <b>rules, clocks and money</b>. It cannot know whether a pallet holds what
            the label says.
          </p>
        </div>

        <div className="trust-col is-you">
          <div className="trust-tag">YOU MUST VERIFY</div>
          <ul>
            <li>That the goods, materials or work actually meet the specification</li>
            <li>That certificates, insurance and test reports are genuine</li>
            <li>That the supplier is who they claim to be, before you rely on them</li>
          </ul>
          <p className="trust-note">
            No oracle here inspects physical reality. <b>Accepting a milestone releases money</b>, so
            inspect before you accept — not after.
          </p>
        </div>
      </div>

      <div className="trust-foot">
        The protocol&apos;s job is to give that human check teeth: retention held back until final
        acceptance, a performance stake the supplier forfeits on abandonment, a rejection recorded
        on-chain with its reason, and an arbiter of last resort. Payment auto-releases if a buyer
        stays silent past the acceptance window, which protects a supplier who delivered — so set a
        window long enough to actually inspect the work.
      </div>
    </section>
  );
}
