/**
 * Read-side client for the agent service (indexer + evaluator + audit).
 *
 * The web app never depends on it to *act*: awards and milestone decisions are sent from the
 * user's own wallet straight to the contracts. The agent supplies the reasoning behind a
 * recommendation and the audit check, so if it is down the dApp still works — it just cannot show
 * the memo.
 */
const BASE = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://127.0.0.1:4020";

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
    }[];
  };
};

export type AuditResult = {
  verified: boolean;
  reason?: string;
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
    const res = await fetch(`${BASE}${path}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback; // the agent is optional; the chain remains the source of truth
  }
}

export const agent = {
  evaluation: (rfqId: number) => get<Evaluation>(`/rfqs/${rfqId}/evaluation`, { evaluated: false }),
  audit: (rfqId: number) =>
    get<AuditResult>(`/audit/${rfqId}`, { verified: false, reason: "agent unreachable" }),
  health: () => get<{ ok: boolean; indexedBlock: number }>("/health", { ok: false, indexedBlock: 0 }),
};
