import { describe, expect, it } from "vitest";
import { describeWindow } from "../src/windows.js";

describe("describeWindow", () => {
  it("picks the unit that makes the number readable", () => {
    // The two ends this has to survive: a buyer testing with minutes, a real tender with weeks.
    expect(describeWindow(900)).toBe("15 minutes");
    expect(describeWindow(1_209_600)).toBe("14 days");
    expect(describeWindow(7_200)).toBe("2 hours");
  });

  it("does not pluralise a single unit", () => {
    expect(describeWindow(86_400)).toBe("1 day");
    expect(describeWindow(3_600)).toBe("1 hour");
    expect(describeWindow(60)).toBe("1 minute");
    expect(describeWindow(1)).toBe("1 second");
  });

  it("keeps one decimal rather than rounding a window away", () => {
    // 36 hours is a day and a half; reporting "1 day" would understate the deadline.
    expect(describeWindow(129_600)).toBe("1.5 days");
  });

  it("falls back to seconds for a window shorter than a minute", () => {
    expect(describeWindow(30)).toBe("30 seconds");
    expect(describeWindow(0)).toBe("0 seconds");
  });
});
