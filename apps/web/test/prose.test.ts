import { describe, expect, it } from "vitest";

/** The split Prose applies. Kept in step with components/Prose.tsx. */
const toParagraphs = (text: string) =>
  text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

describe("paragraph splitting", () => {
  it("separates clauses joined by blank lines", () => {
    // How generateTerms builds them, and what HTML would otherwise collapse into one block.
    const terms = "1. Scope. Everything in this RFQ.\n\n2. Price. All amounts are in USDC.";
    expect(toParagraphs(terms)).toEqual([
      "1. Scope. Everything in this RFQ.",
      "2. Price. All amounts are in USDC.",
    ]);
  });

  it("also breaks on a single newline, which is what people type", () => {
    expect(toParagraphs("Net 30.\n2-year warranty.")).toHaveLength(2);
  });

  it("does not invent empty paragraphs from trailing or repeated newlines", () => {
    expect(toParagraphs("\n\nOne clause.\n\n\n")).toEqual(["One clause."]);
    expect(toParagraphs("   \n  \n ")).toEqual([]);
  });

  it("leaves a single paragraph alone", () => {
    expect(toParagraphs("Payment on delivery.")).toEqual(["Payment on delivery."]);
  });
});
