/**
 * Challenges for Concordium identity presentations.
 *
 * A presentation proves something about a holder, and the proof is bound to a challenge: the
 * challenge seeds the Fiat-Shamir transcript, so a proof produced for one challenge cannot be
 * re-presented under another. That is cryptographic and needs nothing from us.
 *
 * What it does NOT prevent is replaying the same proof under the same challenge. Nothing in the
 * proof says it has been used. So the challenge has to be ours, recent, and usable once — which
 * is this file's whole job, and the reason it is separate from the verification itself.
 *
 * Kept free of `@concordium/web-sdk` so the web app can issue challenges without its wasm.
 */
import { randomBytes } from "node:crypto";

/** 32 bytes. The wallet treats it as opaque; its only job is to be unguessable and unique. */
const CHALLENGE_BYTES = 32;

/** Long enough to read a prompt and approve it, short enough that a captured proof goes stale. */
export const DEFAULT_TTL_SECONDS = 300;

export type Challenge = {
  /** Hex, no 0x. This exact string must come back as the presentation's challenge. */
  challenge: string;
  /**
   * What the challenge was issued for, e.g. `tender:42:bid`. Checked on verification so a proof
   * obtained for one purpose cannot be presented for another — the chain cannot see intent, and
   * a challenge that means "prove you may bid" must not also mean "prove you may be paid".
   */
  purpose: string;
  issuedAt: number;
  expiresAt: number;
};

export function newChallenge(purpose: string, ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now()) {
  if (!purpose) throw new Error("a challenge needs a purpose");
  if (ttlSeconds <= 0) throw new Error("ttlSeconds must be positive");
  return {
    challenge: randomBytes(CHALLENGE_BYTES).toString("hex"),
    purpose,
    issuedAt: now,
    expiresAt: now + ttlSeconds * 1000,
  } satisfies Challenge;
}

/**
 * Where issued challenges live.
 *
 * `consume` must be atomic: two identical presentations arriving together must not both succeed.
 * The in-memory implementation below gets that for free from the single-threaded event loop; a
 * database implementation needs a conditional delete, not a read followed by a write.
 */
export interface ChallengeStore {
  issue(challenge: Challenge): Promise<void>;
  /** Look without consuming, so a bad proof cannot burn a challenge the holder may retry with. */
  peek(challenge: string): Promise<Challenge | undefined>;
  /** Atomically take it. Returns undefined if it was already used, expired or never issued. */
  consume(challenge: string, now?: number): Promise<Challenge | undefined>;
}

export class InMemoryChallengeStore implements ChallengeStore {
  private readonly issued = new Map<string, Challenge>();

  async issue(challenge: Challenge): Promise<void> {
    this.issued.set(challenge.challenge, challenge);
  }

  async peek(challenge: string): Promise<Challenge | undefined> {
    return this.issued.get(challenge);
  }

  async consume(challenge: string, now = Date.now()): Promise<Challenge | undefined> {
    const found = this.issued.get(challenge);
    if (!found) return undefined;
    // Deleted even when expired: an expired challenge is spent, not merely unusable, so it cannot
    // be retried in the hope of landing inside a clock skew.
    this.issued.delete(challenge);
    return found.expiresAt > now ? found : undefined;
  }

  /** Housekeeping. Expired entries are refused anyway; this only stops the map growing forever. */
  evictExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, value] of this.issued) {
      if (value.expiresAt <= now) {
        this.issued.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.issued.size;
  }
}
