import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "sweep-")), "test.db")}`;
const DIR = mkdtempSync(join(tmpdir(), "docs-"));
process.env.DOCUMENT_DIR = DIR;

const hash = (n: string) => `0x${n.repeat(64).slice(0, 64)}`;
const REFERENCED = hash("a");
const ORPHAN = hash("b");
const YOUNG = hash("c");

// biome-ignore lint/suspicious/noExplicitAny: modules are imported after env setup
let sweeper: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let db: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let schema: any;

/** Chain head and index cursor agree, so the sweeper considers the index trustworthy. */
const chain = { publicClient: { getBlockNumber: async () => 1_000n } } as never;

beforeAll(async () => {
  ({ db, schema } = await import("../src/db/index.js"));
  const { DocumentsSweeper } = await import("../src/modules/documents/documents.sweeper.js");
  sweeper = new DocumentsSweeper(chain);
});

function writeDoc(name: string, ageMs: number) {
  const p = join(DIR, name);
  writeFileSync(p, "x");
  writeFileSync(`${p}.type`, "application/pdf");
  const when = (Date.now() - ageMs) / 1000;
  utimesSync(p, when, when);
}

function seedRfq(termsHash?: string) {
  db.insert(schema.rfqs)
    .values({
      id: 1,
      buyer: "0x9999999999999999999999999999999999999999",
      category: "SOFTWARE",
      budget: "3000000",
      depositAmount: "250000",
      buyerStake: "150000",
      rubricHash: hash("f"),
      metadataURI: JSON.stringify(termsHash ? { terms: { sha256: termsHash } } : { scope: "x" }),
      bidDeadline: 1,
      revealDeadline: 2,
      awardDeadline: 3,
      createdTx: "0xtx",
      createdBlock: 1,
    })
    .run();
  db.insert(schema.cursor)
    .values({ id: 1, lastBlock: 1_000 })
    .onConflictDoUpdate({
      target: schema.cursor.id,
      set: { lastBlock: 1_000 },
    })
    .run();
}

beforeEach(() => {
  db.delete(schema.rfqs).run();
  db.delete(schema.bids).run();
  db.delete(schema.milestones).run();
  for (const f of readdirSync(DIR)) writeFileSync(join(DIR, f), "x"); // reset mtimes
  mkdirSync(DIR, { recursive: true });
});

describe("document sweeper", () => {
  it("deletes a file no RFQ refers to", async () => {
    seedRfq(REFERENCED);
    writeDoc(ORPHAN, 48 * 3600_000);
    const r = await sweeper.sweep();
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect(readdirSync(DIR)).not.toContain(ORPHAN);
  });

  it("keeps the terms document an RFQ published", async () => {
    seedRfq(REFERENCED);
    writeDoc(REFERENCED, 90 * 24 * 3600_000); // long past any campaign
    await sweeper.sweep();
    // Deleting this is the mistake the sweeper exists to avoid: the hash is anchored on-chain and
    // the file is what it means.
    expect(readdirSync(DIR)).toContain(REFERENCED);
  });

  it("keeps a file uploaded moments ago, before its RFQ exists", async () => {
    seedRfq(REFERENCED);
    writeDoc(YOUNG, 60_000);
    await sweeper.sweep();
    expect(readdirSync(DIR)).toContain(YOUNG);
  });

  it("refuses to sweep when nothing is indexed", async () => {
    // A fresh volume re-indexing makes every file look unreferenced. Deleting all of them is the
    // worst outcome available, so the sweep declines entirely.
    writeDoc(ORPHAN, 48 * 3600_000);
    expect(await sweeper.sweep()).toBeNull();
    expect(readdirSync(DIR)).toContain(ORPHAN);
  });

  it("refuses to sweep when the index is far behind the chain", async () => {
    seedRfq(REFERENCED);
    db.update(schema.cursor).set({ lastBlock: 1 }).run(); // 999 behind, over the 5000 default? no
    const far = { publicClient: { getBlockNumber: async () => 10_000_000n } } as never;
    const { DocumentsSweeper } = await import("../src/modules/documents/documents.sweeper.js");
    writeDoc(ORPHAN, 48 * 3600_000);
    expect(await new DocumentsSweeper(far).sweep()).toBeNull();
    expect(readdirSync(DIR)).toContain(ORPHAN);
  });

  it("keeps a document referenced by a bid rather than an RFQ", async () => {
    seedRfq();
    db.insert(schema.bids)
      .values({
        rfqId: 1,
        bidder: "0x1111111111111111111111111111111111111111",
        commitHash: "0xh",
        proposalHash: ORPHAN,
        revealed: true,
        committedTx: "0xtx",
      })
      .run();
    writeDoc(ORPHAN, 48 * 3600_000);
    await sweeper.sweep();
    expect(readdirSync(DIR)).toContain(ORPHAN);
  });
});
