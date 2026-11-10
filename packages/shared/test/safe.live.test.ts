/**
 * Confirms Safe's EIP-1271 handler is really deployed on Arc testnet, so "Safe is available on
 * this chain" is checked rather than asserted.
 *
 * Needs the network, so it is opt-in:
 *   ARC_LIVE=1 pnpm --filter @sealedrfq/shared test
 *
 * Deliberately not here: verifying a real Safe signature. That needs a deployed Safe with known
 * owners and a signed payload, which means deploying and signing on a live chain.
 */
import { http, createPublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { arcTest } from "../src/chains.js";

// CompatibilityFallbackHandler 1.4.1: what answers isValidSignature for a Safe proxy.
const FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";

const live = process.env.ARC_LIVE === "1" ? describe : describe.skip;

live("Safe on Arc testnet (live)", () => {
  it("has the CompatibilityFallbackHandler deployed", async () => {
    const client = createPublicClient({ chain: arcTest, transport: http() });
    expect(await client.getChainId()).toBe(5042002);
    const code = await client.getCode({ address: FALLBACK_HANDLER });
    expect(code && code !== "0x").toBe(true);
  });
});
