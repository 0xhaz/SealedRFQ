import { describe, expect, it } from "vitest";

/**
 * The resolution rule that broke the deployment, pinned.
 *
 * `??` falls back only on null and undefined, so a blank field in a hosting dashboard — which
 * arrives as "" — left the base URL empty and sent every call to the site's own origin. Vercel
 * answered 404, the read path swallowed it as "agent unreachable", and the site looked like an
 * agent that had never indexed anything.
 */
function resolveBase(raw: string | undefined): { url: string; misconfigured: boolean } {
  const v = raw?.trim();
  if (!v) return { url: "http://127.0.0.1:4020", misconfigured: false };
  if (!/^https?:\/\//i.test(v)) return { url: "", misconfigured: true };
  return { url: v.replace(/\/+$/, ""), misconfigured: false };
}

describe("agent base URL", () => {
  it("treats a blank value as unset rather than as a relative path", () => {
    for (const blank of ["", "   ", undefined]) {
      const r = resolveBase(blank);
      expect(r.url, JSON.stringify(blank)).toBe("http://127.0.0.1:4020");
      expect(r.misconfigured).toBe(false);
    }
  });

  it("accepts an absolute URL and trims trailing slashes", () => {
    expect(resolveBase("https://agent.example.com").url).toBe("https://agent.example.com");
    expect(resolveBase("https://agent.example.com/").url).toBe("https://agent.example.com");
    expect(resolveBase("  https://agent.example.com//  ").url).toBe("https://agent.example.com");
  });

  it("refuses anything that would resolve against the site's own origin", () => {
    // These are the values that produce a same-origin 404 instead of reaching the agent.
    for (const bad of ["/api", "agent.example.com", "//agent.example.com", "ws://x"]) {
      expect(resolveBase(bad).misconfigured, bad).toBe(true);
    }
  });
});
