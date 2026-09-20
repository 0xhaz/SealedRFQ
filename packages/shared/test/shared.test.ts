import { describe, expect, it } from "vitest";
import {
  type DecisionMemo,
  MEMO_SCHEMA,
  bpsOf,
  canonicalJson,
  chainById,
  formatUsdc,
  hashMemo,
  nativeToUsdc,
  parseUsdc,
  usdcToNative,
  verifyMemo,
} from "../src/index.js";

describe("usdc", () => {
  it("parses decimal strings into 6-decimal units", () => {
    expect(parseUsdc("3")).toBe(3_000_000n);
    expect(parseUsdc("0.25")).toBe(250_000n);
    expect(parseUsdc("1.000001")).toBe(1_000_001n);
    expect(parseUsdc("1,234.5")).toBe(1_234_500_000n);
  });

  it("rejects more than 6 decimals and junk", () => {
    expect(() => parseUsdc("0.0000001")).toThrow();
    expect(() => parseUsdc("-1")).toThrow();
    expect(() => parseUsdc("abc")).toThrow();
  });

  it("formats units", () => {
    expect(formatUsdc(3_000_000n)).toBe("3.00");
    expect(formatUsdc(250_000n)).toBe("0.25");
    expect(formatUsdc(1_000_001n)).toBe("1.000001");
    expect(formatUsdc(1_234_500_000n)).toBe("1,234.50");
  });

  it("converts between the native 18d and ERC-20 6d views", () => {
    expect(usdcToNative(1_000_000n)).toBe(10n ** 18n);
    expect(nativeToUsdc(5n * 10n ** 18n)).toBe(5_000_000n);
    expect(nativeToUsdc(999_999_999_999n)).toBe(0n); // sub-unit dust truncates
  });

  it("computes basis points like Solidity", () => {
    expect(bpsOf(3_000_000n, 500)).toBe(150_000n); // 5% buyer stake on 3.00
    expect(bpsOf(1_000_000n, 1_000)).toBe(100_000n); // 10% retention
  });
});

describe("chains", () => {
  it("pins Arc hosts", () => {
    expect(chainById(5042).rpcUrls.default.http[0]).toBe("https://rpc.mainnet.arc.io");
    expect(chainById(5042002).blockExplorers.default.url).toBe("https://explorer.testnet.arc.io");
    expect(() => chainById(1)).toThrow();
  });
});

const HASH_A = `0x${"a".repeat(64)}` as const;
const HASH_B = `0x${"b".repeat(64)}` as const;
const SUPPLIER = "0x1111111111111111111111111111111111111111";

const memo: DecisionMemo = {
  schema: MEMO_SCHEMA,
  rfqId: "1",
  kind: "BID_EVALUATION",
  actor: "0x2222222222222222222222222222222222222222",
  model: "mock-rubric-v1",
  ts: 1_789_835_952,
  inputsHash: HASH_A,
  rubricHash: HASH_B,
  scores: [
    {
      bidder: SUPPLIER,
      price: "2800000",
      deliveryDays: 21,
      criteria: { price: 80, delivery: 70, quality: 90 },
      totalBps: 8_050,
      redFlags: [],
    },
  ],
  rationale: "Lowest price within budget; delivery inside the requested window.",
  decision: { outcome: "RECOMMEND", bidder: SUPPLIER, amount: "2800000" },
};

describe("memo", () => {
  it("canonicalises independent of key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    const reversed = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reversed)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reversed(x)]),
            )
          : v;
    const reordered = reversed(memo) as DecisionMemo;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(memo));
    expect(hashMemo(reordered)).toBe(hashMemo(memo));
  });

  it("verifies against an anchor and detects tampering", () => {
    const anchor = hashMemo(memo);
    expect(verifyMemo(memo, anchor).ok).toBe(true);
    const tampered = { ...memo, rationale: `${memo.rationale} ` };
    expect(verifyMemo(tampered, anchor).ok).toBe(false);
  });

  it("rejects memos that break the schema", () => {
    expect(() => hashMemo({ ...memo, rubricHash: "0x1234" as `0x${string}` })).toThrow();
    expect(() => hashMemo({ ...memo, schema: "other" as typeof MEMO_SCHEMA })).toThrow();
  });
});
