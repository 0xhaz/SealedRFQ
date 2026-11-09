import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.DOCUMENT_DIR = mkdtempSync(join(tmpdir(), "docs-"));
process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("hex");

const { DocumentError, getDocument, putDocument } = await import("../src/documents.js");
const { pool } = await import("../src/index.js");

const reachable = await pool
  .query("SELECT 1")
  .then(() => true)
  .catch(() => false);
if (!reachable) console.warn("\n  skipping document tests: no database at localhost:5433\n");
const withDb = reachable ? describe : describe.skip;

const BUYER = "11111111-1111-1111-1111-111111111111";
const SUP_A = "22222222-2222-2222-2222-222222222222";
const SUP_B = "33333333-3333-3333-3333-333333333333";
const ORG_BUYER = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000002";
const ORG_B = "aaaaaaaa-0000-0000-0000-000000000003";
const RFI = "bbbbbbbb-0000-0000-0000-000000000001";

const admin = new pg.Pool({
  connectionString:
    process.env.ADMIN_DATABASE_URL ?? "postgres://sealedrfq:localdev@localhost:5433/sealedrfq",
});

beforeEach(async () => {
  if (!reachable) return;
  await admin.query(`
    TRUNCATE request_responses, request_invitations, documents, requests, memberships,
             organizations, users RESTART IDENTITY CASCADE;
    INSERT INTO users (id, wallet) VALUES ('${BUYER}','0xbuyer'), ('${SUP_A}','0xa'), ('${SUP_B}','0xb');
    INSERT INTO organizations (id, name) VALUES
      ('${ORG_BUYER}','Northwind'), ('${ORG_A}','Supplier A'), ('${ORG_B}','Supplier B');
    INSERT INTO memberships (org_id, user_id, role) VALUES
      ('${ORG_BUYER}','${BUYER}','owner'), ('${ORG_A}','${SUP_A}','owner'), ('${ORG_B}','${SUP_B}','owner');
    INSERT INTO requests (id, org_id, type, status, title) VALUES
      ('${RFI}','${ORG_BUYER}','RFI','open','Route optimisation');
    INSERT INTO request_invitations (request_id, org_id) VALUES ('${RFI}','${ORG_A}'), ('${RFI}','${ORG_B}');
  `);
});

afterAll(async () => {
  await admin.end();
  await pool.end();
});

const SECRET = Buffer.from("our confidential pricing model");

const upload = () =>
  putDocument(SUP_A, { orgId: ORG_A, requestId: RFI, filename: "a-pricing.pdf", bytes: SECRET });

withDb("reading a private document", () => {
  it("returns the exact bytes to the organization that uploaded it", async () => {
    const doc = await upload();
    const got = await getDocument(SUP_A, doc.id);
    expect(got.bytes.equals(SECRET)).toBe(true);
    expect(got.filename).toBe("a-pricing.pdf");
  });

  it("reaches the buyer who asked for it", async () => {
    const doc = await upload();
    await expect(getDocument(BUYER, doc.id)).resolves.toMatchObject({ filename: "a-pricing.pdf" });
  });

  it("is refused to a rival supplier holding the document id", async () => {
    // Supplier B is invited to the same request, so it is not a stranger. It still must not read
    // another bidder's attachment.
    const doc = await upload();
    await expect(getDocument(SUP_B, doc.id)).rejects.toThrow(/not yours to read/);
  });

  it("is refused to a caller with no session at all", async () => {
    const doc = await upload();
    await expect(getDocument("00000000-0000-0000-0000-000000000000", doc.id)).rejects.toThrow(
      DocumentError,
    );
  });
});

withDb("what is actually on disk", () => {
  it("is not the plaintext", async () => {
    await upload();
    const files = walk(process.env.DOCUMENT_DIR as string);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const raw = readFileSync(f);
      expect(raw.includes(SECRET)).toBe(false);
      // iv(12) + tag(16) + at least a byte of ciphertext.
      expect(raw.length).toBeGreaterThan(28);
    }
  });

  it("is not named after the content, so holding the file does not locate it", async () => {
    const doc = await upload();
    const sha = doc.sha256;
    const files = walk(process.env.DOCUMENT_DIR as string);
    expect(files.some((f) => f.includes(sha))).toBe(false);
  });

  it("is readable only by its owner on the file system", async () => {
    await upload();
    for (const f of walk(process.env.DOCUMENT_DIR as string)) {
      expect(statSync(f).mode & 0o077).toBe(0);
    }
  });

  it("refuses to hand back a file that was altered", async () => {
    const doc = await upload();
    // Located by its storage key rather than by taking the newest file on disk: documents from
    // earlier tests are still there, and tampering with the wrong one would make this pass without
    // testing anything.
    const { rows } = await admin.query<{ storage_key: string }>(
      "SELECT storage_key FROM documents WHERE id = $1",
      [doc.id],
    );
    const k = rows[0]?.storage_key as string;
    const file = walk(process.env.DOCUMENT_DIR as string).find((f) => f.endsWith(k)) as string;
    expect(file).toBeTruthy();

    const raw = readFileSync(file);
    raw[raw.length - 1] ^= 0xff; // flip a bit in the ciphertext
    writeFileSync(file, raw);
    await expect(getDocument(SUP_A, doc.id)).rejects.toThrow(/integrity check/);
  });
});

withDb("the encryption key", () => {
  it("is required, and a short one is refused rather than padded", async () => {
    const saved = process.env.DOCUMENT_ENCRYPTION_KEY;
    process.env.DOCUMENT_ENCRYPTION_KEY = "";
    await expect(upload()).rejects.toThrow(/DOCUMENT_ENCRYPTION_KEY is not set/);
    process.env.DOCUMENT_ENCRYPTION_KEY = "abcd";
    await expect(upload()).rejects.toThrow(/32 bytes of hex/);
    process.env.DOCUMENT_ENCRYPTION_KEY = saved;
  });

  it("leaves no orphaned bytes when the row cannot be written", async () => {
    const before = walk(process.env.DOCUMENT_DIR as string).length;
    // ORG_B is not an organization this user belongs to, so RLS refuses the insert.
    await expect(
      putDocument(SUP_A, { orgId: ORG_B, filename: "forged.pdf", bytes: SECRET }),
    ).rejects.toThrow();
    expect(walk(process.env.DOCUMENT_DIR as string).length).toBe(before);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
