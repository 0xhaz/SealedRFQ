"use client";

import { LineItemsEditor } from "@/components/LineItemsEditor";
import { WalletChip } from "@/components/WalletChip";
import { agent, uploadDocument } from "@/lib/agent";
import { chain, contracts, explorerTx } from "@/lib/chain";
import { type Deadlines, PRESETS, applyPreset, checkDeadlines, toUnix } from "@/lib/deadlines";
import { hashFile } from "@/lib/docHash";
import { checkMilestones, milestoneLedger } from "@/lib/milestones";
import { DURATION_UNITS, type DurationUnit, MIN_DELIVERY_SECONDS, toSeconds } from "@/lib/duration";
import { MAX_INVITEES, parseInvitees } from "@/lib/invitees";
import { type LineItemRow, emptyRow, toLineItems } from "@/lib/lineItems";
import { signUsdcPermit } from "@/lib/permit";
import { CATEGORIES, REGIONS, labelFor } from "@/lib/taxonomy";
import { INCOTERMS, describeWindow, incotermNote, riskPassesAt } from "@sealedrfq/shared";
import { generateTerms } from "@/lib/terms";
import { describeTxError } from "@/lib/txError";
import {
  RFQRegistryAbi,
  USDC_ADDRESS,
  formatUsdc,
  hashCanonical,
  parseUsdc,
} from "@sealedrfq/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { sha256, stringToBytes, stringToHex } from "viem";
import { erc20Abi } from "viem";
import { useAccount, useConfig, useReadContract, useWriteContract } from "wagmi";
import { getBlock, waitForTransactionReceipt } from "wagmi/actions";

const MIN_STAKE_BPS = 500; // ProcurementPolicy.minBuyerStakeBps on the deployed instance

/** bytes32 label, e.g. "SOFTWARE" -> right-padded hex. */
const label32 = (s: string) => stringToHex(s.slice(0, 31).toUpperCase(), { size: 32 });

