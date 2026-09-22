import { stringToHex } from "viem";
import { describe, expect, it } from "vitest";
import { CATEGORIES, REGIONS, labelFor } from "../lib/taxonomy.js";

/** What NewRfqForm does to a label before it reaches the chain. */
const label32 = (s: string) => stringToHex(s.slice(0, 31).toUpperCase(), { size: 32 });

describe("taxonomy values", () => {
  const all = [...CATEGORIES, ...REGIONS];

  it("every value survives bytes32 without being truncated", () => {
    // Longer than 31 characters is silently cut on the way in, so a value that does not fit is a
    // label that quietly becomes a different one.
    for (const o of all) {
      expect(o.value.length, o.value).toBeLessThanOrEqual(31);
      expect(label32(o.value)).toBe(stringToHex(o.value, { size: 32 }));
    }
  });

  it("values are already upper case, so encoding does not change them", () => {
    // label32 upper-cases; a value that is not already upper case would be stored as something
    // other than what this list says.
    for (const o of all) expect(o.value, o.value).toBe(o.value.toUpperCase());
  });

  it("values are unique within each list", () => {
    expect(new Set(CATEGORIES.map((c) => c.value)).size).toBe(CATEGORIES.length);
    expect(new Set(REGIONS.map((r) => r.value)).size).toBe(REGIONS.length);
  });

  it("labels are distinct, so two options never read the same", () => {
    expect(new Set(all.map((o) => o.label)).size).toBe(all.length);
  });
});

describe("labelFor", () => {
  it("reads back the human label", () => {
    expect(labelFor(CATEGORIES, "SOFTWARE")).toBe("Software and licences");
    expect(labelFor(REGIONS, "SEA")).toBe("South East Asia");
  });

  it("falls back to the stored value for RFQs posted before this list existed", () => {
    // The chain holds whatever earlier buyers typed; the board must still show it.
    expect(labelFor(CATEGORIES, "WIDGETS")).toBe("WIDGETS");
    expect(labelFor(REGIONS, "US")).toBe("US");
  });
});
