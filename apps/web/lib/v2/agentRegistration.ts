/**
 * What the evaluator's Concordium registration actually is, once it exists.
 *
 * `register-agent.mjs` writes `agentRegistration.json` after the transactions land, and both this
 * route and the verifier rebuild the card from it. The card is therefore a pure function of the
 * recorded facts, which is the only reason its SHA-256 can be anchored on chain and still match
 * the bytes a stranger fetches from the URL.
 *
 * Absent the file, the badge simply is not claimed. Nothing invents a plausible one: an agent card
 * naming a registration that does not exist is worse than no card, because the badge is an
 * invitation to rely on it.
 */
import type { AgentCardInput } from "@sealedrfq/concordium";
import record from "./agentRegistration.json" with { type: "json" };

export type AgentRegistration = AgentCardInput & {
  /** Hex, no 0x: what `metadata_hash` holds on chain. Recomputed on read, never trusted. */
  cardHash: string;
  transactions: { keyBinding?: string; register: string; anchorHash: string };
  registeredAt: string;
};

const stored = record as unknown as Partial<AgentRegistration> & { placeholder?: true };

export const agentRegistration: AgentRegistration | null = stored.placeholder
  ? null
  : (stored as AgentRegistration);
