"use client";

import { agent } from "@/lib/agent";
import { chain, contracts } from "@/lib/chain";
import { countdown } from "@/lib/rfq";
import { type WorkRow, deriveWork } from "@/lib/work";
import { RFQRegistryAbi, SealedRFQAdapterAbi } from "@sealedrfq/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";

export type BoardRfq = {
  id: number;
  phase: string;
  inviteOnly: boolean;
  buyer: string;
  winner: string;
  bidDeadline: number;
  revealDeadline: number;
  awardDeadline: number;
};

/**
 * What the connected wallet has to do, and by when.
 *
 * An invitation names a wallet address, and a wallet address is not a contact method: nothing can
 * email `0x0C01…`, so an invited supplier who never opens the site never learns they were invited
 * and the buyer's list quietly does nothing. Collecting email addresses would mean accounts, which
 * this project does not have and does not want — so discovery is pulled rather than pushed. Connect
 * a wallet and the work addressed to it is listed.
 *
 * That does not remove the need to tell someone a tender exists; it removes the need to tell them
 * anything more than once. The deadline that keeps catching people is the reveal window, because a
 * sealed bid that is never revealed loses both the tender and the deposit, so it is listed first
 * and in the strongest terms this panel has.
 */
export function YourWork({ rfqs }: { rfqs: BoardRfq[] }) {
  const { address, isConnected, chainId } = useAccount();
  const me = address?.toLowerCase();

  const open = rfqs.filter((r) => r.phase === "Bidding" || r.phase === "Reveal");

  // Only invite-only RFQs still taking bids need an invitation check.
  const inviteChecks = open.filter((r) => r.inviteOnly && r.phase === "Bidding");
  const bidChecks = open;
  // An awarded RFQ has an engagement, and an engagement has the deadlines that actually cost money
  // once the tender is over. Read them for the awarded ones only; the rest have nothing to carry.
  const engChecks = rfqs.filter((r) => r.phase === "Awarded");

  const { data } = useReadContracts({
    contracts: [
      ...inviteChecks.map((r) => ({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "isInvited" as const,
        args: [BigInt(r.id), address as `0x${string}`],
      })),
      ...bidChecks.map((r) => ({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "getBid" as const,
        args: [BigInt(r.id), address as `0x${string}`],
      })),
      ...engChecks.map((r) => ({
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "getEngagement" as const,
        args: [BigInt(r.id)],
      })),
    ],
    query: { enabled: Boolean(address) && chainId === chain.id, refetchInterval: 30_000 },
  });

  if (!isConnected || chainId !== chain.id) return null;

  const ZERO_HASH = `0x${"0".repeat(64)}`;
  const bidAt = (id: number) =>
    data?.[inviteChecks.length + bidChecks.findIndex((b) => b.id === id)]?.result as
      | { commitHash?: string; revealed?: boolean }
      | undefined;

  const ENGAGEMENT_STATES = [
    "None",
    "Active",
    "Completed",
    "Rejected",
    "Disputed",
    "Resolved",
    "Abandoned",
  ];
  const engagementAt = (id: number) => {
    const i = engChecks.findIndex((e) => e.id === id);
    if (i < 0) return undefined;
    const raw = data?.[inviteChecks.length + bidChecks.length + i]?.result as
      | {
          supplier: string;
          status: number;
          submittedAt: bigint;
          deliveryDeadline: bigint;
          acceptanceWindow: number;
          currentMilestone: number;
          milestoneCount: number;
        }
      | undefined;
    if (!raw) return undefined;
    return {
      supplier: raw.supplier,
      status: ENGAGEMENT_STATES[Number(raw.status)] ?? "None",
      submittedAt: Number(raw.submittedAt),
      deliveryDeadline: Number(raw.deliveryDeadline),
      acceptanceWindow: Number(raw.acceptanceWindow),
      currentMilestone: Number(raw.currentMilestone),
      milestoneCount: Number(raw.milestoneCount),
    };
  };

  const rows: WorkRow[] = rfqs.map((r) => {
    const invited = inviteChecks.findIndex((x) => x.id === r.id);
    const bid = bidAt(r.id);
    return {
      ...r,
      invited: invited >= 0 ? data?.[invited]?.result === true : undefined,
      hasBid: Boolean(bid?.commitHash && bid.commitHash !== ZERO_HASH),
      revealed: Boolean(bid?.revealed),
      engagement: engagementAt(r.id),
    };
  });

  /*
   * Questions waiting on this buyer. Fetched rather than read from the chain, because a
   * clarification is not an on-chain object — it is a signed message the agent holds. An agent
   * that cannot be reached leaves this empty and the rest of the panel still works.
   */
  const mine = open.filter((r) => r.buyer.toLowerCase() === me).map((r) => r.id);
  const [unanswered, setUnanswered] = useState<Record<string, number>>({});
  const mineKey = mine.join(",");
  useEffect(() => {
    if (!address || !mineKey) return;
    let live = true;
    agent.openQuestions(address, mineKey.split(",").map(Number)).then((r) => {
      if (live && "unanswered" in r) setUnanswered(r.unanswered);
    });
    return () => {
      live = false;
    };
  }, [address, mineKey]);

  const items = deriveWork(rows, address, undefined, unanswered);
  if (items.length === 0) return null;

  const describe = (it: (typeof items)[number]) => {
    switch (it.kind) {
      case "reveal":
        return `Reveal your bid on RFQ № ${it.rfqId} within ${countdown(it.deadline)} — an unrevealed bid loses the tender and forfeits its deposit.`;
      case "award":
        return `Award RFQ № ${it.rfqId} within ${countdown(it.deadline)}, or it closes with no award.`;
      case "deliver":
        return `Deliver milestone ${it.milestone} of ${it.milestoneCount} on RFQ № ${it.rfqId} within ${countdown(it.deadline)} — after that the contract will not accept it.`;
      case "lapsed":
        return `The delivery window for milestone ${it.milestone} of ${it.milestoneCount} on RFQ № ${it.rfqId} has closed. Nothing can be submitted now; talk to the buyer before the escrow is settled.`;
      case "accept":
        return `Review the delivery on RFQ № ${it.rfqId} within ${countdown(it.deadline)}, or it is accepted automatically and the supplier is paid.`;
      case "answer":
        return `${it.questions} unanswered question${it.questions === 1 ? "" : "s"} on RFQ № ${it.rfqId}. Asking closes with bidding in ${countdown(it.deadline)}, and you cannot answer after that — every bidder sees the answer, so one reply serves all of them.`;
      default:
        return `You are invited to bid on RFQ № ${it.rfqId}. Bidding closes in ${countdown(it.deadline)}.`;
    }
  };
  const hrefFor = (it: (typeof items)[number]) =>
    it.kind === "invited" || it.kind === "reveal" ? `/rfqs/${it.rfqId}/bid` : `/rfqs/${it.rfqId}`;

  return (
    <div className="panel">
      <div className="head">
        Needs you
        <span className="hint">addressed to this wallet</span>
      </div>
      {items.map((it) => (
        <div key={it.key} className={it.urgent ? "work-row urgent" : "work-row"}>
          <span>{describe(it)}</span>
          <Link className="btn-outline" href={hrefFor(it)}>
            Open →
          </Link>
        </div>
      ))}
    </div>
  );
}
