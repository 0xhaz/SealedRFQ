/**
 * Loads the document a buyer published with an RFQ.
 *
 * `metadataURI` is a string on-chain and buyers use it two ways: small RFQs inline the JSON
 * directly, while anything realistic stores it off-chain and puts a URI there. Only the inline form
 * used to work, so every RFQ following the conventional pattern was unscoreable — the rubric could
 * not be read, so it could not be checked against `rubricHash`, so the evaluator refused to score.
 *
 * Fetching it safely matters more than fetching it. The URI is chosen by whoever created the RFQ,
 * which makes this a server-side request forgery vector: a hostile RFQ could point the agent at a
 * cloud metadata endpoint or something else on its private network and use the memo as an oracle
 * for what came back. So the host must resolve to a public address, only https is accepted, and
 * redirects are refused outright — a redirect is the easy way to land somewhere private after the
 * check has passed.
 *
 * What this does NOT defend against is DNS rebinding: the name is resolved to validate it and
 * resolved again by fetch, and the answer can change in between. Closing that needs a custom
 * connect path pinned to the validated IP. It is written down here rather than glossed over.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIMEOUT_MS = Number(process.env.METADATA_TIMEOUT_MS ?? 5_000);
const MAX_BYTES = Number(process.env.METADATA_MAX_BYTES ?? 256 * 1024);
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs/";

/**
 * Ranges that must never be reachable: loopback, link-local (which covers cloud metadata at
 * 169.254.169.254), RFC1918, carrier NAT, and the IPv6 equivalents.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    // IPv4-mapped (::ffff:10.0.0.1) smuggles a v4 address through a v6 literal.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    const head = Number.parseInt(lower.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
  }
  return true; // unparseable is not safe
}

/** Turns a stored metadataURI into an https URL, or null when it is not fetchable. */
export function toFetchableUrl(uri: string): URL | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith("ipfs://")) {
    return new URL(`${IPFS_GATEWAY}${trimmed.slice("ipfs://".length).replace(/^ipfs\//, "")}`);
  }
  try {
    const url = new URL(trimmed);
    // http is refused rather than upgraded: the content is hash-checked, but the request itself
    // would still be an unauthenticated call to an arbitrary host in the clear.
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`refusing to fetch a private address: ${host}`);
    return;
  }
  const { address } = await lookup(host);
  if (isPrivateAddress(address)) {
    throw new Error(`${host} resolves to a private address (${address})`);
  }
}

export async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES)
    throw new Error(`metadata is ${declared} bytes, over the ${MAX_BYTES} cap`);
  // Content-length can lie or be absent, so the body is capped as it arrives too.
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`metadata exceeded the ${MAX_BYTES} byte cap`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Cache keyed by URI. Safe because the caller only trusts what matches `rubricHash`: a document
 * that hashes correctly is the one the buyer committed to, so it cannot meaningfully change.
 */
const cache = new Map<string, unknown>();

/** Returns the parsed metadata document, or null if it is neither inline JSON nor fetchable. */
export async function loadMetadata(uri: string): Promise<unknown | null> {
  if (!uri) return null;

  const trimmed = uri.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null; // inline but not JSON: free text
    }
  }

  if (cache.has(trimmed)) return cache.get(trimmed);

  const url = toFetchableUrl(trimmed);
  if (!url) return null;
  await assertPublicHost(url);

  const res = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`metadata fetch failed: HTTP ${res.status}`);

  const parsed = JSON.parse(await readCapped(res));
  cache.set(trimmed, parsed);
  return parsed;
}

/** Test seam: the cache would otherwise leak between cases. */
export function clearMetadataCache() {
  cache.clear();
}
