import { describe, expect, it } from "vitest";
import { MAX_INVITEES, parseInvitees } from "../lib/invitees.js";

const A = "0xC6FD9B17137945b0399a0e923F45056fE107851D";
const B = "0x4592DC5fdE2c2D7BDb5570F343c30aC5baA1dF99";

describe("parseInvitees", () => {
  it("accepts whatever separator the paste happened to use", () => {
    for (const text of [
      `${A}\n${B}`,
      `${A}, ${B}`,
      `${A} ${B}`,
      `${A};${B}`,
      `\n ${A} ,\n${B}\n`,
    ]) {
      expect(parseInvitees(text).addresses).toEqual([A.toLowerCase(), B.toLowerCase()]);
    }
  });

  it("treats one address in two casings as one supplier", () => {
    // The contract stores a set, so this must not send a duplicate.
    const r = parseInvitees(`${A}\n${A.toLowerCase()}\n${A.toUpperCase().replace("0X", "0x")}`);
    expect(r.addresses).toHaveLength(1);
  });

  it("reports what is not an address without discarding it silently", () => {
    const r = parseInvitees(`${A}\nacme-corp\n0x123`);
    expect(r.addresses).toEqual([A.toLowerCase()]);
    // Kept verbatim so the message can quote the offending text back to the user.
    expect(r.invalid).toEqual(["acme-corp", "0x123"]);
  });

  it("flags a list the contract would reject", () => {
    const under = Array.from(
      { length: MAX_INVITEES },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`,
    ).join("\n");
    expect(parseInvitees(under).tooMany).toBe(false);

    const over = `${under}\n0x${"f".repeat(40)}`;
    expect(parseInvitees(over).tooMany).toBe(true);
  });

  it("is empty for empty input rather than throwing", () => {
    expect(parseInvitees("")).toEqual({ addresses: [], invalid: [], tooMany: false });
    expect(parseInvitees("   \n  ").addresses).toEqual([]);
  });
});
