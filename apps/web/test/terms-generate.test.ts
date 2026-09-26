import { describe, expect, it } from "vitest";
import { type TermsInput, generateTerms } from "../lib/terms.js";

const base: TermsInput = {
  mode: "RFQ",
  budget: "3.00",
  deposit: "0.25",
  stakePct: "5",
  retentionPct: "10",
  milestones: "30, 30, 40",
  deliverySec: 15 * 60,
  acceptSec: 3 * 60,
  lineItemCount: 2,
};

describe("generateTerms", () => {
  it("states the figures the escrow was actually configured with", () => {
    const t = generateTerms(base);
    // The point of generating: the prose and the contract describe one arrangement, not two.
    expect(t).toContain("3.00 USDC");
    expect(t).toContain("0.25 USDC");
    expect(t).toContain("10% of every milestone");
    expect(t).toContain("5%");
    expect(t).toContain("30%, 30%, 40%");
  });

  it("describes what the contract really does when the buyer stays silent", () => {
    // A buyer writing terms by hand tends to promise the opposite of this.
    const t = generateTerms(base);
    expect(t).toContain("3 minutes");
    expect(t).toMatch(/released to the supplier automatically/i);
  });

  it("counts the milestones rather than assuming three", () => {
    expect(generateTerms({ ...base, milestones: "50, 50" })).toContain("2 milestones");
    expect(generateTerms({ ...base, milestones: "100" })).toContain("1 milestone");
  });

  it("renders a window in the largest unit that fits, up to weeks", () => {
    expect(generateTerms({ ...base, acceptSec: 2 * 3600 })).toContain("2 hours");
    expect(generateTerms({ ...base, deliverySec: 45 * 60 })).toContain("45 minutes");
    // The case that made this worth changing: a real tender's windows are not measured in minutes.
    expect(generateTerms({ ...base, deliverySec: 14 * 86_400 })).toContain("2 weeks");
    expect(generateTerms({ ...base, acceptSec: 3 * 86_400 })).toContain("3 days");
  });

  it("adds the proposal clause only in RFP mode", () => {
    expect(generateTerms(base)).not.toMatch(/proposal document/i);
    expect(generateTerms({ ...base, mode: "RFP" })).toMatch(/proposal document/i);
  });

  it("folds stated requirements into a declarations clause", () => {
    const t = generateTerms({ ...base, attestations: ["ISO 9001", "24-month warranty"] });
    expect(t).toContain("ISO 9001; 24-month warranty");
    expect(t).toMatch(/evidence on request/i);
  });

  it("never leaves a blank where a number should be", () => {
    // An untouched form must still produce readable clauses, not "undefined USDC".
    const t = generateTerms({ ...base, budget: "", deposit: "", retentionPct: "", acceptSec: 0 });
    expect(t).not.toMatch(/undefined|NaN/);
    expect(t).toContain("the stated window");
  });

  it("is deterministic, so regenerating does not churn the text", () => {
    expect(generateTerms(base)).toBe(generateTerms(base));
  });
});
