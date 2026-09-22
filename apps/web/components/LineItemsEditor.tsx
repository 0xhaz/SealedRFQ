"use client";

import {
  COMMON_UNITS,
  type LineItemRow,
  emptyRow,
  parsePastedRows,
  toLineItems,
} from "@/lib/lineItems";

type Props = {
  rows: LineItemRow[];
  onChange: (rows: LineItemRow[]) => void;
};

/**
 * The basket, as rows rather than punctuation.
 *
 * Pasting is the case worth handling properly: a buyer with a basket already in a spreadsheet
 * should not retype it, so a multi-cell paste into any item field expands into rows from that point
 * instead of dropping a wall of tabs into one input.
 */
export function LineItemsEditor({ rows, onChange }: Props) {
  const set = (i: number, patch: Partial<LineItemRow>) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const add = () => onChange([...rows, emptyRow()]);

  /** Always leave one row behind: an empty grid gives nothing to type into. */
  const remove = (i: number) => {
    const left = rows.filter((_, n) => n !== i);
    onChange(left.length ? left : [emptyRow()]);
  };

  const counted = toLineItems(rows).length;

  return (
    <div className="lines">
      <div className="lines-head">
        <span>Item</span>
        <span>Qty</span>
        <span>Unit</span>
        <span />
      </div>

      {rows.map((row, i) => (
        <div className="lines-row" key={row.id}>
          <input
            aria-label={`Item ${i + 1}`}
            placeholder="2D barcode scanner, USB-C"
            value={row.item}
            onChange={(e) => set(i, { item: e.target.value })}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!/[\t\n|]/.test(text)) return; // an ordinary paste of one name
              e.preventDefault();
              const pasted = parsePastedRows(text);
              if (!pasted.length) return;
              onChange([...rows.slice(0, i), ...pasted, ...rows.slice(i + 1)]);
            }}
          />
          <input
            aria-label={`Quantity for item ${i + 1}`}
            inputMode="numeric"
            placeholder="500"
            value={row.qty}
            onChange={(e) => set(i, { qty: e.target.value })}
          />
          <input
            aria-label={`Unit for item ${i + 1}`}
            list="uom-options"
            placeholder="ea"
            value={row.uom}
            onChange={(e) => set(i, { uom: e.target.value })}
          />
          <button
            type="button"
            className="lines-remove"
            aria-label={`Remove item ${i + 1}`}
            title="Remove"
            onClick={() => remove(i)}
          >
            ×
          </button>
        </div>
      ))}

      <datalist id="uom-options">
        {COMMON_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <div className="lines-foot">
        <button type="button" className="btn-outline" onClick={add}>
          + Add item
        </button>
        <span className="hint">
          {counted > 0
            ? `${counted} item${counted === 1 ? "" : "s"} — suppliers quote one total for the list, and it cannot change once bidding opens.`
            : "Optional. Leave empty for a single-line buy. You can paste straight from a spreadsheet."}
        </span>
      </div>
    </div>
  );
}
