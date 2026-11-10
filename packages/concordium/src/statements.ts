/**
 * What a supplier is asked to prove, and what that does and does not mean.
 *
 * Concordium identities can carry company attributes — `legalName`, `legalCountry`,
 * `businessNumber`, `registrationAuth`, `lei` — as well as personal ones. For procurement the
 * company attributes are the interesting half: they come from an identity provider that checked
 * a registration, not from the holder.
 *
 * Be precise about the claim. A verified Concordium identity says an identity provider checked
 * documents at some point and has not revoked the credential. It is **not**:
 *
 *   - proof the company is currently trading, solvent, or in good standing
 *   - proof the holder may contract on the company's behalf
 *   - proof of beneficial ownership
 *   - a sanctions, debarment or conflict-of-interest check
 *
 * The RFC says this in four places and it belongs in the UI, not only here. A buyer who reads
 * "verified" as "vetted" has been misled by us, not by Concordium.
 *
 * Kept free of `@concordium/web-sdk` so the web app can show and compare statements without its
 * wasm; the structures are plain JSON and the wallet takes them as they are.
 */

/** Attributes an identity provider may attest to. The company half is what procurement wants. */
export const COMPANY_ATTRIBUTES = [
  "legalName",
  "legalCountry",
  "businessNumber",
  "registrationAuth",
  "lei",
] as const;

export type AtomicStatement =
  | { type: "RevealAttribute"; attributeTag: string }
  | { type: "AttributeInSet"; attributeTag: string; set: string[] }
  | { type: "AttributeNotInSet"; attributeTag: string; set: string[] }
  | { type: "AttributeInRange"; attributeTag: string; lower: string; upper: string };

/** An identity-credential statement, qualified by which identity providers are acceptable. */
export type IdentityCredentialStatement = {
  idQualifier: { type: "cred"; issuers: number[] };
  statement: AtomicStatement[];
};

export type QualificationPolicy = {
  /**
   * Identity providers whose attestations the buyer accepts, by index. Empty means none, which is
   * refused rather than silently meaning "any": a policy that accepts every issuer should have to
   * say so.
   */
  issuers: number[];
  /**
   * ISO 3166-1 alpha-2 codes the tender is open to. The supplier proves membership without
   * revealing which one, so a losing bidder does not disclose where it is registered.
   */
  allowedCountries: string[];
  /**
   * Attributes the buyer needs in the clear to award and pay — a registration number it can look
   * up. Keep it short: everything here stops being private the moment a bid is revealed.
   */
  reveal?: string[];
  /** Prove against company registration rather than personal residence. */
  basis?: "company" | "residence";
};

/**
 * Build the statement a supplier is asked to prove.
 *
 * Set membership rather than reveal for the country, because a buyer needs to know the supplier is
 * inside the tender's jurisdiction and does not need to know which country that is. Revealing it
 * would leak the bidder's identity in a thin market.
 */
export function qualificationStatement(policy: QualificationPolicy): [IdentityCredentialStatement] {
  if (policy.issuers.length === 0) {
    throw new Error("a qualification policy must name at least one accepted identity provider");
  }
  if (policy.allowedCountries.length === 0) {
    throw new Error("a qualification policy must allow at least one country");
  }
  for (const code of policy.allowedCountries) {
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new Error(`${code} is not an ISO 3166-1 alpha-2 country code`);
    }
  }
  const countryTag = policy.basis === "residence" ? "countryOfResidence" : "legalCountry";
  const statement: AtomicStatement[] = [
    // Sorted so the same policy always produces the same statement, which is what lets the
    // verifier compare what was proved with what was asked without caring about order.
    { type: "AttributeInSet", attributeTag: countryTag, set: [...policy.allowedCountries].sort() },
  ];
  for (const tag of [...(policy.reveal ?? [])].sort()) {
    if (tag === countryTag) {
      throw new Error(
        `${tag} is already proven by set membership; revealing it as well discards that privacy`,
      );
    }
    statement.push({ type: "RevealAttribute", attributeTag: tag });
  }
  return [
    {
      idQualifier: { type: "cred", issuers: [...policy.issuers].sort((a, b) => a - b) },
      statement,
    },
  ];
}

/**
 * One line a buyer or supplier can read, describing exactly what the proof will show. Shown
 * before the wallet prompt, because approving a proof you have not understood is the failure mode
 * this whole flow exists to avoid.
 */
export function describeStatement(policy: QualificationPolicy): string {
  const where = policy.basis === "residence" ? "resident" : "registered";
  const countries = [...policy.allowedCountries].sort().join(", ");
  const revealed = policy.reveal?.length
    ? ` It also reveals ${[...policy.reveal].sort().join(" and ")}.`
    : "";
  return `Proves the supplier is ${where} in one of ${countries}, without revealing which.${revealed} It does not prove the company is trading, solvent, or that the signer may contract for it.`;
}
