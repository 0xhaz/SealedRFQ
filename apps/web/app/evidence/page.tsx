import { keyMatchesArcAddress } from "@sealedrfq/concordium";
import Link from "next/link";
import { Header } from "@/components/Header";
import { explorerAddress, explorerTx } from "@/lib/chain";
import { readBadgeEvidence } from "@/lib/v2/badgeEvidence";
import {
  committeeIsRegistered,
  formatCcd,
  readArcEvidence,
  registryHealth,
  v2Contracts,
} from "@/lib/v2/arcEvidence";

export const dynamic = "force-dynamic";

/**
 * One page where a stranger can check both halves of the system, rather than take either on trust.
 *
 * The Concordium half re-runs the badge checks — the same function
 * `scripts/concordium/verify-agent.mjs` runs, so the page cannot report a pass the script has
 * stopped giving. The Arc half reads the contracts live and asks them what they point at, so the
 * deployment record is checked rather than recited.
 *
 * The claim that joins them is computed here, in the request: the public key bound in CIS-8 is
 * decompressed and hashed to an Arc address, and that address is compared against the one actually
 * holding EVALUATOR on the attestation log. Nobody checks that by hand, which is exactly why it
 * belongs on the page rather than in a sentence claiming it is true.
 *
 * Three states are kept visually distinct throughout, because collapsing them is how a dashboard
 * starts lying: a check that failed, a check that could not be run, and a claim this system does
 * not make at all.
 */

const CCD_EXPLORER = "https://testnet.ccdexplorer.io/testnet";
const ccdAccount = (a: string) => `${CCD_EXPLORER}/account/${a}`;
const ccdInstance = (a: string) => `${CCD_EXPLORER}/instance/${a.replace(".", "/")}`;
const ccdTx = (h: string) => `${CCD_EXPLORER}/transaction/${h}`;

const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s);
const ago = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
};

