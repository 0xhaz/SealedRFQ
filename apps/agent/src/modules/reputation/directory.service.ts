import { BadRequestException, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { type Hex, recoverMessageAddress } from "viem";
import { db, schema } from "../../db/index.js";
import { ReputationService, type TrackRecord } from "./reputation.service.js";

/**
 * The supplier directory.
 *
 * A buyer who has to type a counterparty's wallet address from memory is not going to run a tender
 * here, so a list has to exist. The difficulty is that a directory is exactly where a procurement
 * system starts quietly lending its own credibility to claims it has not checked — "verified
 * supplier" badges are the oldest trick in B2B marketplaces, and the thing a buyer most wants to
 * know, whether a company is real and competent, is the thing least amenable to proof from a chain.
 *
 * So entries are kept in three layers and never blended into a score:
 *
 *  - **Counted.** Bids placed, tenders won, engagements completed, milestones rejected — every one
 *    derived from events this agent indexed, and re-countable by anyone from the same chain.
 *  - **Claimed.** A company name, a country, a website. Signed by the wallet, so it is attributable
 *    and cannot be put in someone else's mouth; verified by nobody, including us.
 *  - **Attested.** Qualification recorded on-chain by a qualifier. Absent here until the qualifier
 *    is wired up, and reported as absent rather than as a pass.
 *
 * Listing is driven by the chain, not by registration: an address appears because it bid on
 * something, not because it filled in a form. That way the directory cannot be stuffed with
 * companies that have never done anything, which is the failure mode of every self-registration
 * registry — and it means a profile decorates a record that already exists rather than creating one.
 */

export type DirectoryEntry = {
  address: string;
  /** Null when the supplier has never published one. The record still stands on its own. */
  profile: {
    name: string;
    country: string;
    categories: string[];
    website: string;
    contact: string;
    about: string;
    /** Proves this address published these words. Proves nothing about whether they are true. */
    signature: string;
    ts: number;
  } | null;
  record: TrackRecord;
};

/** What a supplier signs to publish a profile. Pinned here so both sides build the same string. */
export function profileMessage(input: {
  address: string;
  name: string;
  country: string;
  categories: string;
  website: string;
  contact: string;
  about: string;
  ts: number;
}): string {
  return [
    "SealedRFQ supplier profile",
    `address:${input.address.toLowerCase()}`,
    `name:${input.name}`,
    `country:${input.country}`,
    `categories:${input.categories}`,
    `website:${input.website}`,
    `contact:${input.contact}`,
    `ts:${input.ts}`,
    "",
    input.about,
  ].join("\n");
}

const MAX = { name: 120, country: 60, categories: 200, website: 200, contact: 200, about: 2_000 };

@Injectable()
export class DirectoryService {
  constructor(private readonly reputation: ReputationService) {}

  /**
   * Everyone the chain has seen act as a supplier.
   *
   * Ordered by engagements completed, then tenders won. That is a ranking, and a ranking is a
   * judgement — but it is one a reader can recompute from the same two numbers, which is the line
   * this project draws. A weighted score built from figures only we hold would not be.
   */
  list(): DirectoryEntry[] {
    const bidders = db
      .select({ address: schema.bids.bidder })
      .from(schema.bids)
      .groupBy(schema.bids.bidder)
      .all();

    return bidders
      .map((b) => this.entry(b.address))
      .sort(
        (a, z) =>
          z.record.asSupplier.engagementsCompleted - a.record.asSupplier.engagementsCompleted ||
          z.record.asSupplier.awards - a.record.asSupplier.awards ||
          z.record.asSupplier.bidsPlaced - a.record.asSupplier.bidsPlaced,
      );
  }

  entry(address: string): DirectoryEntry {
    const who = address.toLowerCase();
    const row = db
      .select()
      .from(schema.profiles)
      .where(sql`lower(${schema.profiles.address}) = ${who}`)
      .get();

    return {
      address,
      profile: row
        ? {
            name: row.name,
            country: row.country,
            categories: row.categories ? row.categories.split(",").filter(Boolean) : [],
            website: row.website,
            contact: row.contact,
            about: row.about,
            signature: row.signature,
            ts: row.ts,
          }
        : null,
      record: this.reputation.record(address),
    };
  }

  /**
   * Publish or replace a profile.
   *
   * Authorised by signature rather than by an account, like everything else here. A wallet may only
   * write its own: the address is recovered from the signature and compared, so nobody can publish
   * a profile in a competitor's name — which is the one attack a directory of unverified claims
   * genuinely has to stop.
   */
  async publish(input: {
    address: string;
    name: string;
    country?: string;
    categories?: string;
    website?: string;
    contact?: string;
    about?: string;
    ts: number;
    signature: Hex;
  }): Promise<DirectoryEntry> {
    const fields = {
      address: input.address,
      name: (input.name ?? "").trim(),
      country: (input.country ?? "").trim(),
      categories: (input.categories ?? "").trim(),
      website: (input.website ?? "").trim(),
      contact: (input.contact ?? "").trim(),
      about: (input.about ?? "").trim(),
      ts: input.ts,
    };

    if (!fields.name) throw new BadRequestException("A name is required.");
    // Spelled out rather than looped over the object, so the compiler checks that every capped key
    // is a string field that actually exists — `ts` is a number and does not belong here.
    const capped: [keyof typeof MAX, string][] = [
      ["name", fields.name],
      ["country", fields.country],
      ["categories", fields.categories],
      ["website", fields.website],
      ["contact", fields.contact],
      ["about", fields.about],
    ];
    for (const [key, value] of capped) {
      if (value.length > MAX[key]) {
        throw new BadRequestException(`${key} is limited to ${MAX[key]} characters.`);
      }
    }

    // A timestamp far from now would let an old signature be replayed to restore a profile its
    // owner has since replaced.
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - input.ts) > 600) {
      throw new BadRequestException("That signature is too old; sign again.");
    }

    let signer: string;
    try {
      signer = await recoverMessageAddress({
        message: profileMessage(fields),
        signature: input.signature,
      });
    } catch {
      throw new BadRequestException("That signature could not be read.");
    }
    if (signer.toLowerCase() !== input.address.toLowerCase()) {
      throw new BadRequestException("A profile can only be published by the wallet it describes.");
    }

    db.insert(schema.profiles)
      .values({ ...fields, address: input.address.toLowerCase(), signature: input.signature })
      .onConflictDoUpdate({
        target: schema.profiles.address,
        set: { ...fields, address: input.address.toLowerCase(), signature: input.signature },
      })
      .run();

    return this.entry(input.address);
  }
}
