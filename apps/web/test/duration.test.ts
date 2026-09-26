import { describe, expect, it } from "vitest";
import { DURATION_UNITS, fromSeconds, toSeconds } from "../lib/duration.js";

describe("duration", () => {
  it("converts each unit to seconds", () => {
    expect(toSeconds("15", "minutes")).toBe(900);
    expect(toSeconds("2", "hours")).toBe(7200);
    expect(toSeconds("14", "days")).toBe(1_209_600);
    expect(toSeconds("2", "weeks")).toBe(1_209_600);
    expect(toSeconds("1", "months")).toBe(2_592_000);
  });

  it("treats a blank or nonsense amount as nothing rather than NaN", () => {
    // The form validates against this, so a silent NaN would reach the contract as a window.
    expect(toSeconds("", "days")).toBe(0);
    expect(toSeconds("-3", "days")).toBe(0);
    expect(toSeconds("abc", "days")).toBe(0);
  });

  it("round-trips through the largest unit that divides exactly", () => {
    // A buyer who set "2 weeks" should not reopen the tender and find "14 days".
    expect(fromSeconds(1_209_600)).toEqual({ amount: "2", unit: "weeks" });
    expect(fromSeconds(900)).toEqual({ amount: "15", unit: "minutes" });
    expect(fromSeconds(3 * 86_400)).toEqual({ amount: "3", unit: "days" });
    // 10 days is not a whole number of weeks, so days is the right answer.
    expect(fromSeconds(10 * 86_400)).toEqual({ amount: "10", unit: "days" });
  });

  it("labels months as 30 days, because a rolling window has no calendar month", () => {
    expect(DURATION_UNITS.find((u) => u.value === "months")?.label).toContain("30 days");
  });
});
