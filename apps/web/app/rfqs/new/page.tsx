import Link from "next/link";
import { Header } from "@/components/Header";
import { chain } from "@/lib/chain";
import { NewRfqForm } from "./NewRfqForm";

export default function NewRfq() {
  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">Post an RFQ</h2>
        <p className="desk-head-sub">
          Funded before it opens: the budget and your stake are escrowed in the same transaction on{" "}
          {chain.name}, so suppliers never bid against an unfunded RFQ.
        </p>
      </section>

      <div className="grid">
        <NewRfqForm />
        <div className="right">
          <div className="panel">
            <div className="head">
              What you are committing to<span className="hint">both sides have skin in the game</span>
            </div>
            <div className="note">
              <b>Budget.</b> Escrowed now. Whatever the award does not use is returned to you as
              soon as the winner is chosen.
            </div>
            <div className="note">
              <b>Your stake.</b> Held until the last milestone is accepted. It is what a supplier
              can point to if you walk away after awarding.
            </div>
            <div className="note">
              <b>Retention.</b> A slice of every milestone payment, held back and released with
              final acceptance.
            </div>
            <div className="note">
              <b>Acceptance window.</b> You have this long to accept or reject each delivery. Stay
              silent and it releases to the supplier automatically — the clock protects them from a
              buyer who simply stops answering.
            </div>
          </div>
          <nav className="page-nav">
            <Link className="btn-nav" href="/rfqs">
              ← Back to the board
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
