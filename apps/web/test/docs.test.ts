import { describe, expect, it } from "vitest";
import { listDocs, readDoc } from "../lib/docs";

describe("docs index", () => {
  const docs = listDocs();

  it("finds the repository's documentation", () => {
    const slugs = docs.map((d) => d.slug);
    expect(slugs).toContain("how-it-works");
    expect(slugs).toContain("for-buyers");
    expect(slugs).toContain("for-suppliers");
  });

  it("orders for someone arriving cold, not alphabetically", () => {
    // Alphabetical opens on "architecture", which is the right page for about one reader in
    // twenty. The lifecycle comes first, then the two guides.
    const slugs = docs.map((d) => d.slug);
    expect(slugs[0]).toBe("how-it-works");
    expect(slugs.indexOf("for-buyers")).toBeLessThan(slugs.indexOf("architecture"));
  });

  it("gives every page a title and a summary line", () => {
    for (const d of docs) {
      expect(d.title.length).toBeGreaterThan(3);
      expect(d.title.startsWith("#")).toBe(false);
      expect(d.summary).not.toMatch(/^[#>\-*|`]/);
    }
  });
});

describe("readDoc", () => {
  it("renders markdown to markup, not to escaped text", () => {
    const doc = readDoc("how-it-works");
    expect(doc).not.toBeNull();
    expect(doc?.html).toContain("<h2>");
    expect(doc?.html).not.toContain("## ");
  });

  it("drops the H1, which the page renders itself", () => {
    // Two titles would read as a mistake.
    expect(readDoc("how-it-works")?.html).not.toContain("<h1>");
  });

  it("points a relative link at something a browser can open", () => {
    // These files are also read on GitHub, so they link to source with repository-relative paths.
    // In the browser those resolve against the current route and 404.
    const html = readDoc("for-buyers")?.html ?? "";
    const relative = html.match(/href="(?!https?:|\/|#|mailto:)[^"]+"/g) ?? [];
    expect(relative, `unrewritten links would 404: ${relative.join(", ")}`).toHaveLength(0);
  });

  it("refuses a slug that tries to leave the docs directory", () => {
    // The slug arrives from a URL. Without this it addresses any file the process can read.
    expect(readDoc("../../../etc/passwd")).toBeNull();
    expect(readDoc("../README")).toBeNull();
    expect(readDoc("foo/bar")).toBeNull();
    expect(readDoc("")).toBeNull();
  });

  it("returns null for a page that does not exist, rather than throwing", () => {
    expect(readDoc("not-a-real-page")).toBeNull();
  });
});
