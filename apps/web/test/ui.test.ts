import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/styles/ledger.css"), "utf8");

describe("clickable affordances", () => {
  it("gives every button a pointer cursor from a base rule", () => {
    // Browsers give <button> the default arrow, so before this rule each clickable thing had to
    // remember to set it per class and two had not. An element selector is the floor: a button
    // class added later is covered without anyone thinking about it.
    expect(css).toMatch(/\bbutton\s*\{[^}]*cursor:\s*pointer/);
    expect(css).toMatch(/\bbutton:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  });

  it("keeps the base rule weak enough for deliberate exceptions to win", () => {
    // `.btn:disabled` wants `default` and `.lj-run-btn:disabled` wants `wait`. Both are class
    // selectors, so they outrank the element rule — this only breaks if someone "tidies" the base
    // rule into something more specific.
    const base = css.search(/^button\s*\{/m);
    expect(base).toBeGreaterThan(-1);
    expect(css.slice(base, base + 120)).not.toMatch(/!important/);
  });
});
