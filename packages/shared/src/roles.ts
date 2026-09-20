import { type Hex, keccak256, stringToHex } from "viem";

/**
 * Mirrors contracts/src/governance/Roles.sol. Kept in step by the tests in test/shared.test.ts,
 * which check these against the values the deployed contracts report.
 */
export const Roles = {
  ADMIN: `0x${"0".repeat(64)}` as Hex, // OZ DEFAULT_ADMIN_ROLE
  EVALUATOR: keccak256(stringToHex("sealedrfq.role.EVALUATOR")),
  AWARDER: keccak256(stringToHex("sealedrfq.role.AWARDER")),
  VERIFIER: keccak256(stringToHex("sealedrfq.role.VERIFIER")),
  ATTESTOR: keccak256(stringToHex("sealedrfq.role.ATTESTOR")),
  ARBITER: keccak256(stringToHex("sealedrfq.role.ARBITER")),
  REGISTRY: keccak256(stringToHex("sealedrfq.role.REGISTRY")),
} as const;

/**
 * Decision kinds as the contracts store them: short ASCII right-padded into bytes32
 * (Solidity's `bytes32 constant BID_EVALUATION = "BID_EVALUATION"`).
 */
export const AttestationKinds = {
  BID_EVALUATION: stringToHex("BID_EVALUATION", { size: 32 }),
  AWARD_RECOMMENDATION: stringToHex("AWARD_RECOMMENDATION", { size: 32 }),
  AWARD_REJECTION: stringToHex("AWARD_REJECTION", { size: 32 }),
  MILESTONE_ACCEPT: stringToHex("MILESTONE_ACCEPT", { size: 32 }),
  MILESTONE_REJECT: stringToHex("MILESTONE_REJECT", { size: 32 }),
  QUALIFICATION: stringToHex("QUALIFICATION", { size: 32 }),
} as const;

export type AttestationKind = keyof typeof AttestationKinds;

/** Decode a bytes32 label back to its string (category, region, kind, model). */
export function decodeLabel(hex: string): string {
  const stripped = hex.slice(2).replace(/(00)+$/, "");
  if (!stripped) return "";
  const chars = stripped.match(/.{2}/g) ?? [];
  return chars
    .map((b) => String.fromCharCode(Number.parseInt(b, 16)))
    .join("")
    .replace(/[^\x20-\x7e]/g, "");
}
