import { describe, expect, it } from "vitest";
import { MAX_MILESTONES, checkMilestones } from "../lib/milestones.js";

/**
 * The form shows this live and the submit path throws on the same result, so a split can never
 * look accepted and then fail after the wallet has opened. These pin the cases a buyer actually
 * produces — a typo, a forgotten stage, one too many — rather than the happy path alone.
 */
describe("checkMilestones", () => {
  it("accepts a complete split", () => {
    expect(checkMilestones("30, 30, 40").ok).toBe(true);
    expect(checkMilestones("100").ok).toBe(true);
    expect(checkMilestones("20, 20, 20, 20, 20").bps).toEqual([2000, 2000, 2000, 2000, 2000]);
  });

  it("says by how much an incomplete split is out", () => {
    const short = checkMilestones("20, 20, 20, 20");
    expect(short.ok).toBe(false);
    expect(short.problem).toContain("80%");
    const over = checkMilestones("30, 30, 50");
    expect(over.problem).toContain("110%");
  });

  it("refuses more milestones than the contract accepts", () => {
    const eleven = Array(MAX_MILESTONES + 1).fill("9").join(",");
    expect(checkMilestones(eleven).problem).toContain(String(MAX_MILESTONES));
  });

  it("refuses a zero or negative stage", () => {
    // A milestone worth nothing still has to be delivered and accepted; the contract rejects it.
    expect(checkMilestones("0, 100").ok).toBe(false);
    expect(checkMilestones("-10, 110").ok).toBe(false);
  });

  it("treats an empty field as incomplete rather than valid", () => {
    expect(checkMilestones("").ok).toBe(false);
    expect(checkMilestones("   ").ok).toBe(false);
  });

  it("tolerates the whitespace and trailing commas people type", () => {
    expect(checkMilestones(" 30 ,30,40 , ").ok).toBe(true);
  });

  it("handles a fractional split, which basis points can carry", () => {
    expect(checkMilestones("33.34, 33.33, 33.33").ok).toBe(true);
  });
});
