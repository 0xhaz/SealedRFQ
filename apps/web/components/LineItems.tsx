import { readLineItems } from "@/lib/lineItems";

/**
 * What the buyer asked to be quoted.
 *
 * The list lives in the metadata document whose hash is fixed when the RFQ opens, so the basket
 * cannot grow or change after bids are sealed. Only the total settles on-chain — that is what is
 * escrowed and paid — and the composition behind it belongs in the supplier's quotation, which is
 * hashed into the bid for the same reason.
 */
export function LineItems({ metadataURI }: { metadataURI?: string | null }) {
  if (!metadataURI) return null;

  let items: ReturnType<typeof readLineItems> = [];
  let contact: string | null = null;
  try {
    const published = JSON.parse(metadataURI) as { contact?: unknown };
    items = readLineItems(published);
    contact = typeof published.contact === "string" ? published.contact : null;
  } catch {
    return null; // metadata is a bare URI or free text
  }
  if (items.length === 0 && !contact) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h3>
          What to quote <span className="hint">{items.length} line items</span>
        </h3>
      </div>
      <div className="card-body">
        {items.length > 0 && (
          <>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={`${l.item}-${l.qty ?? ""}-${l.uom ?? ""}`}>
                    <td>{l.item}</td>
                    <td style={{ textAlign: "right" }}>{l.qty ?? "—"}</td>
                    <td>{l.uom ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {contact && (
              <div className="note">
                <b>Send your priced quotation to {contact}</b>, and put your own contact details
                inside it — that document goes to the buyer alone, so it is the private half of this
                exchange.
              </div>
            )}
            <div className="note">
              Bid <b>one total</b> for this list. Attach your priced quotation with the bid: its
              hash is sealed alongside the price, so the breakdown behind your number cannot be
              revised after rival bids open — and the buyer can check the file they receive against
              it.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
