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
    const slugs = docs.map((d) => d.slug);
    expect(slugs[0]).toBe("how-it-works");
    expect(slugs.indexOf("for-buyers")).toBeLessThan(slugs.indexOf("verifying-a-decision"));
  });

  it("publishes only what is named, so a contributor note cannot leak into the app", () => {
    const slugs = docs.map((d) => d.slug);
    expect(slugs).not.toContain("architecture");
    expect(slugs).not.toContain("techstack");
    expect(readDoc("architecture")).toBeNull();
  });

  it("gives every page a title and a summary line", () => {
    for (const d of docs) {
      expect(d.title.length).toBeGreaterThan(3);
      expect(d.title.startsWith("#")).toBe(false);
      expect(d.summary).not.toMatch(/^[#>\-*|`]/);
    }
  });

  it("serves the lifecycle diagram from this app, not from a repository path", () => {
    // The file lives once, under apps/web/public/diagrams, and the markdown points at it by its
    // repository path so GitHub renders it too. In a browser that path is meaningless, so it has
    // to become the route Next serves. A broken image here would be silent.
    const html = readDoc("how-it-works")?.html ?? "";
    expect(html).toContain('src="/diagrams/tender-flow.svg"');
    expect(html).not.toContain("apps/web/public");
    // The picture carries the whole lifecycle; without real alt text that is lost to anyone who
    // cannot see it, and to anyone reading with images off.
    const alt = html.match(/<img[^>]*alt="([^"]*)"/)?.[1] ?? "";
    expect(alt.length).toBeGreaterThan(200);
    expect(alt).toMatch(/cannot award/i);
  });

  it("publishes the field-by-field form guide, and links to it from the buyers page", () => {
    // Added because the buyer-facing hints say what a field is, not how to choose a value; a
    // first-time buyer needs the second and it is easy to publish the file and forget the link.
    const slugs = listDocs().map((d) => d.slug);
    expect(slugs).toContain("filling-in-the-form");
    expect(readDoc("for-buyers")?.html ?? "").toContain("/docs/filling-in-the-form");
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
