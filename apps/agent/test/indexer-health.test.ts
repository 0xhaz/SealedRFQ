import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "idx-")), "test.db")}`;

// biome-ignore lint/suspicious/noExplicitAny: modules are imported after env setup
let IndexerService: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let db: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let schema: any;

const START = 1_000;

/** A chain whose head is well past the deployment, so a pass has work to do. */
const chainAt = (head: bigint, startBlock = START) => {
  const stub = { address: "0x0000000000000000000000000000000000000001", abi: [] } as const;
  return {
    chainId: 5042,
    deployment: { chainId: 5042, startBlock },
    registry: stub,
    adapter: stub,
    attestationLog: stub,
    publicClient: {
      getBlockNumber: async () => head,
      getLogs: async () => [],
    },
  } as never;
};

beforeAll(async () => {
  ({ db, schema } = await import("../src/db/index.js"));
  ({ IndexerService } = await import("../src/modules/indexer/indexer.service.js"));
});

beforeEach(() => {
  db.delete(schema.cursor).run();
  // Set, not deleted: assigning undefined to a process.env key stores the string "undefined".
  process.env.INDEXER_ENABLED = "true";
});

/**
 * The indexer sat at block zero on a live deployment with tenders on-chain, and `/health` reported
 * `ok: true` throughout. These cover the three ways that happens, because the cost of the failure
 * is not a stale page — it is a procurement board that silently shows no tenders.
 */
describe("indexer health", () => {
  it("says so when indexing is switched off, rather than looking like a fresh start", () => {
    process.env.INDEXER_ENABLED = "false";
    const s = new IndexerService(chainAt(2_000n)).status();
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/switched off/);
    // Not a failure: an API-only replica is legitimate, so it must not fail a healthcheck.
    expect(s.ok).toBe(true);
  });

  it("reports an unindexed cursor as null, not as block 0", () => {
    const s = new IndexerService(chainAt(2_000n)).status();
    expect(s.indexedBlock).toBeNull();
    expect(s.lag).toBeNull();
  });

  it("is healthy and caught up once a pass lands", async () => {
    const indexer = new IndexerService(chainAt(2_000n));
    await indexer.tick();
    const s = indexer.status();
    expect(s.indexedBlock).toBe(2_000);
    expect(s.lag).toBe(0);
    expect(s.caughtUp).toBe(true);
    expect(s.ok).toBe(true);
  });

  it("fails immediately when the deployment does not belong to the RPC", async () => {
    // Start block past the head: the scan loop simply would not execute, which is why this was
    // invisible — tick returned successfully while indexing nothing at all.
    const indexer = new IndexerService(chainAt(2_000n, 9_000_000));
    await expect(indexer.tick()).rejects.toThrow(/does not belong to this RPC/);
    // The loop records the error; status must not wait out the stale window to admit it, because
    // a wrong chain id fails the same way on every retry.
    indexer.lastError = "start block 9000000 is ahead of chain head 2000";
    const s = indexer.status();
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/has not completed a pass/);
  });
});
