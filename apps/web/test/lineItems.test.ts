import { describe, expect, it } from "vitest";
import { parsePastedRows, readLineItems, toLineItems } from "../lib/lineItems.js";

describe("toLineItems", () => {
  it("keeps the quantity and unit when they are real", () => {
    expect(toLineItems([{ id: "t", item: "2D barcode scanner", qty: "500", uom: "ea" }])).toEqual([
      { item: "2D barcode scanner", qty: 500, uom: "ea" },
    ]);
  });

  it("keeps a line that is only a description", () => {
    // Not everything has a quantity; "install and commission" is still worth quoting.
    expect(
      toLineItems([{ id: "t", item: "Install and commission on site", qty: "", uom: "" }]),
    ).toEqual([{ item: "Install and commission on site" }]);
  });

  it("drops a quantity that is not usable rather than publishing NaN", () => {
    for (const bad of ["a few", "-5", "0", "  "]) {
      expect(
        toLineItems([{ id: "t", item: "Widget", qty: bad, uom: "ea" }])[0].qty,
        bad,
      ).toBeUndefined();
    }
  });

  it("drops rows with no item name, so a spare empty row publishes nothing", () => {
    const rows = [
      { id: "t", item: "Real", qty: "1", uom: "ea" },
      { id: "t", item: "   ", qty: "99", uom: "box" },
      { id: "t", item: "", qty: "", uom: "" },
    ];
    expect(toLineItems(rows)).toEqual([{ item: "Real", qty: 1, uom: "ea" }]);
  });
});

describe("parsePastedRows", () => {
  it("reads a spreadsheet paste: tabs between cells, newlines between rows", () => {
    const fromExcel = "2D barcode scanner\t500\tea\nCleaning tablets\t20\tbox";
    const rows = parsePastedRows(fromExcel);
    expect(rows.map(({ id, ...r }) => r)).toEqual([
      { item: "2D barcode scanner", qty: "500", uom: "ea" },
      { item: "Cleaning tablets", qty: "20", uom: "box" },
    ]);
    // Each row needs its own identity, or the editor keys two inputs the same.
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("never splits an item name on its commas", () => {
    // "2D barcode scanner, USB-C" is one item. Splitting on commas would shred exactly the
    // descriptive names people actually type.
    const [row] = parsePastedRows("2D barcode scanner, USB-C\t500\tea");
    expect(row.item).toBe("2D barcode scanner, USB-C");
    expect(row.qty).toBe("500");
  });

  it("still accepts the pipe format that preceded this editor", () => {
    expect(parsePastedRows("Aprons | 20 | box").map(({ id, ...r }) => r)).toEqual([
      { item: "Aprons", qty: "20", uom: "box" },
    ]);
  });

  it("handles a single column and ragged rows", () => {
    expect(parsePastedRows("Scanner\nTablets\t20").map(({ id, ...r }) => r)).toEqual([
      { item: "Scanner", qty: "", uom: "" },
      { item: "Tablets", qty: "20", uom: "" },
    ]);
  });

  it("ignores blank lines and carriage returns from a Windows paste", () => {
    expect(parsePastedRows("Aprons\t2\r\n\r\nMugs\t4\r\n")).toHaveLength(2);
  });
});

describe("readLineItems", () => {
  it("reads the list back out of a published metadata document", () => {
    expect(readLineItems({ lineItems: [{ item: "Scanner", qty: 500, uom: "ea" }] })).toEqual([
      { item: "Scanner", qty: 500, uom: "ea" },
    ]);
  });

  it("treats anything malformed as no list rather than throwing on a page render", () => {
    for (const bad of [null, undefined, {}, { lineItems: "not a list" }, { lineItems: [1, 2] }]) {
      expect(readLineItems(bad)).toEqual([]);
    }
  });

  it("survives the round trip an RFQ actually makes", () => {
    const rows = [
      { id: "t", item: "2D barcode scanner, USB-C", qty: "500", uom: "ea" },
      { id: "t", item: "Install and commission", qty: "", uom: "" },
    ];
    const published = JSON.parse(JSON.stringify({ lineItems: toLineItems(rows) }));
    expect(readLineItems(published)).toEqual(toLineItems(rows));
  });
});
