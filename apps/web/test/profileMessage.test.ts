import { describe, expect, it } from "vitest";
import { profileMessage } from "../lib/agent";

/**
 * The browser and the agent each build this string, and the signature only recovers if they build
 * it identically. They live in different packages and cannot import each other, so both suites
 * assert the same literal: if either drifts, one of them fails rather than every profile silently
 * being rejected as an impersonation attempt.
 */
const FIXTURE = {
  address: "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  name: "Acme Instruments",
  country: "MY",
  categories: "HARDWARE",
  website: "https://acme.example",
  contact: "sales@acme.example",
  about: "Barcode hardware since 1998.",
  ts: 1_790_000_000,
};

const EXPECTED = [
  "SealedRFQ supplier profile",
  "address:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "name:Acme Instruments",
  "country:MY",
  "categories:HARDWARE",
  "website:https://acme.example",
  "contact:sales@acme.example",
  "ts:1790000000",
  "",
  "Barcode hardware since 1998.",
].join("\n");

describe("profileMessage", () => {
  it("builds the exact string the agent expects", () => {
    expect(profileMessage(FIXTURE)).toBe(EXPECTED);
  });

  it("lowercases the address, since wallets hand back a checksummed one", () => {
    expect(profileMessage({ ...FIXTURE, address: FIXTURE.address.toUpperCase().replace("0X", "0x") })).toBe(
      EXPECTED,
    );
  });
});
