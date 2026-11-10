/**
 * Input validation on the Concordium routes.
 *
 * Deliberately only the paths that reject before reaching the database or the chain, so these run
 * anywhere. The parts that do reach them are covered where they live: the challenge store against
 * a real Postgres in `@sealedrfq/db`, and the verifier against the real wasm in
 * `@sealedrfq/concordium`.
 */
import { describe, expect, it } from "vitest";
import { POST as challenge } from "../app/api/concordium/challenge/route";
import { POST as verify } from "../app/api/concordium/verify/route";
import {
  QUALIFICATION_DESCRIPTION,
  QUALIFICATION_STATEMENT,
  purposeFor,
} from "../lib/v2/qualification";

const BIDDER = "0x52908400098527886E0F7030069857D2E4169EE7"; // a checksummed address

const post = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });

describe("the challenge route", () => {
  it("refuses a body that is not JSON", async () => {
    const response = await challenge(new Request("http://localhost/api", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
  });

  it("refuses a tender id that is not a positive integer", async () => {
    for (const tenderId of [0, -1, 1.5, "1", null, undefined]) {
      expect((await challenge(post({ tenderId, bidder: BIDDER }))).status).toBe(400);
    }
  });

  it("refuses a missing or malformed bidder address", async () => {
    for (const bidder of [undefined, "", "0x123", "not an address", 7, `0x${"g".repeat(40)}`]) {
      expect((await challenge(post({ tenderId: 1, bidder }))).status).toBe(400);
    }
  });
});

describe("the verify route", () => {
  it("refuses a challenge that is not 32 bytes of hex", async () => {
    for (const c of ["", "zz", "ab".repeat(31), "ab".repeat(33), 42]) {
      const response = await verify(post({ tenderId: 1, bidder: BIDDER, challenge: c, presentation: {} }));
      expect(response.status).toBe(400);
    }
  });

  it("refuses a missing presentation", async () => {
    const response = await verify(post({ tenderId: 1, bidder: BIDDER, challenge: "ab".repeat(32) }));
    expect(response.status).toBe(400);
  });

  it("refuses a missing or malformed bidder address", async () => {
    for (const bidder of [undefined, "0x123", 7]) {
      const response = await verify(
        post({ tenderId: 1, bidder, challenge: "ab".repeat(32), presentation: {} }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("refuses a tender id that is not a positive integer", async () => {
    const response = await verify(post({ tenderId: 0, bidder: BIDDER, challenge: "ab".repeat(32), presentation: {} }));
    expect(response.status).toBe(400);
  });
});

describe("the qualification policy", () => {
  it("asks the same question on the way out and on the way back", () => {
    // Both routes import the one statement. If the request and the check could drift, the check
    // would be verifying a question nobody asked, and it would still look like it was working.
    expect(QUALIFICATION_STATEMENT[0].statement[0].type).toBe("AttributeInSet");
  });

  it("scopes a challenge to one tender, so a proof cannot be carried to another", () => {
    expect(purposeFor(1, BIDDER)).toBe(`tender:1:bid:${BIDDER.toLowerCase()}`);
    expect(purposeFor(1, BIDDER)).not.toBe(purposeFor(2, BIDDER));
    expect(purposeFor(1, BIDDER, "award")).not.toBe(purposeFor(1, BIDDER, "bid"));
  });

  it("scopes a challenge to one bidder, and one address has one purpose in any casing", () => {
    const other = "0x000000000000000000000000000000000000dEaD";
    expect(purposeFor(1, BIDDER)).not.toBe(purposeFor(1, other));
    expect(purposeFor(1, BIDDER)).toBe(purposeFor(1, BIDDER.toLowerCase()));
  });

  it("fits the 200 characters the purpose column allows", () => {
    expect(purposeFor(Number.MAX_SAFE_INTEGER, BIDDER).length).toBeLessThan(200);
  });

  it("states its limits in the description the supplier is shown", () => {
    expect(QUALIFICATION_DESCRIPTION).toMatch(/does not prove/);
    expect(QUALIFICATION_DESCRIPTION).toContain("without revealing which");
  });
});
