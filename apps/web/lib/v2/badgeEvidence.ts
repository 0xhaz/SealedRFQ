/**
 * The Concordium half of the evidence dashboard: the badge checks, cached.
 *
 * Two deliberate choices here.
 *
 * **The import is deferred.** `@concordium/web-sdk` brings wasm, and the checks run on one page.
 * Importing it at module scope would load that wasm into every server component in the app, which
 * is a cost paid for nothing — the same reasoning `api/concordium/verify` already follows.
 *
 * **The result is cached in module memory, and that is the right store here.** Elsewhere in this
 * codebase module memory was the wrong choice: the presentation challenge store had to move to
 * Postgres because on a serverless deployment each invocation has its own memory, so a challenge
 * issued by one request was unknown to the next. A cache has the opposite failure mode. A miss
 * costs a re-check, not a wrong answer, so per-instance caching degrades into "checked more often
 * than strictly needed" rather than into intermittent errors.
 *
 * The cache exists because the checks make four round trips to a Concordium node and fetch the
 * agent card over HTTP, which is several seconds. What it must never do is hide staleness, so the
 * timestamp is returned with the result and the page shows it, and `recheck` bypasses it.
 */
import type { BadgeEvidence } from "@sealedrfq/concordium/verifyAgent";
import { agentRegistration } from "./agentRegistration";

/** Long enough that a page reload is cheap, short enough that a revocation shows up the same day. */
const TTL_MS = Number(process.env.CCD_BADGE_CACHE_MS ?? 5 * 60 * 1000);

const NODES: Record<string, string> = {
  testnet: "grpc.testnet.concordium.com",
  mainnet: "grpc.mainnet.concordium.software",
};

export type CachedBadge = {
  evidence: BadgeEvidence;
  /** When the checks actually ran, which is not when this page was rendered. */
  checkedAt: string;
  ageMs: number;
  fromCache: boolean;
};

let cached: { at: number; evidence: BadgeEvidence } | undefined;

/**
 * Run the badge checks, or return a recent run of them.
 *
 * Returns `null` only when there is no registration to check — absent `agentRegistration.json` the
 * badge is simply not claimed, and inventing a plausible agent id to check would be worse than
 * showing nothing, because the dashboard is an invitation to rely on it.
 */
export async function readBadgeEvidence(opts?: { recheck?: boolean }): Promise<CachedBadge | null> {
  if (!agentRegistration) return null;
  const { network, agentId } = agentRegistration;

  const now = Date.now();
  if (!opts?.recheck && cached && now - cached.at < TTL_MS) {
    return {
      evidence: cached.evidence,
      checkedAt: new Date(cached.at).toISOString(),
      ageMs: now - cached.at,
      fromCache: true,
    };
  }

  const [{ verifyAgentBadge }, { ConcordiumGRPCNodeClient, credentials }] = await Promise.all([
    import("@sealedrfq/concordium/verifyAgent"),
    import("@concordium/web-sdk/nodejs"),
  ]);

  const host = process.env.CCD_GRPC_HOST ?? NODES[network] ?? NODES.testnet;
  const port = Number(process.env.CCD_GRPC_PORT ?? 20000);
  const client = new ConcordiumGRPCNodeClient(host, port, credentials.createSsl());

  const evidence = await verifyAgentBadge({
    client,
    agentId: BigInt(agentId),
    network,
  });

  // A result that could not be obtained is not cached: caching an outage would keep reporting the
  // node as unreachable for the whole TTL after it came back.
  if (evidence.outcome !== "unreachable") {
    cached = { at: now, evidence };
  }

  return {
    evidence,
    checkedAt: new Date(now).toISOString(),
    ageMs: 0,
    fromCache: false,
  };
}

/** For a test, and for the `recheck` path to be honest about what it did. */
export function clearBadgeCache() {
  cached = undefined;
}
