/**
 * Addresses and id encoding for the Concordium registries. Deliberately free of
 * `@concordium/web-sdk`: the web app serves the agent card and so imports this, and the SDK brings
 * wasm that has no business in a server component bundle. Anything needing the SDK lives in
 * `cis8004.ts`, which scripts import directly.
 *
 * Found by querying both networks rather than by reading the docs, which publish mainnet addresses
 * only and whose testnet pages 404. The documented indexes hold unrelated contracts on testnet, so
 * following the documentation leads to the conclusion that the registries are mainnet-only. They
 * are not; the addresses are simply not published.
 */
export const REGISTRY = {
  mainnet: { index: 10082n, subindex: 0n },
  testnet: { index: 13042n, subindex: 0n },
} as const;

/**
 * CIS-8 external key registry. Testnet carries two instances; 12940 is the later one and
 * additionally exposes `migrate`, so 12939 looks like its predecessor.
 */
export const KEY_REGISTRY = {
  mainnet: { index: 10081n, subindex: 0n },
  testnet: { index: 12940n, subindex: 0n },
} as const;

export type Network = keyof typeof REGISTRY;

/**
 * Agent token ids are u64 little-endian, carried as a CIS-2 token id. Nothing states the byte
 * order; it was established by reading agent 0 back off testnet as `0000000000000000` and then
 * confirmed independently, because decoding the reference card's base58 token address only yields
 * its stated agent id under this order.
 */
export function agentTokenId(id: bigint | number): string {
  const n = BigInt(id);
  if (n < 0n || n > 0xffff_ffff_ffff_ffffn) throw new RangeError(`agent id out of range: ${n}`);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf.toString("hex");
}

/** The inverse, for reading an id back out of an event or a return value. */
export function agentIdFromTokenId(tokenId: string): bigint {
  const bytes = Buffer.from(tokenId, "hex");
  if (bytes.length !== 8) throw new Error(`expected an 8-byte token id, got ${bytes.length}`);
  return bytes.readBigUInt64LE(0);
}
