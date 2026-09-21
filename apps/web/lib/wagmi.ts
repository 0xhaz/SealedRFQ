import { arcMainnet, arcTest } from "@sealedrfq/shared";
import { fallback } from "viem";
import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { CHAIN_ID, arcLocal, rpcUrls } from "./chain";

/**
 * MetaMask (injected) on Arc. Both networks are registered so the config keeps literal chain
 * types; `chain` in lib/chain.ts picks the one this build targets. USDC is both the gas token and
 * the settlement asset, so wallets may warn about the symbol: expected on Arc, not an error.
 */
/** Every endpoint in turn for the active chain, so one rate-limited RPC does not break the app. */
const transportFor = (id: number, fallbackUrl: string) =>
  id === CHAIN_ID ? fallback(rpcUrls.map((url) => http(url))) : http(fallbackUrl);

export const wagmiConfig = createConfig({
  chains: [arcTest, arcMainnet, arcLocal],
  connectors: [injected()],
  transports: {
    // The chain this build targets gets the full fallback list; the others are registered only to
    // keep wagmi's literal chain types and are never dialled.
    [arcTest.id]: transportFor(arcTest.id, arcTest.rpcUrls.default.http[0]),
    [arcMainnet.id]: transportFor(arcMainnet.id, arcMainnet.rpcUrls.default.http[0]),
    [arcLocal.id]: transportFor(arcLocal.id, arcLocal.rpcUrls.default.http[0]),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
