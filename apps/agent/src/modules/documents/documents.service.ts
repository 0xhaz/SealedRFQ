import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";

/**
 * Tender documents, stored by the hash of their own contents.
 *
 * A terms PDF had to reach suppliers by email, which quietly meant an *open* tender did not work:
 * anyone could bid, but only the people the buyer happened to write to could read the terms they
 * would be bidding against. Hosting the file closes that.
 *
 * This service is deliberately not trusted. The filename *is* the sha256 of the bytes, that hash is
 * published in the RFQ metadata, and the metadata's own hash is fixed on-chain when the RFQ opens —
 * so an operator who swapped a file would have to break sha256 to do it undetectably. The web app
 * re-hashes what it downloads and says so. Storage here is a convenience; the chain is the record.
 */
const MAX_BYTES = Number(process.env.DOCUMENT_MAX_BYTES ?? 10 * 1024 * 1024);
const DIR = process.env.DOCUMENT_DIR ?? "/data/documents";

/** Formats people actually send tender packs as. Anything executable stays out. */
const ALLOWED: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
};

@Injectable()
export class DocumentsService {
  private readonly log = new Logger(DocumentsService.name);

  constructor() {
    try {
      mkdirSync(DIR, { recursive: true });
    } catch (e) {
      // A deployment without a writable volume still serves everything else; uploads fail loudly.
      this.log.warn(`document store ${DIR} is not writable: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Returns the sha256 the caller should publish. Identical files collapse onto one entry. */
  store(bytes: Buffer, contentType: string): { sha256: string; bytes: number } {
    const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED[type]) {
      throw new BadRequestException(
        `${type || "unknown type"} is not accepted. Send a PDF, Word, Excel, CSV, Markdown or text file.`,
      );
    }
    if (bytes.length === 0) throw new BadRequestException("The file is empty.");
    if (bytes.length > MAX_BYTES) {
      throw new BadRequestException(
        `The file is ${Math.round(bytes.length / 1024)}kB; the limit is ${Math.round(MAX_BYTES / 1024)}kB.`,
      );
    }

    const sha256 = `0x${createHash("sha256").update(bytes).digest("hex")}`;
    writeFileSync(join(DIR, sha256), bytes);
    writeFileSync(join(DIR, `${sha256}.type`), type);
    this.log.log(`stored ${sha256} (${bytes.length} bytes, ${type})`);
    return { sha256, bytes: bytes.length };
  }

  read(sha256: string): { bytes: Buffer; contentType: string } {
    // The id is the only thing joined to a path, so it must be exactly a hash and nothing else.
    if (!/^0x[0-9a-f]{64}$/i.test(sha256)) throw new BadRequestException("Not a document id.");
    const path = join(DIR, sha256.toLowerCase());
    try {
      statSync(path);
    } catch {
      throw new NotFoundException("No document with that hash is stored here.");
    }
    let contentType = "application/octet-stream";
    try {
      contentType = readFileSync(`${path}.type`, "utf8").trim() || contentType;
    } catch {
      // A missing sidecar is not worth failing the download over.
    }
    return { bytes: readFileSync(path), contentType };
  }
}
