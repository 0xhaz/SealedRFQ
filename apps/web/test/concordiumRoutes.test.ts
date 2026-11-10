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

const post = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });

describe("the challenge route", () => {
  it("refuses a body that is not JSON", async () => {
    const response = await challenge(new Request("http://localhost/api", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
  });

  it("refuses a tender id that is not a positive integer", async () => {
    for (const tenderId of [0, -1, 1.5, "1", null, undefined]) {
      expect((await challenge(post({ tenderId }))).status).toBe(400);
    }
  });
});

describe("the verify route", () => {
  it("refuses a challenge that is not 32 bytes of hex", async () => {
    for (const c of ["", "zz", "ab".repeat(31), "ab".repeat(33), 42]) {
      const response = await verify(post({ tenderId: 1, challenge: c, presentation: {} }));
      expect(response.status).toBe(400);
    }
  });

  it("refuses a missing presentation", async () => {
    const response = await verify(post({ tenderId: 1, challenge: "ab".repeat(32) }));
    expect(response.status).toBe(400);
  });

  it("refuses a tender id that is not a positive integer", async () => {
    const response = await verify(post({ tenderId: 0, challenge: "ab".repeat(32), presentation: {} }));
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
    expect(purposeFor(1)).toBe("tender:1:bid");
    expect(purposeFor(1)).not.toBe(purposeFor(2));
    expect(purposeFor(1, "award")).not.toBe(purposeFor(1, "bid"));
  });

  it("states its limits in the description the supplier is shown", () => {
    expect(QUALIFICATION_DESCRIPTION).toMatch(/does not prove/);
    expect(QUALIFICATION_DESCRIPTION).toContain("without revealing which");
  });
});
