/**
 * The basket a buyer asks suppliers to quote against.
 *
 * A classic RFQ is a list of items with quantities, and the supplier returns a priced quotation.
 * Only the total settles on-chain — that is what gets escrowed and paid — but the list rides in the
 * metadata document whose sha256 is fixed when the RFQ opens, so the basket cannot change after
 * bids are in and a supplier can prove they quoted the same items as everyone else.
 */
export type LineItem = { item: string; qty?: number; uom?: string };

/**
 * A row as the editor holds it: everything a string, because a half-typed number is not one.
 *
 * `id` exists only to key the React list. It must not derive from the contents — keying a row by
 * what has been typed into it changes the key on every keystroke, which remounts the input and
 * takes the caret with it.
 */
export type LineItemRow = { id: string; item: string; qty: string; uom: string };

let seq = 0;
/**
 * Pass an id for the row a form starts with. Server and client must agree on the first render, and
 * a module-level counter does not survive being evaluated once per process and hydrated per page.
 */
export const emptyRow = (id?: string): LineItemRow => ({
  id: id ?? `row-${++seq}`,
  item: "",
  qty: "",
  uom: "",
});

/** Units offered as suggestions. Free text stays allowed — nobody's catalogue fits a fixed list. */
export const COMMON_UNITS = [
  "ea",
  "box",
  "pack",
  "set",
  "kg",
  "m",
  "hr",
  "day",
  "month",
  "licence",
];

/** Editor rows to the published shape: blanks dropped, quantities only when they are real. */
export function toLineItems(rows: LineItemRow[]): LineItem[] {
  return rows
    .map((r) => {
      const qty = Number(r.qty);
      return {
        item: r.item.trim(),
        ...(r.qty.trim() && Number.isFinite(qty) && qty > 0 ? { qty } : {}),
        ...(r.uom.trim() ? { uom: r.uom.trim() } : {}),
      };
    })
    .filter((l) => l.item.length > 0);
}

/**
 * Rows pasted from a spreadsheet.
 *
 * Excel and Sheets put a tab between cells and a newline between rows, which is the case worth
 * getting right: a buyer with a basket already in a spreadsheet should not retype it. Pipes are
 * accepted too since that was the previous format. Commas deliberately are not — "2D barcode
 * scanner, USB-C" is one item, and splitting on commas would quietly shred exactly the descriptive
 * names people use.
 */
export function parsePastedRows(text: string): LineItemRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.split("|");
      const [item = "", qty = "", uom = ""] = cells.map((c) => c.trim());
      return { id: `row-${++seq}`, item, qty, uom };
    })
    .filter((r) => r.item.length > 0);
}

/** Narrows whatever the metadata document happens to hold; a malformed list shows as none. */
export function readLineItems(published: unknown): LineItem[] {
  const raw = (published as { lineItems?: unknown } | null)?.lineItems;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
    .map((l) => ({
      item: String(l.item ?? "").trim(),
      ...(typeof l.qty === "number" && l.qty > 0 ? { qty: l.qty } : {}),
      ...(l.uom ? { uom: String(l.uom) } : {}),
    }))
    .filter((l) => l.item.length > 0);
}
