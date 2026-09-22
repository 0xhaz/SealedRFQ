/**
 * Read-side client for the agent service (indexer + evaluator + audit).
 *
 * The web app never depends on it to *act*: awards and milestone decisions are sent from the
 * user's own wallet straight to the contracts. The agent supplies the reasoning behind a
 * recommendation and the audit check, so if it is down the dApp still works — it just cannot show
 * the memo.
 */
/**
 * Where the agent lives.
 *
 * `??` only falls back on null or undefined, so a variable set to an empty string — which is what a
 * blank field in a hosting dashboard produces — left this as "" and every call went to the site's
 * own origin. The deployment answered 404 for each one, and because the read path swallows failures
 * the whole thing looked like an agent that had simply never indexed anything. Blank now counts as
 * unset, and anything that is not an absolute http(s) URL is rejected rather than quietly joined to
 * a relative path.
 */
function resolveBase(): { url: string; misconfigured: boolean } {
  const raw = process.env.NEXT_PUBLIC_AGENT_URL?.trim();
  if (!raw) {
    // No value at all is normal in local development and wrong anywhere else.
    return { url: "http://127.0.0.1:4020", misconfigured: false };
  }
  if (!/^https?:\/\//i.test(raw)) return { url: "", misconfigured: true };
  return { url: raw.replace(/\/+$/, ""), misconfigured: false };
}

const { url: BASE, misconfigured: AGENT_MISCONFIGURED } = resolveBase();

/** Human-readable reason the agent cannot be reached, or null when it is configured sanely. */
export const agentConfigError = AGENT_MISCONFIGURED
  ? "NEXT_PUBLIC_AGENT_URL is not an absolute http(s) URL, so the agent cannot be reached."
  : null;

export type Evaluation = {
  evaluated: boolean;
  /** Anchored on-chain, but this agent does not hold the memo (e.g. a script or another operator). */
  anchoredOnly?: boolean;
  actor?: `0x${string}`;
  model?: string;
  kind?: string;
  winner?: `0x${string}` | null;
  payloadHash?: `0x${string}`;
  tx?: string;
  memo?: {
    model: string;
    rationale: string;
    rubricHash: `0x${string}`;
    ts: number;
    decision: { outcome: string; bidder?: `0x${string}`; amount?: string };
    scores: {
      bidder: `0x${string}`;
      price: string;
      deliveryDays: number;
      criteria: Record<string, number>;
      totalBps: number;
      redFlags: string[];
      /** Buyer requirements a bid cannot prove; present only when the buyer stated some. */
      unverified?: string[];
    }[];
  };
};

export type AuditResult = {
  /** verified = memo matches the anchor; mismatch = altered; anchored-only = memo held elsewhere. */
  state?: "verified" | "mismatch" | "anchored-only" | "none";
  verified: boolean;
  reason?: string;
  kind?: string;
  computedHash?: `0x${string}`;
  anchoredHash?: `0x${string}`;
  anchoredBy?: `0x${string}`;
  anchoredAt?: number;
  model?: string;
  tx?: string;
  memo?: unknown;
};

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback; // the agent is optional; the chain remains the source of truth
  }
}

async function post<T>(path: string): Promise<T | { error: string }> {
  if (agentConfigError) return { error: agentConfigError };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
    });
    // 402 is the x402 paywall, not a fault: the evaluation endpoint is sold, and a browser has no
    // way to sign a USDC authorisation. Say what actually happens next rather than a bare status.
    if (res.status === 402) {
      return {
        error:
          "this evaluation is a paid endpoint. The evaluator scores every RFQ on its own once the reveal window closes, so no action is needed — or pay for it now with the x402 buyer tool.",
      };
    }
    if (res.status === 404) {
      return {
        error:
          "the agent URL is not pointing at the agent (404). Check NEXT_PUBLIC_AGENT_URL on the deployment.",
      };
    }
    return { error: `agent returned ${res.status}` };
    return (await res.json()) as T;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "agent unreachable" };
  }
}

