import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const file = (process.env.DATABASE_URL ?? "file:./data/sealedrfq.db").replace(/^file:/, "");
mkdirSync(dirname(file), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");

/** Tables are created inline: one service, one file, no migration story worth the ceremony yet. */
sqlite.exec(`
CREATE TABLE IF NOT EXISTS rfqs (
  id INTEGER PRIMARY KEY, buyer TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL, deposit_amount TEXT NOT NULL, buyer_stake TEXT NOT NULL,
  rubric_hash TEXT NOT NULL, metadata_uri TEXT NOT NULL DEFAULT '', requires_proposal INTEGER DEFAULT 0,
  bid_deadline INTEGER NOT NULL, reveal_deadline INTEGER NOT NULL, award_deadline INTEGER NOT NULL,
  winner TEXT, award_price TEXT, evaluation_hash TEXT,
  created_tx TEXT NOT NULL, created_block INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bids (
  rfq_id INTEGER NOT NULL, bidder TEXT NOT NULL, commit_hash TEXT NOT NULL,
  price TEXT, delivery_seconds INTEGER, proposal_hash TEXT, revealed INTEGER NOT NULL DEFAULT 0,
  committed_tx TEXT NOT NULL, revealed_tx TEXT, PRIMARY KEY (rfq_id, bidder));
CREATE INDEX IF NOT EXISTS bids_rfq ON bids (rfq_id);
CREATE TABLE IF NOT EXISTS attestations (
  subject_id TEXT NOT NULL, payload_hash TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
  model TEXT NOT NULL, rfq_id INTEGER, winner TEXT, memo TEXT, tx TEXT NOT NULL, ts INTEGER NOT NULL,
  PRIMARY KEY (subject_id, payload_hash));
CREATE INDEX IF NOT EXISTS attest_rfq ON attestations (rfq_id);
CREATE TABLE IF NOT EXISTS engagements (
  rfq_id INTEGER PRIMARY KEY, supplier TEXT NOT NULL, price TEXT NOT NULL,
  milestone_count INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Active', started_tx TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS milestones (
  rfq_id INTEGER NOT NULL, idx INTEGER NOT NULL, job_id TEXT NOT NULL, job_budget TEXT NOT NULL,
  retention TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'Funded', deliverable TEXT, reason TEXT,
  automatic INTEGER DEFAULT 0, funded_tx TEXT, submitted_tx TEXT, settled_tx TEXT,
  PRIMARY KEY (rfq_id, idx));
CREATE INDEX IF NOT EXISTS ms_rfq ON milestones (rfq_id);
CREATE TABLE IF NOT EXISTS clarifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rfq_id INTEGER NOT NULL, parent_id INTEGER,
  author TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, body_hash TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0, signature TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS clar_rfq ON clarifications (rfq_id);
CREATE TABLE IF NOT EXISTS profiles (
  address TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY, last_block INTEGER NOT NULL DEFAULT 0, updated_at INTEGER);
`);

export const db = drizzle(sqlite, { schema });
export { schema };
