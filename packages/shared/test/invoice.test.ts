import { describe, expect, it } from "vitest";
import { type InvoiceInput, buildInvoice, invoiceNumber, renderInvoice } from "../src/invoice.js";

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
