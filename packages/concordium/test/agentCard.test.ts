import { ContractAddress, tokenAddressFromBase58, tokenAddressToBase58 } from "@concordium/web-sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import {
  agentCard,
  agentIdFromTokenId,
  agentTokenId,
  cardBytes,
  cardHashHex,
} from "../src/index.js";
import { REGISTRY } from "../src/index.js";

const INPUT = {
  network: "testnet" as const,
  origin: "https://sealedrfq.example",
  agentId: 1n,
  owner: "4FCA4rWQ2DpNW2eKF9MSnH6G17TQ1bWo2j7KiH8SvaqPV9254W",
};

describe("agent token ids", () => {
  it("is little-endian, matching how the chain reads agent 0 back", () => {
    expect(agentTokenId(0)).toBe("0000000000000000");
    expect(agentTokenId(1)).toBe("0100000000000000");
    expect(agentTokenId(1007)).toBe("ef03000000000000");
  });

  it("round-trips", () => {
    for (const id of [0n, 1n, 255n, 256n, 1007n, 2n ** 63n]) {
      expect(agentIdFromTokenId(agentTokenId(id))).toBe(id);
    }
  });

  it("refuses an id that does not fit a u64", () => {
    expect(() => agentTokenId(2n ** 64n)).toThrow(RangeError);
    expect(() => agentTokenId(-1)).toThrow(RangeError);
  });
});

describe("token address encoding", () => {
  // The card embeds a base58 CIS-2 token address. This package encodes it by hand rather than
  // pulling the SDK's wasm into the web bundle, so the hand-rolled encoder is checked against the
  // SDK's own on every id that matters.
  it("agrees with the SDK's encoder", () => {
    for (const id of [0n, 1n, 1007n, 65_535n, 2n ** 40n]) {
      const fromSdk = tokenAddressToBase58({
        contract: ContractAddress.create(REGISTRY.testnet.index, REGISTRY.testnet.subindex),
        id: agentTokenId(id),
      });
      const params = agentCard({ ...INPUT, agentId: id }).capabilities as {
        extensions: { params: { tokenAddress: string } }[];
      };
      expect(params.extensions[0].params.tokenAddress).toBe(
        `ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:${fromSdk}`,
      );
    }
  });

  it("decodes the reference card's token address to its stated agent id", () => {
    // The only independent confirmation of the byte order: the card published by the registry
    // authors says agentId 1007, and its base58 address only decodes to that under u64 LE.
    const decoded = tokenAddressFromBase58("JyP9YQ12p23Tk9iFqSYa8");
    expect(decoded.contract.index).toBe(12802n);
    expect(agentIdFromTokenId(decoded.id)).toBe(1007n);
  });
});

describe("card bytes", () => {
  it("hashes to the same value every time", () => {
    expect(cardHashHex(INPUT)).toBe(cardHashHex(INPUT));
    expect(Buffer.from(sha256(cardBytes(INPUT))).toString("hex")).toBe(cardHashHex(INPUT));
  });

  it("is canonical JSON, so key order in the source cannot change the hash", () => {
    const text = cardBytes(INPUT).toString("utf8");
    const keys = Object.keys(JSON.parse(text));
    expect(keys).toStrictEqual([...keys].sort());
    expect(text).not.toContain("\n");
  });

  it("changes when the agent id changes", () => {
    expect(cardHashHex({ ...INPUT, agentId: 2n })).not.toBe(cardHashHex(INPUT));
  });

  it("changes when the origin changes, since the URL is part of what is attested", () => {
    expect(cardHashHex({ ...INPUT, origin: "https://elsewhere.example" })).not.toBe(
      cardHashHex(INPUT),
    );
  });

  it("names the right registry for each network", () => {
    const reg = (network: "mainnet" | "testnet") =>
      (agentCard({ ...INPUT, network }).registrations as { agentRegistry: string }[])[0]
        .agentRegistry;
    expect(reg("testnet")).toBe("ccd:4221332d34e1694168c2a0c0b3fd0f27:13042.0");
    expect(reg("mainnet")).toBe("ccd:9dd9ca4d19e9393877d2c44b70f89acb:10082.0");
  });

  it("claims no capability the agent does not have", () => {
    const card = agentCard(INPUT);
    const caps = card.capabilities as { streaming: boolean; pushNotifications: boolean };
    expect(caps.streaming).toBe(false);
    expect(caps.pushNotifications).toBe(false);
    // The evaluator is arithmetic over the rubric. A card that implies a model is a false claim.
    expect(String(card.description)).toMatch(/no model in the path/);
  });
});
