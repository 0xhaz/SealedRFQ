import { describe, expect, it } from "vitest";
import {
  INCOTERMS,
  type ShippingDocument,
  describeShipment,
  incotermNote,
  isIncoterm,
  riskPassesAt,
} from "../src/shipment.js";

describe("incoterms", () => {
  it("covers the 2020 set and nothing invented", () => {
    expect(INCOTERMS).toHaveLength(10);
    expect(isIncoterm("DDP")).toBe(true);
    expect(isIncoterm("FOB")).toBe(true);
    // Retired in 2020 and still widely mistyped; accepting it would publish a term with no
    // agreed meaning, which is the exact ambiguity these exist to remove.
    expect(isIncoterm("DAT")).toBe(false);
    expect(isIncoterm("")).toBe(false);
  });

  it("says where risk passes, which is the question people actually ask", () => {
    expect(riskPassesAt("EXW")).toBe("seller's premises");
    expect(riskPassesAt("FOB")).toBe("on shipment");
    expect(riskPassesAt("CIF")).toBe("on shipment");
    // The D-terms are the only ones where a container lost at sea is still the seller's problem.
    expect(riskPassesAt("DAP")).toBe("on arrival");
    expect(riskPassesAt("DDP")).toBe("on arrival");
  });

  it("gives every term a plain-English note", () => {
    for (const t of INCOTERMS) expect(incotermNote(t.value).length).toBeGreaterThan(20);
    expect(incotermNote("NOPE")).toBe("");
  });
});

describe("describeShipment", () => {
  const base: ShippingDocument = {
    schema: "sealedrfq.shipment.v1",
    rfqId: 5,
    milestone: 1,
    incoterm: "FOB",
    namedPlace: "Port Klang",
    shippedAt: "2026-09-24",
  };

  it("leads with the reference a buyer can check with a third party", () => {
    const line = describeShipment({ ...base, carrier: "Maersk", trackingNumber: "MAEU1234567" });
    expect(line).toContain("Maersk");
    expect(line).toContain("MAEU1234567");
    expect(line).toContain("FOB Port Klang");
  });

  it("falls back to the bill of lading when there is no tracking number", () => {
    expect(describeShipment({ ...base, billOfLading: "BL-99" })).toContain("BL-99");
  });

  it("reads cleanly when only the required fields are present", () => {
    expect(describeShipment(base)).toBe("· FOB Port Klang · shipped 2026-09-24");
  });
});
