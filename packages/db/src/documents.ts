import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { withTenant } from "./index.js";

/**
 * Private document storage: encrypted at rest, and reachable only through a membership check.
 *
 * Two things differ from the legacy public store, and both are deliberate.
 *
 * It is not content-addressed. V1 serves documents at their sha256, which is fine for a tender pack
 * everyone is meant to read and wrong for a confidential one: anyone holding a copy of the file can
 * compute the hash and fetch it, so possession of the content becomes permission to read it. The
 * storage key here is random, and knowing it is still not authorisation, because the row is behind
 * row-level security either way.
 *
 * The bytes are encrypted with AES-256-GCM. The point is not the file system, which is local: it is
 * that a database dump, a stray backup or a misconfigured bucket yields ciphertext, and GCM's tag
 * means a modified file fails to decrypt rather than returning something altered.
 */
const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "DOCUMENT_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32",
    );
  }
  const k = Buffer.from(raw, "hex");
  // A short key here would be a silent downgrade, so it is refused rather than padded.
  if (k.length !== 32) throw new Error("DOCUMENT_ENCRYPTION_KEY must be 32 bytes of hex (64 chars)");
  return k;
}

function root(): string {
  return resolve(process.env.DOCUMENT_DIR ?? "./data/documents");
}

export class DocumentError extends Error {}

export type StoredDocument = { id: string; sha256: string; filename: string };

/**
 * Store a file against an organization, optionally attached to a request.
 *
 * The sha256 is recorded but is not the address: it is there so a reader can verify they received
 * the bytes that were stored, which is the property the legacy store got right.
 */
export async function putDocument(
  userId: string,
  input: { orgId: string; requestId?: string | null; filename: string; bytes: Buffer },
): Promise<StoredDocument> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  // Random, not derived from the content: a derived key would let anyone holding the file guess it.
  const storageKey = randomBytes(32).toString("hex");

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  const path = pathFor(storageKey);
  await mkdir(dirname(path), { recursive: true });
  // iv | tag | ciphertext, so one file is self-contained and nothing else has to be kept in step.
  await writeFile(path, Buffer.concat([iv, tag, ciphertext]), { mode: 0o600 });

  try {
    return await withTenant(userId, async (q) => {
      const { rows } = await q.query<StoredDocument>(
        `INSERT INTO documents (org_id, request_id, sha256, filename, storage_key)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, sha256, filename`,
        [input.orgId, input.requestId ?? null, sha256, input.filename, storageKey],
      );
      const row = rows[0];
      if (!row) throw new DocumentError("could not record the document");
      return row;
    });
  } catch (e) {
    // The row is the thing that makes a file reachable. If it did not land, the bytes are garbage
    // nobody can find, so they are removed rather than left to accumulate unreferenced.
    await unlink(path).catch(() => {});
    throw e;
  }
}

/**
 * Read a document, if this user is entitled to it.
 *
 * Entitlement is decided by the database, not here: the row is invisible unless the user's
 * organization owns it or owns the request it is attached to. A document id is therefore not a
 * capability, and guessing one gains nothing.
 */
export async function getDocument(
  userId: string,
  documentId: string,
): Promise<{ filename: string; sha256: string; bytes: Buffer }> {
  const row = await withTenant(userId, async (q) => {
    const { rows } = await q.query<{ storage_key: string; filename: string; sha256: string }>(
      "SELECT storage_key, filename, sha256 FROM documents WHERE id = $1",
      [documentId],
    );
    return rows[0] ?? null;
  });
  if (!row) throw new DocumentError("no such document, or it is not yours to read");

  const blob = await readFile(pathFor(row.storage_key));
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  let bytes: Buffer;
  try {
    bytes = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  } catch {
    // GCM failing here means the file was altered or truncated. Saying so beats handing back
    // plausible-looking bytes.
    throw new DocumentError("the stored file failed its integrity check and was not returned");
  }
  return { filename: row.filename, sha256: row.sha256, bytes };
}

/** Two levels of fan-out, so a directory listing never becomes the index of everything stored. */
function pathFor(storageKey: string): string {
  return join(root(), storageKey.slice(0, 2), storageKey.slice(2, 4), storageKey);
}
