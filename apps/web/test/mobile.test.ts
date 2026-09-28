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

  it("gives every pair of adjacent buttons a gap", () => {
    // Twice now a pair has shipped touching: two hard-edged buttons read as one control with a
    // seam down it, and the first one's shadow lands on the second. The shape of the bug is a
    // `</button>` with another button or link as its very next sibling — anything further apart is
    // separated by something anyway, so looking only for adjacency keeps this from crying wolf.
    const GAPPED = ["button-row", "filter-row", "pack-actions", "presets"];
    const offenders: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // `</button>` then optionally a JSX conditional, then the next button or link.
      const adjacency = /<\/button>\s*\n\s*(?:\{[^\n]*\n\s*)?<(?:button|a)\b/g;
      for (const m of src.matchAll(adjacency)) {
        const before = src.slice(0, m.index);
        // The nearest enclosing div is the last one opened and not yet closed.
        let depth = 0;
        let container: string | null = null;
        for (const tag of [...before.matchAll(/<div\b[^>]*>|<\/div>/g)].reverse()) {
          if (tag[0] === "</div>") depth++;
          else if (depth > 0) depth--;
          else {
            container = /className="([^"]*)"/.exec(tag[0])?.[1] ?? "";
            break;
          }
        }
        if (container !== null && !GAPPED.some((g) => container.includes(g))) {
          offenders.push(
            `${f.replace(process.cwd(), ".")}:${before.split("\n").length} "${container}"`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
