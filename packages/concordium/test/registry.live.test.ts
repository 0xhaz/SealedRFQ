/**
 * Checks what we send against the contracts actually deployed on Concordium testnet.
 *
 * Comparing a committed schema with a snapshot of itself proves nothing. What matters is whether
 * the bytes we build are bytes the contract parses and accepts, so these tests dry-run real
 * entrypoints and read the reject code. A drifted schema shows up as ParseParams rather than as a
 * sensible refusal, and a wrong canonical message shows up as InvalidProof.
 *
 * Needs the network, so it is opt-in:
 *   CCD_LIVE=1 pnpm --filter @sealedrfq/concordium test
 */
import * as SDK from "@concordium/web-sdk";
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  cis8ReceiveName,
  keyRegistryAddress,
  ownerOfKeyParameter,
  parseCis8View,
  parseOwnerOfKey,
  registerExternalKeyParameter,
} from "../src/cis8.js";
import {
  CIS8_DOMAIN,
  PROOF_SCHEMES,
  canonicalMessage,
  describeReject,
  ethereumPersonalSignPayload,
} from "../src/cis8Message.js";
import {
  KEY_REGISTRY,
  agentOfParameter,
  parseAgentOf,
  receiveName,
  registerParameter,
  registryAddress,
  setAgentUriParameter,
} from "../src/cis8004.js";

const live = process.env.CCD_LIVE === "1";
const REGISTRY = registryAddress("testnet");
const KEYS = keyRegistryAddress("testnet");

let client: ConcordiumGRPCNodeClient;
/** Any real account works as a dry-run invoker, which is how these run without an account of ours. */
let invoker: SDK.AccountAddress.Type;
let genesisHash: Buffer;

/** The reject code, or undefined when the call succeeded. */
function rejectCode(result: SDK.InvokeContractResult): number | undefined {
  if (result.tag !== "failure") return undefined;
  const reason = result.reason as { tag: string; rejectReason?: number };
  return reason.tag === "RejectedReceive" ? reason.rejectReason : Number.NaN;
}

