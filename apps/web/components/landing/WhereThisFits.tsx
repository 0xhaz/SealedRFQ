/**
 * Positioning, answered before a reader assumes it.
 *
 * Anyone who knows this market will ask "isn't this Coupa?" within a minute of landing here. It is
 * not: orchestration suites route decisions and hand payment to an ERP, which is a different layer
 * from settling the money itself. Saying so plainly — and saying what we do *not* do — is more
 * persuasive than claiming to replace a stack we complement.
 */
const LAYERS = [
  {
    layer: "Intake and approvals",
    who: "Coupa, SAP Ariba, Tonkean",
    what: "A request is raised, routed, approved and tracked across the people who must sign off.",
    ours: false,
  },
  {
    layer: "Sourcing, sealed bids, award",
    who: "SealedRFQ",
    what: "Suppliers bid without seeing each other. An evaluator scores against a rubric fixed before bidding, and the contract refuses an award that breaks the published rules.",
    ours: true,
  },
  {
    layer: "Escrow and milestone payment",
    who: "SealedRFQ",
    what: "The budget is locked before bidding opens and released per milestone against delivery, with retention, stakes and deadlines that apply to both sides.",
    ours: true,
  },
  {
    layer: "Contracts, invoices, spend analytics",
    who: "Ironclad, ERP, P2P suites",
    what: "The paperwork and reporting that follow an award and a payment.",
    ours: false,
  },
] as const;

export function WhereThisFits() {
  return (
    <section className="fits">
      <h2 className="section-title">Where this fits</h2>
      <p className="story-lede">
        Procurement software is mostly orchestration: it moves a decision through an organisation,
        then hands the payment to an ERP and a bank. SealedRFQ is the layer underneath — the part
        where the money actually moves, and where a losing bidder can check the reasoning instead of
        taking someone&apos;s word for it.
      </p>

      <div className="stack">
        {LAYERS.map((l) => (
          <div key={l.layer} className={`stack-row ${l.ours ? "is-ours" : ""}`}>
            <div className="stack-label">
              <b>{l.layer}</b>
              <span className={l.ours ? "stack-who ours" : "stack-who"}>{l.who}</span>
            </div>
            <p>{l.what}</p>
          </div>
        ))}
      </div>

      <div className="trust-foot">
        The difference is not scope, it is what the software can guarantee. An orchestration platform
        records that an award was approved; the money then moves in a system it does not control, and
        its AI&apos;s reasoning lives in a database only its operator can read. Here the award cannot
        exceed the published budget because the contract rejects it, the payment is already escrowed,
        and the reasoning is anchored so anyone can re-hash it. That is worth having <i>under</i> an
        intake tool, not instead of one — an awarded PO and its milestone receipts should still flow
        back into whatever system your finance team already lives in.
      </div>
    </section>
  );
}