export type IndexedRfq = {
  rfq?: { metadataURI?: string } | null;
  milestones?: {
    idx: number;
    state: string;
    reason?: string | null;
    deliverable?: string | null;
    automatic?: boolean | null;
  }[];
};

/** Where a stored tender document can be fetched from. Empty when the agent is not configured. */
export const documentUrl = (sha256: string) => (BASE ? `${BASE}/documents/${sha256}` : "");

/**
 * Hand a tender document to the agent and get back the hash to publish.
 *
 * The agent is storage, not an authority: it keys files by the sha256 of their own bytes, and that
 * hash goes into the RFQ metadata whose own hash the chain fixes. Anyone downloading later re-hashes
 * what they received. An upload that fails is therefore recoverable — the buyer can still publish
 * the hash and send the file by hand, which is what happened before this existed.
 */
export async function uploadDocument(
  file: File,
): Promise<{ sha256: `0x${string}`; url: string } | { error: string }> {
  if (agentConfigError) return { error: agentConfigError };
  try {
    const res = await fetch(`${BASE}/documents`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json().catch(() => null)) as {
      sha256?: string;
      message?: string;
    } | null;
    if (!res.ok || !body?.sha256) {
      return { error: body?.message ?? `the agent refused the file (${res.status})` };
    }
    return { sha256: body.sha256 as `0x${string}`, url: documentUrl(body.sha256) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "could not reach the agent" };
  }
}

export type TrackRecord = {
  address: string;
  asSupplier: {
    bidsPlaced: number;
    bidsRevealed: number;
    bidsAbandoned: number;
    awards: number;
    engagementsCompleted: number;
    milestonesDelivered: number;
    milestonesRejected: number;
  };
  asBuyer: {
    rfqsPosted: number;
    rfqsAwarded: number;
    rfqsClosedWithoutAward: number;
    milestonesAcceptedOnTime: number;
    milestonesLeftToAutoRelease: number;
  };
};

const EMPTY_RECORD: TrackRecord = {
  address: "",
  asSupplier: {
    bidsPlaced: 0,
    bidsRevealed: 0,
    bidsAbandoned: 0,
    awards: 0,
    engagementsCompleted: 0,
    milestonesDelivered: 0,
    milestonesRejected: 0,
  },
  asBuyer: {
    rfqsPosted: 0,
    rfqsAwarded: 0,
    rfqsClosedWithoutAward: 0,
    milestonesAcceptedOnTime: 0,
    milestonesLeftToAutoRelease: 0,
  },
};

export const agent = {
  /** A counterparty's record. An unreachable agent yields zeroes, never an invented figure. */
  record: (address: string) =>
    get<TrackRecord>(`/reputation/${address}`, { ...EMPTY_RECORD, address }),
  /** Suppliers this buyer has completed work with, for inviting them again. */
  partners: (buyer: string) =>
    get<{ partners: { supplier: string; completed: number; lastRfqId: number }[] }>(
      `/reputation/${buyer}/partners`,
      { partners: [] },
    ),
  /** The indexed row, for the published metadata document the chain only stores a hash of. */
  rfq: (rfqId: number) => get<IndexedRfq>(`/rfqs/${rfqId}`, { rfq: null }),
  evaluation: (rfqId: number) => get<Evaluation>(`/rfqs/${rfqId}/evaluation`, { evaluated: false }),
  audit: (rfqId: number) =>
    get<AuditResult>(`/audit/${rfqId}`, { verified: false, reason: "agent unreachable" }),
  health: () =>
    get<{ ok: boolean; indexedBlock: number }>("/health", { ok: false, indexedBlock: 0 }),
  /**
   * Ask the evaluator to score now. The scheduler does this on its own once the reveal window
   * closes; this is for anyone who does not want to wait for the next tick.
   */
  evaluate: (rfqId: number) => post<{ tx?: string }>(`/rfqs/${rfqId}/evaluate`),
};

export const AGENT_URL = BASE;