function Verdict({ ok, label }: { ok: boolean | null; label: string }) {
  // `null` is "could not ask", and it must not look like either answer.
  const cls = ok === null ? "p-award" : ok ? "p-awarded" : "p-noaward";
  return <span className={`badge ${cls}`}>{label}</span>;
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="note" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span
        className="mono"
        aria-hidden
        style={{ color: ok ? "var(--good, #2f7d4f)" : "var(--bad, #a3323c)", fontWeight: 700 }}
      >
        {ok ? "✓" : "✕"}
      </span>
      <span>
        <b style={{ fontWeight: ok ? 500 : 700 }}>{label}</b>
        {detail && (
          <>
            <br />
            <span className="mono" style={{ fontSize: 10, whiteSpace: "pre-wrap", opacity: 0.75 }}>
              {detail}
            </span>
          </>
        )}
      </span>
      <span className="sr-only">{ok ? "passed" : "failed"}</span>
    </div>
  );
}

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ recheck?: string }>;
}) {
  const recheck = (await searchParams).recheck === "1";
  // Both halves at once: they are independent, and one chain being unreachable should not delay
  // the other's result.
  const [badge, arc] = await Promise.all([readBadgeEvidence({ recheck }), readArcEvidence()]);

  const badgeFailed = badge?.evidence.checks.filter((c) => !c.ok) ?? [];
  const badgeOk = badge?.evidence.outcome === "verified";
  const arcHealth = arc.reachable ? registryHealth(arc.periodsBehind) : null;

  // The cross-chain claim, computed rather than asserted.
  const claimedKey = badge?.evidence.claimedKey?.publicKey;
  const binding =
    claimedKey && v2Contracts
      ? keyMatchesArcAddress(claimedKey, v2Contracts.evaluator.address)
      : undefined;

  // The headline verdict is deliberately conservative: it is only green when both halves were
  // actually checked and both passed. "Could not check" never reads as "fine".
  const overall: boolean | null =
    badge === null || !arc.reachable || badge.evidence.outcome === "unreachable"
      ? null
      : badgeOk && binding?.ok === true && arc.evaluatorHasRole && arcHealth?.state === "current";

  return (
    <div className="shell">
      <Header />

      <section className="desk-head">
        <h2 className="section-title">
          Evidence{" "}
          <Verdict
            ok={overall}
            label={
              overall === null ? "COULD NOT CHECK EVERYTHING" : overall ? "CHECKS OUT" : "SEE BELOW"
            }
          />
        </h2>
        <p className="desk-head-sub">
          This system makes two claims on two chains: that an agent is registered on Concordium with
          an identity you can verify, and that the key behind that identity is the one Arc accepts
          decisions from. Both are checked here when the page loads, from the chains rather than from
          our records. Every check below is one you can repeat yourself, and the panel on the right
          says how.
        </p>
      </section>

      <div className="grid">
        <div className="col">
          {/* ---- The Concordium badge ------------------------------------------------- */}
          <div className="panel">
            <div className="head">
              The Concordium badge
              <span className="hint">
                {badge
                  ? badge.fromCache
                    ? `checked ${ago(badge.ageMs)}`
                    : "checked just now"
                  : "not claimed"}
              </span>
            </div>

            {badge === null ? (
              <div className="note">
                No agent registration is recorded, so this deployment claims no badge. Nothing is
                shown rather than a plausible agent id, because this page is an invitation to rely on
                it.
              </div>
            ) : badge.evidence.outcome === "unreachable" ? (
              <div className="note warn">
                <b>The Concordium node could not be reached.</b> {badge.evidence.reason}
                <br />
                This is an outage, not a finding: the badge has not failed a check, we were unable to
                run them. Nothing below should be read as a verdict.
              </div>
            ) : badge.evidence.outcome === "absent" ? (
              <div className="note warn">
                <b>No such agent.</b> {badge.evidence.reason}
              </div>
            ) : (
              <>
                <div className="note">
                  Agent <b>{String(badge.evidence.agentId)}</b> in CIS-8004 on Concordium{" "}
                  {badge.evidence.network}, owned by{" "}
                  <a
                    className="mono"
                    href={ccdAccount(badge.evidence.agent?.owner ?? "")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(badge.evidence.agent?.owner ?? "", 8)}
                  </a>
                  . Checked from the agent id alone — our own registration record is not consulted,
                  the card is fetched from the URL the chain names, and every hash is recomputed.
                </div>

                {badgeFailed.length > 0 && (
                  <div className="note warn">
                    <b>
                      {badgeFailed.length} of {badge.evidence.checks.length} checks failed.
                    </b>{" "}
                    A failing check here is a real finding about this badge, not a display problem.
                  </div>
                )}

                {badge.evidence.checks.map((c) => (
                  <CheckRow key={c.id} ok={c.ok} label={c.label} detail={c.detail} />
                ))}

                <div className="note">
                  The key binding was found{" "}
                  {badge.evidence.via === "external-reference" ? (
                    <>via the registry&rsquo;s own external reference.</>
                  ) : (
                    <>
                      via the card, because the registry holds no reference. CIS-8004 on testnet is
                      configured against the <i>mainnet</i> CIS-8 address, so it refuses every
                      external reference however correct the binding is. The card is trusted only for
                      where to look: CIS-8 is then asked whether this agent&rsquo;s owner owns the key
                      it names, so a card pointing at somebody else&rsquo;s binding fails.
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ---- The binding across both chains -------------------------------------- */}
          <div className="panel">
            <div className="head">
              One key, both chains
              <span className="hint">the claim that joins them</span>
            </div>

            {!binding || !v2Contracts ? (
              <div className="note">
                Not checkable without both a claimed key and a V2 deployment on this chain.
              </div>
            ) : (
              <>
                <div className="note">
                  A badge that merely shares a project name with a deployment proves nothing. The
                  claim worth making is that the key registered on Concordium is the key Arc accepts
                  recommendations from — and that is arithmetic, so it is done here rather than
                  asserted: decompress the secp256k1 point, Keccak-256 the 64-byte public key, keep
                  the last 20 bytes.
                </div>
                <div className="kv">
                  <span>Bound in CIS-8</span>
                  <b className="mono" style={{ fontSize: 10 }}>
                    {short(claimedKey ?? "", 14)}
                  </b>
                </div>
                <div className="kv">
                  <span>Derives to</span>
                  <b className="mono" style={{ fontSize: 10 }}>
                    {binding.derived ?? "—"}
                  </b>
                </div>
                <div className="kv">
                  <span>Arc evaluator</span>
                  <b className="mono" style={{ fontSize: 10 }}>
                    <a
                      href={explorerAddress(v2Contracts.evaluator.address)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {v2Contracts.evaluator.address}
                    </a>
                  </b>
                </div>
                <CheckRow
                  ok={binding.ok}
                  label="The key bound on Concordium is the Arc evaluator address"
                  detail={binding.reason}
                />
                <CheckRow
                  ok={arc.reachable ? arc.evaluatorHasRole : false}
                  label="That address holds EVALUATOR on the Arc attestation log"
                  detail={
                    arc.reachable
                      ? arc.evaluatorHasRole
                        ? "so the agent holding the badge is the agent Arc records decisions from"
                        : "the role was never granted, so the badge describes a mechanism rather than a fact"
                      : "could not be read — Arc was unreachable"
                  }
                />
              </>
            )}
          </div>
        </div>

        <div className="right">
          {/* ---- Arc V2 ------------------------------------------------------------- */}
          <div className="panel">
            <div className="head">
              Arc testnet V2<span className="hint">read live</span>
            </div>

            {!arc.reachable ? (
              <div className="note warn">
                <b>Arc could not be reached.</b> {arc.reason}
                <br />
                Nothing is shown rather than zeroes: a zero here would read as a registry that has
                fallen behind and a role that was never granted, which is a far more alarming claim
                than &ldquo;we could not ask&rdquo;.
              </div>
            ) : (
              <>
                <div className={`note${arcHealth?.state === "current" ? "" : " warn"}`}>
                  <b>
                    {arcHealth?.state === "current"
                      ? "The qualification gate is open."
                      : "The qualification gate is closed."}
                  </b>{" "}
                  {arcHealth?.summary}
                </div>
                <div className="kv">
                  <span>Concordium epoch</span>
                  <b>{String(arc.epoch)}</b>
                </div>
                <div className="kv">
                  <span>Reward period</span>
                  <b>
                    {String(arc.period)}{" "}
                    <span className="hint">({arc.rewardPeriodEpochs} epochs)</span>
                  </b>
                </div>
                <div className="kv">
                  <span>Periods behind</span>
                  <b style={{ color: arc.periodsBehind === 0n ? undefined : "var(--bad, #a3323c)" }}>
                    {String(arc.periodsBehind)}
                  </b>
                </div>
                <div className="kv">
                  <span>Committee</span>
                  <b className="mono" style={{ fontSize: 10 }}>
                    {committeeIsRegistered(arc.committee)
                      ? short(arc.committee.membersHash, 10)
                      : "none"}
                  </b>
                </div>
                {committeeIsRegistered(arc.committee) && (
                  <div className="kv">
                    <span>Stake covered</span>
                    <b>{formatCcd(arc.committee.totalStake)} CCD</b>
                  </div>
                )}
                <div className="kv">
                  <span>Max cert age</span>
                  <b>{arc.maxCertificateAgeEpochs} epochs</b>
                </div>
                <div className="kv">
                  <span>Qualification valid</span>
                  <b>{Number(arc.wiring.validitySeconds) / 3600}h</b>
                </div>
              </>
            )}
          </div>

          {/* ---- Wiring ------------------------------------------------------------- */}
          {v2Contracts && (
            <div className="panel">
              <div className="head">
                The contracts<span className="hint">asked, not recited</span>
              </div>
              {(
                [
                  ["Epoch registry", v2Contracts.ConcordiumEpochRegistry],
                  ["Qualifier", v2Contracts.ConcordiumQualifier],
                  ["Registry V2", v2Contracts.QualifiedRFQRegistryV2],
                  ["Attestation log", v2Contracts.reused.AttestationLog],
                ] as const
              ).map(([label, address]) => (
                <div className="kv" key={address}>
                  <span>{label}</span>
                  <b className="mono" style={{ fontSize: 10 }}>
                    <a href={explorerAddress(address)} target="_blank" rel="noreferrer">
                      {short(address, 8)}
                    </a>
                  </b>
                </div>
              ))}
              {arc.reachable && (
                <>
                  <CheckRow
                    ok={
                      arc.wiring.registryQualifier.toLowerCase() ===
                      v2Contracts.ConcordiumQualifier.toLowerCase()
                    }
                    label="Registry V2 points at this qualifier"
                    detail={
                      arc.wiring.registryQualifier.toLowerCase() ===
                      v2Contracts.ConcordiumQualifier.toLowerCase()
                        ? undefined
                        : `on chain ${arc.wiring.registryQualifier}`
                    }
                  />
                  <CheckRow
                    ok={
                      arc.wiring.qualifierFinality.toLowerCase() ===
                      v2Contracts.ConcordiumEpochRegistry.toLowerCase()
                    }
                    label="The qualifier points at this epoch registry"
                    detail={
                      arc.wiring.qualifierFinality.toLowerCase() ===
                      v2Contracts.ConcordiumEpochRegistry.toLowerCase()
                        ? undefined
                        : `on chain ${arc.wiring.qualifierFinality}`
                    }
                  />
                </>
              )}
            </div>
          )}

          {/* ---- Honest limits ------------------------------------------------------ */}
          <div className="panel">
            <div className="head">
              What this does not establish<span className="hint">read this part</span>
            </div>
            <div className="note warn">
              <b>The finalization committee is asserted, not proven.</b> Concordium exposes no state
              proof for its committee, so the set of signers is registered by an updater and taken on
              trust. What makes that tolerable is that it is public and falsifiable — anyone can read
              the same committee off a Concordium node and compare it with the hash registered here.
              It is a weaker claim than a proof and is described as one.
            </div>
            <div className="note warn">
              <b>The credential check behind a qualification is asserted.</b> Verifying a Concordium
              credential means proving a commitment sits in a block&rsquo;s state, and no contract on
              any chain can do that today. What Arc verifies is that the block a qualification cites
              was genuinely finalized by a two-thirds stake quorum and is recent. That removes the
              trusted <i>clock</i> — nobody can backdate a qualification or replay one against state
              that has since changed — but not the trusted check.
            </div>
            <div className="note warn">
              <b>No real wallet proof has run yet.</b> Everything up to the wallet prompt is
              exercised and tested, including replay protection, but producing a presentation needs a
              Concordium identity in the browser extension. Until that has happened this remains a
              verified registration rather than a verified end-to-end flow.
            </div>
            <div className="note warn">
              <b>A verified identity is not a verified company.</b> It means an identity provider
              checked documents and has not revoked the credential. It is not evidence of trading
              history, solvency, authority to contract, beneficial ownership, or any sanctions or
              debarment screening. On testnet the issuer attests without checking anything at all.
            </div>
          </div>

          {/* ---- Repeat it yourself ------------------------------------------------- */}
          <div className="panel">
            <div className="head">
              Check it yourself<span className="hint">none of this needs us</span>
            </div>
            <div className="note">
              The badge, from an agent id and nothing else:
              <br />
              <span className="mono" style={{ fontSize: 10 }}>
                node scripts/concordium/verify-agent.mjs{" "}
                {badge ? String(badge.evidence.agentId) : "1"}
              </span>
            </div>
            {badge?.evidence.cardUrl && (
              <div className="note">
                The card&rsquo;s bytes, hashed:
                <br />
                <span className="mono" style={{ fontSize: 10 }}>
                  curl -s {badge.evidence.cardUrl} | shasum -a 256
                </span>
                <br />
                <a href={badge.evidence.cardUrl} target="_blank" rel="noreferrer">
                  open the card ↗
                </a>
              </div>
            )}
            {v2Contracts && (
              <>
                <div className="kv">
                  <span>CIS-8004</span>
                  <b>
                    <a
                      href={ccdInstance(v2Contracts.concordium.agentRegistry)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {v2Contracts.concordium.agentRegistry} ↗
                    </a>
                  </b>
                </div>
                <div className="kv">
                  <span>CIS-8 keys</span>
                  <b>
                    <a
                      href={ccdInstance(v2Contracts.concordium.keyRegistry)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {v2Contracts.concordium.keyRegistry} ↗
                    </a>
                  </b>
                </div>
                <div className="kv">
                  <span>Committee tx</span>
                  <b>
                    <a href={explorerTx(v2Contracts.committee.tx)} target="_blank" rel="noreferrer">
                      open ↗
                    </a>
                  </b>
                </div>
              </>
            )}
            {badge && (
              <div className="note">
                <Link href="/evidence?recheck=1">Re-run the Concordium checks now ↻</Link>
                <br />
                <span className="hint">
                  Results are cached briefly because the checks make several round trips to a node.
                  Arc is always read live.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className="page-nav">
        <Link className="btn-nav" href="/qualify">
          Prove you may bid →
        </Link>
        <Link className="btn-nav ghost" href="/rfqs">
          All RFQs
        </Link>
      </nav>
    </div>
  );
}
