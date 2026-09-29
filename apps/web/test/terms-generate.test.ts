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

  it("describes the dispute path as the parties first, and bounds what an arbiter may do", () => {
    // The clause used to say a deadlock is "referred to the arbiter named on this deployment",
    // which named nobody and implied an adjudicator §6c concluded should not exist. The role is
    // real but narrow, and a buyer publishing these terms should be able to check it.
    const t = generateTerms(base);
    expect(t).toMatch(/parties to settle between themselves/i);
    expect(t).toMatch(/cannot reverse a payment already released/i);
    expect(t).toMatch(/readable on-chain/i);
  });

  it("names the platform fee only when one is charged", () => {
    // Silent by default, because this deployment charges nothing and a clause about a zero fee is
    // noise in a document people are asked to read. Present the moment it is not zero, because it
    // changes what the supplier receives and they price against these clauses.
    expect(generateTerms(base)).not.toMatch(/platform fee/i);

    const withFee = generateTerms({ ...base, platformFeeBps: 250 });
    expect(withFee).toMatch(/2\.50% of each milestone/);
    expect(withFee).toMatch(/borne by the supplier/i);
    expect(withFee).toMatch(/not charged on the retention/i);
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
