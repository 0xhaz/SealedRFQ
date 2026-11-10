import { secp256k1 } from "@noble/curves/secp256k1.js";
import { describe, expect, it } from "vitest";
import { arcAddressForKey, keyMatchesArcAddress } from "../src/arcIdentity.js";

/**
 * The cross-chain claim, pinned to the real pair.
 *
 * `03c5528c…98dd` is the key bound in CIS-8 on Concordium testnet; `0x82D0…6774` is the address
 * holding EVALUATOR on the Arc attestation log. The badge's whole assertion is that these are one
 * entity, so the derivation that proves it is tested against the actual values rather than against
 * a synthetic pair that would pass whatever the code did.
 */
const CIS8_KEY = "03c5528c02501158aa5286c621394ef47e95c36edc35b21c71c76d13be8e7198dd";
const ARC_EVALUATOR = "0x82D0ab44CBdd811E6836C7F88ff6eCb094D26774";

describe("arcAddressForKey", () => {
  it("derives the Arc evaluator address from the key bound in CIS-8", () => {
    expect(arcAddressForKey(CIS8_KEY)).toBe(ARC_EVALUATOR.toLowerCase());
  });

  it("accepts the 0x prefix", () => {
    expect(arcAddressForKey(`0x${CIS8_KEY}`)).toBe(ARC_EVALUATOR.toLowerCase());
  });

  it("derives the same address from the uncompressed form of the same point", () => {
    // Both are CIS-8 key types and both describe one point, so a badge using either must verify.
    const uncompressed = Buffer.from(secp256k1.Point.fromHex(CIS8_KEY).toBytes(false)).toString(
      "hex",
    );
    expect(uncompressed).toHaveLength(130);
    expect(arcAddressForKey(uncompressed)).toBe(ARC_EVALUATOR.toLowerCase());
  });

  it("refuses 33 well-formed bytes that are not a curve point", () => {
    // The case that matters: this would otherwise hash to a plausible-looking address and be
    // compared against a real one, reporting a mismatch instead of bad input.
    expect(() => arcAddressForKey(`03${"42".repeat(32)}`)).toThrow();
  });

  it("refuses the wrong length and non-hex", () => {
    expect(() => arcAddressForKey("03c5528c")).toThrow(/33-byte compressed/);
    expect(() => arcAddressForKey("zz".repeat(33))).toThrow(/hex/);
  });
});

describe("keyMatchesArcAddress", () => {
  it("matches regardless of address checksum casing", () => {
    expect(keyMatchesArcAddress(CIS8_KEY, ARC_EVALUATOR).ok).toBe(true);
    expect(keyMatchesArcAddress(CIS8_KEY, ARC_EVALUATOR.toLowerCase()).ok).toBe(true);
    expect(keyMatchesArcAddress(CIS8_KEY, ARC_EVALUATOR.toUpperCase().replace("0X", "0x")).ok).toBe(
      true,
    );
  });

  it("reports a different address as a mismatch, with what it derived", () => {
    const result = keyMatchesArcAddress(CIS8_KEY, "0x0000000000000000000000000000000000000001");
    expect(result.ok).toBe(false);
    expect(result.derived).toBe(ARC_EVALUATOR.toLowerCase());
  });

  it("reports bad input as a reason rather than as a mismatch", () => {
    const result = keyMatchesArcAddress("not-a-key", ARC_EVALUATOR);
    expect(result.ok).toBe(false);
    expect(result.derived).toBeUndefined();
    expect(result.reason).toMatch(/hex/);
  });
});
