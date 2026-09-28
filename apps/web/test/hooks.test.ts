import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * React counts hooks per render, so a hook that sits after an early return runs on some renders
 * and not others. The moment the condition flips — a wallet connecting, say — the count changes
 * and React tears the whole tree down with error #310.
 *
 * It is worth a test rather than a review habit for two reasons. It presents as a blank "this page
 * couldn't load" with a minified stack that names no file of ours, so it is expensive to trace
 * back. And `biome` is configured to skip `apps/web`, so the lint rule that would normally catch
 * this (`react-hooks/rules-of-hooks`) never runs here.
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

describe("rules of hooks", () => {
  it("never calls a hook after an early return", () => {
    const files = [...tsxFiles(join(process.cwd(), "app")), ...tsxFiles(join(process.cwd(), "components"))];
    const offenders: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.includes('"use client"')) continue;

      for (const comp of src.matchAll(/export function (\w+)\([^)]*\)\s*\{/g)) {
        // Walk to the matching brace so nested components are handled on their own.
        let depth = 1;
        let i = comp.index + comp[0].length;
        while (depth > 0 && i < src.length) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          i++;
        }
        const body = src.slice(comp.index + comp[0].length, i - 1);
        const lines = body.split("\n");

        // A return at the component's own indentation, not one inside a callback or JSX.
        const firstReturn = lines.findIndex((l) => /^ {2}(?:if \(.*\) )?return\b/.test(l));
        if (firstReturn === -1) continue;

        // `[<(]` rather than `\(`: a hook is very often called with a type argument, and
        // `useState<Record<string, number>>(...)` has generics between the name and the paren.
        // Requiring the paren immediately is what let the bug this test exists for slip through.
        const late = lines
          .slice(firstReturn)
          .filter((l) => /^ {2}const\b.*\buse[A-Z]\w*[<(]/.test(l));
        for (const l of late) {
          offenders.push(`${f.replace(process.cwd(), ".")} ${comp[1]}: ${l.trim().slice(0, 70)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
