import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { db, schema } from "../../db/index.js";
import { ChainService } from "../chain/chain.service.js";

/**
 * Deletes uploaded files that no RFQ ever referred to.
 *
 * The upload endpoint has to be open — a buyer posting an RFQ holds no credential here, and gating
 * it would put tender terms back behind an email — so anyone can write to it. A type allowlist and
 * a size cap bound each file; nothing bounds the number of them.
 *
 * What it must *not* do is delete documents when a tender closes. The hash of a terms document is
 * anchored on-chain and the file is what that hash means; an award is also when terms start
 * mattering most, since milestones, retention and a dispute to the arbiter all run afterwards.
 * Legitimate growth is not the problem either: a terms PDF is a few hundred kilobytes, one per RFQ,
 * and storage is content-addressed so the same file uploaded fifty times occupies one entry.
 *
 * So the selection is the opposite one — orphans only. A file that no indexed RFQ, bid or milestone
 * refers to after the grace period was never part of a tender.
 */
const SWEEP_MS = Number(process.env.DOCUMENT_SWEEP_MS ?? 60 * 60 * 1000);
/** A file is uploaded before the RFQ that references it exists, so young files are never touched. */
const GRACE_MS = Number(process.env.DOCUMENT_GRACE_MS ?? 24 * 60 * 60 * 1000);
const DIR = process.env.DOCUMENT_DIR ?? "/data/documents";
/** Refuse to sweep on an index this far behind the chain; see `referenced()`. */
const MAX_LAG_BLOCKS = Number(process.env.DOCUMENT_SWEEP_MAX_LAG ?? 5_000);

@Injectable()
export class DocumentsSweeper implements OnModuleInit {
  private readonly log = new Logger(DocumentsSweeper.name);

  constructor(private readonly chain: ChainService) {}

  onModuleInit() {
    if (process.env.DOCUMENT_SWEEP_ENABLED === "false") return;
    setInterval(() => {
      this.sweep().catch((e) =>
        this.log.warn(`document sweep failed: ${e instanceof Error ? e.message : e}`),
      );
    }, SWEEP_MS).unref();
  }

  /**
   * Every document hash the chain's own records point at.
   *
   * Returns null rather than an empty set when the index cannot be trusted. An index that is empty
   * or far behind makes every file look unreferenced, and a sweep on that basis would delete the
   * very documents it exists to keep — on a fresh volume, all of them. Deleting nothing is always
   * the safe failure here.
   */
  private async referenced(): Promise<Set<string> | null> {
    const rfqs = db.select().from(schema.rfqs).all();
    if (rfqs.length === 0) {
      this.log.log("skipping sweep: no RFQs indexed yet");
      return null;
    }

    const cursor = db.select().from(schema.cursor).all()[0];
    const head = await this.chain.publicClient.getBlockNumber();
    const lag = Number(head) - Number(cursor?.lastBlock ?? 0);
    if (lag > MAX_LAG_BLOCKS) {
      this.log.log(`skipping sweep: index is ${lag} blocks behind`);
      return null;
    }

    const hashes = new Set<string>();
    const add = (v?: string | null) => {
      if (v && /^0x[0-9a-f]{64}$/i.test(v)) hashes.add(v.toLowerCase());
    };

    for (const rfq of rfqs) {
      // The terms document, named inside the metadata the RFQ published.
      try {
        const meta = JSON.parse(rfq.metadataURI) as { terms?: { sha256?: string } };
        add(meta?.terms?.sha256);
      } catch {
        // Metadata may be a bare URI or free text; nothing to collect from it.
      }
    }
    // Quotations and proposals sealed with a bid, and milestone deliverables. Neither is uploaded
    // here today, but both are document hashes and a sweep must not outrun a later feature.
    for (const bid of db.select().from(schema.bids).all()) add(bid.proposalHash);
    for (const m of db.select().from(schema.milestones).all()) add(m.deliverable);

    return hashes;
  }

  async sweep(): Promise<{ deleted: number; kept: number } | null> {
    const keep = await this.referenced();
    if (!keep) return null;

    let files: string[];
    try {
      files = readdirSync(DIR);
    } catch {
      return { deleted: 0, kept: 0 }; // no store on this deployment
    }

    const cutoff = Date.now() - GRACE_MS;
    let deleted = 0;
    let kept = 0;

    for (const name of files) {
      // `<hash>.type` sidecars follow their document rather than being judged separately.
      if (name.endsWith(".type")) continue;
      const path = join(DIR, name);
      try {
        if (keep.has(name.toLowerCase())) {
          kept++;
          continue;
        }
        if (statSync(path).mtimeMs > cutoff) {
          kept++; // uploaded recently; the RFQ that references it may not exist yet
          continue;
        }
        unlinkSync(path);
        try {
          unlinkSync(`${path}.type`);
        } catch {
          // A missing sidecar is not an error.
        }
        deleted++;
      } catch (e) {
        this.log.warn(`could not sweep ${name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (deleted > 0) this.log.log(`swept ${deleted} unreferenced document(s), kept ${kept}`);
    return { deleted, kept };
  }
}
