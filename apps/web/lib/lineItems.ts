/**
 * The basket a buyer asks suppliers to quote against.
 *
 * A classic RFQ is a list of items with quantities, and the supplier returns a priced quotation.
 * Only the total is settled on-chain — that is what gets escrowed and paid — but the list itself
 * rides in the metadata document whose sha256 is fixed when the RFQ opens, so the basket cannot be
 * changed after bids are in. A supplier can prove they quoted the same items everyone else did.
 *
 * Entered one item per line, `item | qty | uom`, because people paste these out of a spreadsheet
 * and anything requiring a row editor gets abandoned halfway. Quantity and unit are optional: a
 * line with neither is still a line worth quoting.
 */
export type LineItem = { item: string; qty?: number; uom?: string };

export function parseLineItems(text: string): LineItem[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [item, qty, uom] = line.split("|").map((p) => p.trim());
      const quantity = Number(qty);
      return {
        item: item || line,
        ...(qty && Number.isFinite(quantity) && quantity > 0 ? { qty: quantity } : {}),
        ...(uom ? { uom } : {}),
      };
    })
    .filter((l) => l.item.length > 0);
}

/** Back to the editable text, so a buyer can reopen what they typed. */
export function formatLineItems(items: LineItem[]): string {
  return items
    .map((l) =>
      [l.item, l.qty ?? "", l.uom ?? ""]
        .join(" | ")
        .replace(/\s*\|\s*$/, "")
        .trim(),
    )
    .join("\n");
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
