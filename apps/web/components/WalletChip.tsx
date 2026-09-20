"use client";

import { formatUsdc, USDC_ADDRESS } from "@sealedrfq/shared";
import { erc20Abi } from "viem";
import { useAccount, useConnect, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { chain } from "@/lib/chain";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Connect + network + USDC balance in one control. Unlike the reference site's read-only chip,
 * this wallet signs: buyers fund RFQs and suppliers post deposits from it.
 */
export function WalletChip() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: USDC_ADDRESS,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button
        type="button"
        className="wallet-btn"
        disabled={isPending || !injected}
        onClick={() => injected && connect({ connector: injected })}
      >
        <i className="wallet-dot" />
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (chainId !== chain.id) {
    return (
      <button type="button" className="wallet-btn" onClick={() => switchChain({ chainId: chain.id })}>
        <i className="wallet-dot" />
        Switch to {chain.name}
      </button>
    );
  }

  return (
    <button type="button" className="wallet-btn" onClick={() => disconnect()} title="Disconnect">
      <i className="wallet-dot" />
      <span className="mono">{address ? short(address) : ""}</span>
      {balance !== undefined && <span className="wallet-bal">{formatUsdc(balance)} USDC</span>}
    </button>
  );
}
