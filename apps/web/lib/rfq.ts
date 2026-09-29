import { AgenticCommerceAbi, RFQRegistryAbi, SealedRFQAdapterAbi } from "@sealedrfq/shared";
import { http, createPublicClient, fallback } from "viem";
import { chain, contracts, rpcUrls } from "./chain";

/**
 * Read side of the RFQ board. Deliberately plain sequential reads: Arc has no Multicall3
 * deployment we rely on, and a hackathon board holds tens of RFQs, not thousands. The indexer in
 * apps/agent takes over when this stops being true.
 */
export const publicClient = createPublicClient({
  chain,
  // One endpoint is a single point of failure on Arc; try each in turn.
  transport: fallback(rpcUrls.map((url) => http(url))),
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
const escrow = { address: contracts.AgenticCommerce, abi: AgenticCommerceAbi } as const;

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
    /** Sealed (0) or open (1). Decides which bid path the form offers and what the audit claims. */
    bidMode: Number(rfq.bidMode) === 1 ? ("open" as const) : ("sealed" as const),
    milestoneBps: [...milestones],
    buyer: rfq.buyer,
    status: Number(rfq.status),
    inviteOnly: rfq.inviteOnly,
    requiresQualification: rfq.requiresQualification,
    requiresProposal: rfq.requiresProposal,
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
    deliverySeconds: bid.deliverySeconds,
    proposalHash: bid.proposalHash,
    revealed: bid.revealed,
    deposit: DEPOSIT_STATES[Number(bid.deposit)] ?? "None",
  };
}

/** Arc's RPC rejects eth_getLogs spans wider than ~5k blocks (measured 2026-09-20). */
const LOG_CHUNK = 5_000n;
/** Arc produces roughly 11 blocks a second, so a day is ~1M blocks: never scan from genesis. */
/** Give up after this many chunks (~200k blocks, about 5 hours of Arc) rather than hammer the RPC. */
const MAX_CHUNKS = 40;

/**
 * Bidders come from events: the contract deliberately keeps no array to loop over (unbounded
 * loops are how escrow contracts get bricked). We walk back from the bidding deadline in chunks
 * and stop as soon as the contract's own `commitCount` is satisfied.
 *
 * This is a stopgap for the read path; apps/agent's indexer keeps the full history in SQLite.
 */
export async function getBidders(id: number, opts?: { expected?: number }) {
  const latest = await publicClient.getBlock({ blockTag: "latest" });
  const deployBlock = BigInt(contracts.startBlock ?? 0);
  // Start at the head and walk back. This used to estimate the block at the bidding deadline from
  // an assumed block rate, which was wrong by about six times — Arc produces roughly 1.8 blocks a
  // second, not 11 — so the scan began *behind* the commits it was looking for and, only ever
  // walking backwards, could never reach them. Every bid on a live RFQ silently vanished from the
  // page while the contract's own counter still said three.
  //
  // An estimate cannot fail safe here: too far back and the events are unreachable. The head
  // always can, and `expected` still stops the scan as soon as the contract's commitCount is
  // satisfied, which on a recent RFQ is the first chunk.
  let to = latest.number;

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

/**
 * The platform's cut of each milestone, in basis points, as the escrow contract holds it.
 *
 * Read rather than assumed. It is zero on this deployment and can stay zero forever once the admin
 * role is renounced — but until then it is a live figure, and a supplier quoting against a stale
 * zero would be quoting for less than they thought.
 */
export async function getPlatformFeeBps(): Promise<number> {
  try {
    const bps = await publicClient.readContract({
      ...escrow,
      functionName: "platformFeeBP",
    });
    return Number(bps);
  } catch {
    // A fee that cannot be read is shown as none rather than guessed at. The contract is the
    // authority either way; this only decides what the page says.
    return 0;
  }
}

export async function getEngagement(id: number) {
  const e = await publicClient.readContract({
    ...adapter,
    functionName: "getEngagement",
    args: [BigInt(id)],
  });
  if (Number(e.status) === 0) return null;

  /**
   * The furthest a delivery deadline can be pushed, computed exactly as `extendDelivery` does.
   *
   * The milestone's escrow job has its own expiry, and the extended deadline must still leave room
   * for transit and one acceptance window inside it — otherwise the supplier would be given time
   * to deliver into a job that expires before they could be paid. Offering a date the contract
   * will reject is worse than offering none: the buyer signs, pays gas and gets `BadExtension`.
   */
  let latestExtension = 0;
  try {
    const job = await publicClient.readContract({
      ...escrow,
      functionName: "getJob",
      args: [e.currentJobId],
    });
    latestExtension =
      Number(job.expiredAt) - Number(e.transitWindow) - Number(e.acceptanceWindow);
  } catch {
    // No current job (between milestones, or already finished) — there is nothing to extend.
  }

  return {
    latestExtension,
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
    receivedAt: Number(e.receivedAt),
    transitWindow: Number(e.transitWindow),
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
