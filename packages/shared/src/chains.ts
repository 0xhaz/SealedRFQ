import { defineChain } from "viem";
import { arc, arcTestnet } from "viem/chains";

/**
 * Arc networks as SealedRFQ uses them. RPC and explorer hosts are pinned to the ones in
 * docs/architecture.md (viem's built-in testnet entry points at arc.network / arcscan.app).
 * The native currency is USDC with 18 decimals; settlement uses the 6-decimal ERC-20 view.
 */
export const arcMainnet = defineChain({
  ...arc,
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

export const arcTest = defineChain({
  ...arcTestnet,
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" },
  },
});

export const CHAINS = { [arcMainnet.id]: arcMainnet, [arcTest.id]: arcTest } as const;
export type SupportedChainId = keyof typeof CHAINS;

export function chainById(id: number) {
  const chain = CHAINS[id as SupportedChainId];
  if (!chain) throw new Error(`Unsupported chain id ${id} (expected 5042 or 5042002)`);
  return chain;
}

export const txUrl = (chainId: number, hash: string) =>
  `${chainById(chainId).blockExplorers.default.url}/tx/${hash}`;
export const addressUrl = (chainId: number, address: string) =>
  `${chainById(chainId).blockExplorers.default.url}/address/${address}`;
