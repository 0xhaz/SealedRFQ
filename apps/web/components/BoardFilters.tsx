import { CATEGORIES, REGIONS, labelFor } from "@/lib/taxonomy";
import Link from "next/link";

export type Facet = { value: string; count: number };

type Props = {
  categories: Facet[];
  regions: Facet[];
  active: { category?: string; region?: string; open?: boolean };
  total: number;
  shown: number;
};

/**
 * Filters as links rather than as state.
 *
 * A supplier's question is "is there work in my field", asked repeatedly — so the answer should be
 * a URL they can bookmark and return to, which client-side state cannot give them. Plain links also
 * mean the board filters with JavaScript disabled and that each view is shareable: a buyer can send
 * "the open logistics tenders" to someone rather than describing where to click.
 *
 * Only facets that actually appear are offered. A list of seventeen categories where three exist is
 * mostly dead options, and a filter that returns nothing teaches people not to trust the filter.
 */
export function BoardFilters({ categories, regions, active, total, shown }: Props) {
  const href = (patch: Record<string, string | undefined>) => {
    const next = { ...active, ...patch } as Record<string, string | boolean | undefined>;
    const q = new URLSearchParams();
    if (next.category) q.set("category", String(next.category));
    if (next.region) q.set("region", String(next.region));
    if (next.open) q.set("open", "1");
    const s = q.toString();
    return s ? `/rfqs?${s}` : "/rfqs";
  };

  const chip = (label: string, isActive: boolean, to: string, key: string) => (
    <Link key={key} href={to} className={isActive ? "chip is-active" : "chip"}>
      {label}
    </Link>
  );

  const filtering = Boolean(active.category || active.region || active.open);

  return (
    <div className="board-filters">
      <div className="filter-row">
        <span className="filter-label">Category</span>
        {chip("All", !active.category, href({ category: undefined }), "cat-all")}
        {categories.map((f) =>
          chip(
            `${labelFor(CATEGORIES, f.value)} (${f.count})`,
            active.category === f.value,
            href({ category: f.value }),
            f.value,
          ),
        )}
      </div>

      {regions.length > 1 && (
        <div className="filter-row">
          <span className="filter-label">Region</span>
          {chip("All", !active.region, href({ region: undefined }), "reg-all")}
          {regions.map((f) =>
            chip(
              `${labelFor(REGIONS, f.value)} (${f.count})`,
              active.region === f.value,
              href({ region: f.value }),
              f.value,
            ),
          )}
        </div>
      )}

      <div className="filter-row">
        {chip(
          "Open for bids only",
          Boolean(active.open),
          href({ open: active.open ? undefined : "1" }),
          "open",
        )}
        {filtering && (
          <span className="hint">
            Showing {shown} of {total} ·{" "}
            <Link className="linklike" href="/rfqs">
              clear filters
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}
