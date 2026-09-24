import { formatUsdc } from "./usdc.js";

/**
 * A commercial invoice, built from figures the tender already fixed.
 *
 * Generated rather than typed for the same reason the terms are: every number on it is already
 * settled and agreed, and re-entering them by hand is an invitation to write something the escrow
 * contradicts. The award price, the milestone split, the retention rate, the line items and both
 * parties are all published or on-chain before this is drawn up, so the invoice restates them
 * rather than asserting anything new.
 *
 * Two honest limits, stated here because an invoice that overstates its own authority is worse than
 * none. This is **not a tax invoice**: it carries no tax registration, no VAT or GST treatment and
 * no jurisdiction, because nothing in the tender establishes any of them. And it proves payment is
 * *due* under the contract, not that goods exist — customs will want the packing list and the bill
 * of lading alongside it, which travel as separate documents.
 *
 * Amounts are in USDC because that is what the escrow settles in, and there is no exchange rate
 * anywhere in this system to convert them with.
 */

export type InvoiceParty = {
  /** What the party calls itself, if it has published a supplier profile. */
  name?: string;
  address: string;
  contact?: string;
  country?: string;
};

export type InvoiceLine = { description: string; quantity: number; unit: string };

export type InvoiceInput = {
  rfqId: number;
  /** 1-based, as people count them. */
  milestone: number;
  milestoneCount: number;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  /** Atomic 6-decimal units, as the chain holds them. */
  awardPrice: string;
  milestoneGross: string;
  retentionHeld: string;
  incoterm?: string;
  namedPlace?: string;
  /** ISO date. Passed in rather than read from a clock, so the same inputs give the same document. */
  issuedAt: string;
  lineItems?: InvoiceLine[];
  reference?: string;
};

export type Invoice = InvoiceInput & {
  schema: "sealedrfq.invoice.v1";
  /** What this milestone actually pays out: gross less the retention held back from it. */
  netPayable: string;
  number: string;
};

/**
 * A stable invoice number.
 *
 * Derived from the tender and the milestone rather than a counter, so the same milestone always
 * produces the same number — a counter would depend on who generated it and in what order, and two
 * parties reconciling the same shipment would disagree about what to call it.
 */
export function invoiceNumber(rfqId: number, milestone: number): string {
  return `RFQ-${String(rfqId).padStart(4, "0")}-M${milestone}`;
}

export function buildInvoice(input: InvoiceInput): Invoice {
  const gross = BigInt(input.milestoneGross);
  const retained = BigInt(input.retentionHeld);
  if (retained > gross) throw new Error("Retention cannot exceed the milestone it is held from.");
  return {
    ...input,
    schema: "sealedrfq.invoice.v1",
    netPayable: (gross - retained).toString(),
    number: invoiceNumber(input.rfqId, input.milestone),
  };
}

const line = (label: string, value: string) => `${label.padEnd(26)}${value}`;

/**
 * The invoice as text, for printing or attaching.
 *
 * Plain text rather than a PDF because the hash is what matters: a buyer checks the document they
 * received against the hash sealed on-chain, and bytes that survive being emailed do that better
 * than a rendering that differs between viewers.
 */
export function renderInvoice(inv: Invoice): string {
  const party = (p: InvoiceParty) =>
    [p.name ?? "(no published name)", p.address, p.country, p.contact].filter(Boolean).join("\n");

  const rows = (inv.lineItems ?? []).map((l) => `  ${l.quantity} ${l.unit} — ${l.description}`);

  return [
    `COMMERCIAL INVOICE   ${inv.number}`,
    `Issued ${inv.issuedAt}`,
    "",
    "SELLER",
    party(inv.seller),
    "",
    "BUYER",
    party(inv.buyer),
    "",
    `Tender                    RFQ № ${inv.rfqId}`,
    `Milestone                 ${inv.milestone} of ${inv.milestoneCount}`,
    ...(inv.incoterm
      ? [`Delivery terms            ${inv.incoterm} ${inv.namedPlace ?? ""}`.trimEnd()]
      : []),
    ...(inv.reference ? [`Reference                 ${inv.reference}`] : []),
    "",
    ...(rows.length ? ["GOODS", ...rows, ""] : []),
    line("Award price (total)", `${formatUsdc(BigInt(inv.awardPrice))} USDC`),
    line("This milestone", `${formatUsdc(BigInt(inv.milestoneGross))} USDC`),
    line("Retention held back", `${formatUsdc(BigInt(inv.retentionHeld))} USDC`),
    line("Net payable now", `${formatUsdc(BigInt(inv.netPayable))} USDC`),
    "",
    "Payable in USDC by release of the milestone escrow held for this tender. Retention is",
    "released on final acceptance, not against this invoice.",
    "",
    "Not a tax invoice: no tax registration, VAT or GST treatment is asserted. Goods are",
    "evidenced by the packing list and transport documents travelling with this shipment.",
  ].join("\n");
}
