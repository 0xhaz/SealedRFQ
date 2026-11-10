import { Header } from "@/components/Header";
import { ProveQualification } from "@/components/v2/ProveQualification";
import { QUALIFICATION_DESCRIPTION } from "@/lib/v2/qualification";

export const dynamic = "force-dynamic";

/**
 * A standalone page for the qualification proof, so the flow can be exercised and shown without
 * first creating a tender. The real gate lives on the bid page; this is the same code path.
 */
export default function QualifyPage() {
  return (
    <div className="shell">
      <Header />
      <section className="desk-head">
        <h2 className="section-title">Qualify to bid</h2>
        <p className="desk-head-sub">
          Some tenders are open only to suppliers who can prove where they are established. The
          proof is made by your wallet and checked by us; the attributes behind it never leave your
          device.
        </p>
      </section>
      <div className="grid">
        <div className="col">
          <ProveQualification tenderId={1} />
        </div>
        <div className="right">
          <div className="panel">
            <div className="head">
              How the check works<span className="hint">challenge → proof → check</span>
            </div>
            <div className="note">
              <b>1. We issue a challenge.</b> Thirty-two random bytes, good for five minutes and
              usable once. It is ours rather than yours because a proof answering a challenge you
              chose would show only that you hold a credential, not that you are here now.
            </div>
            <div className="note">
              <b>2. Your wallet proves the statement.</b> {QUALIFICATION_DESCRIPTION}
            </div>
            <div className="note">
              <b>3. We check it against the chain.</b> The proof has to verify, every credential
              behind it has to be Active rather than revoked, and the statement proved has to be
              the statement we asked for — a proof of something easier is not an answer.
            </div>
            <div className="note">
              <b>4. The challenge is spent.</b> The proof is bound to it cryptographically, so it
              cannot be replayed under a different challenge, and the challenge itself works once,
              so it cannot be replayed under the same one.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
