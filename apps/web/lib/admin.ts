import { keccak256, toBytes } from "viem";

/**
 * The five contracts an operator holds keys over, and the roles on each.
 *
 * Gathered in one place because the powers are scattered by design — least privilege means the
 * EVALUATOR cannot award and the AWARDER cannot refund — and the cost of that is that nobody can
 * see the whole picture without checking five addresses. An operator who cannot see what they hold
 * cannot give it up deliberately, which is what §6d of the work plan asks them to do.
 */

/** `Roles.ADMIN` is OZ's DEFAULT_ADMIN_ROLE: the zero word, not a hash of anything. */
export const ADMIN_ROLE = `0x${"0".repeat(64)}` as const;

export const ROLE_IDS = {
  ADMIN: ADMIN_ROLE,
  EVALUATOR: keccak256(toBytes("sealedrfq.role.EVALUATOR")),
  AWARDER: keccak256(toBytes("sealedrfq.role.AWARDER")),
  VERIFIER: keccak256(toBytes("sealedrfq.role.VERIFIER")),
  ATTESTOR: keccak256(toBytes("sealedrfq.role.ATTESTOR")),
  ARBITER: keccak256(toBytes("sealedrfq.role.ARBITER")),
  REGISTRY: keccak256(toBytes("sealedrfq.role.REGISTRY")),
} as const;

export type RoleName = keyof typeof ROLE_IDS;

/** What holding each role actually lets someone do, in the terms the README uses. */
export const ROLE_POWER: Record<RoleName, string> = {
  ADMIN: "Grant itself every other role, on this contract. The root key.",
  EVALUATOR: "Anchor a scored decision memo. Cannot award.",
  AWARDER: "Award a tender without the buyer — but only to the bidder the attested evaluation named.",
  VERIFIER: "Accept or reject a milestone on any engagement, after anchoring its reason.",
  ATTESTOR: "Anchor attestations of the kinds mapped to it.",
  ARBITER: "Split the escrow of an engagement that is already Disputed.",
  REGISTRY: "Open engagements. Held by the RFQRegistry contract, not by a person.",
};

/**
 * Whether an address looks like one at all.
 *
 * Granting the root role to a mistyped address cannot be undone — plain AccessControl has no
 * two-step handover — and if the old admin then renounces, the contract is ungoverned forever. A
 * checksum-insensitive shape check is weak protection, so the interface pairs it with a typed
 * confirmation rather than relying on it.
 */
export function looksLikeAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/** The phrase an operator has to type before a one-way role change is enabled. */
export const CONFIRM_PHRASES = {
  transfer: "TRANSFER ADMIN",
  renounce: "RENOUNCE FOREVER",
} as const;

export function phraseMatches(typed: string, expected: string): boolean {
  return typed.trim().toUpperCase() === expected;
}
