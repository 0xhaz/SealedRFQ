import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The indexer's view of the chain. Amounts are 6-decimal USDC stored as text, because SQLite
 * integers top out at 2^63 and money should never round-trip through a float.
 */

export const rfqs = sqliteTable("rfqs", {
  id: integer("id").primaryKey(),
  buyer: text("buyer").notNull(),
  category: text("category").notNull().default(""),
  budget: text("budget").notNull(),
  depositAmount: text("deposit_amount").notNull(),
  buyerStake: text("buyer_stake").notNull(),
  rubricHash: text("rubric_hash").notNull(),
  metadataURI: text("metadata_uri").notNull().default(""),
  requiresProposal: integer("requires_proposal", { mode: "boolean" }).default(false),
  bidDeadline: integer("bid_deadline").notNull(),
  revealDeadline: integer("reveal_deadline").notNull(),
  awardDeadline: integer("award_deadline").notNull(),
  winner: text("winner"),
  awardPrice: text("award_price"),
  evaluationHash: text("evaluation_hash"),
  createdTx: text("created_tx").notNull(),
  createdBlock: integer("created_block").notNull(),
});

export const bids = sqliteTable(
  "bids",
  {
    rfqId: integer("rfq_id").notNull(),
    bidder: text("bidder").notNull(),
    commitHash: text("commit_hash").notNull(),
    price: text("price"),
    deliverySeconds: integer("delivery_seconds"),
    /** sha256 of the proposal document (RFP mode); null for a price-only RFQ. */
    proposalHash: text("proposal_hash"),
    revealed: integer("revealed", { mode: "boolean" }).notNull().default(false),
    committedTx: text("committed_tx").notNull(),
    revealedTx: text("revealed_tx"),
  },
  (t) => [index("bids_rfq").on(t.rfqId)],
);

/** Every anchored AI decision, with the memo we published for it (verification re-hashes this). */
export const attestations = sqliteTable(
  "attestations",
  {
    subjectId: text("subject_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    kind: text("kind").notNull(),
    actor: text("actor").notNull(),
    model: text("model").notNull(),
    rfqId: integer("rfq_id"),
    winner: text("winner"),
    memo: text("memo"),
    tx: text("tx").notNull(),
    ts: integer("ts").notNull(),
  },
  (t) => [index("attest_rfq").on(t.rfqId)],
);

export const engagements = sqliteTable("engagements", {
  rfqId: integer("rfq_id").primaryKey(),
  supplier: text("supplier").notNull(),
  price: text("price").notNull(),
  milestoneCount: integer("milestone_count").notNull(),
  status: text("status").notNull().default("Active"),
  startedTx: text("started_tx").notNull(),
});

export const milestones = sqliteTable(
  "milestones",
  {
    rfqId: integer("rfq_id").notNull(),
    idx: integer("idx").notNull(),
    jobId: text("job_id").notNull(),
    jobBudget: text("job_budget").notNull(),
    retention: text("retention").notNull(),
    state: text("state").notNull().default("Funded"),
    deliverable: text("deliverable"),
    reason: text("reason"),
    automatic: integer("automatic", { mode: "boolean" }).default(false),
    fundedTx: text("funded_tx"),
    submittedTx: text("submitted_tx"),
    settledTx: text("settled_tx"),
  },
  (t) => [index("ms_rfq").on(t.rfqId)],
);

/**
 * The clarification round: questions from suppliers, answers from the buyer.
 *
 * Every row is signed by its author, so the thread can be checked by anyone without this service
 * being believed about who said what. `anonymous` hides the asker from other readers, never from
 * the signature — a buyer must still be able to prove a question came from a real bidder.
 */
/**
 * What a supplier says about itself.
 *
 * Kept rigidly apart from the track record, which is counted from the chain. Nothing here is
 * verified by anyone: a wallet can call itself whatever it likes, and the only thing the signature
 * establishes is that this address published these words — not that they are true. The directory
 * presents the two in separate columns for that reason, and a buyer who needs a company to really
 * hold ISO 9001 still has to ask for the certificate.
 */
export const profiles = sqliteTable("profiles", {
  address: text("address").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull().default(""),
  /** Comma-separated taxonomy keys, matching the RFQ categories. */
  categories: text("categories").notNull().default(""),
  website: text("website").notNull().default(""),
  contact: text("contact").notNull().default(""),
  about: text("about").notNull().default(""),
  signature: text("signature").notNull(),
  ts: integer("ts").notNull(),
});

export const clarifications = sqliteTable(
  "clarifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    rfqId: integer("rfq_id").notNull(),
    /** The question this answers, or null for a question. */
    parentId: integer("parent_id"),
    author: text("author").notNull(),
    role: text("role").notNull(),
    body: text("body").notNull(),
    bodyHash: text("body_hash").notNull(),
    anonymous: integer("anonymous", { mode: "boolean" }).notNull().default(false),
    signature: text("signature").notNull(),
    ts: integer("ts").notNull(),
  },
  (t) => [index("clar_rfq").on(t.rfqId)],
);

/** One row: how far the indexer has read. */
export const cursor = sqliteTable("cursor", {
  id: integer("id").primaryKey().default(1),
  lastBlock: integer("last_block").notNull().default(0),
  updatedAt: integer("updated_at").default(sql`(unixepoch())`),
});
