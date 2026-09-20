"use client";

import { RFQRegistryAbi, formatUsdc, parseUsdc } from "@sealedrfq/shared";
import Link from "next/link";
import { useState } from "react";
import { sha256, stringToBytes } from "viem";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { readContract, signMessage, waitForTransactionReceipt } from "wagmi/actions";
import { WalletChip } from "@/components/WalletChip";
import { chain, contracts, explorerTx } from "@/lib/chain";
import {
  computeCommitment,
  downloadBid,
  loadBid,
  saltFromSignature,
  saltMessage,
  saveBid,
  type SavedBid,
} from "@/lib/bidStore";
import { signUsdcPermit } from "@/lib/permit";

const ZERO_HASH = `0x${"0".repeat(64)}` as const;

type Props = {
  rfqId: number;
  phase: string;
  deposit: string; // 6-decimal units as string
  budget: string;
  /** RFP mode: the bid must carry a proposal, not just a price. */
  requiresProposal: boolean;
};

export function BidForm({ rfqId, phase, deposit, budget, requiresProposal }: Props) {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [price, setPrice] = useState("");
  const [days, setDays] = useState("21");
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [saved, setSaved] = useState<SavedBid | null>(
    address ? loadBid(chain.id, rfqId, address) : null,
  );
  const [revealFile, setRevealFile] = useState<SavedBid | null>(null);

  const wrongChain = isConnected && chainId !== chain.id;
  const bidding = phase === "Bidding";
  const revealing = phase === "Reveal";
  const fail = (e: unknown) => {
    setBusy(null);
    setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
  };

  /** Salt = signature over a bid-scoped message, so the wallet alone can regenerate it later. */
  async function deriveSalt(bidder: `0x${string}`) {
    const signature = await signMessage(config, {
      message: saltMessage({ registry: contracts.RFQRegistry, chainId: chain.id, rfqId, bidder }),
    });
    return saltFromSignature(signature);
  }

  function proposalHashOf(text: string): `0x${string}` {
    return text.trim() ? sha256(stringToBytes(text)) : ZERO_HASH;
  }

  function commitmentFor(
    bidder: `0x${string}`,
    price: bigint,
    deliveryDays: number,
    proposalHash: `0x${string}`,
    salt: `0x${string}`,
  ) {
    return computeCommitment({
      registry: contracts.RFQRegistry,
      chainId: chain.id,
      rfqId,
      bidder,
      price,
      deliveryDays,
      proposalHash,
      salt,
    });
  }

  async function onChainCommitment(bidder: `0x${string}`) {
    const bid = await readContract(config, {
      abi: RFQRegistryAbi,
      address: contracts.RFQRegistry,
      functionName: "getBid",
      args: [BigInt(rfqId), bidder],
      chainId: chain.id as never,
    });
    return bid.commitHash;
  }

  async function commit(reseal = false) {
    setError(null);
    setNotice(null);
    if (!address) return;
    try {
      const priceUnits = parseUsdc(price);
      if (priceUnits <= 0n) throw new Error("Enter a price above zero");
      const deliveryDays = Number(days);
      if (!Number.isInteger(deliveryDays) || deliveryDays <= 0) {
        throw new Error("Delivery must be a whole number of days");
      }

      if (requiresProposal && !proposal.trim()) {
        throw new Error("This RFQ is an RFP: a written proposal is required");
      }
      const proposalHash = proposalHashOf(proposal);

      setBusy("Deriving your bid secret (signature, not a transaction)…");
      const salt = await deriveSalt(address);
      const commitHash = commitmentFor(address, priceUnits, deliveryDays, proposalHash, salt);

      // Save and hand over the reveal file before signing anything that costs money.
      const record: SavedBid = {
        chainId: chain.id,
        rfqId,
        bidder: address,
        price: priceUnits.toString(),
        deliveryDays,
        proposalHash,
        salt,
        commitHash,
        savedAt: Date.now(),
      };
      saveBid(record);
      downloadBid(record);
      setSaved(record);

      let args: readonly [bigint, `0x${string}`] | null = null;
      if (reseal) {
        // Re-sealing reuses the deposit already held: commitBid replaces the stored hash.
        setBusy("Re-sealing the bid…");
        args = [BigInt(rfqId), commitHash];
      } else {
        setBusy("Signing the USDC permit for the deposit…");
      }

      const hash = args
        ? await writeContractAsync({
            abi: RFQRegistryAbi,
            address: contracts.RFQRegistry,
            functionName: "commitBid",
            args,
          })
        : await (async () => {
            const permit = await signUsdcPermit(config, {
              owner: address,
              spender: contracts.RFQRegistry,
              value: BigInt(deposit),
              chainId: chain.id,
            });
            setBusy("Sending the sealed bid…");
            return writeContractAsync({
              abi: RFQRegistryAbi,
              address: contracts.RFQRegistry,
              functionName: "commitBidWithPermit",
              args: [BigInt(rfqId), commitHash, permit.deadline, permit.v, permit.r, permit.s],
            });
          })();

      setTxHash(hash);
      setBusy("Waiting for the transaction…");
      await waitForTransactionReceipt(config, { hash });
      setBusy(null);
      setNotice(reseal ? "Bid re-sealed with a fresh secret. No extra deposit was taken." : null);
    } catch (e) {
      fail(e);
    }
  }

  /** Try the saved bid, then an uploaded file, then re-derive from the wallet. */
  async function reveal() {
    setError(null);
    setNotice(null);
    if (!address) return;
    try {
      setBusy("Checking your bid against the chain…");
      const target = await onChainCommitment(address);
      const candidates: SavedBid[] = [revealFile, saved].filter(Boolean) as SavedBid[];
      let match = candidates.find(
        (c) =>
          commitmentFor(
            address,
            BigInt(c.price),
            c.deliveryDays,
            c.proposalHash ?? ZERO_HASH,
            c.salt,
          ).toLowerCase() === target.toLowerCase(),
      );

      if (!match) {
        const priceUnits = price ? parseUsdc(price) : candidates[0] ? BigInt(candidates[0].price) : 0n;
        const deliveryDays = Number(days) || candidates[0]?.deliveryDays || 0;
        if (priceUnits > 0n && deliveryDays > 0) {
          setBusy("Re-deriving your bid secret from your wallet…");
          const salt = await deriveSalt(address);
          const proposalHash = proposal.trim()
            ? proposalHashOf(proposal)
            : (candidates[0]?.proposalHash ?? ZERO_HASH);
          if (
            commitmentFor(address, priceUnits, deliveryDays, proposalHash, salt).toLowerCase() ===
            target.toLowerCase()
          ) {
            match = {
              chainId: chain.id,
              rfqId,
              bidder: address,
              price: priceUnits.toString(),
              deliveryDays,
              proposalHash,
              salt,
              commitHash: target,
              savedAt: Date.now(),
            };
            saveBid(match);
            setSaved(match);
          }
        }
      }

      if (!match) {
        throw new Error(
          "Could not reproduce your sealed bid. Load the reveal file, or enter the exact price and delivery days you bid and try again.",
        );
      }

      setBusy("Revealing the bid…");
      const hash = await writeContractAsync({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "revealBid",
        args: [
          BigInt(rfqId),
          BigInt(match.price),
          match.deliveryDays,
          match.proposalHash ?? ZERO_HASH,
          match.salt,
        ],
      });
      setTxHash(hash);
      await waitForTransactionReceipt(config, { hash });
      setBusy(null);
      setNotice("Bid revealed.");
    } catch (e) {
      fail(e);
    }
  }

  function onRevealFile(file: File) {
    file
      .text()
      .then((t) => setRevealFile(JSON.parse(t) as SavedBid))
      .catch(() => setError("That file is not a SealedRFQ reveal file"));
  }

  if (!isConnected) {
    return (
      <div className="panel">
        <div className="head">Connect to bid</div>
        <div className="note">
          Bidding posts a {formatUsdc(BigInt(deposit))} USDC deposit. It is refunded when you reveal
          and do not win, and forfeited if you never reveal.
        </div>
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
        <div className="note">Switch your wallet to {chain.name} to bid.</div>
        <div style={{ padding: 14 }}>
          <WalletChip />
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="head">
        {bidding ? "Submit a sealed bid" : revealing ? "Reveal your bid" : "Bidding closed"}
        <span className="hint">
          budget {formatUsdc(BigInt(budget))} · deposit {formatUsdc(BigInt(deposit))} USDC
        </span>
      </div>

      {(bidding || revealing) && (
        <div className="form">
          <div className="field">
            <label htmlFor="bid-price">
              {revealing ? "Price you bid (USDC)" : "Your price (USDC)"}
            </label>
            <input
              id="bid-price"
              inputMode="decimal"
              placeholder="2.80"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="bid-days">Delivery (days)</label>
            <input
              id="bid-days"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>

          {bidding && (
            <div className="field full">
              <label htmlFor="bid-proposal">
                Proposal {requiresProposal ? "(required)" : "(optional)"}
              </label>
              <textarea
                id="bid-proposal"
                rows={4}
                placeholder="Method, team, timeline — whatever the buyer asked for."
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
              />
            </div>
          )}

          {bidding ? (
            <>
              <div className="full note">
                <b>Your secret is derived from your wallet.</b> The price{requiresProposal ? " and proposal are" : " is"}{" "}
                hidden on-chain behind a hash, so neither can be rewritten after seeing rival bids.
                The secret that unlocks it comes from a signature, so the same wallet can regenerate
                it — and the reveal file downloads as a backup. Keep at least one: after bidding
                closes, a bid that cannot be revealed forfeits its deposit.
              </div>
              <div className="full">
                <button type="button" className="btn-primary" disabled={!!busy} onClick={() => commit(false)}>
                  {busy ?? "Seal and submit bid"}
                </button>
                {saved && (
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={!!busy}
                    onClick={() => commit(true)}
                    title="Replaces the stored hash with a fresh secret; the deposit you already posted is reused"
                  >
                    Lost your file? Re-seal (no new deposit)
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="full note">
                {saved ? (
                  <>
                    Found your sealed bid in this browser:{" "}
                    <b>{formatUsdc(BigInt(saved.price))} USDC</b> over {saved.deliveryDays} days.
                  </>
                ) : (
                  <>
                    No saved bid in this browser. Load the reveal file, or type the price and
                    delivery days you bid — the secret is re-derived from your wallet.
                  </>
                )}
              </div>
              <div className="field full">
                <label htmlFor="reveal-file">Reveal file (optional)</label>
                <input
                  id="reveal-file"
                  type="file"
                  accept="application/json"
                  onChange={(e) => e.target.files?.[0] && onRevealFile(e.target.files[0])}
                />
              </div>
              <div className="full">
                <button type="button" className="btn-primary" disabled={!!busy} onClick={reveal}>
                  {busy ?? "Reveal bid"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!bidding && !revealing && (
        <div className="note">
          This RFQ is in its {phase.toLowerCase()} phase — no new bids or reveals.
        </div>
      )}

      {saved && bidding && (
        <div className="note">
          Sealed bid saved.{" "}
          <button type="button" className="linklike" onClick={() => downloadBid(saved)}>
            Download the reveal file again
          </button>
        </div>
      )}

      {notice && <div className="note">{notice}</div>}

      {error && (
        <div className="field-err" role="alert">
          {error}
        </div>
      )}

      {txHash && (
        <div className="note">
          <a href={explorerTx(txHash)} target="_blank" rel="noreferrer">
            View transaction ↗
          </a>{" "}
          ·{" "}
          <Link href={`/rfqs/${rfqId}`} className="linklike">
            back to the RFQ
          </Link>
        </div>
      )}
    </div>
  );
}
