import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

/**
 * A sealed bid can only be revealed by re-supplying its exact salt. Lose the salt and the bid
 * cannot be revealed, which forfeits the deposit — so every commit is saved locally *and* offered
 * as a downloadable reveal file before the transaction is sent.
 */
export type SavedBid = {
  chainId: number;
  rfqId: number;
  bidder: `0x${string}`;
  /** 6-decimal USDC units, as a string (JSON has no bigint). */
  price: string;
  deliveryDays: number;
  salt: `0x${string}`;
  commitHash: `0x${string}`;
  savedAt: number;
};

const key = (chainId: number, rfqId: number, bidder: string) =>
  `sealedrfq.bid.${chainId}.${rfqId}.${bidder.toLowerCase()}`;

export function randomSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Same preimage as RFQRegistry.computeCommitment: binds contract, chain, RFQ and bidder. */
export function computeCommitment(args: {
  registry: `0x${string}`;
  chainId: number;
  rfqId: number;
  bidder: `0x${string}`;
  price: bigint;
  deliveryDays: number;
  salt: `0x${string}`;
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, uint256, uint256, address, uint128, uint32, bytes32"),
      [
        args.registry,
        BigInt(args.chainId),
        BigInt(args.rfqId),
        args.bidder,
        args.price,
        args.deliveryDays,
        args.salt,
      ],
    ),
  );
}

export function saveBid(bid: SavedBid) {
  try {
    localStorage.setItem(key(bid.chainId, bid.rfqId, bid.bidder), JSON.stringify(bid));
  } catch {
    // Private windows and blocked site data are fine: the downloaded file is the real backup.
  }
}

export function loadBid(chainId: number, rfqId: number, bidder: string): SavedBid | null {
  try {
    const raw = localStorage.getItem(key(chainId, rfqId, bidder));
    return raw ? (JSON.parse(raw) as SavedBid) : null;
  } catch {
    return null;
  }
}

export function downloadBid(bid: SavedBid) {
  const blob = new Blob([JSON.stringify(bid, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sealedrfq-bid-${bid.rfqId}-${bid.bidder.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
