import { describe, expect, it } from "vitest";
import {
  type QualificationPolicy,
  deriveNullifier,
  describeStatement,
  qualificationStatement,
} from "../src/statements.js";

const POLICY: QualificationPolicy = {
  issuers: [0],
  allowedCountries: ["SE", "DK", "NO"],
  reveal: ["businessNumber"],
};

describe("the qualification statement", () => {
  it("proves country by set membership, not by revealing it", () => {
    // A thin market is a small market. Revealing the country of a losing bid can identify the
    // bidder, so the tender asks whether they are inside the jurisdiction, not where they are.
    const [s] = qualificationStatement(POLICY);
    const country = s.statement.find((a) => a.attributeTag === "legalCountry");
    expect(country?.type).toBe("AttributeInSet");
    expect(
      s.statement.some((a) => a.type === "RevealAttribute" && a.attributeTag === "legalCountry"),
    ).toBe(false);
  });

  it("is stable for the same policy whatever order it was written in", () => {
    // The verifier compares what was proved with what was asked. That comparison is only
    // meaningful if the same policy always produces the same statement.
    const a = qualificationStatement(POLICY);
    const b = qualificationStatement({
      issuers: [0],
      allowedCountries: ["NO", "SE", "DK"],
      reveal: ["businessNumber"],
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("defaults to company registration rather than personal residence", () => {
    expect(qualificationStatement(POLICY)[0].statement[0].attributeTag).toBe("legalCountry");
    expect(
      qualificationStatement({ ...POLICY, basis: "residence" })[0].statement[0].attributeTag,
    ).toBe("countryOfResidence");
  });

  it("refuses a policy that accepts no issuer, rather than reading it as accepting any", () => {
    expect(() => qualificationStatement({ ...POLICY, issuers: [] })).toThrow(/identity provider/);
  });

  it("refuses a policy with no allowed country, or a code that is not one", () => {
    expect(() => qualificationStatement({ ...POLICY, allowedCountries: [] })).toThrow(/country/);
    expect(() => qualificationStatement({ ...POLICY, allowedCountries: ["Sweden"] })).toThrow(
      /alpha-2/,
    );
    expect(() => qualificationStatement({ ...POLICY, allowedCountries: ["se"] })).toThrow(
      /alpha-2/,
    );
  });

  it("refuses to reveal the attribute it just proved privately", () => {
    // Asking for both discards the privacy the set membership bought, which is almost certainly
    // a mistake rather than an intention.
    expect(() => qualificationStatement({ ...POLICY, reveal: ["legalCountry"] })).toThrow(
      /discards that privacy/,
    );
  });

  it("describes itself in terms a buyer can check against what they wanted", () => {
    const text = describeStatement(POLICY);
    expect(text).toContain("DK, NO, SE");
    expect(text).toContain("without revealing which");
    expect(text).toContain("businessNumber");
    // The limits are part of the description, not a footnote elsewhere. A buyer who reads
    // "verified" as "vetted" has been misled by us, not by Concordium.
    expect(text).toMatch(/does not prove .*trading, solvent/);
  });
});

describe("the nullifier", () => {
  const secret = new Uint8Array(32).fill(7);
  const subject = "did:ccd:testnet:cred/aabb";

  it("is the same for the same prover and tender", async () => {
    expect(await deriveNullifier({ subject, tenderId: 1, secret })).toBe(
      await deriveNullifier({ subject, tenderId: 1, secret }),
    );
  });

  it("differs across tenders, so bids cannot be linked by comparing them", async () => {
    expect(await deriveNullifier({ subject, tenderId: 1, secret })).not.toBe(
      await deriveNullifier({ subject, tenderId: 2, secret }),
    );
  });

  it("differs across provers, which is what makes a second wallet collide", async () => {
    expect(await deriveNullifier({ subject, tenderId: 1, secret })).not.toBe(
      await deriveNullifier({ subject: `${subject}cc`, tenderId: 1, secret }),
    );
  });

  it("cannot be computed without the secret", async () => {
    const other = new Uint8Array(32).fill(8);
    expect(await deriveNullifier({ subject, tenderId: 1, secret })).not.toBe(
      await deriveNullifier({ subject, tenderId: 1, secret: other }),
    );
  });

  it("cannot be confused by a tender id that runs into the subject", async () => {
    // Without length prefixing, tender 1 with subject "2x" and tender 12 with subject "x" would
    // hash the same bytes and collide, letting one supplier's nullifier block another's.
    expect(await deriveNullifier({ subject: "2x", tenderId: 1, secret })).not.toBe(
      await deriveNullifier({ subject: "x", tenderId: 12, secret }),
    );
  });

  it("refuses a weak secret or a missing subject", async () => {
    await expect(
      deriveNullifier({ subject, tenderId: 1, secret: new Uint8Array(16) }),
    ).rejects.toThrow(/at least 32 bytes/);
    await expect(deriveNullifier({ subject: "", tenderId: 1, secret })).rejects.toThrow(/subject/);
  });

  it("is a 32-byte hex value, which is what the contract stores", async () => {
    expect(await deriveNullifier({ subject, tenderId: 1, secret })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
