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

/**
 * A proforma invoice, issued at award rather than against delivered work.
 *
 * Worth being precise about why this exists, because most of what a proforma traditionally does is
 * already done better here. It exists to let a buyer raise internal approval, to show a supplier's
 * offer is firm, to justify an advance payment or open a letter of credit — and on this system the
 * tender pack is the authorisation, the bid is committed on-chain and cannot be revised, and the
 * money was escrowed before bidding opened, which a supplier can verify rather than take on trust.
 * A document asserting payment will come is a weaker claim than escrow that can be checked.
 *
 * What none of that replaces is **customs**. Import licences and pre-clearance in many
 * jurisdictions want a proforma before goods move, and no amount of on-chain escrow substitutes
 * for the document an authority asks for. That is the case this serves, and the only one.
 *
 * Two fields come from the supplier rather than from the tender, because the tender does not know
 * them and cannot: the country the goods originate in, and their tariff classification. Neither is
 * the supplier's own country — goods made in one place by a company registered in another are the
 * ordinary case, not an edge one.
 */
export type ProformaLine = InvoiceLine & {
  /** Harmonised System code. Customs classifies by this, not by the description. */
  hsCode?: string;
  /** Where the goods were produced. Not the supplier's address. */
  countryOfOrigin?: string;
  /** Unit price in 6-decimal USDC, when the tender priced per line rather than in total. */
  unitPrice?: string;
};

export type ProformaInput = {
  rfqId: number;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  /** The whole award, not one milestone. */
  awardPrice: string;
  incoterm?: string;
  namedPlace?: string;
  /** How the award is split, so a bank or an authority can see the payment schedule. */
  milestones?: { index: number; label: string; amount: string }[];
  lines?: ProformaLine[];
  /** ISO date. Passed in, so the same inputs give the same document. */
  issuedAt: string;
  /** ISO date. A proforma with no expiry is a price the supplier is held to indefinitely. */
  validUntil?: string;
  notes?: string;
};

export type Proforma = ProformaInput & {
  schema: "sealedrfq.proforma.v1";
  number: string;
};

/** Distinct from the commercial invoice's series, so the two are never mistaken for each other. */
export function proformaNumber(rfqId: number): string {
  return `RFQ-${String(rfqId).padStart(4, "0")}-PI`;
}

export function buildProforma(input: ProformaInput): Proforma {
  if (input.validUntil && input.validUntil < input.issuedAt) {
    throw new Error("A proforma cannot expire before it is issued.");
  }
  return { ...input, schema: "sealedrfq.proforma.v1", number: proformaNumber(input.rfqId) };
}

export function renderProforma(p: Proforma): string {
  const party = (x: InvoiceParty) =>
    [x.name ?? "(no published name)", x.address, x.country, x.contact].filter(Boolean).join("\n");

  const lines = (p.lines ?? []).map((l) => {
    const bits = [`  ${l.quantity} ${l.unit} — ${l.description}`];
    if (l.hsCode) bits.push(`HS ${l.hsCode}`);
    if (l.countryOfOrigin) bits.push(`origin ${l.countryOfOrigin}`);
    if (l.unitPrice) bits.push(`@ ${formatUsdc(BigInt(l.unitPrice))} USDC`);
    return bits.join("  ·  ");
  });

  const schedule = (p.milestones ?? []).map(
    (m) => `  ${m.index}. ${m.label.padEnd(28)} ${formatUsdc(BigInt(m.amount))} USDC`,
  );

  const missing = [
    (p.lines ?? []).some((l) => l.hsCode) ? null : "tariff classification (HS codes)",
    (p.lines ?? []).some((l) => l.countryOfOrigin) ? null : "country of origin",
  ].filter(Boolean);

  return [
    `PROFORMA INVOICE   ${p.number}`,
    `Issued ${p.issuedAt}${p.validUntil ? `   ·   Valid until ${p.validUntil}` : ""}`,
    "",
    "SELLER",
    party(p.seller),
    "",
    "BUYER",
    party(p.buyer),
    "",
    `Tender                    RFQ № ${p.rfqId}`,
    ...(p.incoterm
      ? [`Delivery terms            ${p.incoterm} ${p.namedPlace ?? ""}`.trimEnd()]
      : []),
    "",
    ...(lines.length ? ["GOODS", ...lines, ""] : []),
    line("Total", `${formatUsdc(BigInt(p.awardPrice))} USDC`),
    "",
    ...(schedule.length ? ["PAYMENT SCHEDULE", ...schedule, ""] : []),
    "Payment is held in escrow on Arc against this tender and releases milestone by milestone as",
    "work is accepted. Funds were committed before bidding opened and can be verified on-chain.",
    "",
    "THIS IS A PROFORMA INVOICE. It is not a demand for payment and no payment is due against it.",
    "It is issued for customs, import licensing and the buyer's internal authorisation.",
    ...(missing.length
      ? [
          "",
          `Not stated on this document: ${missing.join(", ")}. Many customs`,
          "authorities require them; ask the seller to reissue with them if yours does.",
        ]
      : []),
    ...(p.notes ? ["", p.notes] : []),
  ].join("\n");
}
