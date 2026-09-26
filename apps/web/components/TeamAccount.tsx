"use client";

import { chain } from "@/lib/chain";
import { useBytecode, useReadContract } from "wagmi";

/**
 * Says whether a party is one person's wallet or a team account, and on what terms.
 *
 * Procurement is not a one-person job. A buyer is a company — requisition, approval, finance —
 * and a company acting through a single private key has its whole purchasing authority resting on
 * one person not losing a laptop. A supplier deciding whether to spend a day preparing a bid
 * learns something real from the difference, so it is published rather than left to be guessed.
 *
 * Nothing here manages the account. Safe already does that far better than a procurement app
 * should attempt, and the screen that removes an owner is the one screen where being wrong locks a
 * company out of its own money. This reads, labels and links out.
 */

/** `getThreshold()` and `getOwners()` — Safe's, and shared by most multisig implementations. */
const SAFE_ABI = [
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
] as const;

export function useIsContract(address?: string) {
  const { data, isLoading } = useBytecode({
    address: address as `0x${string}` | undefined,
    chainId: chain.id,
    query: { enabled: Boolean(address) },
  });
  // Absent or "0x" both mean an ordinary wallet; anything longer is code.
  return { isContract: Boolean(data && data !== "0x"), isLoading };
}

export function TeamAccount({ address, label = "Team account" }: { address: string; label?: string }) {
  const { isContract } = useIsContract(address);

  const { data: threshold } = useReadContract({
    address: address as `0x${string}`,
    abi: SAFE_ABI,
    functionName: "getThreshold",
    chainId: chain.id,
    query: { enabled: isContract },
  });
  const { data: owners } = useReadContract({
    address: address as `0x${string}`,
    abi: SAFE_ABI,
    functionName: "getOwners",
    chainId: chain.id,
    query: { enabled: isContract },
  });

  if (!isContract) return null;

  // A contract that does not answer both calls is some other kind of account. Saying "team
  // account" without the terms is still true and still useful; inventing a threshold is not.
  const known = threshold !== undefined && owners !== undefined;

  return (
    <span className="team-account" title={known ? undefined : "A contract account of an unknown kind"}>
      {label}
      {known && (
        <b>
          {String(threshold)}-of-{owners.length}
        </b>
      )}
    </span>
  );
}
