import { newChallenge } from "@sealedrfq/concordium";
/**
 * The durable challenge store, against a real database.
 *
 * The properties that matter here cannot be tested in memory: that the application role cannot
 * touch the table directly, and that two presentations racing the same challenge cannot both be
 * accepted. The second depends on the conditional UPDATE being one statement, which is a fact
 * about the SQL rather than about this file.
 */
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresChallengeStore } from "../src/presentationChallenges.js";

const store = new PostgresChallengeStore();
const admin = new Pool({
  connectionString:
    process.env.ADMIN_DATABASE_URL ?? "postgres://sealedrfq:localdev@localhost:5433/sealedrfq",
});

afterAll(async () => {
  await admin.end();
});

describe("the presentation challenge store", () => {
  it("round-trips a challenge", async () => {
    const c = newChallenge("tender:1:bid", 300);
    await store.issue(c);
    const found = await store.peek(c.challenge);
    expect(found?.purpose).toBe("tender:1:bid");
    // The database sets the timestamps, so they are close to ours rather than identical.
    expect(Math.abs((found?.expiresAt ?? 0) - c.expiresAt)).toBeLessThan(60_000);
  });

  it("consumes once, and reports the second attempt as gone", async () => {
    const c = newChallenge("tender:2:bid", 300);
    await store.issue(c);
    expect(await store.consume(c.challenge)).toBeDefined();
    expect(await store.consume(c.challenge)).toBeUndefined();
    // Consumed reads as absent, so both stores behave the same way to a caller.
    expect(await store.peek(c.challenge)).toBeUndefined();
  });

  it("lets only one of several concurrent consumers win", async () => {
    // The property the whole design rests on. Issued once, claimed eight times at once.
    const c = newChallenge("tender:3:bid", 300);
    await store.issue(c);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.consume(c.challenge)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses an expired challenge", async () => {
    const c = newChallenge("tender:4:bid", 1, Date.now() - 10_000);
    // Issue with a lifetime already in the past by writing it directly: the store's own `issue`
    // refuses a non-positive TTL, which is itself the behaviour we want everywhere else.
    await admin.query(
      "INSERT INTO presentation_challenges (challenge, purpose, issued_at, expires_at) VALUES ($1, $2, now() - interval '1 hour', now() - interval '59 minutes')",
      [c.challenge, c.purpose],
    );
    expect(await store.consume(c.challenge)).toBeUndefined();
  });

  it("refuses to issue a challenge that expires before it was issued", async () => {
    const c = newChallenge("tender:5:bid", 300);
    await expect(store.issue({ ...c, expiresAt: c.issuedAt - 1 })).rejects.toThrow(/expire/);
  });

  it("keeps the table out of the application role's reach", async () => {
    // The escalation is meant to live in the SECURITY DEFINER functions and nowhere else. If the
    // app role could read or write the table, single use would be advisory rather than enforced.
    const app = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgres://sealedrfq_app:localdev@localhost:5433/sealedrfq",
    });
    try {
      await expect(app.query("SELECT * FROM presentation_challenges")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        app.query("UPDATE presentation_challenges SET consumed_at = NULL"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it("evicts only long-expired rows", async () => {
    const live = newChallenge("tender:6:bid", 300);
    await store.issue(live);
    await store.evictExpired();
    expect(await store.peek(live.challenge)).toBeDefined();
  });
});