describe.skipIf(!live)("Concordium testnet registries", () => {
  beforeAll(async () => {
    client = new ConcordiumGRPCNodeClient(
      "grpc.testnet.concordium.com",
      20000,
      credentials.createSsl(),
    );
    for await (const a of client.getAccountList()) {
      invoker = a;
      break;
    }
    const view = await client.invokeContract({ contract: KEYS, method: cis8ReceiveName("view") });
    if (view.tag !== "success" || !view.returnValue) throw new Error("CIS-8 view failed");
    genesisHash = Buffer.from(parseCis8View(view.returnValue).genesisHash, "hex");
  }, 60_000);

  describe("CIS-8004 agent registry", () => {
    it("parses our register parameter, and lets any account register", async () => {
      const result = await client.invokeContract({
        invoker,
        contract: REGISTRY,
        method: receiveName("register"),
        parameter: registerParameter({
          agentUri: "https://sealedrfq.example/.well-known/agent-card.json",
          metadataHash: new Uint8Array(32).fill(7),
          initialMetadata: [{ key: "role", value: Buffer.from("evaluator", "utf8") }],
        }),
      });
      expect(rejectCode(result)).toBeUndefined();
    }, 60_000);

    it("refuses an external reference whose key is not in CIS-8 yet", async () => {
      // This is the ordering constraint the contract imposes, and it is not optional: the key has
      // to exist in CIS-8, owned by the sender, before CIS-8004 will accept a reference to it. So
      // binding the key is its own transaction, and it goes first.
      const result = await client.invokeContract({
        invoker,
        contract: REGISTRY,
        method: receiveName("register"),
        parameter: registerParameter({
          agentUri: "https://sealedrfq.example/.well-known/agent-card.json",
          externalReference: {
            keyRegistry: KEY_REGISTRY.testnet,
            namespace: "sealedrfq",
            keyType: "secp256k1-compressed",
            publicKey: new Uint8Array(33).fill(3),
          },
        }),
      });
      expect(describeReject(rejectCode(result) ?? 0)).toBe("InvalidExternalReference");
    }, 60_000);

    it("parses our setAgentURI parameter, and refuses an agent we do not own", async () => {
      const result = await client.invokeContract({
        invoker,
        contract: REGISTRY,
        method: receiveName("setAgentURI"),
        // Agent 0 belongs to the registry's own admin, so this must be refused — but refused for
        // ownership, not for a malformed parameter.
        parameter: setAgentUriParameter({
          agentId: 0,
          agentUri: "https://attacker.invalid/card.json",
          metadataHash: new Uint8Array(32).fill(9),
        }),
      });
      expect(describeReject(rejectCode(result) ?? 0)).toBe("Unauthorized");
    }, 60_000);

    it("says AgentNotFound for an agent that does not exist", async () => {
      const result = await client.invokeContract({
        invoker,
        contract: REGISTRY,
        method: receiveName("setAgentURI"),
        parameter: setAgentUriParameter({ agentId: 999_999, agentUri: "https://x.invalid/c.json" }),
      });
      expect(describeReject(rejectCode(result) ?? 0)).toBe("AgentNotFound");
    }, 60_000);

    it("reads agent 0 back through our parser", async () => {
      const result = await client.invokeContract({
        contract: REGISTRY,
        method: receiveName("agentOf"),
        parameter: agentOfParameter(0),
      });
      if (result.tag !== "success" || !result.returnValue) throw new Error("agentOf failed");
      const agent = parseAgentOf(result.returnValue);
      expect(agent?.agentId).toBe(0n);
      expect(agent?.status).toBe("Active");
      expect(agent?.agentUri).toMatch(/^https:\/\//);
      expect(agent?.registeredAt.getTime()).toBeGreaterThan(Date.UTC(2025, 0, 1));
    }, 60_000);

    it("reports no agent for an id that does not exist", async () => {
      const result = await client.invokeContract({
        contract: REGISTRY,
        method: receiveName("agentOf"),
        parameter: agentOfParameter(2n ** 40n),
      });
      if (result.tag !== "success" || !result.returnValue) throw new Error("agentOf failed");
      expect(parseAgentOf(result.returnValue)).toBeUndefined();
    }, 60_000);
  });

  describe("CIS-8 key registry", () => {
    it("is configured with the original genesis hash, not the current era's", async () => {
      // Worth asserting rather than assuming. Concordium's quorum certificates sign against
      // current-era genesis, and both networks are on protocol 10, so the two differ. A proof
      // built with the wrong one fails as InvalidProof, which names no field.
      expect(genesisHash.toString("hex")).toBe(
        "4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796",
      );
      const info = await client.getConsensusStatus();
      expect(SDK.BlockHash.toHexString(info.genesisBlock)).toBe(genesisHash.toString("hex"));
      expect(SDK.BlockHash.toHexString(info.currentEraGenesisBlock)).not.toBe(
        genesisHash.toString("hex"),
      );
    }, 60_000);

    it("accepts a proof over our canonical message", async () => {
      const priv = keccak_256(Buffer.from("sealedrfq live-test key, never funded"));
      const publicKey = secp256k1.getPublicKey(priv, true);
      const externalKey = {
        namespace: "sealedrfq",
        keyType: "secp256k1-compressed" as const,
        publicKey,
      };
      const message = canonicalMessage({
        concordiumAccount: SDK.AccountAddress.toBuffer(invoker),
        contract: KEY_REGISTRY.testnet,
        genesisHash,
        externalKey,
        proofScheme: PROOF_SCHEMES.ethereumPersonalSign,
      });
      expect(message.subarray(0, 18).toString("ascii")).toBe(CIS8_DOMAIN);
      const sig = secp256k1.sign(keccak_256(ethereumPersonalSignPayload(message)), priv, {
        prehash: false,
      });
      const result = await client.invokeContract({
        invoker,
        contract: KEYS,
        method: cis8ReceiveName("registerExternalKey"),
        parameter: registerExternalKeyParameter({
          externalKey,
          proofScheme: PROOF_SCHEMES.ethereumPersonalSign,
          signature: Buffer.concat([
            Buffer.from(sig.toBytes("compact")),
            Buffer.from([sig.recovery]),
          ]),
        }),
      });
      expect(rejectCode(result)).toBeUndefined();
    }, 60_000);

    it("rejects a proof over a message missing the repeated namespace", async () => {
      // The one layout question the specification's prose leaves open. The contract settles it:
      // omit the second copy of the namespace and the proof does not verify. This test is what
      // stops anyone "simplifying" the serialiser back to the reading that seems more natural.
      const priv = keccak_256(Buffer.from("sealedrfq live-test key, never funded"));
      const publicKey = secp256k1.getPublicKey(priv, true);
      const full = canonicalMessage({
        concordiumAccount: SDK.AccountAddress.toBuffer(invoker),
        contract: KEY_REGISTRY.testnet,
        genesisHash,
        externalKey: { namespace: "sealedrfq", keyType: "secp256k1-compressed", publicKey },
        proofScheme: PROOF_SCHEMES.ethereumPersonalSign,
      });
      // Drop the second namespace: it sits right after the first, 13 bytes in from offset 90.
      const trimmed = Buffer.concat([full.subarray(0, 90 + 13), full.subarray(90 + 26)]);
      expect(trimmed.length).toBe(full.length - 13);
      const sig = secp256k1.sign(keccak_256(ethereumPersonalSignPayload(trimmed)), priv, {
        prehash: false,
      });
      const result = await client.invokeContract({
        invoker,
        contract: KEYS,
        method: cis8ReceiveName("registerExternalKey"),
        parameter: registerExternalKeyParameter({
          externalKey: { namespace: "sealedrfq", keyType: "secp256k1-compressed", publicKey },
          proofScheme: PROOF_SCHEMES.ethereumPersonalSign,
          signature: Buffer.concat([
            Buffer.from(sig.toBytes("compact")),
            Buffer.from([sig.recovery]),
          ]),
        }),
      });
      expect(describeReject(rejectCode(result) ?? 0)).toBe("InvalidProof");
    }, 60_000);

    it("reports no owner for a well-formed key nobody has registered", async () => {
      const publicKey = secp256k1.getPublicKey(keccak_256(Buffer.from("unregistered")), true);
      const result = await client.invokeContract({
        contract: KEYS,
        method: cis8ReceiveName("ownerOfKey"),
        parameter: ownerOfKeyParameter({
          namespace: "sealedrfq",
          keyType: "secp256k1-compressed",
          publicKey,
        }),
      });
      if (result.tag === "success" && result.returnValue) {
        expect(parseOwnerOfKey(result.returnValue)).toBeUndefined();
      } else {
        expect(describeReject(rejectCode(result) ?? 0)).toBe("NotRegistered");
      }
    }, 60_000);

    it("checks that a key is a real curve point, not merely the right length", async () => {
      // 33 bytes of 0x2a has the right length and no valid compressed-point prefix. The contract
      // refuses it as malformed rather than reporting it as simply unregistered, so our own length
      // check in `canonicalMessage` is a convenience and not the thing being relied on.
      const result = await client.invokeContract({
        contract: KEYS,
        method: cis8ReceiveName("ownerOfKey"),
        parameter: ownerOfKeyParameter({
          namespace: "sealedrfq",
          keyType: "secp256k1-compressed",
          publicKey: new Uint8Array(33).fill(42),
        }),
      });
      expect(describeReject(rejectCode(result) ?? 0)).toBe("MalformedExternalKey");
    }, 60_000);
  });
});
