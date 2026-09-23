import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "sealedrfq-dir-")), "test.db")}`;

// Deterministic anvil keys: the directory only cares that a signature recovers to its own address.
const ACME = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const RIVAL = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

// biome-ignore lint/suspicious/noExplicitAny: imported after env setup
let directory: any;
// biome-ignore lint/suspicious/noExplicitAny: imported after env setup
let db: any;
// biome-ignore lint/suspicious/noExplicitAny: imported after env setup
let schema: any;
// biome-ignore lint/suspicious/noExplicitAny: the signed-message builder
let profileMessage: any;

beforeAll(async () => {
  ({ db, schema } = await import("../src/db/index.js"));
  const mod = await import("../src/modules/reputation/directory.service.js");
  const { ReputationService } = await import("../src/modules/reputation/reputation.service.js");
  profileMessage = mod.profileMessage;
  directory = new mod.DirectoryService(new ReputationService());
});

beforeEach(() => {
  db.delete(schema.profiles).run();
  db.delete(schema.bids).run();
});

/** Sign a profile the way the browser would. */
async function signed(
  account: typeof ACME,
  over: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const fields = {
    address: account.address,
    name: "Acme Instruments",
    country: "MY",
    categories: "HARDWARE",
    website: "https://acme.example",
    contact: "sales@acme.example",
    about: "Barcode hardware since 1998.",
    ts: Math.floor(Date.now() / 1000),
    ...over,
  };
  const signature = await account.signMessage({
    message: profileMessage(fields as Parameters<typeof profileMessage>[0]),
  });
  return { ...fields, signature };
}

describe("supplier directory", () => {
  it("builds the exact string the browser signs", () => {
    // The other half of this assertion lives in apps/web/test/profileMessage.test.ts. The two
    // packages cannot import each other, so both pin the same literal; drift fails a test here
    // rather than rejecting every real profile as an impersonation attempt.
    expect(
      profileMessage({
        address: "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        name: "Acme Instruments",
        country: "MY",
        categories: "HARDWARE",
        website: "https://acme.example",
        contact: "sales@acme.example",
        about: "Barcode hardware since 1998.",
        ts: 1_790_000_000,
      }),
    ).toBe(
      [
        "SealedRFQ supplier profile",
        "address:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "name:Acme Instruments",
        "country:MY",
        "categories:HARDWARE",
        "website:https://acme.example",
        "contact:sales@acme.example",
        "ts:1790000000",
        "",
        "Barcode hardware since 1998.",
      ].join("\n"),
    );
  });

  it("publishes a profile the wallet signed for itself", async () => {
    const entry = await directory.publish(await signed(ACME));
    expect(entry.profile.name).toBe("Acme Instruments");
    expect(entry.profile.categories).toEqual(["HARDWARE"]);
  });

  it("refuses a profile published in someone else's name", async () => {
    // The one attack a directory of unverified claims actually has to stop. Anyone may say anything
    // about themselves; nobody may say it about a competitor.
    const body = await signed(RIVAL, { address: ACME.address, name: "Acme Instruments" });
    await expect(directory.publish(body)).rejects.toThrow(/only be published by the wallet/i);
  });

  it("refuses a stale signature, so an old profile cannot be replayed over a new one", async () => {
    const body = await signed(ACME, { ts: Math.floor(Date.now() / 1000) - 7200 });
    await expect(directory.publish(body)).rejects.toThrow(/too old/i);
  });

  it("replaces rather than duplicates when the same wallet publishes again", async () => {
    await directory.publish(await signed(ACME));
    await directory.publish(await signed(ACME, { name: "Acme Instruments Sdn Bhd" }));
    const rows = db.select().from(schema.profiles).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Acme Instruments Sdn Bhd");
  });

  it("requires a name, since an entry with nothing in it helps nobody", async () => {
    await expect(directory.publish(await signed(ACME, { name: "   " }))).rejects.toThrow(
      /name is required/i,
    );
  });

  it("serves a record for an address with no profile at all", () => {
    // The counted half stands on its own: a supplier who never filled in a form still has a history.
    const entry = directory.entry(RIVAL.address);
    expect(entry.profile).toBeNull();
    expect(entry.record.asSupplier.bidsPlaced).toBe(0);
  });

  it("lists whoever the chain saw bid, not whoever registered", async () => {
    // A profile alone must not put anyone in the directory, or it fills up with companies that have
    // never done anything — the failure mode of every self-registration registry.
    await directory.publish(await signed(ACME));
    expect(directory.list()).toHaveLength(0);

    db.insert(schema.bids)
      .values({
        rfqId: 1,
        bidder: ACME.address,
        commitHash: "0xhash",
        revealed: true,
        committedTx: "0xtx",
      })
      .run();

    const listed = directory.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].profile.name).toBe("Acme Instruments");
  });
});
