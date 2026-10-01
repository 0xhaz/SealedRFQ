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

describe("printing one document from a busy page", () => {
  it("removes the rest of the page from flow rather than merely hiding it", () => {
    // `visibility: hidden` keeps an element's space. The first attempt used it and printed a
    // one-page invoice across six — five of them the tender page's layout, blank but still taking
    // paper. Only `display: none` reclaims the height, which is why the printable copy is
    // portalled out of the panel: nothing that must stay visible may have a hidden ancestor.
    expect(css).toMatch(/body\.printing-doc > \*:not\(\.print-sheet\)\s*\{[^}]*display:\s*none/);
    expect(css).not.toMatch(/body\.printing-doc \*\s*\{[^}]*visibility:\s*hidden/);
  });

  it("keeps the printable copy off the screen and on the paper", () => {
    expect(css).toMatch(/\.print-sheet\s*\{\s*display:\s*none/);
    expect(css).toMatch(/body\.printing-doc \.print-sheet\s*\{[^}]*display:\s*block/);
  });

  it("lets the document run onto a second page only if its text needs one", () => {
    const sheet = /body\.printing-doc \.print-sheet\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(sheet).toMatch(/max-height:\s*none/);
    expect(sheet).toMatch(/overflow:\s*visible/);
  });
});
