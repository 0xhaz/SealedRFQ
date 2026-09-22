"use client";

import { chain, contracts } from "@/lib/chain";
import { describeTxError } from "@/lib/txError";
import { RFQRegistryAbi } from "@sealedrfq/shared";
import { useState } from "react";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

/**
 * Settle one bidder's deposit once the RFQ is decided.
 *
 * The contract settles deposits one bidder at a time and refuses to loop over them, because an
 * unbounded loop is how an escrow contract gets bricked by a list nobody can afford to iterate. The
 * consequence is that somebody has to ask: until then a losing bidder's deposit sits held, and
 * before this button nothing in the interface asked.
 *
 * Permissionless on purpose, and worth leaving that way. The contract decides where the money goes
 * — refunded to a bidder who revealed, forfeited to the buyer if they did not — so the caller only
 * chooses *when*, never *who gets paid*. That means a supplier can recover their own deposit
 * without the buyer's cooperation, which is the point.
 */
export function SettleDeposit({ rfqId, bidder }: { rfqId: number; bidder: `0x${string}` }) {
  const { isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!isConnected || chainId !== chain.id) return null;
  if (done) return <span className="hint">settled</span>;

  async function settle() {
    setError(null);
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "settleDeposit",
        args: [BigInt(rfqId), bidder],
        chainId: chain.id,
      });
      await waitForTransactionReceipt(config, { hash });
      setDone(true);
    } catch (e) {
      setError(describeTxError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="chip" disabled={busy} onClick={settle}>
        {busy ? "settling…" : "settle"}
      </button>
      {error && (
        <div className="field-err" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
