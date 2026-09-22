"use client";

import { DocumentCheck } from "@/components/DocumentCheck";
import { WalletChip } from "@/components/WalletChip";
import { agent } from "@/lib/agent";
import { uploadDocument } from "@/lib/agent";
import { chain, contracts, explorerTx } from "@/lib/chain";
import { ZERO_HASH, hashFile, hashText } from "@/lib/docHash";
import { describeTxError } from "@/lib/txError";
import {
  AgenticCommerceAbi,
  RFQRegistryAbi,
  SealedRFQAdapterAbi,
  formatUsdc,
} from "@sealedrfq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Hex } from "viem";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

type Props = {
  rfqId: number;
  phase: string;
  buyer: `0x${string}`;
  /** Bidder the attested evaluation recommends, if any. */
  recommended?: `0x${string}` | null;
  evaluationHash?: `0x${string}`;
  rubricHash: `0x${string}`;
  engagement: {
    status: string;
    supplier: `0x${string}`;
    currentMilestone: number;
    milestoneCount: number;
    currentJobId: string;
    submittedAt: number;
    acceptanceWindow: number;
    currentJobBudget: string;
    /** Hash of the submitted deliverable, for the buyer to check their copy against. */
    deliverable?: string;
  } | null;
};

/**
 * Everything a participant can do from their own wallet. Nothing here goes through the agent: the
 * agent supplies the recommendation, the human (or their key) sends the transaction.
 */
