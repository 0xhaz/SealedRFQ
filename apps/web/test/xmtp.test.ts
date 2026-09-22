import { describe, expect, it } from "vitest";
import {
  type KeyStore,
  bytesToHex,
  counterpartyOf,
  dbKeyFor,
  explainXmtpError,
  hexToBytes,
  xmtpEnv,
} from "../lib/xmtp";

const BUYER = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const SUPPLIER = "0xBbBbBBbBbbBBbBbBbbBBbB4ac6BbBBbbBBbbBBbB";
const STRANGER = "0xCcccCCCcCCCcCCCcCCcccccCCCCCcCCCCCCcCcCc";
const ZERO = `0x${"0".repeat(40)}`;

function store(initial: Record<string, string> = {}): KeyStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("counterpartyOf", () => {
  it("points the buyer at the supplier and the supplier at the buyer", () => {
    expect(counterpartyOf({ me: BUYER, buyer: BUYER, supplier: SUPPLIER })).toEqual({
      role: "buyer",
      counterparty: SUPPLIER.toLowerCase(),
    });
    expect(counterpartyOf({ me: SUPPLIER, buyer: BUYER, supplier: SUPPLIER })).toEqual({
      role: "supplier",
      counterparty: BUYER.toLowerCase(),
    });
  });

  it("matches regardless of address casing", () => {
    // Wallets hand back checksummed addresses and the chain hands back lowercase ones; a thread
    // that silently fails to open because of capitalisation would be very hard to diagnose.
    expect(counterpartyOf({ me: BUYER.toLowerCase(), buyer: BUYER, supplier: SUPPLIER })?.role).toBe(
      "buyer",
    );
    expect(
      counterpartyOf({ me: SUPPLIER.toUpperCase().replace("0X", "0x"), buyer: BUYER, supplier: SUPPLIER })
        ?.role,
    ).toBe("supplier");
  });

  it("shows nothing to anyone else", () => {
    expect(counterpartyOf({ me: STRANGER, buyer: BUYER, supplier: SUPPLIER })).toBeNull();
    expect(counterpartyOf({ me: undefined, buyer: BUYER, supplier: SUPPLIER })).toBeNull();
  });

  it("shows nothing before an award", () => {
    expect(counterpartyOf({ me: BUYER, buyer: BUYER, supplier: undefined })).toBeNull();
    // An engagement with no winner carries the zero address, which is not a counterparty.
    expect(counterpartyOf({ me: BUYER, buyer: BUYER, supplier: ZERO })).toBeNull();
  });
});

describe("dbKeyFor", () => {
  it("returns 32 bytes and keeps them across calls", () => {
    const s = store();
    const first = dbKeyFor(BUYER, s);
    expect(first).toHaveLength(32);
    // A fresh key on reload would leave the previous database undecryptable.
    expect(bytesToHex(dbKeyFor(BUYER, s))).toBe(bytesToHex(first));
  });

  it("keys separately per wallet and ignores casing", () => {
    const s = store();
    const buyerKey = bytesToHex(dbKeyFor(BUYER, s));
    expect(bytesToHex(dbKeyFor(SUPPLIER, s))).not.toBe(buyerKey);
    expect(bytesToHex(dbKeyFor(BUYER.toLowerCase(), s))).toBe(buyerKey);
  });

  it("replaces a corrupted stored value rather than throwing", () => {
    const slot = `sealedrfq.xmtp.dbkey.${BUYER.toLowerCase()}`;
    const s = store({ [slot]: "not-a-key" });
    expect(dbKeyFor(BUYER, s)).toHaveLength(32);
    expect(s.data[slot]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hex helpers", () => {
  it("round-trip", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255, 128]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
    expect(bytesToHex(new Uint8Array([0, 10]))).toBe("000a");
  });
});

describe("xmtpEnv", () => {
  it("defaults to production and rejects anything unrecognised", () => {
    expect(xmtpEnv(undefined)).toBe("production");
    expect(xmtpEnv("")).toBe("production");
    expect(xmtpEnv("mainnet-ish")).toBe("production");
    expect(xmtpEnv("dev")).toBe("dev");
    expect(xmtpEnv("local")).toBe("local");
  });
});

describe("explainXmtpError", () => {
  it("names the single-tab limit, which otherwise looks like a hang", () => {
    expect(explainXmtpError(new Error("OPFS SAHPool already open"))).toMatch(/another tab/i);
  });

  it("treats a declined signature as a choice, not a fault", () => {
    expect(explainXmtpError(new Error("User rejected the request"))).toMatch(/declined/i);
  });

  it("falls back to the original text rather than inventing a cause", () => {
    expect(explainXmtpError(new Error("inbox id mismatch"))).toBe("inbox id mismatch");
  });
});
