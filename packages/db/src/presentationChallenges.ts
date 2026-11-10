/**
 * The durable home for Concordium presentation challenges.
 *
 * Implements the `ChallengeStore` interface from `@sealedrfq/concordium` against Postgres. The
 * in-memory implementation there is for tests: on a serverless deployment each invocation has its
 * own memory, so a challenge issued by one request would be unknown to the next, and the symptom
 * would be intermittent "unknown challenge" errors rather than anything that looks like a missing
 * store.
 *
 * Single use is enforced by the database, in the WHERE clause of a conditional UPDATE, so two
 * presentations racing the same challenge cannot both be accepted. Checking first and updating
 * after would leave precisely that gap.
 */
import type { Challenge, ChallengeStore } from "@sealedrfq/concordium";
import { pool } from "./index.js";

type Row = {
  challenge: string;
  purpose: string;
  issued_at: Date;
  expires_at: Date;
  consumed_at?: Date | null;
};

const toChallenge = (r: Row): Challenge => ({
  challenge: r.challenge,
  purpose: r.purpose,
  issuedAt: r.issued_at.getTime(),
  expiresAt: r.expires_at.getTime(),
});

export class PostgresChallengeStore implements ChallengeStore {
  async issue(challenge: Challenge): Promise<void> {
    const ttlSeconds = Math.ceil((challenge.expiresAt - challenge.issuedAt) / 1000);
    if (ttlSeconds <= 0) throw new Error("a challenge must expire after it is issued");
    await pool.query(
      "SELECT * FROM app.issue_presentation_challenge($1, $2, make_interval(secs => $3))",
      [challenge.challenge, challenge.purpose, ttlSeconds],
    );
  }

  async peek(challenge: string): Promise<Challenge | undefined> {
    const { rows } = await pool.query<Row>("SELECT * FROM app.peek_presentation_challenge($1)", [
      challenge,
    ]);
    const row = rows[0];
    if (!row) return undefined;
    // A consumed challenge is reported as absent rather than as present-but-spent: to every
    // caller it is gone, and saying so in one place keeps the two stores behaving alike.
    if (row.consumed_at) return undefined;
    return toChallenge(row);
  }

  /**
   * `now` is accepted for interface compatibility and deliberately ignored: the database decides,
   * and using its clock for both the expiry check and the claim means there is no second clock to
   * disagree with it in between.
   */
  async consume(challenge: string, _now?: number): Promise<Challenge | undefined> {
    const { rows } = await pool.query<Row>("SELECT * FROM app.consume_presentation_challenge($1)", [
      challenge,
    ]);
    const row = rows[0];
    return row ? toChallenge(row) : undefined;
  }

  /** Housekeeping. Expired challenges are refused with or without this. */
  async evictExpired(): Promise<number> {
    const { rows } = await pool.query<{ evict_expired_presentation_challenges: string }>(
      "SELECT app.evict_expired_presentation_challenges()",
    );
    return Number(rows[0]?.evict_expired_presentation_challenges ?? 0);
  }
}
