"use client";

import { RFQRegistryAbi } from "@sealedrfq/shared";
import { formatUsdc, parseUsdc } from "@sealedrfq/shared";
import Link from "next/link";
import { useState } from "react";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { WalletChip } from "@/components/WalletChip";
import { chain, contracts, explorerTx } from "@/lib/chain";
import {
  computeCommitment,
  downloadBid,
  loadBid,
  randomSalt,
  saveBid,
  type SavedBid,
} from "@/lib/bidStore";
import { signUsdcPermit } from "@/lib/permit";

type Props = {
  rfqId: number;
  phase: string;
  deposit: string; // 6-decimal units as string
  budget: string;
};

export function BidForm({ rfqId, phase, deposit, budget }: Props) {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [price, setPrice] = useState("");
  const [days, setDays] = useState("21");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [saved, setSaved] = useState<SavedBid | null>(
    address ? loadBid(chain.id, rfqId, address) : null,
  );
  const [revealFile, setRevealFile] = useState<SavedBid | null>(null);

  const wrongChain = isConnected && chainId !== chain.id;
  const bidding = phase === "Bidding";
  const revealing = phase === "Reveal";

  async function commit() {
    setError(null);
    if (!address) return;
    try {
      const priceUnits = parseUsdc(price);
      if (priceUnits <= 0n) throw new Error("Enter a price above zero");
      const deliveryDays = Number(days);
      if (!Number.isInteger(deliveryDays) || deliveryDays <= 0) {
        throw new Error("Delivery must be a whole number of days");
      }

      const salt = randomSalt();
      const commitHash = computeCommitment({
        registry: contracts.RFQRegistry,
        chainId: chain.id,
        rfqId,
        bidder: address,
        price: priceUnits,
        deliveryDays,
        salt,
      });

      // Save and hand over the reveal file BEFORE signing: losing the salt forfeits the deposit.
      const record: SavedBid = {
        chainId: chain.id,
        rfqId,
        bidder: address,
        price: priceUnits.toString(),
        deliveryDays,
        salt,
        commitHash,
        savedAt: Date.now(),
      };
      saveBid(record);
      downloadBid(record);
      setSaved(record);

      setBusy("Signing the USDC permit for the deposit…");
      const permit = await signUsdcPermit(config, {
        owner: address,
        spender: contracts.RFQRegistry,
        value: BigInt(deposit),
        chainId: chain.id,
      });

      setBusy("Sending the sealed bid…");
      const hash = await writeContractAsync({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "commitBidWithPermit",
        args: [BigInt(rfqId), commitHash, permit.deadline, permit.v, permit.r, permit.s],
      });
      setTxHash(hash);
      setBusy("Waiting for the transaction…");
      await waitForTransactionReceipt(config, { hash });
      setBusy(null);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  }

  async function reveal() {
    setError(null);
    const bid = revealFile ?? saved;
    if (!bid || !address) {
      setError("No saved bid found. Load the reveal file you downloaded when you bid.");
      return;
    }
    try {
      setBusy("Revealing the bid…");
      const hash = await writeContractAsync({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "revealBid",
        args: [BigInt(rfqId), BigInt(bid.price), bid.deliveryDays, bid.salt],
      });
      setTxHash(hash);
      await waitForTransactionReceipt(config, { hash });
      setBusy(null);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
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
          Bidding posts a {formatUsdc(BigInt(deposit))} USDC deposit. It is refunded when you
          reveal and do not win, and forfeited if you never reveal.
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

      {bidding && (
        <div className="form">
          <div className="field">
            <label htmlFor="bid-price">Your price (USDC)</label>
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
          <div className="full note">
            <b>Keep the reveal file.</b> Your price is hidden on-chain behind a hash. Revealing
            needs the exact secret from this bid, so the file downloads automatically and a copy is
            kept in this browser. Without it you cannot reveal, and an unrevealed bid forfeits its
            deposit.
          </div>
          <div className="full">
            <button type="button" className="btn-primary" disabled={!!busy} onClick={commit}>
              {busy ?? "Seal and submit bid"}
            </button>
          </div>
        </div>
      )}

      {revealing && (
        <div className="form">
          <div className="full note">
            {saved ? (
              <>
                Found your sealed bid in this browser: <b>{formatUsdc(BigInt(saved.price))} USDC</b>{" "}
                over {saved.deliveryDays} days. Reveal it before the window closes or the deposit is
                forfeited.
              </>
            ) : (
              <>No saved bid in this browser. Load the reveal file you downloaded when you bid.</>
            )}
          </div>
          {!saved && (
            <div className="field full">
              <label htmlFor="reveal-file">Reveal file</label>
              <input
                id="reveal-file"
                type="file"
                accept="application/json"
                onChange={(e) => e.target.files?.[0] && onRevealFile(e.target.files[0])}
              />
            </div>
          )}
          <div className="full">
            <button
              type="button"
              className="btn-primary"
              disabled={!!busy || (!saved && !revealFile)}
              onClick={reveal}
            >
              {busy ?? "Reveal bid"}
            </button>
          </div>
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
