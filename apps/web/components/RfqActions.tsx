"use client";

import { AgenticCommerceAbi, RFQRegistryAbi, SealedRFQAdapterAbi, formatUsdc } from "@sealedrfq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { sha256, stringToBytes } from "viem";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { WalletChip } from "@/components/WalletChip";
import { chain, contracts, explorerTx } from "@/lib/chain";

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
      setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  }

  const award = () =>
    run("Awarding…", () =>
      writeContractAsync({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "award",
        args: [BigInt(rfqId), recommended as `0x${string}`, evaluationHash as `0x${string}`, rubricHash],
      }),
    );

  const submitMilestone = () =>
    run("Submitting the deliverable…", () =>
      writeContractAsync({
        abi: AgenticCommerceAbi,
        address: contracts.AgenticCommerce,
        functionName: "submit",
        args: [BigInt(engagement?.currentJobId ?? 0), sha256(stringToBytes(deliverable || "delivered")), "0x"],
      }),
    );

  const accept = () =>
    run("Accepting…", () =>
      writeContractAsync({
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "acceptMilestone",
        args: [BigInt(rfqId), sha256(stringToBytes(reason || `accepted milestone ${(engagement?.currentMilestone ?? 0) + 1}`))],
      }),
    );

  const reject = () =>
    run("Rejecting…", () =>
      writeContractAsync({
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "rejectMilestone",
        args: [BigInt(rfqId), sha256(stringToBytes(reason))],
      }),
    );

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
      {phase === "Award" && (
        <div className="form">
          {recommended && evaluationHash ? (
            isBuyer ? (
              <>
                <div className="full note">
                  The evaluator recommends <span className="mono">{recommended.slice(0, 10)}…</span>.
                  Awarding moves the price, your stake and the winner&apos;s deposit into milestone
                  escrow. The contract re-checks every policy rule and rejects the award if one fails.
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
            <div className="full note">
              No attested recommendation yet — an award cannot be sent until the evaluator has
              anchored one, and it can only name the bidder that was recommended.
            </div>
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
                <label htmlFor="deliverable">Deliverable (hashed on-chain)</label>
                <input
                  id="deliverable"
                  value={deliverable}
                  placeholder="link or description of what you delivered"
                  onChange={(e) => setDeliverable(e.target.value)}
                />
              </div>
              <div className="full">
                <button type="button" className="btn-primary" disabled={!!busy} onClick={submitMilestone}>
                  {busy ?? "Submit deliverable"}
                </button>
              </div>
            </>
          )}

          {isBuyer && awaitingReview && (
            <>
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

      {engagement && engagement.status !== "Active" && (
        <div className="note">Engagement {engagement.status.toLowerCase()}.</div>
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
