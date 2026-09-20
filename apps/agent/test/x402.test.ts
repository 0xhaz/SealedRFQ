import { describe, expect, it } from "vitest";
import { X402ConfigError, resolveX402 } from "../src/modules/x402/x402.config.js";

const PAY_TO = "0x90aD2B03aD46Ef7E413261FCdc5D82f9870Ca91F";
const on = (extra: Record<string, string> = {}) =>
  ({ X402_ENABLED: "true", X402_PAY_TO: PAY_TO, ...extra }) as NodeJS.ProcessEnv;

describe("x402 config", () => {
  it("is off unless asked for, so the demo scripts keep working", () => {
    expect(resolveX402(5042002, {} as NodeJS.ProcessEnv)).toBeNull();
    // Anything other than the exact opt-in leaves it off rather than guessing.
    expect(resolveX402(5042002, { X402_ENABLED: "1" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("names the chain in CAIP-2 and picks the matching Circle facilitator", () => {
    expect(resolveX402(5042002, on())).toMatchObject({
      network: "eip155:5042002",
      facilitatorUrl: "https://gateway-api-testnet.circle.com",
    });
    expect(resolveX402(5042, on())).toMatchObject({
      network: "eip155:5042",
      facilitatorUrl: "https://gateway-api.circle.com",
    });
  });

  it("refuses to start on a chain Circle cannot settle, rather than serving for free", () => {
    // The local chain is the realistic case: 31337 has no facilitator.
    expect(() => resolveX402(31337, on())).toThrow(X402ConfigError);
    expect(() => resolveX402(31337, on())).toThrow(/no Circle facilitator/);
  });

  it("still allows a self-hosted facilitator on an unlisted chain", () => {
    expect(resolveX402(31337, on({ X402_FACILITATOR_URL: "http://127.0.0.1:4021" }))).toMatchObject(
      { facilitatorUrl: "http://127.0.0.1:4021", network: "eip155:31337" },
    );
  });

  it("refuses to charge with nowhere to pay", () => {
    expect(() => resolveX402(5042, { X402_ENABLED: "true" } as NodeJS.ProcessEnv)).toThrow(
      /X402_PAY_TO/,
    );
    expect(() => resolveX402(5042, on({ X402_PAY_TO: "not-an-address" }))).toThrow(
      /not an address/,
    );
  });

  it("rejects a price it would otherwise read as zero", () => {
    // "5c" or "0.05 USDC" parsing to nothing would give the service away silently.
    expect(() => resolveX402(5042, on({ X402_PRICE: "5c" }))).toThrow(/X402_PRICE/);
    expect(() => resolveX402(5042, on({ X402_PRICE: "0.05 USDC" }))).toThrow(/X402_PRICE/);
    expect(resolveX402(5042, on({ X402_PRICE: "$0.25" }))?.price).toBe("$0.25");
    expect(resolveX402(5042, on({ X402_PRICE: "0.25" }))?.price).toBe("0.25");
  });

  it("defaults to a price rather than to free", () => {
    expect(resolveX402(5042, on())?.price).toBe("$0.05");
  });
});
