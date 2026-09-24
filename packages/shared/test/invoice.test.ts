import { describe, expect, it } from "vitest";
import {
  type InvoiceInput,
  type ProformaInput,
  buildInvoice,
  buildProforma,
  invoiceNumber,
  renderInvoice,
  renderProforma,
} from "../src/invoice.js";

const input: InvoiceInput = {
  rfqId: 5,
  milestone: 1,
  milestoneCount: 3,
  seller: { name: "Acme Instruments", address: "0xC6FD…851D", country: "MY" },
  buyer: { address: "0x3a9a…C88E" },
  awardPrice: "2800000",
  milestoneGross: "840000",
  retentionHeld: "84000",
  incoterm: "FOB",
  namedPlace: "Port Klang",
  issuedAt: "2026-09-24",
  lineItems: [{ description: "Barcode scanner, 2D, USB-C", quantity: 500, unit: "ea" }],
};

describe("buildInvoice", () => {
  it("nets the retention out of the milestone rather than off the total", () => {
    // 0.84 gross less 10% retention = 0.756, which is what the escrow actually releases.
    expect(buildInvoice(input).netPayable).toBe("756000");
  });

  it("numbers from the tender, so both sides derive the same reference", () => {
    // A counter would depend on who generated it and when; two parties reconciling one shipment
    // would then disagree about what to call it.
    expect(invoiceNumber(5, 1)).toBe("RFQ-0005-M1");
    expect(buildInvoice(input).number).toBe("RFQ-0005-M1");
    expect(buildInvoice({ ...input, milestone: 3 }).number).toBe("RFQ-0005-M3");
  });

  it("refuses a retention larger than the milestone it comes from", () => {
    expect(() => buildInvoice({ ...input, retentionHeld: "900000" })).toThrow(/cannot exceed/i);
  });

  it("is deterministic — the same inputs give the same document", () => {
    expect(renderInvoice(buildInvoice(input))).toBe(renderInvoice(buildInvoice(input)));
  });
});

describe("renderInvoice", () => {
  const text = renderInvoice(buildInvoice(input));

  it("states the four figures a buyer reconciles against", () => {
    expect(text).toContain("2.80 USDC"); // award price
    expect(text).toContain("0.84 USDC"); // this milestone
    expect(text).toContain("0.084 USDC"); // retention
    expect(text).toContain("0.756 USDC"); // net payable
  });

  it("carries the delivery terms and the goods", () => {
    expect(text).toContain("FOB Port Klang");
    expect(text).toContain("500 ea — Barcode scanner, 2D, USB-C");
  });

  it("disclaims being a tax invoice, which it is not", () => {
    expect(text).toMatch(/not a tax invoice/i);
    expect(text).toMatch(/retention is\s*\n?released on final acceptance/i);
  });

  it("omits sections it has no data for rather than printing empty headings", () => {
    const bare = renderInvoice(
      buildInvoice({ ...input, lineItems: undefined, incoterm: undefined, reference: undefined }),
    );
    expect(bare).not.toContain("GOODS");
    expect(bare).not.toContain("Delivery terms");
    expect(bare).not.toContain("Reference");
  });
});

describe("buildProforma", () => {
  const input: ProformaInput = {
    rfqId: 5,
    seller: { name: "Acme Instruments", address: "0xC6FD…851D", country: "MY" },
    buyer: { address: "0x3a9a…C88E" },
    awardPrice: "2800000",
    incoterm: "FOB",
    namedPlace: "Port Klang",
    issuedAt: "2026-09-24",
    validUntil: "2026-10-24",
    lines: [{ description: "Barcode scanner, 2D, USB-C", quantity: 500, unit: "ea" }],
    milestones: [
      { index: 1, label: "Deposit against production", amount: "840000" },
      { index: 2, label: "Balance against shipping documents", amount: "1960000" },
    ],
  };

  it("numbers in a series distinct from the commercial invoice", () => {
    // The two documents mean different things and must never be mistaken for one another.
    expect(buildProforma(input).number).toBe("RFQ-0005-PI");
    expect(buildProforma(input).number).not.toBe(invoiceNumber(5, 1));
  });

  it("covers the whole award, not one milestone", () => {
    expect(renderProforma(buildProforma(input))).toContain("2.80 USDC");
  });

  it("refuses to expire before it was issued", () => {
    expect(() => buildProforma({ ...input, validUntil: "2026-09-01" })).toThrow(/expire before/i);
  });

  it("says it is not a demand for payment", () => {
    // The one sentence that distinguishes it from the commercial invoice. A proforma read as a
    // bill is how a buyer pays twice.
    const text = renderProforma(buildProforma(input));
    expect(text).toMatch(/not a demand for payment/i);
    expect(text).toContain("PROFORMA INVOICE");
  });

  it("names what customs will want and this document does not carry", () => {
    // Silence here would be worse than the omission: a buyer presents it, it is refused, and
    // nothing told them why.
    const text = renderProforma(buildProforma(input));
    expect(text).toMatch(/tariff classification/i);
    expect(text).toMatch(/country of origin/i);
  });

  it("stops warning once the seller supplies them", () => {
    const withCustoms = buildProforma({
      ...input,
      lines: [{ ...input.lines![0], hsCode: "8471.60", countryOfOrigin: "CN" }],
    });
    const text = renderProforma(withCustoms);
    expect(text).toContain("HS 8471.60");
    expect(text).toContain("origin CN");
    expect(text).not.toMatch(/Not stated on this document/i);
  });

  it("shows the payment schedule, which is what a bank or an authority asks for", () => {
    const text = renderProforma(buildProforma(input));
    expect(text).toContain("PAYMENT SCHEDULE");
    expect(text).toContain("0.84 USDC");
    expect(text).toContain("1.96 USDC");
  });
});
