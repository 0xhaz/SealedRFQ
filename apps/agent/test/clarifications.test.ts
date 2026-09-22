import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "clar-")), "test.db")}`;

// Anvil's first two development keys: public, worthless, and deterministic.
const buyer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const supplier = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

// biome-ignore lint/suspicious/noExplicitAny: imported after env setup
let svc: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let db: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let schema: any;
// biome-ignore lint/suspicious/noExplicitAny: same
let clarificationMessage: any;

const now = () => Math.floor(Date.now() / 1000);
const future = () => now() + 3600;

beforeAll(async () => {
  ({ db, schema } = await import("../src/db/index.js"));
  const m = await import("../src/modules/clarifications/clarifications.service.js");
  clarificationMessage = m.clarificationMessage;
  svc = new m.ClarificationsService();
});

function seedRfq(bidDeadline = future()) {
  db.insert(schema.rfqs)
    .values({
      id: 1,
      buyer: buyer.address,
      category: "SOFTWARE",
      budget: "3000000",
      depositAmount: "250000",
      buyerStake: "150000",
      rubricHash: "0xr",
      metadataURI: "{}",
      bidDeadline,
      revealDeadline: bidDeadline + 600,
      awardDeadline: bidDeadline + 1200,
      createdTx: "0xtx",
      createdBlock: 1,
    })
    .run();
}

async function sign(who: typeof buyer, body: string, parentId: number | null = null) {
  const ts = now();
  const signature = await who.signMessage({
    message: clarificationMessage({ rfqId: 1, parentId, body, ts }),
  });
  return { body, ts, signature, parentId };
}

beforeEach(() => {
  db.delete(schema.clarifications).run();
  db.delete(schema.rfqs).run();
});

describe("asking", () => {
  it("accepts a signed question from any wallet", async () => {
    seedRfq();
    const e = await svc.add({
      rfqId: 1,
      ...(await sign(supplier, "Is 90-day delivery acceptable?")),
    });
    expect(e.role).toBe("supplier");
    expect(e.author?.toLowerCase()).toBe(supplier.address.toLowerCase());
  });

  it("hides an anonymous asker from readers but still records the signature", async () => {
    seedRfq();
    const e = await svc.add({
      rfqId: 1,
      ...(await sign(supplier, "Does the warranty cover parts?")),
      anonymous: true,
    });
    // Asking can reveal strategy, so anonymity is allowed — but the signature stays, so the buyer
    // can satisfy themselves a real wallet asked.
    expect(e.author).toBeNull();
    expect(e.signature).toMatch(/^0x/);
  });

  it("refuses a question once bidding has closed", async () => {
    seedRfq(now() - 60);
    await expect(svc.add({ rfqId: 1, ...(await sign(supplier, "Too late?")) })).rejects.toThrow(
      /closed/i,
    );
  });

  it("cannot put words in a known bidder's mouth", async () => {
    // Recovery always yields some address, so editing the body does not fail — it recovers a
    // different, meaningless one. The property that matters is that the original signer is never
    // shown as the author of something they did not sign.
    seedRfq();
    const s = await sign(supplier, "Original question");
    const forged = await svc.add({ rfqId: 1, ...s, body: "Edited question" });
    expect(forged.author?.toLowerCase()).not.toBe(supplier.address.toLowerCase());
  });

  it("refuses a stale signature, so one cannot be replayed later", async () => {
    seedRfq();
    const s = await sign(supplier, "Replay me");
    await expect(svc.add({ rfqId: 1, ...s, ts: s.ts - 7200 })).rejects.toThrow(/too old/i);
  });

  it("will not let a buyer ask questions on their own RFQ", async () => {
    seedRfq();
    await expect(
      svc.add({ rfqId: 1, ...(await sign(buyer, "Planting a question")) }),
    ).rejects.toThrow(/cannot ask/i);
  });
});

describe("answering", () => {
  it("lets the buyer answer, and never anonymously", async () => {
    seedRfq();
    const q = await svc.add({ rfqId: 1, ...(await sign(supplier, "Question?")) });
    const a = await svc.add({
      rfqId: 1,
      ...(await sign(buyer, "Answer.", q.id)),
      anonymous: true,
    });
    // Bidders must know the buyer said it, so the request for anonymity is ignored.
    expect(a.role).toBe("buyer");
    expect(a.author?.toLowerCase()).toBe(buyer.address.toLowerCase());
  });

  it("refuses an answer from anyone else", async () => {
    seedRfq();
    const q = await svc.add({ rfqId: 1, ...(await sign(supplier, "Question?")) });
    await expect(
      svc.add({ rfqId: 1, ...(await sign(supplier, "I'll answer my own", q.id)) }),
    ).rejects.toThrow(/only the buyer/i);
  });

  it("lets the buyer answer after bidding closes, unlike asking", async () => {
    // A question already asked deserves an answer even if the deadline passed mid-thread.
    seedRfq();
    const q = await svc.add({ rfqId: 1, ...(await sign(supplier, "Question?")) });
    db.update(schema.rfqs)
      .set({ bidDeadline: now() - 60 })
      .run();
    const a = await svc.add({ rfqId: 1, ...(await sign(buyer, "Still answering.", q.id)) });
    expect(a.parentId).toBe(q.id);
  });
});

describe("the thread", () => {
  it("reads in order and shows every entry to everyone", async () => {
    seedRfq();
    const q = await svc.add({ rfqId: 1, ...(await sign(supplier, "First")) });
    await svc.add({ rfqId: 1, ...(await sign(buyer, "Reply", q.id)) });
    const t = svc.thread(1);
    expect(t.map((e: { body: string }) => e.body)).toEqual(["First", "Reply"]);
    // There is no per-reader filtering: an answer one bidder could read and others could not is
    // the thing this design exists to prevent.
    expect(t.every((e: { body: string }) => e.body.length > 0)).toBe(true);
  });
});
