import { privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";
import { AuthError, challengeMessage, issueChallenge, verifyChallenge } from "../src/auth.js";
import { pool, withTenant } from "../src/index.js";

const reachable = await pool
  .query("SELECT 1")
  .then(() => true)
  .catch(() => false);
if (!reachable) {
  console.warn(
    "\n  skipping auth tests: no database at localhost:5433." +
      "\n  start it with:  pnpm --filter @sealedrfq/db db:up && pnpm --filter @sealedrfq/db db:migrate\n",
  );
}
const withDb = reachable ? describe : describe.skip;

// A throwaway key. Anvil's first account, published in its own startup banner.
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const other = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

afterAll(async () => {
  await pool.end();
});

const sign = (c: { nonce: string; message: string }, who = account) =>
  who.signMessage({ message: c.message });

withDb("signing in with a wallet", () => {
  it("returns a user id that works as a tenant identity", async () => {
    const c = await issueChallenge(account.address);
    const userId = await verifyChallenge(c.nonce, await sign(c));
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    // The point of the id: it is what withTenant takes.
    await expect(withTenant(userId, null, async () => "ok")).resolves.toBe("ok");
  });

  it("is the same user on a second sign-in, not a duplicate", async () => {
    const first = await verifyChallenge(
      ...(await (async () => {
        const c = await issueChallenge(account.address);
        return [c.nonce, await sign(c)] as const;
      })()),
    );
    const second = await verifyChallenge(
      ...(await (async () => {
        const c = await issueChallenge(account.address);
        return [c.nonce, await sign(c)] as const;
      })()),
    );
    expect(second).toBe(first);
  });

  it("treats a checksummed address as the same account as a lower-case one", async () => {
    const c = await issueChallenge(account.address.toLowerCase());
    const lower = await verifyChallenge(c.nonce, await sign(c));
    const c2 = await issueChallenge(account.address);
    const checksummed = await verifyChallenge(c2.nonce, await sign(c2));
    expect(checksummed).toBe(lower);
  });
});

withDb("what a challenge refuses", () => {
  it("will not accept the same nonce twice", async () => {
    const c = await issueChallenge(account.address);
    const sig = await sign(c);
    await expect(verifyChallenge(c.nonce, sig)).resolves.toBeTruthy();
    await expect(verifyChallenge(c.nonce, sig)).rejects.toThrow(AuthError);
  });

  it("will not accept a signature from a different wallet", async () => {
    const c = await issueChallenge(account.address);
    await expect(verifyChallenge(c.nonce, await sign(c, other))).rejects.toThrow(
      /different wallet/,
    );
  });

  it("burns the nonce even when the signature is wrong, so it cannot be ground against", async () => {
    const c = await issueChallenge(account.address);
    await expect(verifyChallenge(c.nonce, await sign(c, other))).rejects.toThrow(AuthError);
    // The correct signature now fails too: one attempt per nonce.
    await expect(verifyChallenge(c.nonce, await sign(c))).rejects.toThrow(
      /unknown, used or expired/,
    );
  });

  it("will not accept an expired nonce", async () => {
    const c = await issueChallenge(account.address);
    const sig = await sign(c);
    // Through an admin connection: the application role is denied wallet_challenges entirely, which
    // is the point of migration 0003. Reaching it from here would mean the lockdown had a hole.
    const admin = new (await import("pg")).default.Pool({
      connectionString:
        process.env.ADMIN_DATABASE_URL ?? "postgres://sealedrfq:localdev@localhost:5433/sealedrfq",
    });
    await admin.query(
      "UPDATE wallet_challenges SET expires_at = now() - interval '1 second' WHERE nonce = $1",
      [c.nonce],
    );
    await admin.end();
    await expect(verifyChallenge(c.nonce, sig)).rejects.toThrow(/unknown, used or expired/);
  });

  it("will not accept a nonce it never issued", async () => {
    await expect(verifyChallenge(crypto.randomUUID(), "0xdead" as `0x${string}`)).rejects.toThrow(
      /unknown, used or expired/,
    );
  });

  it("only one of two racing requests can claim a nonce", async () => {
    const c = await issueChallenge(account.address);
    const sig = await sign(c);
    const results = await Promise.allSettled([
      verifyChallenge(c.nonce, sig),
      verifyChallenge(c.nonce, sig),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

withDb("the challenge table itself", () => {
  it("cannot be read or written by the application role at all", async () => {
    // Sign-in goes through app.issue_challenge and app.consume_challenge. Direct access is revoked,
    // so a nonce cannot be listed, forged or un-consumed by anything holding an app connection.
    await expect(pool.query("SELECT * FROM wallet_challenges")).rejects.toThrow(
      /permission denied/,
    );
    await expect(pool.query("UPDATE wallet_challenges SET consumed_at = NULL")).rejects.toThrow(
      /permission denied/,
    );
  });
});

withDb("the message being signed", () => {
  it("says it moves no funds, because a wallet shows it verbatim", () => {
    const msg = challengeMessage("n", "0xabc", new Date(0));
    expect(msg).toMatch(/does not move funds/);
    expect(msg).toContain("nonce: n");
  });
});
