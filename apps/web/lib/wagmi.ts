import { arcMainnet, arcTest } from "@sealedrfq/shared";
import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

/**
 * MetaMask (injected) on Arc. Both networks are registered so the config keeps literal chain
 * types; `chain` in lib/chain.ts picks the one this build targets. USDC is both the gas token and
 * the settlement asset, so wallets may warn about the symbol: expected on Arc, not an error.
 */
export const wagmiConfig = createConfig({
  chains: [arcTest, arcMainnet],
  connectors: [injected()],
  transports: {
    [arcTest.id]: http(arcTest.rpcUrls.default.http[0]),
    [arcMainnet.id]: http(arcMainnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