export function RfqActions({
  rfqId,
  phase,
  buyer,
  recommended,
  evaluationHash,
  rubricHash,
  engagement,
}: Props) {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [deliverable, setDeliverable] = useState("");
  // Hash the file the supplier actually delivers, not a sentence typed about it.
  const [deliverableHash, setDeliverableHash] = useState<Hex | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const me = address?.toLowerCase();
  const isBuyer = me === buyer.toLowerCase();
  const isSupplier = Boolean(engagement && me === engagement.supplier.toLowerCase());
  const wrongChain = isConnected && chainId !== chain.id;

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    setError(null);
    setBusy(label);
    try {
      const hash = await fn();
      setTxHash(hash);
      setBusy("Waiting for the transaction…");
      await waitForTransactionReceipt(config, { hash });
      setBusy(null);
      router.refresh();
    } catch (e) {
      setBusy(null);
      // Typed contract errors are the useful part; viem puts them on the first line.
      setError(describeTxError(e));
    }
  }

  const award = () =>
    run("Awarding…", () =>
      writeContractAsync({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "award",
        args: [
          BigInt(rfqId),
          recommended as `0x${string}`,
          evaluationHash as `0x${string}`,
          rubricHash,
        ],
      }),
    );

  /** The hash that goes on-chain: the file's bytes when one is attached, else the typed reference. */
  const pendingHash = (): Hex =>
    deliverableHash ?? (deliverable.trim() ? hashText(deliverable.trim()) : ZERO_HASH);

  const submitMilestone = () =>
    run("Submitting the deliverable…", () =>
      writeContractAsync({
        abi: AgenticCommerceAbi,
        address: contracts.AgenticCommerce,
        functionName: "submit",
        args: [BigInt(engagement?.currentJobId ?? 0), pendingHash(), "0x"],
      }),
    );

  /**
   * Publish the reason text so the supplier can read it.
   *
   * Only the hash goes on-chain, which commits the buyer to a specific sentence but leaves the
   * other party holding 32 bytes they cannot read. The document store is keyed by sha256 of the
   * exact bytes and `hashText` is that same sha256, so storing the text makes it retrievable by the
   * value already recorded. Nothing new has to be trusted: anyone can re-hash what they fetch.
   *
   * Best effort — a store that is down must never stop a buyer rejecting work they did not get.
   */
  async function publishReason(text: string) {
    if (!text.trim()) return;
    try {
      await uploadDocument(new File([text], "reason.txt", { type: "text/plain" }));
    } catch {
      // The hash still lands on-chain and the text can be sent by hand.
    }
  }

  const accept = () => {
    // Built once: the bytes published and the bytes hashed must be the same or the note the
    // supplier fetches will not match what the chain recorded.
    const text = reason || `accepted milestone ${(engagement?.currentMilestone ?? 0) + 1}`;
    return run("Accepting…", async () => {
      await publishReason(text);
      return writeContractAsync({
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "acceptMilestone",
        args: [BigInt(rfqId), hashText(text)],
      });
    });
  };

  const reject = () =>
    run("Rejecting…", async () => {
      await publishReason(reason);
      return writeContractAsync({
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "rejectMilestone",
        args: [BigInt(rfqId), hashText(reason)],
      });
    });

  const autoRelease = () =>
    run("Releasing…", () =>
      writeContractAsync({
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "autoRelease",
        args: [BigInt(rfqId)],
      }),
    );

  if (!isConnected) {
    return (
      <div className="panel">
        <div className="head">Take part</div>
        <div className="note">Connect a wallet to bid, award or sign off milestones.</div>
        <div style={{ padding: 14 }}>
          <WalletChip />
        </div>
      </div>
    );
  }
  if (wrongChain) {
    return (
      <div className="panel">
        <div className="head">Wrong network</div>
        <div style={{ padding: 14 }}>
          <WalletChip />
        </div>
      </div>
    );
  }

  const releasesAt = engagement?.submittedAt
    ? engagement.submittedAt + engagement.acceptanceWindow
    : 0;
  const canAutoRelease = releasesAt > 0 && Date.now() / 1000 >= releasesAt;
  const deliverableOnChain = engagement?.deliverable as Hex | undefined;
  const awaitingReview = Boolean(engagement?.submittedAt);

  return (
    <div className="panel">
      <div className="head">
        Actions
        <span className="hint">
          {isBuyer ? "you are the buyer" : isSupplier ? "you are the supplier" : "anyone"}
        </span>
      </div>

      {/* ---- award ---- */}
      {phase !== "Award" && !engagement && (
        <div className="note">
          {phase === "Bidding"
            ? "Bidding is open: suppliers can seal a bid from the bid page. Nothing is awardable until the reveal window closes."
            : phase === "Reveal"
              ? "The reveal window is open. Bidders who committed must reveal now; an unrevealed bid forfeits its deposit."
              : phase === "NoAward"
                ? "No award was made, so the budget and the buyer stake returned and every revealed bidder can reclaim its deposit."
                : "Nothing to do in this phase."}
        </div>
      )}

      {phase === "Award" && (
        <div className="form">
          {recommended && evaluationHash ? (
            isBuyer ? (
              <>
                <div className="full note">
                  The evaluator recommends <span className="mono">{recommended.slice(0, 10)}…</span>
                  . Awarding moves the price, your stake and the winner&apos;s deposit into
                  milestone escrow. The contract re-checks every policy rule and rejects the award
                  if one fails.
                </div>
                <div className="full">
                  <button type="button" className="btn-primary" disabled={!!busy} onClick={award}>
                    {busy ?? "Award to the recommended bidder"}
                  </button>
                </div>
              </>
            ) : (
              <div className="full note">
                Waiting for the buyer (or the awarder agent) to award{" "}
                <span className="mono">{recommended.slice(0, 10)}…</span>.
              </div>
            )
          ) : (
            <>
              <div className="full note">
                No attested recommendation yet. An award cannot be sent until the evaluator has
                anchored one, and it can only name the bidder that was recommended. The evaluator
                scores automatically once the reveal window closes — this runs it now.
              </div>
              <div className="full">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!!busy}
                  onClick={async () => {
                    setError(null);
                    setBusy("Scoring the revealed bids…");
                    const res = await agent.evaluate(rfqId);
                    setBusy(null);
                    if ("error" in res) {
                      setError(`Could not reach the evaluator: ${res.error}`);
                    } else {
                      router.refresh();
                    }
                  }}
                >
                  {busy ?? "Run the AI evaluation"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- milestones ---- */}
      {engagement && engagement.status === "Active" && (
        <div className="form">
          <div className="full note">
            Milestone {engagement.currentMilestone + 1} of {engagement.milestoneCount} ·{" "}
            {formatUsdc(BigInt(engagement.currentJobBudget))} USDC in escrow
            {awaitingReview ? " · delivered, awaiting review" : " · awaiting delivery"}
          </div>

          {isSupplier && !awaitingReview && (
            <>
              <div className="field full">
                <label htmlFor="deliverable-file">Deliverable</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <label className="btn-nav" htmlFor="deliverable-file">
                    {fileName ? "Choose a different file" : "Attach the file you are delivering"}
                  </label>
                  <input
                    id="deliverable-file"
                    type="file"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setFileName(f.name);
                      setDeliverableHash(await hashFile(f));
                    }}
                  />
                  {fileName && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {fileName}
                    </span>
                  )}
                </div>
              </div>
              <div className="field full">
                <label htmlFor="deliverable">Or a reference, if the work is not a file</label>
                <input
                  id="deliverable"
                  value={deliverable}
                  placeholder="https://… , a commit id, a tracking number"
                  onChange={(e) => {
                    setDeliverable(e.target.value);
                    setDeliverableHash(null);
                    setFileName(null);
                  }}
                />
              </div>
              <div className="full note">
                Only the hash goes on-chain — send the file itself the way you always do. The buyer
                can then check the copy they received against this hash and see that nothing changed
                in transit.{" "}
                {pendingHash() !== ZERO_HASH && (
                  <>
                    This submission will record{" "}
                    <span className="mono">{pendingHash().slice(0, 18)}…</span>
                  </>
                )}
              </div>
              <div className="full">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!!busy || pendingHash() === ZERO_HASH}
                  onClick={submitMilestone}
                >
                  {busy ?? "Submit deliverable"}
                </button>
              </div>
            </>
          )}

          {isBuyer && awaitingReview && deliverableOnChain && (
            <div className="full">
              <DocumentCheck
                expected={deliverableOnChain}
                label="Check what you received"
                hint="compare it with the submitted hash before you accept"
              />
            </div>
          )}

          {isBuyer && awaitingReview && (
            <>
              <div className="full note warn">
                <b>Accepting pays this milestone and cannot be undone.</b> A matching hash proves
                the file is the one submitted — it does not mean the work meets the specification.
                Inspect the goods, the report or the code before you accept: after the acceptance
                window closes, payment releases whether or not anyone looked.
              </div>
              <div className="field full">
                <label htmlFor="reason">Reason (hashed; required to reject)</label>
                <input
                  id="reason"
                  value={reason}
                  placeholder="why you are accepting or rejecting"
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="full">
                <button type="button" className="btn-primary" disabled={!!busy} onClick={accept}>
                  {busy ?? "Accept and pay"}
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={!!busy || !reason.trim()}
                  onClick={reject}
                  title={reason.trim() ? "Refusal is recorded on-chain" : "A reason is required"}
                >
                  Reject
                </button>
              </div>
            </>
          )}

          {awaitingReview && !isBuyer && (
            <div className="full">
              <div className="note">
                {canAutoRelease
                  ? "The buyer's acceptance window has passed. Anyone can release the payment now — the clock protects the supplier from a buyer who stops answering."
                  : `If the buyer says nothing, anyone can release this payment after ${new Date(
                      releasesAt * 1000,
                    )
                      .toISOString()
                      .slice(11, 16)} UTC.`}
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={!!busy || !canAutoRelease}
                onClick={autoRelease}
              >
                {busy ?? "Release payment (auto-release)"}
              </button>
            </div>
          )}
        </div>
      )}

      {engagement && engagement.status === "Completed" && (
        <>
          <div className="note">
            <b>Engagement completed.</b> Every milestone was accepted, so the retention held back
            along the way and the supplier&apos;s performance stake were released with the final
            one, and the buyer&apos;s stake returned.
          </div>
          <div className="kv">
            <span>Milestones</span>
            <b>
              {engagement.milestoneCount} of {engagement.milestoneCount} accepted
            </b>
          </div>
        </>
      )}

      {engagement && !["Active", "Completed"].includes(engagement.status) && (
        <div className="note">
          Engagement <b>{engagement.status.toLowerCase()}</b>.{" "}
          {engagement.status === "Rejected"
            ? "The supplier can escalate to the arbiter until the dispute window closes; after that the buyer is made whole."
            : engagement.status === "Disputed"
              ? "The arbiter can split the remaining escrow in one call."
              : engagement.status === "Abandoned"
                ? "A delivery deadline passed with nothing submitted, so the escrow and the performance stake went to the buyer."
                : "Nothing further to do here."}
        </div>
      )}

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
