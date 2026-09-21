import { sha256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { hashText, sameHash } from "../lib/docHash.js";

/**
 * The guarantee the terms panel makes, exercised end to end.
 *
 * The buyer's form builds a metadata document and anchors sha256 of it as `metadataHash`. A
 * supplier later receives that document from the indexer — a server — and re-hashes it against the
 * chain. These tests are the claim itself: that a buyer or an operator cannot revise a payment term
 * after bids are sealed without the comparison failing.
 */
const buildMetadata = (terms: Record<string, unknown>) =>
  JSON.stringify({
    scope: "500 barcode scanners",
    rubric: { price: 50, delivery: 30, quality: 20 },
    mode: "RFQ",
    visibility: "public",
    terms,
  });

describe("terms anchored in the metadata document", () => {
  const terms = {
    summary: "Net 30. 2-year warranty. Liability capped at contract value.",
    name: "terms-v1.pdf",
    sha256: sha256(stringToBytes("pretend pdf bytes")),
  };
  const metadata = buildMetadata(terms);
  // Exactly what NewRfqForm puts on-chain.
  const metadataHash = sha256(stringToBytes(metadata));

  it("verifies when the document served is the one anchored", () => {
    expect(sameHash(hashText(metadata), metadataHash)).toBe(true);
  });

  it("fails when a payment term is quietly rewritten", () => {
    const rewritten = buildMetadata({ ...terms, summary: "Net 90. No warranty." });
    expect(sameHash(hashText(rewritten), metadataHash)).toBe(false);
  });

  it("fails on a change too small to notice by eye", () => {
    // "capped at contract value" -> "capped at contract vaIue" (capital i for l).
    const sneaky = buildMetadata({
      ...terms,
      summary: terms.summary.replace("value", "vaIue"),
    });
    expect(sameHash(hashText(sneaky), metadataHash)).toBe(false);
  });

  it("fails when the attached document is swapped for another file", () => {
    const swapped = buildMetadata({ ...terms, sha256: sha256(stringToBytes("different bytes")) });
    expect(sameHash(hashText(swapped), metadataHash)).toBe(false);
  });

  it("the file hash is independent of the metadata hash", () => {
    // Two separate guarantees: the terms text is anchored, and the PDF's bytes are anchored.
    // A supplier checks the file they were emailed against terms.sha256, not against metadataHash.
    const parsed = JSON.parse(metadata) as { terms: { sha256: string } };
    expect(parsed.terms.sha256).toBe(terms.sha256);
    expect(parsed.terms.sha256).not.toBe(metadataHash);
  });

  it("an RFQ published without terms simply has none", () => {
    const bare = JSON.stringify({ scope: "x", rubric: {}, mode: "RFQ", visibility: "public" });
    expect((JSON.parse(bare) as { terms?: unknown }).terms).toBeUndefined();
  });
});
