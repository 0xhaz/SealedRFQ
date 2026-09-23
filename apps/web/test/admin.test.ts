import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLE,
  CONFIRM_PHRASES,
  ROLE_IDS,
  looksLikeAddress,
  phraseMatches,
} from "../lib/admin";

describe("role ids", () => {
  it("uses the zero word for ADMIN, which is what OZ means by DEFAULT_ADMIN_ROLE", () => {
    // Not a hash of the word "ADMIN". Getting this wrong makes every admin check silently false,
    // which is the same shape as the EVALUATOR bug found earlier in this project.
    expect(ADMIN_ROLE).toBe(`0x${"0".repeat(64)}`);
    expect(ROLE_IDS.ADMIN).toBe(ADMIN_ROLE);
  });

  it("hashes the namespaced constant the contracts declare, not the bare role name", () => {
    // Roles.sol declares keccak256("sealedrfq.role.EVALUATOR"). Checking against
    // keccak256("EVALUATOR_ROLE") — the obvious guess, and one already made once in this project —
    // returns false for a wallet that really does hold the role, which looks like a permissions
    // bug rather than a wrong constant.
    expect(ROLE_IDS.EVALUATOR).toBe(keccak256(toBytes("sealedrfq.role.EVALUATOR")));
    expect(ROLE_IDS.EVALUATOR).not.toBe(keccak256(toBytes("EVALUATOR_ROLE")));
  });

  it("gives every role a distinct id", () => {
    expect(new Set(Object.values(ROLE_IDS)).size).toBe(Object.keys(ROLE_IDS).length);
  });
});

describe("looksLikeAddress", () => {
  it("accepts a well-formed address in either case", () => {
    expect(looksLikeAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(true);
    expect(looksLikeAddress("  0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266  ")).toBe(true);
  });

  it("rejects the shapes a mistype actually produces", () => {
    expect(looksLikeAddress("")).toBe(false);
    expect(looksLikeAddress("0x123")).toBe(false);
    expect(looksLikeAddress("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(false);
    // One character short, which is the failure a truncated paste gives.
    expect(looksLikeAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226")).toBe(false);
    expect(looksLikeAddress("0xzzzFd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(false);
  });
});

describe("phraseMatches", () => {
  it("requires the exact phrase, ignoring case and surrounding space", () => {
    expect(phraseMatches("transfer admin", CONFIRM_PHRASES.transfer)).toBe(true);
    expect(phraseMatches("  RENOUNCE FOREVER ", CONFIRM_PHRASES.renounce)).toBe(true);
  });

  it("does not accept a near miss", () => {
    expect(phraseMatches("transfer", CONFIRM_PHRASES.transfer)).toBe(false);
    expect(phraseMatches("RENOUNCE", CONFIRM_PHRASES.renounce)).toBe(false);
    expect(phraseMatches("", CONFIRM_PHRASES.transfer)).toBe(false);
  });
});
