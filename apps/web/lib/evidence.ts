import { CHAIN_ID } from "./chain";
import testnetEvidence from "./deployments/evidence-5042002.json";

export type Evidence = {
  chainId: number;
  explorer: string;
  steps: { step: string; status: string; tx: string; url: string }[];
};

/**
 * The evidence pack shown on the landing page, and which chain it is actually from.
 *
 * Keyed like `byChain` in `chain.ts`, and for the same reason: a mainnet build must not silently
 * borrow testnet data. Adding a pack here is the deliberate act of claiming a lifecycle ran on that
 * chain — `collect-evidence.sh <chainId>` writes the file and copies it next to this one.
 *
 * Until a full lifecycle has run on mainnet there is no mainnet pack, so the testnet one is shown
 * and labelled as testnet rather than passed off as the live chain's. The distinction is not
 * cosmetic: the transaction hashes only resolve on the explorer they were recorded against, so a
 * mainnet build rendering them through the mainnet explorer produced links that opened nothing.
 */
const PACKS: Record<number, Evidence> = {
  5042002: testnetEvidence as Evidence,
};

export const evidence = PACKS[CHAIN_ID] ?? (testnetEvidence as Evidence);

/** Whether the run shown happened on the chain this build is pointed at. */
export const evidenceIsLive = evidence.chainId === CHAIN_ID;

/** Where this pack's hashes actually resolve — the pack's own explorer, never the active chain's. */
export const evidenceTx = (hash: string) => `${evidence.explorer}/tx/${hash}`;

/** How to name the run's chain in prose, when it is not the one the visitor is transacting on. */
export const evidenceChainName = evidence.chainId === 5042 ? "Arc mainnet" : "Arc testnet";
