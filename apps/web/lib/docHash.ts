import { sha256, stringToBytes, type Hex } from "viem";

/**
 * Documents live off-chain; only their hash is anchored.
 *
 * The chain is a notary, not a file server: it can prove that the file a buyer holds is byte-for-byte
 * the one the supplier committed to, and nothing more. The file still travels by whatever channel the
 * parties already use (email, a data room, a repo), and inspecting its *contents* remains a human job.
 */

/** sha256 of the exact bytes of a file — the same value the buyer recomputes on what they received. */
export async function hashFile(file: File): Promise<Hex> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return sha256(bytes);
}

/** sha256 of a typed reference (a link, a commit id) when there is no file to hash. */
export function hashText(text: string): Hex {
  return sha256(stringToBytes(text));
}

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export const sameHash = (a?: string, b?: string) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
