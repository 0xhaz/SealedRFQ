"use client";

import { chain, contracts, explorerTx } from "@/lib/chain";
import { describeTxError } from "@/lib/txError";
import { RFQRegistryAbi, SealedRFQAdapterAbi, formatUsdc } from "@sealedrfq/shared";
import { useState } from "react";
import { useAccount, useConfig, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

/**
 * Money owed to the connected wallet, and the button that claims it.
 *
 * Payouts here are pull, not push: accepting a milestone credits the supplier rather than
 * transferring to them, so nobody can block a settlement by refusing delivery or by being a
 * contract that reverts on receipt. The cost of that design is that money sits until it is asked
 * for, and until this panel existed nothing anywhere said it was there — a supplier could be paid
 * and never know.
 *
 * Two balances, because two contracts hold money for different reasons: the registry refunds bid
 * deposits and unused budget, the adapter pays milestones, retention and stakes. Showing one total
 * would be friendlier and would hide which contract to ask.
 */
export function Payouts() {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const enabled = Boolean(address) && chainId === chain.id;

  const registry = useReadContract({
    abi: RFQRegistryAbi,
    address: contracts.RFQRegistry,
    functionName: "withdrawable",
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  });

  const adapter = useReadContract({
    abi: SealedRFQAdapterAbi,
    address: contracts.SealedRFQAdapter,
    functionName: "withdrawable",
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  });

  if (!isConnected || chainId !== chain.id) return null;

  const fromRegistry = (registry.data as bigint | undefined) ?? 0n;
  const fromAdapter = (adapter.data as bigint | undefined) ?? 0n;
  const total = fromRegistry + fromAdapter;

  async function claim(which: "registry" | "adapter") {
    setError(null);
    setTxHash(null);
    setBusy("Confirm in your wallet…");
    try {
      const hash = await writeContractAsync({
        abi: which === "registry" ? RFQRegistryAbi : SealedRFQAdapterAbi,
        address: which === "registry" ? contracts.RFQRegistry : contracts.SealedRFQAdapter,
        functionName: "withdraw",
        chainId: chain.id,
      });
      setTxHash(hash);
      setBusy("Waiting for the transaction…");
      await waitForTransactionReceipt(config, { hash });
      await Promise.all([registry.refetch(), adapter.refetch()]);
    } catch (e) {
      setError(describeTxError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel">
      <div className="head">
        Your payouts
        <span className="hint">credited here until you claim them</span>
      </div>

      {total === 0n ? (
        <div className="note">
          Nothing owed to this wallet right now. Refunded deposits, milestone payments, retention
          and stakes all appear here when they are released.
        </div>
      ) : (
        <>
          <div className="note">
            <b>{formatUsdc(total)} USDC</b> is credited to this wallet. It stays in the contract
            until you withdraw it — releasing a payment credits you rather than transferring, so
            nobody can block a settlement by refusing to receive it.
          </div>
          {fromAdapter > 0n && (
            <div className="payout-row">
              <span>
                Milestones, retention and stakes <b>{formatUsdc(fromAdapter)} USDC</b>
              </span>
              <button
                type="button"
                className="btn-primary"
                disabled={!!busy}
                onClick={() => claim("adapter")}
              >
                {busy ?? "Withdraw"}
              </button>
            </div>
          )}
          {fromRegistry > 0n && (
            <div className="payout-row">
              <span>
                Bid deposits and unused budget <b>{formatUsdc(fromRegistry)} USDC</b>
              </span>
              <button
                type="button"
                className="btn-outline"
                disabled={!!busy}
                onClick={() => claim("registry")}
              >
                {busy ?? "Withdraw"}
              </button>
            </div>
          )}
        </>
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
