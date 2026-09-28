import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

/**
 * The documentation, read from the repository's own `docs/` at build time.
 *
 * Deliberately not a second copy. A hosted docs site would be a separate place for the same
 * sentences to live, and the reliable outcome of that is two descriptions of one system drifting
 * apart until neither can be trusted — which is a poor look for a project whose whole argument is
 * that claims should be checkable. These pages render the files that sit beside the contracts they
 * describe, so a doc that is wrong is a file someone can open a pull request against.
 *
 * Read at build time rather than fetched, so the app carries no runtime dependency on the repo and
 * a broken doc is a build failure rather than an empty page in front of a reader.
 */

const DOCS_DIR = join(process.cwd(), "..", "..", "docs");

export type DocMeta = {
  slug: string;
  title: string;
  /** One line under the title in the sidebar, taken from the file's own first paragraph. */
  summary: string;
};

/**
 * Which pages appear in the app, and in what order.
 *
 * An explicit list rather than "whatever is in the folder", for two reasons. Order matters:
 * someone arriving cold needs the lifecycle before anything else, and alphabetical would open on
 * whichever file happens to sort first. And membership matters more — `docs/` also holds notes
 * written for contributors, and a file landing there should not publish itself to every visitor
 * because nobody remembered it would.
 *
 * Adding a page here is the deliberate act of publishing it.
 */
const PUBLISHED = [
  "how-it-works",
  "for-buyers",
  "filling-in-the-form",
  "for-suppliers",
  "building-a-supplier-agent",
  "verifying-a-decision",
];

function titleOf(markdown: string, slug: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : slug.replace(/-/g, " ");
}

function summaryOf(markdown: string): string {
  // The first prose line after the title: not a heading, a blockquote, a list or a fence.
  const line = markdown
    .split("\n")
    .slice(1)
    .find((l) => l.trim() && !/^[#>\-*|`]/.test(l.trim()));
  if (!line) return "";
  const plain = line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
  return plain.length > 120 ? `${plain.slice(0, 117).trimEnd()}…` : plain;
}

export function listDocs(): DocMeta[] {
  const present = new Set(
    readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, "")),
  );
  // A published page naming a file that no longer exists would render an empty panel, so it is
  // dropped here and the missing file shows up as a shorter sidebar rather than a broken link.
  return PUBLISHED.filter((slug) => present.has(slug)).map((slug) => {
    const md = readFileSync(join(DOCS_DIR, `${slug}.md`), "utf8");
    return { slug, title: titleOf(md, slug), summary: summaryOf(md) };
  });
}

export function readDoc(slug: string): { title: string; html: string } | null {
  // The slug comes from a URL, so it must not be able to walk out of the docs directory — and it
  // must not reach a file that was deliberately left unpublished either.
  if (!/^[a-z0-9-]+$/.test(slug) || !PUBLISHED.includes(slug)) return null;
  let md: string;
  try {
    md = readFileSync(join(DOCS_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }

  const title = titleOf(md, slug);
  // Drop the H1: the page renders its own heading, and two would read as a mistake.
  const body = md.replace(/^#\s+.+$/m, "");

  const html = marked.parse(body, { async: false, gfm: true }) as string;
  return { title, html: rewriteImages(rewriteLinks(html)) };
}

/**
 * Point an image at the copy this app serves.
 *
 * The file lives once, under `apps/web/public/diagrams/`, and the markdown refers to it by the
 * repository-relative path so GitHub renders it too. In the browser that path means nothing, so
 * anything under that folder becomes the route Next serves it at. Keeping a single copy matters
 * more than the tidier-looking alternative: two copies of a diagram drift, and a picture that
 * disagrees with the prose beside it is worse than no picture.
 */
function rewriteImages(html: string): string {
  return html.replace(
    /src="([^"]*apps\/web\/public\/diagrams\/([^"/]+))"/g,
    (_whole, _full: string, file: string) => `src="/diagrams/${file}"`,
  );
}

/**
 * Point links at things a reader can actually open.
 *
 * These files are written to be read on GitHub as well as here, so they link to source with
 * repository-relative paths. In the browser those resolve against the current route and 404. A
 * link to `contracts/src/...` becomes a link into the repository; a link to another doc becomes a
 * link to its page here.
 */
function rewriteLinks(html: string): string {
  const REPO = "https://github.com/0xhaz/SealedTender/blob/main";
  return html.replace(/href="([^"]+)"/g, (whole, href: string) => {
    if (/^(https?:|mailto:|#|\/)/.test(href)) return whole;
    const [path, hash = ""] = href.split("#");
    if (path.endsWith(".md")) {
      const slug = path.replace(/^.*\//, "").replace(/\.md$/, "");
      return `href="/docs/${slug}${hash ? `#${hash}` : ""}"`;
    }
    return `href="${REPO}/${path}${hash ? `#${hash}` : ""}" target="_blank" rel="noreferrer"`;
  });
}
