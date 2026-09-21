"use client";

import { WalletChip } from "@/components/WalletChip";
import { chain, contracts, explorerTx } from "@/lib/chain";
import { type Deadlines, PRESETS, applyPreset, checkDeadlines, toUnix } from "@/lib/deadlines";
import { hashFile } from "@/lib/docHash";
import { MAX_INVITEES, parseInvitees } from "@/lib/invitees";
import { parseLineItems } from "@/lib/lineItems";
import { signUsdcPermit } from "@/lib/permit";
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
  const [region, setRegion] = useState("US");
  const [budget, setBudget] = useState("3.00");
  const [deposit, setDeposit] = useState("0.25");
  const [stakePct, setStakePct] = useState("5");
  const [deadlines, setDeadlines] = useState<Deadlines>({ bid: "", reveal: "", award: "" });
  /**
   * chain time minus this device's clock, in seconds. Deadlines are judged by block.timestamp, so
   * the dates offered and validated here are measured from the chain rather than from the browser.
   */
  const [skew, setSkew] = useState<number | null>(null);
  const [deliveryMin, setDeliveryMin] = useState("15");
  const [acceptMin, setAcceptMin] = useState("3");
  const [retentionPct, setRetentionPct] = useState("10");
  const [milestones, setMilestones] = useState("30, 30, 40");
  const [weights, setWeights] = useState({ price: "50", delivery: "30", quality: "20" });
  /** RFQ = priced line items. RFP = proposals judged on method as well as price. */
  const [mode, setMode] = useState<"RFQ" | "RFP">("RFQ");
  /**
   * Who may bid. Separate from the bids being sealed, which is not optional here: visibility
   * controls who is let in, sealing controls what they can see once they are.
   */
  const [visibility, setVisibility] = useState<"public" | "invited">("public");
  const [inviteeText, setInviteeText] = useState("");
  /**
   * Buyer's terms. Hashed into the metadata document, whose own hash is fixed on-chain when the RFQ
   * opens — so the terms cannot be revised once bidding has started, and every bidder can prove it.
   */
  /** The basket suppliers quote against. Hash-fixed with the rest of the metadata. */
  const [lineItemText, setLineItemText] = useState("");
  const [termsSummary, setTermsSummary] = useState("");
  const [termsUri, setTermsUri] = useState("");
  const [termsFile, setTermsFile] = useState<{ name: string; sha256: `0x${string}` } | null>(null);
  /** Screened by the evaluator at reveal. Checkable ones become red flags; the rest need a person. */
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

  const chainNow = Math.floor(Date.now() / 1000) + (skew ?? 0);
  const deadlineError = skew === null ? null : checkDeadlines(deadlines, chainNow);

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
      const bps = milestones
        .split(",")
        .map((m) => Math.round(Number(m.trim()) * 100))
        .filter((n) => Number.isFinite(n));

      if (budgetUnits <= 0n || depositUnits <= 0n)
        throw new Error("Budget and deposit must be above zero");
      if (stakeBps < MIN_STAKE_BPS)
        throw new Error(`Buyer stake must be at least ${MIN_STAKE_BPS / 100}%`);
      if (bps.length === 0 || bps.some((b) => b <= 0))
        throw new Error("Milestones must be positive percentages");
      if (bps.reduce((a, b) => a + b, 0) !== 10_000)
        throw new Error("Milestone percentages must add up to 100");
      if (Number(deliveryMin) < 5) throw new Error("Delivery window must be at least 5 minutes");
      if (Number(acceptMin) < 1) throw new Error("Acceptance window must be at least 1 minute");

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
        termsSummary.trim() || termsUri.trim() || termsFile
          ? {
              ...(termsSummary.trim() ? { summary: termsSummary.trim() } : {}),
              ...(termsUri.trim() ? { uri: termsUri.trim() } : {}),
              ...(termsFile ? { name: termsFile.name, sha256: termsFile.sha256 } : {}),
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
      };
      const lineItems = parseLineItems(lineItemText);
      const metadata = JSON.stringify({
        scope,
        rubric: rubric.criteria,
        mode,
        visibility,
        ...(terms ? { terms } : {}),
        ...(Object.keys(requirements).length ? { requirements } : {}),
        ...(lineItems.length ? { lineItems } : {}),
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
        deliveryWindow: Number(deliveryMin) * 60,
        acceptanceWindow: Number(acceptMin) * 60,
        milestoneBps: bps,
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
      <div className="form">
        <div className="field full">
          <label htmlFor="mode">Type</label>
          <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as "RFQ" | "RFP")}>
            <option value="RFQ">RFQ — defined items, judged mainly on price and delivery</option>
            <option value="RFP">RFP — suppliers propose a solution; method is judged too</option>
          </select>
        </div>
        <div className="field full">
          <label htmlFor="visibility">Visibility</label>
          <select
            id="visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "public" | "invited")}
          >
            <option value="public">Open — any supplier may bid</option>
            <option value="invited">Invited — only listed suppliers may bid</option>
          </select>
          <span className="hint">
            Bids stay sealed either way. This decides who is let in, not what they can see.
          </span>
        </div>
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
          <textarea id="scope" rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <input id="category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="region">Region</label>
          <input id="region" value={region} onChange={(e) => setRegion(e.target.value)} />
        </div>
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
        <div className="field full">
          <label htmlFor="bidAt">Timetable</label>
          <div className="presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="btn-outline"
                title={preset.hint}
                onClick={() => setDeadlines(applyPreset(preset.offsets, chainNow))}
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
          <label htmlFor="deliverymin">Delivery per milestone (minutes)</label>
          <input
            id="deliverymin"
            inputMode="numeric"
            value={deliveryMin}
            onChange={(e) => setDeliveryMin(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="acceptmin">Acceptance window (minutes)</label>
          <input
            id="acceptmin"
            inputMode="numeric"
            value={acceptMin}
            onChange={(e) => setAcceptMin(e.target.value)}
          />
          {Number(acceptMin) < 60 && (
            <span className="field-hint warn">
              Payment auto-releases after this long. Fine for a demo; for real work give yourself
              time to inspect — hours for a document, days for anything physical.
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="milestones">Milestones (% split)</label>
          <input
            id="milestones"
            value={milestones}
            onChange={(e) => setMilestones(e.target.value)}
          />
        </div>
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
        <div className="field full">
          <label htmlFor="lineItems">Line items (optional)</label>
          <textarea
            id="lineItems"
            rows={4}
            placeholder={
              "2D barcode scanner, USB-C | 500 | ea\nCleaning tablets | 20 | box\nInstall and commission on site"
            }
            value={lineItemText}
            onChange={(e) => setLineItemText(e.target.value)}
          />
          <span className="hint">
            One per line as <span className="mono-sm">item | qty | unit</span>; quantity and unit
            are optional.{" "}
            {parseLineItems(lineItemText).length > 0
              ? `${parseLineItems(lineItemText).length} item(s) — suppliers quote a single total against this list, and it cannot change once bidding opens.`
              : "Suppliers quote one total for the whole list. Leave empty for a single-line buy."}
          </span>
        </div>
        <div className="field full">
          <label htmlFor="termsSummary">Terms and conditions (optional)</label>
          <textarea
            id="termsSummary"
            rows={2}
            placeholder="Payment terms, warranty, liability, confidentiality — or a summary pointing at the attached document."
            value={termsSummary}
            onChange={(e) => setTermsSummary(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="termsUri">Terms document link</label>
          <input
            id="termsUri"
            placeholder="https://…"
            value={termsUri}
            onChange={(e) => setTermsUri(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="termsFile">Terms document (hashed, not uploaded)</label>
          <input
            id="termsFile"
            type="file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setTermsFile(f ? { name: f.name, sha256: await hashFile(f) } : null);
            }}
          />
          <span className="hint">
            {termsFile
              ? `${termsFile.name} — ${termsFile.sha256.slice(0, 14)}…`
              : "The file stays with you. Only its hash is published, so a supplier can prove the copy they received is the one you set before bidding opened."}
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
          <span className="hint">Counted from this deployment&apos;s own record, not a claim.</span>
        </div>
        <div className="field full">
          <label htmlFor="attestations">Other requirements (one per line, optional)</label>
          <textarea
            id="attestations"
            rows={2}
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
        <div className="full note warn">
          <b>What this contract does not check:</b> whether delivered goods, materials or work meet
          your specification. It settles money against rules and hashes. Inspection stays yours —
          retention, the supplier&apos;s stake and your right to reject are what give it teeth.
        </div>
        <div className="full note">
          The rubric is hashed and stored when the RFQ opens, before anyone bids. An award has to
          cite an evaluation made against this exact rubric, so the criteria cannot be rewritten
          afterwards to justify a favoured bid.
        </div>
        {shortBy > 0n && (
          <div className="full note warn">
            <b>Not enough USDC.</b> Posting this RFQ escrows {formatUsdc(totalNeeded)} (budget plus
            your stake) and this account holds {formatUsdc(balance ?? 0n)} — {formatUsdc(shortBy)}{" "}
            short. On Arc the gas is USDC too, so an empty account cannot even estimate a fee, which
            is why a wallet may say the network fee is unavailable rather than saying you are short.
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
