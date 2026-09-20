import { RFQRegistryAbi, SealedRFQAdapterAbi } from "@sealedrfq/shared";
import { createPublicClient, http } from "viem";
import { chain, contracts } from "./chain";

/**
 * Read side of the RFQ board. Deliberately plain sequential reads: Arc has no Multicall3
 * deployment we rely on, and a hackathon board holds tens of RFQs, not thousands. The indexer in
 * apps/agent takes over when this stops being true.
 */
export const publicClient = createPublicClient({
  chain,
  transport: http(chain.rpcUrls.default.http[0]),
});

export const PHASES = [
  "None",
  "Bidding",
  "Reveal",
  "Award",
  "Awarded",
  "NoAward",
  "Cancelled",
] as const;
export type Phase = (typeof PHASES)[number];

export const DEPOSIT_STATES = ["None", "Held", "Refunded", "RolledOver", "Forfeited"] as const;
export const ENGAGEMENT_STATES = [
  "None",
  "Active",
  "Completed",
  "Rejected",
  "Disputed",
  "Resolved",
  "Abandoned",
] as const;

export type Rfq = Awaited<ReturnType<typeof getRfq>>;

const registry = { address: contracts.RFQRegistry, abi: RFQRegistryAbi } as const;
const adapter = { address: contracts.SealedRFQAdapter, abi: SealedRFQAdapterAbi } as const;

/** bytes32 fields hold short ASCII labels (category, region). */
export function decodeLabel(hex: string): string {
  const bytes = hex.slice(2).replace(/(00)+$/, "");
  if (!bytes) return "";
  const out = bytes.match(/.{2}/g)?.map((b) => String.fromCharCode(Number.parseInt(b, 16))) ?? [];
  return out.join("").replace(/[^\x20-\x7e]/g, "");
}

export async function getRfqCount(): Promise<number> {
  return Number(await publicClient.readContract({ ...registry, functionName: "rfqCount" }));
}

export async function getRfq(id: number) {
  const [rfq, phase, milestones] = await Promise.all([
    publicClient.readContract({ ...registry, functionName: "getRFQ", args: [BigInt(id)] }),
    publicClient.readContract({ ...registry, functionName: "phase", args: [BigInt(id)] }),
    publicClient.readContract({ ...registry, functionName: "milestoneBps", args: [BigInt(id)] }),
  ]);
  return {
    id,
    phase: PHASES[Number(phase)] ?? "None",
    milestoneBps: [...milestones],
    buyer: rfq.buyer,
    status: Number(rfq.status),
    inviteOnly: rfq.inviteOnly,
    requiresQualification: rfq.requiresQualification,
    bidDeadline: Number(rfq.bidDeadline),
    revealDeadline: Number(rfq.revealDeadline),
    awardDeadline: Number(rfq.awardDeadline),
    budget: rfq.budget,
    buyerStake: rfq.buyerStake,
    depositAmount: rfq.depositAmount,
    rubricHash: rfq.rubricHash,
    metadataHash: rfq.metadataHash,
    category: decodeLabel(rfq.category),
    region: decodeLabel(rfq.region),
    retentionBps: rfq.retentionBps,
    deliveryWindow: rfq.deliveryWindow,
    acceptanceWindow: rfq.acceptanceWindow,
    commitCount: rfq.commitCount,
    revealCount: rfq.revealCount,
    winner: rfq.winner,
    awardPrice: rfq.awardPrice,
    evaluationHash: rfq.evaluationHash,
  };
}

/** Newest first. */
export async function listRfqs() {
  const count = await getRfqCount();
  const ids = Array.from({ length: count }, (_, i) => count - i);
  return Promise.all(ids.map(getRfq));
}

export async function getBid(id: number, bidder: `0x${string}`) {
  const bid = await publicClient.readContract({
    ...registry,
    functionName: "getBid",
    args: [BigInt(id), bidder],
  });
  return {
    commitHash: bid.commitHash,
    price: bid.price,
    deliveryDays: bid.deliveryDays,
    revealed: bid.revealed,
    deposit: DEPOSIT_STATES[Number(bid.deposit)] ?? "None",
  };
}

/** Arc's RPC rejects eth_getLogs spans wider than ~5k blocks (measured 2026-09-20). */
const LOG_CHUNK = 5_000n;
/** Arc produces roughly 11 blocks a second, so a day is ~1M blocks: never scan from genesis. */
const BLOCKS_PER_SECOND = 11n;
/** Give up after this many chunks (~200k blocks, about 5 hours of Arc) rather than hammer the RPC. */
const MAX_CHUNKS = 40;

/**
 * Bidders come from events: the contract deliberately keeps no array to loop over (unbounded
 * loops are how escrow contracts get bricked). We walk back from the bidding deadline in chunks
 * and stop as soon as the contract's own `commitCount` is satisfied.
 *
 * This is a stopgap for the read path; apps/agent's indexer keeps the full history in SQLite.
 */
export async function getBidders(id: number, opts?: { until?: number; expected?: number }) {
  const latest = await publicClient.getBlock({ blockTag: "latest" });
  const deployBlock = BigInt(contracts.startBlock ?? 0);
  const endTs = BigInt(opts?.until ?? Number(latest.timestamp));
  // Blocks are ~uniform on Arc, so estimate the block at a timestamp rather than binary-searching.
  const drift = latest.timestamp > endTs ? (latest.timestamp - endTs) * BLOCKS_PER_SECOND : 0n;
  let to = drift >= latest.number ? latest.number : latest.number - drift;
  if (to > latest.number) to = latest.number;

  const seen = new Set<`0x${string}`>();
  for (let i = 0; i < MAX_CHUNKS && to >= deployBlock; i++) {
    const from = to - LOG_CHUNK + 1n > deployBlock ? to - LOG_CHUNK + 1n : deployBlock;
    const logs = await publicClient.getContractEvents({
      ...registry,
      eventName: "BidCommitted",
      args: { rfqId: BigInt(id) },
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      if (log.args.bidder) seen.add(log.args.bidder);
    }
    if (opts?.expected !== undefined && seen.size >= opts.expected) break;
    if (from === deployBlock) break;
    to = from - 1n;
  }
  return [...seen];
}

export async function getEngagement(id: number) {
  const e = await publicClient.readContract({
    ...adapter,
    functionName: "getEngagement",
    args: [BigInt(id)],
  });
  if (Number(e.status) === 0) return null;
  return {
    status: ENGAGEMENT_STATES[Number(e.status)] ?? "None",
    buyer: e.buyer,
    supplier: e.supplier,
    milestoneCount: e.milestoneCount,
    currentMilestone: e.currentMilestone,
    retentionBps: e.retentionBps,
    acceptanceWindow: e.acceptanceWindow,
    price: e.price,
    allocated: e.allocated,
    buyerStake: e.buyerStake,
    performanceStake: e.performanceStake,
    retentionHeld: e.retentionHeld,
    currentJobBudget: e.currentJobBudget,
    currentJobId: e.currentJobId,
    deliveryDeadline: Number(e.deliveryDeadline),
    submittedAt: Number(e.submittedAt),
    deliverable: e.deliverable,
  };
}

export function countdown(unixSeconds: number, now = Date.now() / 1000): string {
  const s = Math.floor(unixSeconds - now);
  if (s <= 0) return "closed";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}
