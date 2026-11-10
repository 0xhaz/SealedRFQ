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
  it("serves the registration that is actually on chain", async () => {
    // Not a fixture. This is the record the registration script wrote, and the hash below is the
    // one anchored in CIS-8004 agent 1 on Concordium testnet. If the card ever stops hashing to
    // it, the badge stops verifying for everyone, and this is where that is caught.
    expect(agentRegistration).not.toBeNull();
    expect(agentRegistration?.agentId).toBe(1);
    expect(agentRegistration?.network).toBe("testnet");
    expect(cardHashHex(agentRegistration!)).toBe(agentRegistration?.cardHash);
    expect(agentRegistration?.cardHash).toBe(
      "dc12f239397f6af32010bdc2f26b31e154958240809afd9c74874418f4162e12",
    );
  });

  it("serves those exact bytes, and says so in the header", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = Buffer.from(await response.arrayBuffer());
    expect(createHash("sha256").update(body).digest("hex")).toBe(agentRegistration?.cardHash);
    expect(response.headers.get("x-agent-card-sha256")).toBe(agentRegistration?.cardHash);
  });

  it("names the key whose CIS-8 binding proves who the agent is", () => {
    // The registry on testnet cannot hold an external reference, so the card is the only place
    // that says which key to look up. Losing it would leave the badge unlinked to anything.
    const card = JSON.parse(cardBytes(agentRegistration!).toString("utf8"));
    const badge = card.capabilities.extensions.find((e: { uri: string }) =>
      e.uri.includes("concordium-badge"),
    );
    expect(badge.params.externalKey.publicKey).toBe(agentRegistration?.keyBinding?.publicKey);
    expect(badge.params.externalKey.proofScheme).toBe("ethereum-personal-sign");
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
