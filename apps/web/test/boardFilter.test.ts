import { describe, expect, it } from "vitest";
import { applyBoardQuery, facetsOf, parseBoardQuery } from "../lib/boardFilter.js";

const rows = [
  { id: 1, category: "SOFTWARE", region: "EU", phase: "Bidding" },
  { id: 2, category: "SOFTWARE", region: "SEA", phase: "Awarded" },
  { id: 3, category: "LOGISTICS", region: "EU", phase: "Reveal" },
  { id: 4, category: "LOGISTICS", region: "EU", phase: "NoAward" },
  { id: 5, category: "HARDWARE", region: "", phase: "Bidding" },
];
const ids = (r: { id: number }[]) => r.map((x) => x.id);

describe("applyBoardQuery", () => {
  it("returns everything when nothing is selected", () => {
    expect(applyBoardQuery(rows, {})).toHaveLength(5);
  });

  it("filters by category and by region", () => {
    expect(ids(applyBoardQuery(rows, { category: "SOFTWARE" }))).toEqual([1, 2]);
    expect(ids(applyBoardQuery(rows, { region: "EU" }))).toEqual([1, 3, 4]);
  });

  it("intersects filters rather than accumulating them", () => {
    // The mistake worth pinning: two filters must narrow, never widen.
    expect(ids(applyBoardQuery(rows, { category: "SOFTWARE", region: "EU" }))).toEqual([1]);
  });

  it("treats only Bidding and Reveal as open for bids", () => {
    // Awarded and NoAward are finished; a supplier filtering for work must not be shown them.
    expect(ids(applyBoardQuery(rows, { open: true }))).toEqual([1, 3, 5]);
  });

  it("combines open with the other filters", () => {
    expect(ids(applyBoardQuery(rows, { category: "LOGISTICS", open: true }))).toEqual([3]);
    expect(ids(applyBoardQuery(rows, { category: "SOFTWARE", region: "SEA", open: true }))).toEqual(
      [],
    );
  });
});

describe("facetsOf", () => {
  it("counts across the whole board, most common first", () => {
    expect(facetsOf(rows, (r) => r.category)).toEqual([
      { value: "LOGISTICS", count: 2 },
      { value: "SOFTWARE", count: 2 },
      { value: "HARDWARE", count: 1 },
    ]);
  });

  it("skips blanks, so an unset region is not offered as a filter", () => {
    expect(facetsOf(rows, (r) => r.region).map((f) => f.value)).toEqual(["EU", "SEA"]);
  });

  it("every facet returns at least one row when clicked", () => {
    // A chip advertising a count that clicking cannot produce teaches people to distrust filters.
    for (const f of facetsOf(rows, (r) => r.category)) {
      expect(applyBoardQuery(rows, { category: f.value }), f.value).toHaveLength(f.count);
    }
  });
});

describe("parseBoardQuery", () => {
  it("treats a blank parameter as no filter", () => {
    expect(parseBoardQuery({ category: "", region: "   " })).toEqual({
      category: undefined,
      region: undefined,
      open: false,
    });
  });

  it("only accepts open=1", () => {
    expect(parseBoardQuery({ open: "1" }).open).toBe(true);
    expect(parseBoardQuery({ open: "true" }).open).toBe(false);
  });
});