export function NewRfqForm() {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const router = useRouter();

  const [scope, setScope] = useState(
    "Route-optimisation SaaS integration: connect our TMS to the carrier API, migrate historical routes, and hand over documentation.",
  );
  const [category, setCategory] = useState("SOFTWARE");
  const [region, setRegion] = useState("GLOBAL");
  const [budget, setBudget] = useState("3.00");
  const [deposit, setDeposit] = useState("0.25");
  const [stakePct, setStakePct] = useState("5");
  const [deadlines, setDeadlines] = useState<Deadlines>({ bid: "", reveal: "", award: "" });
  /**
   * chain time minus this device's clock, in seconds. Deadlines are judged by block.timestamp, so
   * the dates offered and validated here are measured from the chain rather than from the browser.
   */
  const [skew, setSkew] = useState<number | null>(null);
  // Windows are durations, not minutes. Defaults are what a real tender would use; the Demo
  // preset shortens them to something that can be walked end to end in one sitting.
  const [deliveryAmount, setDeliveryAmount] = useState("14");
  const [deliveryUnit, setDeliveryUnit] = useState<DurationUnit>("days");
  const [acceptAmount, setAcceptAmount] = useState("3");
  const [acceptUnit, setAcceptUnit] = useState<DurationUnit>("days");
  const [retentionPct, setRetentionPct] = useState("10");
  const [milestones, setMilestones] = useState("30, 30, 40");
  // Shipment terms. Empty incoterm means "not a goods tender", which leaves transit at zero and
  // release timing exactly as it is for anything delivered as a file.
  const [incoterm, setIncoterm] = useState("");
  const [namedPlace, setNamedPlace] = useState("");
  const [transitDays, setTransitDays] = useState("0");
  const [weights, setWeights] = useState({ price: "50", delivery: "30", quality: "20" });
  /** RFQ = priced line items. RFP = proposals judged on method as well as price. */
  const [mode, setMode] = useState<"RFQ" | "RFP">("RFQ");
  /**
   * Who may bid. Separate from the bids being sealed, which is not optional here: visibility
   * controls who is let in, sealing controls what they can see once they are.
   */
  const [visibility, setVisibility] = useState<"public" | "invited">("public");
  /**
   * Sealed or open. Sealed is the default and stays the default: it is the mode that carries the
   * integrity claim, and a buyer who has not thought about it should get the one that cannot be
   * gamed by watching rivals.
   */
  const [bidMode, setBidMode] = useState<"sealed" | "open">("sealed");
  const [inviteeText, setInviteeText] = useState("");
  /** Suppliers this buyer has already finished a job with, offered as one-click invitations. */
  const [partners, setPartners] = useState<
    { supplier: string; completed: number; lastRfqId: number }[]
  >([]);
  useEffect(() => {
    if (!address || visibility !== "invited") return;
    let live = true;
    agent.partners(address).then((r) => {
      if (live && "partners" in r) setPartners(r.partners);
    });
    return () => {
      live = false;
    };
  }, [address, visibility]);
  /**
   * Buyer's terms. Hashed into the metadata document, whose own hash is fixed on-chain when the RFQ
   * opens — so the terms cannot be revised once bidding has started, and every bidder can prove it.
   */
  /** The basket suppliers quote against. Hash-fixed with the rest of the metadata. */
  const [lineRows, setLineRows] = useState<LineItemRow[]>([emptyRow("row-initial")]);
  /** Where suppliers send the quotation. Published, so it must be an address meant to be public. */
  const [contact, setContact] = useState("");
  const [termsSummary, setTermsSummary] = useState("");
  /**
   * The last text this form generated. If the box still matches it the buyer has not edited, so
   * changing a figure above can safely refresh the clauses. Once they have typed, it never
   * overwrites them — it only points out that the numbers have moved.
   */
  const [generated, setGenerated] = useState("");
  const [termsFile, setTermsFile] = useState<{
    name: string;
    sha256: `0x${string}`;
    /** Set when the agent is hosting it; absent means the buyer must send the file themselves. */
    uri?: string;
    warning?: string;
  } | null>(null);
  /** Screened by the evaluator at reveal. Checkable ones become red flags; the rest need a person. */
  /** Empty means any supplier may bid. Declared only — see the hint beside the field. */
  const [supplierRegion, setSupplierRegion] = useState("");
  const [maxDeliveryDays, setMaxDeliveryDays] = useState("");
  const [minHistory, setMinHistory] = useState("");
  const [attestations, setAttestations] = useState("");

  const {
    addresses: invitees,
    invalid: invalidInvitees,
    tooMany: tooManyInvitees,
  } = parseInvitees(inviteeText);
  const inviteesUnusable =
    visibility === "invited" &&
    (invitees.length === 0 || invalidInvitees.length > 0 || tooManyInvitees);

  // Measured once: a second round-trip per keystroke would be silly, and clocks do not drift that
  // fast. The transaction itself is still built from a freshly read block.
  useEffect(() => {
    let live = true;
    getBlock(config, { chainId: chain.id as never })
      .then((b) => {
        if (!live) return;
        const delta = Number(b.timestamp) - Math.floor(Date.now() / 1000);
        setSkew(delta);
        setDeadlines((d) =>
          d.bid ? d : applyPreset(PRESETS[1].offsets, Math.floor(Date.now() / 1000) + delta),
        );
      })
      .catch(() => setSkew(0));
    return () => {
      live = false;
    };
  }, [config]);

  const split = checkMilestones(milestones);

  const deliverySec = toSeconds(deliveryAmount, deliveryUnit);
  const acceptSec = toSeconds(acceptAmount, acceptUnit);

  const chainNow = Math.floor(Date.now() / 1000) + (skew ?? 0);
  const deadlineError = skew === null ? null : checkDeadlines(deadlines, chainNow);

  const termsDraft = generateTerms({
    mode,
    budget,
    deposit,
    stakePct,
    retentionPct,
    milestones,
    deliverySec,
    acceptSec,
    maxDeliveryDays,
    attestations: attestations
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    lineItemCount: toLineItems(lineRows).length,
  });
  const termsAreGenerated = termsSummary === generated && termsSummary.length > 0;
  const termsAreStale = termsAreGenerated && termsDraft !== termsSummary;

  // Unedited terms follow the figures above; edited ones are left alone and flagged instead.
  useEffect(() => {
    if (termsAreStale) {
      setTermsSummary(termsDraft);
      setGenerated(termsDraft);
    }
  }, [termsAreStale, termsDraft]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  // Gas and settlement are the same token on Arc, so an unfunded account cannot even estimate a
  // fee: the wallet reports "network fee unavailable" rather than "not enough USDC".
  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: USDC_ADDRESS,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });

  const stakeUnits = (() => {
    try {
      return (parseUsdc(budget) * BigInt(Math.round(Number(stakePct) * 100))) / 10_000n;
    } catch {
      return 0n;
    }
  })();

  const totalNeeded = (() => {
    try {
      return parseUsdc(budget || "0") + stakeUnits;
    } catch {
      return 0n;
    }
  })();
  const shortBy = balance !== undefined && totalNeeded > 0n ? totalNeeded - balance : 0n;

  async function submit() {
    setError(null);
    if (!address) return;
    try {
      const budgetUnits = parseUsdc(budget);
      const depositUnits = parseUsdc(deposit);
      const stakeBps = Math.round(Number(stakePct) * 100);

      if (budgetUnits <= 0n || depositUnits <= 0n)
        throw new Error("Budget and deposit must be above zero");
      if (stakeBps < MIN_STAKE_BPS)
        throw new Error(`Buyer stake must be at least ${MIN_STAKE_BPS / 100}%`);
      // The same check the field shows live, so the form cannot look content and then throw here.
      if (!split.ok) throw new Error(split.problem ?? "Check the milestone split");
      if (deliverySec < MIN_DELIVERY_SECONDS) {
        throw new Error("Delivery window must be at least 5 minutes");
      }
      if (incoterm && !namedPlace.trim()) {
        throw new Error(
          "Name the place the incoterm refers to — a port, a city or an address. Without it the term says who pays but not to where.",
        );
      }
      if (acceptSec < 60) throw new Error("Acceptance window must be at least 1 minute");

      // The rubric is hashed before bids open, so it cannot be rewritten to fit a favoured bid.
      const rubric = {
        schema: "sealedrfq.rubric.v1",
        criteria: {
          price: Number(weights.price),
          delivery: Number(weights.delivery),
          quality: Number(weights.quality),
        },
      };
      const rubricHash = hashCanonical(rubric);
      // Publish the rubric with the scope: only its hash is on-chain, and the evaluator refuses to
      // score unless the published weights hash to it. Otherwise criteria could be invented later.
      const terms =
        termsSummary.trim() || termsFile
          ? {
              ...(termsSummary.trim() ? { summary: termsSummary.trim() } : {}),
              ...(termsFile
                ? {
                    name: termsFile.name,
                    sha256: termsFile.sha256,
                    ...(termsFile.uri ? { uri: termsFile.uri } : {}),
                  }
                : {}),
            }
          : undefined;
      const attestationList = attestations
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const requirements = {
        ...(Number(maxDeliveryDays) > 0 ? { maxDeliveryDays: Number(maxDeliveryDays) } : {}),
        ...(Number(minHistory) > 0 ? { minCompletedEngagements: Number(minHistory) } : {}),
        ...(attestationList.length ? { attestations: attestationList } : {}),
        ...(supplierRegion ? { supplierRegion: labelFor(REGIONS, supplierRegion) } : {}),
      };
      const lineItems = toLineItems(lineRows);
      const metadata = JSON.stringify({
        scope,
        rubric: rubric.criteria,
        mode,
        visibility,
        bidMode,
        ...(terms ? { terms } : {}),
        ...(Object.keys(requirements).length ? { requirements } : {}),
        ...(lineItems.length ? { lineItems } : {}),
        ...(contact.trim() ? { contact: contact.trim() } : {}),
        // Published with the tender and fixed by metadataHash before bidding, so the delivery
        // obligation is a term suppliers price against rather than something settled later.
        ...(incoterm
          ? {
              shipment: {
                incoterm,
                namedPlace: namedPlace.trim(),
                transitDays: Math.max(0, Number(transitDays) || 0),
              },
            }
          : {}),
      });
      const metadataHash = sha256(stringToBytes(metadata));

      // Deadlines are judged by block.timestamp, so anchor them to the chain rather than to this
      // machine's clock: the two drift, and a local chain can be warped hours ahead. Using
      // Date.now() there produces a "deadline" already in the chain's past — InvalidDeadlines.
      const block = await getBlock(config, { chainId: chain.id as never });
      const now = Number(block.timestamp);
      const fresh = checkDeadlines(deadlines, now);
      if (fresh) throw new Error(fresh);
      const bidDeadline = BigInt(toUnix(deadlines.bid) as number);
      const revealDeadline = BigInt(toUnix(deadlines.reveal) as number);
      const awardDeadline = BigInt(toUnix(deadlines.award) as number);

      const params = {
        rubricHash,
        metadataHash,
        category: label32(category),
        region: label32(region),
        budget: budgetUnits,
        depositAmount: depositUnits,
        buyerStakeBps: stakeBps,
        bidDeadline,
        revealDeadline,
        awardDeadline,
        retentionBps: Math.round(Number(retentionPct) * 100),
        deliveryWindow: deliverySec,
        acceptanceWindow: acceptSec,
        // Zero unless this tender ships something. It is what stops a silent buyer paying for a
        // container still at sea, and what stops that protection becoming a way to never pay.
        transitWindow: incoterm ? Math.max(0, Number(transitDays) || 0) * 86_400 : 0,
        bidMode: bidMode === "open" ? 1 : 0,
        milestoneBps: split.bps,
        invitees: visibility === "invited" ? invitees : ([] as `0x${string}`[]),
        requiresQualification: false,
        requiresProposal: mode === "RFP",
        metadataURI: metadata,
      } as const;

      const total = budgetUnits + (budgetUnits * BigInt(stakeBps)) / 10_000n;
      setBusy(`Signing a USDC permit for ${formatUsdc(total)}…`);
      const permit = await signUsdcPermit(config, {
        owner: address,
        spender: contracts.RFQRegistry,
        value: total,
        chainId: chain.id,
      });

      setBusy("Posting the RFQ (budget and stake escrow now)…");
      const hash = await writeContractAsync({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "createRFQWithPermit",
        args: [params, permit.deadline, permit.v, permit.r, permit.s],
      });
      setTxHash(hash);
      setBusy("Waiting for the transaction…");
      await waitForTransactionReceipt(config, { hash });
      setBusy(null);
      router.push("/rfqs");
    } catch (e) {
      setBusy(null);
      setError(describeTxError(e));
    }
  }

  if (!isConnected || chainId !== chain.id) {
    return (
      <div className="panel">
        <div className="head">{isConnected ? "Wrong network" : "Connect to post an RFQ"}</div>
        <div className="note">
          Posting escrows the budget plus your stake in the same transaction: suppliers never bid
          against an unfunded RFQ.
        </div>
        <div style={{ padding: 14 }}>
          <WalletChip />
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="head">
        Post an RFQ
        <span className="hint">
          escrows {formatUsdc(stakeUnits > 0n ? parseUsdc(budget || "0") + stakeUnits : 0n)} USDC
        </span>
      </div>
      <section id="details" className="form-section">
        <h4>Details</h4>
        <div className="form">
          <div className="field full">
            <label htmlFor="mode">Type</label>
            <select
              id="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as "RFQ" | "RFP")}
            >
              <option value="RFQ">RFQ — defined items, judged mainly on price and delivery</option>
              <option value="RFP">RFP — suppliers propose a solution; method is judged too</option>
            </select>
          </div>
          {/*
            Two options each, and both are decisions rather than settings — a dropdown hides the
            alternative behind a click and reads as a default nobody chose. Radios put the choice
            and its consequence side by side, which is what these two need.
          */}
          <fieldset className="field full choice">
            <legend>Visibility</legend>
            <label className={visibility === "public" ? "opt selected" : "opt"}>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              <span>
                <b>Open to all</b>
                <em>Any supplier may bid.</em>
              </span>
            </label>
            <label className={visibility === "invited" ? "opt selected" : "opt"}>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "invited"}
                onChange={() => setVisibility("invited")}
              />
              <span>
                <b>Invited only</b>
                <em>Only the suppliers you list can bid. Enforced by the contract.</em>
              </span>
            </label>
            <span className="hint">
              This decides who is let in, not what they can see — that is the next choice.
            </span>
          </fieldset>

          {/*
            Two genuinely different products sharing one settlement layer, and the choice is the
            buyer's per tender. The copy has to be straight about what open costs, because the
            audit page will say it too: a tender whose prices were visible cannot claim nobody
            could see them.
          */}
          <fieldset className="field full choice">
            <legend>How bids are taken</legend>
            <label className={bidMode === "sealed" ? "opt selected" : "opt"}>
              <input
                type="radio"
                name="bidmode"
                checked={bidMode === "sealed"}
                onChange={() => setBidMode("sealed")}
              />
              <span>
                <b>Sealed</b>
                <em>
                  Nobody sees a price until the reveal window. No supplier can price against a
                  rival, and the award can be re-checked against the sealed bids afterwards.
                </em>
              </span>
            </label>
            <label className={bidMode === "open" ? "opt selected" : "opt"}>
              <input
                type="radio"
                name="bidmode"
                checked={bidMode === "open"}
                onChange={() => setBidMode("open")}
              />
              <span>
                <b>Open</b>
                <em>
                  Every bid is public the moment it is placed. Suits commodity buying where price
                  and speed decide.
                </em>
              </span>
            </label>
            {bidMode === "open" && (
              <div className="note warn">
                <b>Open forfeits the sealed-bid guarantee, and the audit page will say so.</b>{" "}
                Suppliers who can watch each other to undercut can also watch each other to{" "}
                <i>hold</i> a price, which a sealed round makes impossible. For anything
                contestable, or where you may have to show the award was fair, use sealed.
              </div>
            )}
          </fieldset>
          {visibility === "invited" && (
            <div className="field full">
              <label htmlFor="invitees">Invited suppliers</label>
              <textarea
                id="invitees"
                rows={3}
                placeholder="0xabc… one per line, or pasted comma-separated"
                value={inviteeText}
                onChange={(e) => setInviteeText(e.target.value)}
              />
              {partners.length > 0 && (
                <div className="partners">
                  <span className="hint">
                    Suppliers who have finished a job for you. The count is the chain&apos;s record,
                    not a rating:
                  </span>
                  <div className="filter-row">
                    {partners.map((p) => {
                      const already = invitees.includes(p.supplier.toLowerCase() as `0x${string}`);
                      return (
                        <button
                          key={p.supplier}
                          type="button"
                          className={already ? "chip is-active" : "chip"}
                          onClick={() =>
                            setInviteeText((t) =>
                              already ? t : `${t.trim()}${t.trim() ? "\n" : ""}${p.supplier}`,
                            )
                          }
                        >
                          {already ? "✓ " : "+ "}
                          {p.supplier.slice(0, 6)}…{p.supplier.slice(-4)} · {p.completed} completed
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <span className="hint">
                {invalidInvitees.length > 0
                  ? `Not an address: ${invalidInvitees.slice(0, 3).join(", ")}${
                      invalidInvitees.length > 3 ? ` and ${invalidInvitees.length - 3} more` : ""
                    }`
                  : tooManyInvitees
                    ? `${invitees.length} addresses — the contract accepts at most ${MAX_INVITEES}.`
                    : invitees.length === 0
                      ? "Add at least one address, or switch back to open bidding."
                      : `${invitees.length} supplier${invitees.length === 1 ? "" : "s"} invited. The list is on-chain and public: it names who was asked, not what they bid.`}
              </span>
            </div>
          )}
          <div className="field full">
            <label htmlFor="scope">{mode === "RFP" ? "Problem statement" : "Scope"}</label>
            <textarea
              id="scope"
              rows={3}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="region">Delivery region</label>
            <select id="region" value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="hint">
              Both are published on-chain so suppliers can find work in their field. A fixed list
              keeps that searchable — free text turns one category into several.
            </span>
          </div>
        </div>
      </section>

      <section id="money" className="form-section">
        <h4>Budget and stakes</h4>
        <div className="form">
          <div className="field">
            <label htmlFor="budget">Budget (USDC)</label>
            <input
              id="budget"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="deposit">Bid deposit (USDC)</label>
            <input
              id="deposit"
              inputMode="decimal"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="stake">Your stake (% of budget)</label>
            <input
              id="stake"
              inputMode="decimal"
              value={stakePct}
              onChange={(e) => setStakePct(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="retention">Retention (% per milestone)</label>
            <input
              id="retention"
              inputMode="decimal"
              value={retentionPct}
              onChange={(e) => setRetentionPct(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section id="timetable" className="form-section">
        <h4>Timetable</h4>
        <div className="form">
          <div className="field full">
            <label htmlFor="bidAt">Timetable</label>
            <div className="presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="btn-outline"
                  title={preset.hint}
                  onClick={() => {
                    setDeadlines(applyPreset(preset.offsets, chainNow));
                    // A timetable sets the whole clock: dates and windows move together, so a
                    // demo run cannot leave fortnight-long milestones behind a 12-minute tender.
                    setDeliveryAmount(preset.windows.delivery[0]);
                    setDeliveryUnit(preset.windows.delivery[1]);
                    setAcceptAmount(preset.windows.accept[0]);
                    setAcceptUnit(preset.windows.accept[1]);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="bidAt">Bidding closes</label>
            <input
              id="bidAt"
              type="datetime-local"
              value={deadlines.bid}
              onChange={(e) => setDeadlines({ ...deadlines, bid: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="revealAt">Revealing closes</label>
            <input
              id="revealAt"
              type="datetime-local"
              value={deadlines.reveal}
              onChange={(e) => setDeadlines({ ...deadlines, reveal: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="awardAt">Award deadline</label>
            <input
              id="awardAt"
              type="datetime-local"
              value={deadlines.award}
              onChange={(e) => setDeadlines({ ...deadlines, award: e.target.value })}
            />
          </div>
          {deadlineError && (
            <div className="full note warn">
              <b>Timetable:</b> {deadlineError}
            </div>
          )}
          {skew !== null && Math.abs(skew) > 90 && (
            <div className="full note warn">
              <b>
                This device&apos;s clock is{" "}
                {Math.abs(skew) > 3600
                  ? `${Math.round(Math.abs(skew) / 3600)}h`
                  : `${Math.round(Math.abs(skew) / 60)} min`}{" "}
                {skew > 0 ? "behind" : "ahead of"} the network.
              </b>{" "}
              The dates above are measured from chain time, not from this machine, because that is
              what the contract judges deadlines against.
            </div>
          )}
          <div className="field">
            <label htmlFor="deliveryamount">Delivery per milestone</label>
            <div className="duration-input">
              <input
                id="deliveryamount"
                inputMode="numeric"
                value={deliveryAmount}
                onChange={(e) => setDeliveryAmount(e.target.value)}
              />
              <select
                aria-label="delivery window unit"
                value={deliveryUnit}
                onChange={(e) => setDeliveryUnit(e.target.value as DurationUnit)}
              >
                {DURATION_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="field-hint">
              How long the supplier has to deliver each milestone once the engagement reaches it.
              Bids quoting longer than this cannot be awarded — the contract rejects them.
            </span>
          </div>
          <div className="field">
            <label htmlFor="acceptamount">Acceptance window</label>
            <div className="duration-input">
              <input
                id="acceptamount"
                inputMode="numeric"
                value={acceptAmount}
                onChange={(e) => setAcceptAmount(e.target.value)}
              />
              <select
                aria-label="acceptance window unit"
                value={acceptUnit}
                onChange={(e) => setAcceptUnit(e.target.value as DurationUnit)}
              >
                {DURATION_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            {acceptSec > 0 && acceptSec < 3600 ? (
              <span className="field-hint warn">
                Payment auto-releases after this long. Fine for walking the system through; for real
                work give yourself time to inspect — hours for a document, days for anything
                physical.
              </span>
            ) : (
              <span className="field-hint">
                How long you have to inspect and reject before payment releases on its own.
              </span>
            )}
          </div>

          {/*
            Shipment terms. Optional, and absent for anything delivered as a file — but once an
            incoterm is set the tender has actually said what "delivered" means, which is the
            single thing most often left undefined in a goods contract and the first thing argued
            about when something goes wrong.
          */}
          <div className="field">
            <label htmlFor="incoterm">Delivery terms (physical goods only)</label>
            <select
              id="incoterm"
              value={incoterm}
              onChange={(e) => setIncoterm(e.target.value)}
            >
              <option value="">Not a goods tender — delivered as a file</option>
              {INCOTERMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {incoterm && <span className="field-hint">{incotermNote(incoterm)}</span>}
          </div>

          {incoterm && (
            <>
              <div className="field">
                <label htmlFor="namedplace">Named place</label>
                <input
                  id="namedplace"
                  value={namedPlace}
                  placeholder="Port Klang · Rotterdam · our Shah Alam warehouse"
                  onChange={(e) => setNamedPlace(e.target.value)}
                />
                <span className="field-hint">
                  Risk passes <b>{riskPassesAt(incoterm)}</b> under {incoterm}.
                </span>
              </div>
              <div className="field">
                <label htmlFor="transit">Transit allowance (days)</label>
                <input
                  id="transit"
                  inputMode="numeric"
                  value={transitDays}
                  onChange={(e) => setTransitDays(e.target.value)}
                />
              </div>
              <div className="field full note">
                A milestone releases money against a <i>hash</i>, not against goods — the contract
                cannot see a container. The transit allowance is what stops that paying for a
                shipment still at sea: if you confirm receipt, your inspection window starts then;
                if you say nothing, it starts only after this many days. It cannot be used to
                withhold payment indefinitely, because silence eventually pays the supplier either
                way. Set it to the realistic door-to-door time for {incoterm || "this route"}.
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="milestones">Milestones (% split)</label>
            <input
              id="milestones"
              value={milestones}
              onChange={(e) => setMilestones(e.target.value)}
              aria-invalid={!split.ok}
              aria-describedby="milestones-check"
            />
            {/*
              The running total, shown whether or not it is right. A split that is wrong by five
              percent looks identical to a correct one until something adds it up, and the first
              thing that did was a revert after the wallet had already opened.
            */}
            <span
              id="milestones-check"
              className={split.ok ? "field-hint" : "field-hint warn"}
              role={split.ok ? undefined : "alert"}
            >
              {split.problem ? (
                <>
                  <b>{split.problem}</b>
                  {split.totalBps > 0 && split.totalBps !== 10_000 && (
                    <>
                      {" "}
                      {split.totalBps < 10_000
                        ? `Add ${(10_000 - split.totalBps) / 100}% more.`
                        : `Remove ${(split.totalBps - 10_000) / 100}%.`}
                    </>
                  )}
                </>
              ) : (
                <>
                  {split.bps.length} milestone{split.bps.length === 1 ? "" : "s"} totalling 100%
                  {parseUsdc(budget || "0") > 0n && (
                    <>
                      {" — "}
                      {milestoneLedger(
                        parseUsdc(budget),
                        split.bps,
                        Math.round(Number(retentionPct || "0") * 100),
                      )
                        .lines.map((l) => formatUsdc(l.gross))
                        .join(" · ")}{" "}
                      USDC at the published budget
                    </>
                  )}
                </>
              )}
            </span>
            {/*
              Bulk goods are not bought in equal thirds. The trade convention is a deposit against
              production and the balance against shipping documents, so it is offered rather than
              left to be typed — and naming it is also the moment to say that a stage here releases
              money against a hash, which is not the same as against goods.
            */}
            {/*
              The label sits on its own line so the three chips share the field's full width.
              Inline, it takes enough of a half-width field to push the last chip onto a second
              row, which reads as though that option belongs to something else.
            */}
            <span className="hint" style={{ display: "block", marginTop: 6 }}>
              Common splits:
            </span>
            <div className="filter-row" style={{ marginTop: 4 }}>
              <button type="button" className="chip" onClick={() => setMilestones("30, 30, 40")}>
                thirds
              </button>
              <button
                type="button"
                className="chip"
                title="A deposit against production, the balance against shipping documents"
                onClick={() => setMilestones("30, 70")}
              >
                30 / 70 — bulk
              </button>
              <button type="button" className="chip" onClick={() => setMilestones("100")}>
                single payment
              </button>
            </div>
            {milestones.replace(/\s/g, "") === "30,70" && (
              <div className="note warn" style={{ marginTop: 8 }}>
                <b>Buying physical goods?</b> A milestone releases money when the supplier submits a
                <i> hash</i> and you accept it, or when your acceptance window runs out. The contract
                cannot see a container — it can only check that a document you were sent matches the
                hash that was sealed. So set the acceptance window to cover{" "}
                <b>shipping time plus inspection</b>, not just your own review, and treat the
                deliverable hash as the bill of lading rather than as proof the goods are good.
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="scoring" className="form-section">
        <h4>Scoring rubric</h4>
        <div className="form">
          <div className="field full">
            <label htmlFor="w-price">Rubric weights — price / delivery / quality</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="w-price"
                inputMode="numeric"
                value={weights.price}
                onChange={(e) => setWeights({ ...weights, price: e.target.value })}
              />
              <input
                aria-label="delivery weight"
                inputMode="numeric"
                value={weights.delivery}
                onChange={(e) => setWeights({ ...weights, delivery: e.target.value })}
              />
              <input
                aria-label="quality weight"
                inputMode="numeric"
                value={weights.quality}
                onChange={(e) => setWeights({ ...weights, quality: e.target.value })}
              />
            </div>
          </div>
          <div className="full note">
            {mode === "RFP"
              ? "In RFP mode each bid carries a proposal document, sealed with the price: neither can be rewritten after seeing rival bids."
              : "In RFQ mode bids are price and delivery only — the fastest path when you already know exactly what you need."}
          </div>
        </div>
      </section>

      <section id="quote" className="form-section">
        <h4>What to quote</h4>
        <div className="form">
          <div className="field full">
            <LineItemsEditor rows={lineRows} onChange={setLineRows} />
          </div>
        </div>
      </section>

      <section id="terms" className="form-section">
        <h4>Terms and conditions</h4>
        <div className="form">
          <div className="field full">
            <label htmlFor="contact">Where to send quotations</label>
            <input
              id="contact"
              placeholder="tenders@yourcompany.com"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
            <span className="hint">
              Published with the RFQ and permanent, so use an address meant to be public — a
              tenders@ or procurement@ inbox, never a personal one. Suppliers put their own contact
              inside the quotation they send you, which stays between the two of you.
            </span>
          </div>
          <div className="field full">
            <label htmlFor="termsSummary">Terms and conditions (optional)</label>
            <div className="terms-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  if (
                    termsSummary.trim() &&
                    !termsAreGenerated &&
                    !confirm("Replace the terms you have written with freshly generated ones?")
                  ) {
                    return;
                  }
                  setTermsSummary(termsDraft);
                  setGenerated(termsDraft);
                }}
              >
                {termsSummary.trim() ? "Regenerate standard terms" : "Generate standard terms"}
              </button>
              {termsAreGenerated && (
                <span className="hint">
                  Generated from the figures above, and following them as you change them. Edit
                  freely — once you do, they stop tracking.
                </span>
              )}
              {!termsAreGenerated && termsSummary.trim() && (
                <span className="hint">Edited by you; the button above will replace them.</span>
              )}
            </div>
            <textarea
              id="termsSummary"
              rows={8}
              placeholder="Press Generate above for clauses built from the figures you have entered, then edit. Anything a form cannot guess — warranty, liability, governing law — belongs in the attached document."
              value={termsSummary}
              onChange={(e) => setTermsSummary(e.target.value)}
            />
            {/*
              Said to the buyer, not only to the reader of the source.
              These clauses become a binding term of a real contract the moment the RFQ is posted,
              and the generator knows nothing about the parties, the goods, the governing law or
              anything a form cannot see. Restating what the escrow does is the whole of what it can
              honestly claim to do, and a buyer is entitled to be told that before they rely on it.
            */}
            <div className="note warn">
              These clauses restate what the escrow contract does with the figures you entered. They
              are <b>not legal advice and not a complete contract</b> — no form can know your
              governing law, warranty, liability or termination terms. Have them reviewed, and put
              anything they do not cover in the attached terms document. Once the RFQ is posted they
              bind you: the hash is published and suppliers bid against it.
            </div>
          </div>
          <div className="field full">
            <label htmlFor="termsFile">Terms document (optional)</label>
            <input
              id="termsFile"
              type="file"
              accept=".pdf,.docx,.xlsx,.csv,.md,.txt"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return setTermsFile(null);
                // Hash locally first: that value is what gets published, and it holds whether or
                // not the upload succeeds.
                const sha256 = await hashFile(f);
                setTermsFile({ name: f.name, sha256 });
                setBusy("Uploading the terms document…");
                const up = await uploadDocument(f);
                setBusy(null);
                if ("error" in up) {
                  setTermsFile({ name: f.name, sha256, warning: up.error });
                  return;
                }
                // The agent stores by content hash, so disagreement here means it stored something
                // other than what this browser read. Publish ours and do not link to theirs.
                if (up.sha256.toLowerCase() !== sha256.toLowerCase()) {
                  setTermsFile({
                    name: f.name,
                    sha256,
                    warning: "the stored copy does not match this file, so it has not been linked",
                  });
                  return;
                }
                setTermsFile({ name: f.name, sha256, uri: up.url });
              }}
            />
            <span className="hint">
              {termsFile?.uri
                ? `${termsFile.name} — published with the RFQ and downloadable by any supplier. sha256 ${termsFile.sha256.slice(0, 14)}…`
                : termsFile?.warning
                  ? `${termsFile.name} — hash published, but not hosted: ${termsFile.warning}. Suppliers can still verify a copy you send them.`
                  : termsFile
                    ? `${termsFile.name} — ${termsFile.sha256.slice(0, 14)}…`
                    : "Uploaded so any supplier can download it, and hashed so they can prove the copy they hold is the one you published. Required for an open tender: otherwise only the people you email can read the terms."}
            </span>
          </div>
        </div>
      </section>

      <section id="requirements" className="form-section">
        <h4>Requirements</h4>
        <div className="form">
          <div className="field full">
            <label htmlFor="supplierRegion">Who may bid</label>
            <select
              id="supplierRegion"
              value={supplierRegion}
              onChange={(e) => setSupplierRegion(e.target.value)}
            >
              <option value="">Any supplier, anywhere</option>
              {REGIONS.filter((r) => r.value !== "GLOBAL").map((r) => (
                <option key={r.value} value={r.value}>
                  Suppliers established in {r.label}
                </option>
              ))}
            </select>
            <span className="hint">
              {supplierRegion ? (
                <>
                  <b>Published, not enforced.</b> An address has no country, so nothing on-chain can
                  check this — it is listed against every bid as needing a human, exactly like a
                  certification. To actually restrict who can bid, set <b>Visibility</b> to invited
                  and list the suppliers; the contract enforces that one.
                </>
              ) : (
                "Leave this open unless a supplier's own location matters. Where the work is delivered is the Delivery region field above."
              )}
            </span>
          </div>
          <div className="field">
            <label htmlFor="maxDeliveryDays">Required delivery (days, optional)</label>
            <input
              id="maxDeliveryDays"
              inputMode="numeric"
              placeholder="e.g. 30"
              value={maxDeliveryDays}
              onChange={(e) => setMaxDeliveryDays(e.target.value)}
            />
            <span className="hint">A slower bid is flagged automatically when it is revealed.</span>
          </div>
          <div className="field">
            <label htmlFor="minHistory">Minimum completed jobs here (optional)</label>
            <input
              id="minHistory"
              inputMode="numeric"
              placeholder="e.g. 1"
              value={minHistory}
              onChange={(e) => setMinHistory(e.target.value)}
            />
            <span className="hint">
              Counted from this deployment&apos;s own record, not a claim.
            </span>
          </div>
          <div className="field full">
            <label htmlFor="attestations">Other requirements (one per line, optional)</label>
            <textarea
              id="attestations"
              rows={3}
              placeholder={"ISO 9001 certification\n24-month warranty\nNet 30 payment terms"}
              value={attestations}
              onChange={(e) => setAttestations(e.target.value)}
            />
            <span className="hint">
              These are published with the RFQ and listed against every bid as still needing a human
              check. Nothing here is ever marked satisfied automatically — a bid cannot prove a
              certificate.
            </span>
          </div>
        </div>
      </section>

      <section id="review" className="form-section">
        <h4>Before you post</h4>
        <div className="form">
          <div className="full note warn">
            <b>This contract never sees the goods.</b> It moves money according to rules and hashes,
            so it cannot tell whether what arrives matches your specification. Someone on your side
            still has to inspect each delivery and decide.
            <br />
            <br />
            What it does give you is leverage to decide with: you hold back {retentionPct || "10"}%
            of every milestone until the last one is accepted, the winning supplier&apos;s deposit
            is staked on finishing the job, and you can reject a delivery with a reason instead of
            paying for it. Accept a milestone and the money moves; say nothing for{" "}
            {describeWindow(acceptSec)} and it moves anyway.
          </div>
          <div className="full note">
            The rubric is hashed and stored when the RFQ opens, before anyone bids. An award has to
            cite an evaluation made against this exact rubric, so the criteria cannot be rewritten
            afterwards to justify a favoured bid.
          </div>
          {shortBy > 0n && (
            <div className="full note warn">
              <b>Not enough USDC.</b> Posting this RFQ escrows {formatUsdc(totalNeeded)} (budget
              plus your stake) and this account holds {formatUsdc(balance ?? 0n)} —{" "}
              {formatUsdc(shortBy)} short. On Arc the gas is USDC too, so an empty account cannot
              even estimate a fee, which is why a wallet may say the network fee is unavailable
              rather than saying you are short.
            </div>
          )}
          <div className="full">
            <button
              type="button"
              className="btn-primary"
              disabled={!!busy || shortBy > 0n || inviteesUnusable || !!deadlineError}
              onClick={submit}
            >
              {busy ?? "Escrow budget and open for bids"}
            </button>
          </div>
        </div>
      </section>
      {error && (
        <div className="field-err" role="alert">
          {error}
        </div>
      )}
      {txHash && (
        <div className="note">
          <a href={explorerTx(txHash)} target="_blank" rel="noreferrer">
            View transaction ↗
          </a>
        </div>
      )}
    </div>
  );
}
