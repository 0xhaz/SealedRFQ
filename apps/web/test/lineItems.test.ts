import { describe, expect, it } from "vitest";
import { formatLineItems, parseLineItems, readLineItems } from "../lib/lineItems.js";

describe("parseLineItems", () => {
  it("reads item, quantity and unit", () => {
    expect(parseLineItems("2D barcode scanner | 500 | ea")).toEqual([
      { item: "2D barcode scanner", qty: 500, uom: "ea" },
    ]);
  });

  it("keeps a line that is just a description", () => {
    // Not everything has a quantity; a line without one is still worth quoting.
    expect(parseLineItems("Install and commission on site")).toEqual([
      { item: "Install and commission on site" },
    ]);
  });

  it("ignores blank lines and stray whitespace from a paste", () => {
    const pasted = "  Aprons | 20 | box \n\n\n  Coffee maker | 2 | ea  \n";
    expect(parseLineItems(pasted)).toHaveLength(2);
    expect(parseLineItems(pasted)[0].item).toBe("Aprons");
  });

  it("drops a quantity that is not a usable number rather than storing NaN", () => {
    for (const bad of ["a few", "-5", "0", ""]) {
      expect(parseLineItems(`Widget | ${bad} | ea`)[0].qty, bad).toBeUndefined();
    }
  });

  it("survives a round trip through the editable text", () => {
    const items = [{ item: "Scanner", qty: 500, uom: "ea" }, { item: "Training day" }];
    expect(parseLineItems(formatLineItems(items))).toEqual(items);
  });
});

describe("readLineItems", () => {
  it("reads the list back out of a published metadata document", () => {
    const published = { lineItems: [{ item: "Scanner", qty: 500, uom: "ea" }] };
    expect(readLineItems(published)).toEqual([{ item: "Scanner", qty: 500, uom: "ea" }]);
  });

  it("treats anything malformed as no list, rather than throwing on a page render", () => {
    for (const bad of [null, undefined, {}, { lineItems: "not a list" }, { lineItems: [1, 2] }]) {
      expect(readLineItems(bad)).toEqual([]);
    }
  });

  it("drops entries with no item name", () => {
    expect(readLineItems({ lineItems: [{ item: "" }, { qty: 5 }, { item: "Real" }] })).toEqual([
      { item: "Real" },
    ]);
  });
});
