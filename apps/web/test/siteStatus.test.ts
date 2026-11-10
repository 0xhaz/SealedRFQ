import { describe, expect, it } from "vitest";

/**
 * The pause is a banner, and these keep it one.
 *
 * It defaults to live so a mistyped environment variable cannot flip the site's own description,
 * and it stays out of the audit view, which is the page whose availability the project's central
 * claim rests on. Both are small; the reason they are tested is that this flag used to gate real
 * actions and the docstring went on saying so after the actions were gone.
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

describe("what the pause flag reaches", () => {
  const read = (p: string) => require("node:fs").readFileSync(new URL(p, import.meta.url), "utf8");

  it("does not reach the audit view", () => {
    expect(read("../app/audit/[id]/page.tsx")).not.toContain("isPaused");
  });
});
