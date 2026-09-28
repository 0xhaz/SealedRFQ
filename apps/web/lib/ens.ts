import { http, createPublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

/**
 * Names for wallet addresses, read from ENS on Ethereum mainnet.
 *
 * ENS does not exist on Arc, so this is a deliberate cross-chain read: the address that bids here
 * is very often an Ethereum wallet that already carries a name, and `0x5975…6984` tells a reader
 * nothing at all. Optional by design — with no endpoint configured every caller gets nothing back
 * and the interface shows addresses exactly as it did before.
 *
 * **A name is a claim, not an identity.** All a reverse record proves is that whoever controls the
 * address also controls that name; it says nothing about who they are, and `some-large-retailer.eth`
 * is registrable by anyone willing to pay for it. So callers show the name *beside* the address
 * rather than instead of it, and nothing here is ever used to decide anything — the contracts
 * compare addresses and will keep comparing addresses.
 */

const RPC = process.env.ENS_RPC_URL?.trim();

const client = RPC
  ? createPublicClient({ chain: mainnet, transport: http(RPC, { timeout: 4_000 }) })
  : null;

/**
 * Addresses already looked up, so a board of twenty rows is not twenty round trips every render.
 *
 * Deliberately unbounded and process-lifetime: the set of addresses this deployment has ever seen
 * is small, and a name changing is not worth a cache invalidation strategy — a stale label beside
 * a correct address misleads nobody.
 */
const cache = new Map<string, string | null>();

/**
 * The name this address claims, or null.
 *
 * Reverse resolution alone is not trustworthy: anyone can point a reverse record at any name they
 * like, so a lookup that stopped there would happily print a name its owner never set. The forward
 * check is what makes it mean something — resolve the name back and keep it only if it returns to
 * the address we started from. This is the step most integrations leave out.
 */
export async function ensNameOf(address: string): Promise<string | null> {
  if (!client) return null;
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  try {
    const name = await client.getEnsName({ address: address as `0x${string}` });
    if (!name) {
      cache.set(key, null);
      return null;
    }
    const forward = await client.getEnsAddress({ name: normalize(name) });
    const ok = forward?.toLowerCase() === key;
    cache.set(key, ok ? name : null);
    return ok ? name : null;
  } catch {
    // An unreachable or rate-limited endpoint must not take a page down with it. Not cached, so a
    // transient failure does not become a permanent absence.
    return null;
  }
}

/** Several at once, for a page that renders a list. Failures are individually null. */
export async function ensNames(addresses: string[]): Promise<Record<string, string | null>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const pairs = await Promise.all(unique.map(async (a) => [a, await ensNameOf(a)] as const));
  return Object.fromEntries(pairs);
}
