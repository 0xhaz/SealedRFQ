import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phones get a card layout instead of a wide table: `tr.row` turns each row into a block and
 * `td::before { content: attr(data-label) }` prints the heading that `thead` no longer shows.
 *
 * A row that opts in without labelling every cell loses those headings — the values stack with
 * nothing saying what they are, which is worse than the sideways scroll it replaced. Nothing about
 * that fails on a desktop, so it needs checking here rather than in a browser.
 */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const ROOT = join(process.cwd(), "app");
const COMPONENTS = join(process.cwd(), "components");

describe("mobile card layout", () => {
  const files = [...tsxFiles(ROOT), ...tsxFiles(COMPONENTS)];

  it("labels every cell of a row that opts into the card layout", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.includes('className="row"')) continue;
      const bare = src.match(/<td\b(?![^>]*data-label)/g) ?? [];
      if (bare.length) offenders.push(`${f.replace(process.cwd(), ".")}: ${bare.length} unlabelled <td>`);
    }
    expect(offenders).toEqual([]);
  });

  it("gives the board and the bid table the card layout at all", () => {
    // These are the two a supplier meets first, and both are too wide for a handset.
    for (const f of ["app/rfqs/page.tsx", "app/rfqs/[id]/page.tsx"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toContain('className="row"');
    }
  });
});
