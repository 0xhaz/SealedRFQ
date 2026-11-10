import { describe, expect, it } from "vitest";

/**
 * A pause must refuse new commitments without trapping money or hiding the record.
 *
 * The temptation with a maintenance mode is to switch the whole site off, which here would break
 * the two things the project promises: that committed funds can always be withdrawn, and that any
 * decision can be re-checked against the chain. These pin the shape of the pause so a later change
 * cannot quietly widen it.
 */
describe("site status", () => {
  it("defaults to live, so a typo cannot take the site down", async () => {
    process.env.NEXT_PUBLIC_SITE_STATUS = "";
    const live = await import(`../lib/siteStatus?blank=${Date.now()}`);
    expect(live.SITE_STATUS).toBe("live");
    process.env.NEXT_PUBLIC_SITE_STATUS = "pasued"; // deliberate misspelling
    const typo = await import(`../lib/siteStatus?typo=${Date.now()}`);
    expect(typo.SITE_STATUS).toBe("live");
  });

  it("pauses only on the exact value", async () => {
    process.env.NEXT_PUBLIC_SITE_STATUS = "paused";
    const m = await import(`../lib/siteStatus?paused=${Date.now()}`);
    expect(m.isPaused).toBe(true);
  });
});

describe("what a pause is allowed to touch", () => {
  const read = (p: string) => require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8");

  it("never gates the audit trail", () => {
    expect(read("../app/audit/[id]/page.tsx")).not.toContain("isPaused");
  });
});
