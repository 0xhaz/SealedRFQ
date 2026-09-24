/**
 * Shipment terms, and the document a supplier submits against a milestone of physical goods.
 *
 * These exist because "delivered" is not a fact the chain can establish, and without an agreed
 * meaning it is not a fact at all. EXW and DDP describe opposite obligations — under one the buyer
 * collects from the factory gate and owns the risk from that moment, under the other the supplier
 * pays duty and carries risk to the buyer's door — so a tender that names neither has not said what
 * the supplier is being paid to do. Alibaba's own dispute rules refuse a late-shipment claim
 * outright when the shipment term is ambiguous, which is the same observation with money attached.
 *
 * Everything here is published in the RFQ metadata, whose hash is fixed on-chain before bidding
 * opens. So the incoterm is a term of the tender in the same way the budget is: suppliers price
 * against it, and it cannot be changed afterwards without the hash no longer matching.
 *
 * What the chain still cannot do is confirm that a container exists or arrived. The shipping
 * document below is a record, not a proof: it is hashed, the hash is what the supplier submits, and
 * a buyer who receives the real documents can check they are the ones that were sealed. That is
 * worth having and it is not the same as verification, so nothing here claims to be.
 */

/** Incoterms 2020. The ones that actually appear in B2B goods tenders. */
export const INCOTERMS = [
  {
    value: "EXW",
    label: "EXW — Ex Works",
    note: "Buyer collects from the seller's premises and carries every cost and risk from there.",
  },
  {
    value: "FCA",
    label: "FCA — Free Carrier",
    note: "Seller hands over to the buyer's carrier, cleared for export.",
  },
  {
    value: "FOB",
    label: "FOB — Free On Board",
    note: "Sea freight. Risk passes when the goods are on board the vessel.",
  },
  {
    value: "CFR",
    label: "CFR — Cost and Freight",
    note: "Seller pays freight to the destination port; risk still passes on board.",
  },
  {
    value: "CIF",
    label: "CIF — Cost, Insurance and Freight",
    note: "As CFR, and the seller insures the cargo.",
  },
  {
    value: "CPT",
    label: "CPT — Carriage Paid To",
    note: "Seller pays carriage to the named place; risk passes at first carrier.",
  },
  { value: "CIP", label: "CIP — Carriage and Insurance Paid To", note: "As CPT, with insurance." },
  {
    value: "DAP",
    label: "DAP — Delivered At Place",
    note: "Seller delivers to the named place, ready for unloading. Buyer clears import.",
  },
  {
    value: "DPU",
    label: "DPU — Delivered At Place Unloaded",
    note: "As DAP, and the seller unloads.",
  },
  {
    value: "DDP",
    label: "DDP — Delivered Duty Paid",
    note: "Seller carries everything to the buyer's door, duty and import clearance included.",
  },
] as const;

export type Incoterm = (typeof INCOTERMS)[number]["value"];

export function isIncoterm(v: string): v is Incoterm {
  return INCOTERMS.some((i) => i.value === v);
}

export function incotermNote(v: string): string {
  return INCOTERMS.find((i) => i.value === v)?.note ?? "";
}

/**
 * Whether the seller or the buyer carries risk in transit under a given term.
 *
 * Decides who is out of pocket when a container is lost at sea, which is the question people
 * actually ask and the one the three-letter code answers least legibly.
 */
export function riskPassesAt(term: string): "seller's premises" | "on shipment" | "on arrival" {
  if (term === "EXW") return "seller's premises";
  if (["DAP", "DPU", "DDP"].includes(term)) return "on arrival";
  return "on shipment";
}

/** Published with the RFQ. Absent entirely for a tender that delivers a file. */
export type ShipmentTerms = {
  incoterm: Incoterm;
  /** Where the incoterm's named place is — a port, a city, a warehouse. Free text on purpose. */
  namedPlace: string;
  /** What the buyer expects to receive as proof of shipment. */
  documentsRequired?: string[];
  /** Notes a form cannot guess: packaging, labelling, temperature, hazardous goods. */
  notes?: string;
};

/**
 * What a supplier submits for a milestone that moves goods.
 *
 * Hashed, and the hash is what goes on-chain in the existing `deliverable` field — so this needs no
 * contract change and nothing about it is trusted. A buyer compares the documents they were sent
 * against the hash that was sealed; a mismatch means the record changed after the fact, which is
 * the only thing a hash can honestly tell them.
 */
export type ShippingDocument = {
  schema: "sealedrfq.shipment.v1";
  rfqId: number;
  milestone: number;
  incoterm: Incoterm;
  namedPlace: string;
  /** Who is carrying it, and the number the buyer can track it with. */
  carrier?: string;
  trackingNumber?: string;
  /** Bill of lading or air waybill number, for anything crossing a border. */
  billOfLading?: string;
  shippedAt: string;
  estimatedArrival?: string;
  /** sha256 of each supporting file, already in the document store. */
  documents?: { name: string; sha256: string }[];
  quantity?: { description: string; count: number; unit: string }[];
  notes?: string;
};

/**
 * A one-line summary for a buyer scanning a milestone.
 *
 * Deliberately leads with the tracking number, because that is the only field on the whole record
 * a buyer can independently check against a third party today.
 */
export function describeShipment(d: ShippingDocument): string {
  const who = d.carrier ? `${d.carrier} ` : "";
  const ref = d.trackingNumber ?? d.billOfLading;
  const eta = d.estimatedArrival ? `, ETA ${d.estimatedArrival}` : "";
  return `${who}${ref ? `${ref} ` : ""}· ${d.incoterm} ${d.namedPlace} · shipped ${d.shippedAt}${eta}`.trim();
}
