import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { eq, inArray, sql } from "drizzle-orm";
import { type Hex, recoverMessageAddress, sha256, stringToBytes } from "viem";
import { db, schema } from "../../db/index.js";

/**
 * The clarification round.
 *
 * Real tenders have one: a supplier asks what the spec means, and the buyer answers. The rule that
 * matters is not that questions exist but that **answers go to every bidder**. A private answer
 * hands one supplier something the others do not have, which is precisely the advantage sealing
 * bids exists to remove — so questions may be asked anonymously here and answers never are.
 *
 * Nothing is trusted to this service. Each entry is stored with the signature that produced it, so
 * a reader recovers the author themselves rather than believing the server. What that proves is
 * bounded and worth stating: a signature binds an address to those exact words, so nobody can be
 * shown saying something they did not sign — but anyone can sign as a fresh address, so a question
 * from an unknown wallet is only as meaningful as any anonymous one. Anonymity hides the asker from
 * readers, never from the signature.
 *
 * Asking closes when bidding closes. A question answered after bids are sealed could only inform
 * the answer's timing, and an answer arriving mid-reveal would reach bidders who can no longer act
 * on it while looking like it might have.
 */
export type Entry = {
  id: number;
  rfqId: number;
  parentId: number | null;
  /** Null when the asker chose anonymity: hidden from readers, still bound by the signature. */
  author: string | null;
  role: "supplier" | "buyer";
  body: string;
  bodyHash: string;
  signature: string;
  ts: number;
};

/** What the author signs. Pinned here because both sides must build the identical string. */
export function clarificationMessage(input: {
  rfqId: number;
  parentId: number | null;
  body: string;
  ts: number;
}): string {
  return [
    "SealedRFQ clarification",
    `rfq:${input.rfqId}`,
    `parent:${input.parentId ?? "none"}`,
    `ts:${input.ts}`,
    "",
    input.body,
  ].join("\n");
}

const MAX_BODY = 4_000;

@Injectable()
export class ClarificationsService {
  async add(input: {
    rfqId: number;
    parentId?: number | null;
    body: string;
    ts: number;
    signature: Hex;
    anonymous?: boolean;
  }): Promise<Entry> {
    const body = input.body.trim();
    if (!body) throw new BadRequestException("The message is empty.");
    if (body.length > MAX_BODY) {
      throw new BadRequestException(`Messages are limited to ${MAX_BODY} characters.`);
    }

    const rfq = db.select().from(schema.rfqs).where(eq(schema.rfqs.id, input.rfqId)).get();
    if (!rfq) throw new BadRequestException(`RFQ ${input.rfqId} is not indexed here.`);

    // A timestamp far from now would let a signature be replayed or pre-dated into a closed round.
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - input.ts) > 600) {
      throw new BadRequestException("That signature is too old; sign again.");
    }

    const message = clarificationMessage({
      rfqId: input.rfqId,
      parentId: input.parentId ?? null,
      body,
      ts: input.ts,
    });

    const author = await this.signerOf(message, input.signature);
    const isBuyer = author.toLowerCase() === rfq.buyer.toLowerCase();

    if (input.parentId != null) {
      // Only the buyer answers, and only a real question.
      if (!isBuyer) throw new ForbiddenException("Only the buyer answers questions on their RFQ.");
      const parent = db
        .select()
        .from(schema.clarifications)
        .where(eq(schema.clarifications.id, input.parentId))
        .get();
      if (!parent || parent.rfqId !== input.rfqId) {
        throw new BadRequestException("No such question on this RFQ.");
      }
    } else {
      if (isBuyer) throw new ForbiddenException("A buyer cannot ask questions on their own RFQ.");
      if (now > rfq.bidDeadline) {
        throw new BadRequestException("Bidding has closed, so the clarification round is over.");
      }
    }

    const row = {
      rfqId: input.rfqId,
      parentId: input.parentId ?? null,
      author,
      role: isBuyer ? "buyer" : "supplier",
      body,
      bodyHash: sha256(stringToBytes(body)),
      // An answer is never anonymous: bidders must know the buyer said it.
      anonymous: isBuyer ? false : Boolean(input.anonymous),
      signature: input.signature,
      ts: input.ts,
    };
    db.insert(schema.clarifications).values(row).run();

    const saved = db
      .select()
      .from(schema.clarifications)
      .where(sql`${schema.clarifications.rfqId} = ${input.rfqId}`)
      .all()
      .at(-1);
    return this.present(saved ?? row);
  }

  /** Newest last, so a thread reads top to bottom. */
  thread(rfqId: number): Entry[] {
    return db
      .select()
      .from(schema.clarifications)
      .where(eq(schema.clarifications.rfqId, rfqId))
      .all()
      .sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0))
      .map((r) => this.present(r));
  }

  /**
   * Questions on a buyer's own tenders that nobody has answered yet.
   *
   * There is no push notification anywhere in this project and deliberately so: a wallet address
   * is not a contact method, and collecting an email would mean accounts. What can be fixed is the
   * *pull* — a buyer who opens the board should be told a supplier is waiting on them, rather than
   * having to visit each tender to find out.
   *
   * Counted per RFQ rather than listed, because the panel that uses this only needs to say how
   * many and where. A question is unanswered when no reply points at it.
   */
  unansweredByRfq(rfqIds: number[]): Record<number, number> {
    if (rfqIds.length === 0) return {};
    const rows = db
      .select()
      .from(schema.clarifications)
      .where(inArray(schema.clarifications.rfqId, rfqIds))
      .all();

    const answered = new Set(
      rows.filter((r) => r.parentId !== null).map((r) => r.parentId as number),
    );
    const out: Record<number, number> = {};
    for (const r of rows) {
      if (r.parentId !== null || r.role !== "supplier") continue;
      if (answered.has(r.id)) continue;
      out[r.rfqId] = (out[r.rfqId] ?? 0) + 1;
    }
    return out;
  }

  /**
   * Who signed this.
   *
   * Any address may ask. Requiring a sealed bid first would invert the round — a supplier asks what
   * the spec means in order to decide whether to bid at all, and gating that behind a deposit makes
   * the question useless. The signature still binds an asker to their words, and because questions
   * are public the buyer simply declines to answer anything frivolous.
   */
  private async signerOf(message: string, signature: Hex): Promise<string> {
    try {
      return await recoverMessageAddress({ message, signature });
    } catch {
      throw new BadRequestException("That signature could not be read.");
    }
  }

  private present(r: {
    id?: number | null;
    rfqId: number;
    parentId: number | null;
    author: string;
    role: string;
    body: string;
    bodyHash: string;
    anonymous: boolean | null;
    signature: string;
    ts: number;
  }): Entry {
    return {
      id: r.id ?? 0,
      rfqId: r.rfqId,
      parentId: r.parentId,
      author: r.anonymous ? null : r.author,
      role: r.role === "buyer" ? "buyer" : "supplier",
      body: r.body,
      bodyHash: r.bodyHash,
      signature: r.signature,
      ts: r.ts,
    };
  }
}
