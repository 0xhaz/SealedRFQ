/**
 * Configuration for charging per evaluation over x402.
 *
 * x402 is the HTTP 402 handshake for machine payments: an unpaid request gets a 402 describing what
 * to pay, the caller signs a USDC authorisation, and the facilitator verifies and settles it. Circle
 * runs a facilitator that supports Arc on both networks, so this is USDC paid to a USDC-settled
 * service on a USDC-gas chain — no API keys, no accounts, no invoices.
 *
 * What is charged for is deliberately narrow. Scoring an RFQ costs real inference, so `POST
 * /rfqs/:id/evaluate` is a service worth metering. Reading a memo back, re-hashing it and checking
 * it against the chain is not: the entire argument of this project is that a losing bidder can
 * audit the reasoning without anyone's permission, and putting a price on that would contradict it.
 * So the verification routes stay free forever, whatever this is set to.
 */

/** Arc is the only place this can work: Circle's facilitator settles 5042 and 5042002, nothing local. */
const FACILITATORS: Record<number, string> = {
  5042: "https://gateway-api.circle.com",
  5042002: "https://gateway-api-testnet.circle.com",
};

export type X402Config = {
  price: string;
  payTo: string;
  /** CAIP-2, which is how x402 v2 names chains. */
  network: string;
  facilitatorUrl: string;
  description: string;
};

export class X402ConfigError extends Error {}

/**
 * Returns null when metering is off, which is the default.
 *
 * Off by default because the demo scripts and the local chain drive this endpoint directly, and a
 * paywall that appears without being asked for would break them. When it *is* asked for and cannot
 * be honoured, this throws rather than quietly serving a paid endpoint for free — an operator who
 * set X402_ENABLED believes they are charging, and silently not charging is the worse outcome.
 */
export function resolveX402(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env,
): X402Config | null {
  if (env.X402_ENABLED !== "true") return null;

  const facilitatorUrl = env.X402_FACILITATOR_URL ?? FACILITATORS[chainId];
  if (!facilitatorUrl) {
    throw new X402ConfigError(
      `X402_ENABLED is set but chain ${chainId} has no Circle facilitator. x402 settles on Arc (5042 or 5042002); on a local chain leave it unset, or point X402_FACILITATOR_URL at your own.`,
    );
  }

  const payTo = env.X402_PAY_TO;
  if (!payTo) {
    throw new X402ConfigError(
      "X402_ENABLED is set but X402_PAY_TO is not: payments would have nowhere to go.",
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new X402ConfigError(`X402_PAY_TO is not an address: ${payTo}`);
  }

  // The SDK takes dollars as a string, with or without the sign. Anything else would be read as a
  // price of zero and give the service away, so it is rejected here instead.
  const price = env.X402_PRICE ?? "$0.05";
  if (!/^\$?\d+(\.\d+)?$/.test(price)) {
    throw new X402ConfigError(`X402_PRICE must look like "$0.05", got: ${price}`);
  }

  return {
    price,
    payTo,
    network: `eip155:${chainId}`,
    facilitatorUrl,
    description:
      "Sealed-bid evaluation: scores revealed bids against the published rubric and anchors a signed decision memo on Arc.",
  };
}
