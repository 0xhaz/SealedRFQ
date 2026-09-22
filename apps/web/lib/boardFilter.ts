/**
 * Narrowing the board.
 *
 * Kept out of the page so the combination rules can be tested. They are simple individually and
 * easy to get subtly wrong together: filters have to intersect rather than accumulate, and the
 * counts beside each chip must come from the whole board so a chip never advertises a number that
 * clicking it cannot produce.
 */
export type BoardRow = { category: string; region: string; phase: string };

export type BoardQuery = { category?: string; region?: string; open?: boolean };

/** Phases in which a supplier can still act. */
const OPEN_PHASES = new Set(["Bidding", "Reveal"]);

export function applyBoardQuery<T extends BoardRow>(rows: T[], q: BoardQuery): T[] {
  return rows.filter(
    (r) =>
      (!q.category || r.category === q.category) &&
      (!q.region || r.region === q.region) &&
      (!q.open || OPEN_PHASES.has(r.phase)),
  );
}

export type Facet = { value: string; count: number };

/** Most common first, then alphabetical, so the list does not reshuffle on every deploy. */
export function facetsOf<T>(rows: T[], pick: (row: T) => string): Facet[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = pick(row);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Reads the query string, treating blanks as absent so `?category=` is not a filter for "". */
export function parseBoardQuery(p: {
  category?: string;
  region?: string;
  open?: string;
}): BoardQuery {
  return {
    category: p.category?.trim() || undefined,
    region: p.region?.trim() || undefined,
    open: p.open === "1",
  };
}
