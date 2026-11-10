/**
 * The qualification policy this deployment asks suppliers to prove, in one place.
 *
 * One place because the statement sent to the wallet and the statement checked on the way back
 * have to be identical. If the request and the check could drift, the check would be verifying a
 * question nobody asked.
 *
 * The policy is deliberately narrow and its limits are stated wherever it is shown. A verified
 * Concordium identity means an identity provider checked documents and has not revoked the
 * credential. It is not evidence of trading status, solvency, authority to contract, beneficial
 * ownership, or any sanctions check.
 */
import {
  type QualificationPolicy,
  describeStatement,
  qualificationStatement,
} from "@sealedrfq/concordium";

/**
 * Identity provider 0 on Concordium testnet is the test issuer, which attests without checking
 * anything. That is fine for a demonstration and must never be read as a real attestation, which
 * is why the network is named next to it everywhere this policy is shown.
 */
export const QUALIFICATION_POLICY: QualificationPolicy = {
  issuers: [0],
  allowedCountries: ["DK", "FI", "NO", "SE"],
  basis: "residence",
};

export const QUALIFICATION_STATEMENT = qualificationStatement(QUALIFICATION_POLICY);
export const QUALIFICATION_DESCRIPTION = describeStatement(QUALIFICATION_POLICY);

/** What a challenge is for. Scoped to the tender, so one proof cannot be reused on another. */
export function purposeFor(tenderId: number | string, action: "bid" | "award" = "bid"): string {
  return `tender:${tenderId}:${action}`;
}
