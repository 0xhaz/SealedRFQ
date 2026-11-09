import { createHash } from "node:crypto";
import { cardBytes, cardHashHex } from "@sealedrfq/concordium";
import { describe, expect, it } from "vitest";
import { GET } from "../app/.well-known/agent-card.json/route";
import { agentRegistration } from "../lib/v2/agentRegistration";

const EXAMPLE = {
  network: "testnet" as const,
  origin: "https://www.sealedrfq.com",
  agentId: 1n,
  owner: "4FCA4rWQ2DpNW2eKF9MSnH6G17TQ1bWo2j7KiH8SvaqPV9254W",
};

describe("the agent card route", () => {
  it("claims no badge until a registration exists", async () => {
    // The committed record is a placeholder, so this is the state the site ships in. A card that
    // named a registration which did not exist would be worse than no card: the badge is an
    // invitation to rely on it.
    expect(agentRegistration).toBeNull();
    const response = GET();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_registered" });
  });

  it("serves bytes that hash to the value anchored on chain", async () => {
    // The invariant the badge rests on. Returning an object for the framework to serialise would
    // let a key reorder break every verification while the page still looked correct, so the route
    // writes `cardBytes` through unchanged and this proves the bytes survive the Response.
    const body = Buffer.from(await new Response(Uint8Array.from(cardBytes(EXAMPLE))).arrayBuffer());
    expect(body).toStrictEqual(cardBytes(EXAMPLE));
    expect(createHash("sha256").update(body).digest("hex")).toBe(cardHashHex(EXAMPLE));
  });

  it("is readable cross-origin, because verifying it happens from somewhere else", () => {
    // A verifier runs in someone else's page or someone else's script. Without this header the
    // card is only checkable by us, which defeats the point of publishing a hash.
    const headers = GET().headers;
    expect(headers.get("access-control-allow-origin")).toBe("*");
  });
});
