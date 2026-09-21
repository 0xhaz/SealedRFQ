import { describe, expect, it } from "vitest";
import { PRESETS, applyPreset, checkDeadlines, toLocalInput, toUnix } from "../lib/deadlines.js";

const NOW = 1_800_000_000; // a fixed chain time to measure everything from

describe("datetime round-trip", () => {
  it("survives a round trip through the input format", () => {
    // datetime-local has minute resolution, so compare on the minute.
    const at = NOW - (NOW % 60);
    expect(toUnix(toLocalInput(at))).toBe(at);
  });

  it("returns null for anything unparseable instead of NaN", () => {
    for (const bad of ["", "tomorrow", "2026-13-45T99:99"]) {
      expect(toUnix(bad), bad).toBeNull();
    }
  });
});

describe("checkDeadlines", () => {
  const at = (mins: number) => toLocalInput(NOW + mins * 60);
  const valid = { bid: at(60), reveal: at(120), award: at(180) };

  it("accepts a timetable in the right order", () => {
    expect(checkDeadlines(valid, NOW)).toBeNull();
  });

  it("asks for all three when one is blank", () => {
    expect(checkDeadlines({ ...valid, reveal: "" }, NOW)).toMatch(/all three/i);
  });

  it("rejects a bidding date already past on-chain, and blames the clock", () => {
    // The case a date picker makes worse: the browser offers a time that looks future to the user
    // and is behind the chain, so the message has to name that possibility.
    const msg = checkDeadlines({ ...valid, bid: at(-10) }, NOW);
    expect(msg).toMatch(/future/i);
    expect(msg).toMatch(/clock/i);
  });

  it("enforces the contract's ordering", () => {
    expect(checkDeadlines({ ...valid, reveal: at(30) }, NOW)).toMatch(/after bidding/i);
    expect(checkDeadlines({ ...valid, award: at(90) }, NOW)).toMatch(/after revealing/i);
  });

  it("rejects equal timestamps, which the contract also refuses", () => {
    expect(checkDeadlines({ bid: at(60), reveal: at(60), award: at(180) }, NOW)).not.toBeNull();
  });

  it("is judged against chain time, not the host clock", () => {
    const soon = { bid: at(5), reveal: at(10), award: at(20) };
    expect(checkDeadlines(soon, NOW)).toBeNull();
    // Same inputs, but the chain is an hour ahead: now they are all in the past.
    expect(checkDeadlines(soon, NOW + 3600)).not.toBeNull();
  });
});

describe("presets", () => {
  it("every preset produces a timetable the contract would accept", () => {
    for (const p of PRESETS) {
      expect(checkDeadlines(applyPreset(p.offsets, NOW), NOW), p.label).toBeNull();
    }
  });

  it("offers a realistic default as well as a short one for demos", () => {
    const longest = Math.max(...PRESETS.map((p) => p.offsets[0]));
    const shortest = Math.min(...PRESETS.map((p) => p.offsets[0]));
    expect(longest).toBeGreaterThanOrEqual(7 * 1440); // a week or more
    expect(shortest).toBeLessThanOrEqual(60); // minutes, for a testnet run
  });
});
