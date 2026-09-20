/**
 * Arc USDC amount helpers.
 *
 * App code uses 6-decimal ERC-20 units (bigint) everywhere. Native USDC on Arc (gas, wallet
 * balances, `eth_getBalance`) is 18 decimals: the same balance, scaled by 1e12. Mixing the two is
 * the #1 Arc integration bug, so conversions exist only here.
 */

export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;
export const NATIVE_DECIMALS = 18;
export const USDC_ONE = 1_000_000n;
export const NATIVE_SCALE = 1_000_000_000_000n; // 1e12 native wei per 6-decimal unit

/** 6-decimal ERC-20 units (what the contracts and app store). */
export type UsdcUnits = bigint;

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

/** Parse a user-entered decimal string ("3", "0.25", "1.000001") into 6-decimal units. */
export function parseUsdc(input: string): UsdcUnits {
  const s = input.trim().replace(/,/g, "");
  if (!AMOUNT_RE.test(s)) throw new Error(`Invalid USDC amount: "${input}" (max 6 decimals)`);
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * USDC_ONE + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
}

/** Format 6-decimal units for display. Trims trailing zeros but keeps at least `minFraction`. */
export function formatUsdc(units: UsdcUnits, minFraction = 2): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / USDC_ONE;
  let frac = (abs % USDC_ONE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < minFraction) frac = frac.padEnd(minFraction, "0");
  const wholeStr = whole.toLocaleString("en-US");
  return `${neg ? "-" : ""}${wholeStr}${frac ? `.${frac}` : ""}`;
}

/** Native (18d) wei -> 6-decimal units. Truncates sub-unit dust, which the ERC-20 view can't hold. */
export function nativeToUsdc(wei: bigint): UsdcUnits {
  return wei / NATIVE_SCALE;
}

/** 6-decimal units -> native (18d) wei. */
export function usdcToNative(units: UsdcUnits): bigint {
  return units * NATIVE_SCALE;
}

/** Basis-point share of an amount, rounded down (matches Solidity integer math). */
export function bpsOf(units: UsdcUnits, bps: number | bigint): UsdcUnits {
  return (units * BigInt(bps)) / 10_000n;
}
