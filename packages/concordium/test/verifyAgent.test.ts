import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as SDK from "@concordium/web-sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { verifyAgentBadge } from "../src/verifyAgent.js";

/**
 * The badge checks, driven by return values captured from Concordium testnet rather than encoded
 * here. Hand-built fixtures would test the checks against a second copy of my own assumptions
 * about the wire format; these are the exact bytes the contracts returned for agent 1, so a schema
 * change breaks this suite instead of silently passing.
 *
 * The card fixture is the exact body `https://www.sealedrfq.com/.well-known/agent-card.json`
 * served, 3036 bytes, hashing to the value anchored on chain. It is checked in because the hash
 * comparison is the one check with nothing to compare against otherwise.
 */
const AGENT_OF_1 =
  "01080100000000000000a6bc3d97475a15c01c33911154dc003f63ffc0e29a72f6afa7a3529898614575013500000068747470733a2f2f7777772e7365616c65647266712e636f6d2f2e77656c6c2d6b6e6f776e2f6167656e742d636172642e6a736f6e01dc12f239397f6af32010bdc2f26b31e154958240809afd9c74874418f4162e120001a6bc3d97475a15c01c33911154dc003f63ffc0e29a72f6afa7a3529898614575005c220ac4a101000000000200000004000000726f6c65090000006576616c7561746f720f000000736574746c656d656e74436861696e03000000617263";

const OWNER_OF_KEY =
  "01a6bc3d97475a15c01c33911154dc003f63ffc0e29a72f6afa7a3529898614575090000007365616c656472667114000000736563703235366b312d636f6d707265737365642100000003c5528c02501158aa5286c621394ef47e95c36edc35b21c71c76d13be8e7198dd16000000657468657265756d2d706572736f6e616c2d7369676e0200000004000000726f6c650d0000006172632d6576616c7561746f7205000000636861696e03000000617263002cd103c4a1010000";

/** `agentOf` for an id nobody has registered: the option tag is 0 and nothing follows. */
const NO_SUCH_AGENT = "00";

const CARD_BYTES = readFileSync(resolve(import.meta.dirname, "fixtures/agent-1-card.json"));
const ANCHORED_HASH = "dc12f239397f6af32010bdc2f26b31e154958240809afd9c74874418f4162e12";

/**
 * The fixture is bytes, not source, and must never be formatted.
 *
 * `biome check --write` reformatted it once — 3036 bytes became 3508 and the hash changed — and the
 * only symptom was two assertions failing with no hint that the input had been rewritten rather
 * than the code broken. `test/fixtures/**` is now in biome's ignore list, and this guard states the
 * reason at the point of failure so the next person does not have to rediscover it.
 */
it("the card fixture is byte-identical to what is anchored on chain", () => {
  expect(CARD_BYTES.length).toBe(3036);
  expect(Buffer.from(sha256(CARD_BYTES)).toString("hex")).toBe(ANCHORED_HASH);
});

/**
 * A client that answers from a table keyed by entrypoint, so a test can replace one answer without
 * restating the others.
 */
function fakeClient(answers: Record<string, string | Error>) {
  return {
    invokeContract: async ({ method }: { method: SDK.ReceiveName.Type }) => {
      const entrypoint = SDK.ReceiveName.toString(method).split(".")[1] ?? "";
      const answer = answers[entrypoint];
      if (answer === undefined) throw new Error(`the test gave no answer for ${entrypoint}`);
      if (answer instanceof Error) throw answer;
      return { tag: "success" as const, returnValue: SDK.ReturnValue.fromHexString(answer) };
    },
  };
}

const serving = (body: Buffer) => async () =>
  new Response(new Uint8Array(body), { status: 200 }) as Response;

const healthy = () => fakeClient({ agentOf: AGENT_OF_1, ownerOfKey: OWNER_OF_KEY }) as never;

describe("verifyAgentBadge", () => {
  it("passes every check for the registration that is actually on testnet", async () => {
    const result = await verifyAgentBadge({
      client: healthy(),
      agentId: 1n,
      network: "testnet",
      fetch: serving(CARD_BYTES),
    });

    expect(result.outcome).toBe("verified");
    expect(result.checks.length).toBeGreaterThanOrEqual(8);
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.agent?.owner).toBe("4DBCxp3GVDmTwtB1Z718ojSCEy1eBp6oJ7RrNTJk8BUsJn7FGb");
    expect(result.servedCardSha256).toBe(ANCHORED_HASH);
    // Testnet's CIS-8004 holds no external reference, so the binding has to be found via the card.
    expect(result.via).toBe("card");
    expect(result.claimedKey?.publicKey).toBe(
      "03c5528c02501158aa5286c621394ef47e95c36edc35b21c71c76d13be8e7198dd",
    );
    // And CIS-8 agrees that the agent's own owner holds it. That is the whole badge.
    expect(result.keyBinding?.owner).toBe(result.agent?.owner);
    expect(result.keyBinding?.status).toBe("Active");
    expect(result.keyBinding?.proofScheme).toBe("ethereum-personal-sign");
  });

  it("catches a card edited after its hash was anchored", async () => {
    // One byte, inside a prose string so the card still parses and still looks right. The whole
    // value of anchoring the hash is that this is caught anyway, so the check is shown failing
    // rather than assumed to work.
    const edited = Buffer.from(CARD_BYTES);
    const at = edited.indexOf("The same secp256k1 key");
    expect(at).toBeGreaterThan(-1);
    edited[at] = "t".charCodeAt(0);
    expect(() => JSON.parse(edited.toString("utf8"))).not.toThrow();

    const result = await verifyAgentBadge({
      client: healthy(),
      agentId: 1n,
      network: "testnet",
      fetch: serving(edited),
    });

    expect(result.outcome).toBe("failed");
    const hashCheck = result.checks.find((c) => c.id === "card-hash");
    expect(hashCheck?.ok).toBe(false);
    expect(result.servedCardSha256).not.toBe(ANCHORED_HASH);
  });

  it("refuses a card that names a key belonging to somebody else", async () => {
    // The card is trusted only for where to look. CIS-8 is asked whether this agent's owner owns
    // the key it names, so a card pointing at a stranger's active binding must still fail.
    const strangersKey = OWNER_OF_KEY.replace(
      "a6bc3d97475a15c01c33911154dc003f63ffc0e29a72f6afa7a3529898614575",
      "b6bc3d97475a15c01c33911154dc003f63ffc0e29a72f6afa7a3529898614575",
    );
    const result = await verifyAgentBadge({
      client: fakeClient({ agentOf: AGENT_OF_1, ownerOfKey: strangersKey }) as never,
      agentId: 1n,
      network: "testnet",
      fetch: serving(CARD_BYTES),
    });

    expect(result.outcome).toBe("failed");
    expect(result.checks.find((c) => c.id === "key-owner")?.ok).toBe(false);
    // The binding itself is still Active; it is the ownership that does not match.
    expect(result.checks.find((c) => c.id === "key-active")?.ok).toBe(true);
  });

  it("reports an unreachable node as unreachable, not as a failed check", async () => {
    // The distinction the whole dashboard rests on: "we could not ask" must never render as
    // "the answer is no". One is an outage, the other is a finding.
    const result = await verifyAgentBadge({
      client: fakeClient({ agentOf: new Error("14 UNAVAILABLE: no connection") }) as never,
      agentId: 1n,
      network: "testnet",
      fetch: serving(CARD_BYTES),
    });

    expect(result.outcome).toBe("unreachable");
    expect(result.reason).toMatch(/UNAVAILABLE/);
    expect(result.checks).toEqual([]);
  });

  it("reports an unregistered agent id as absent", async () => {
    const result = await verifyAgentBadge({
      client: fakeClient({ agentOf: NO_SUCH_AGENT }) as never,
      agentId: 99_999n,
      network: "testnet",
      fetch: serving(CARD_BYTES),
    });

    expect(result.outcome).toBe("absent");
    expect(result.checks).toEqual([]);
  });

  it("rejects a key type CIS-8 does not define without asking the contract", async () => {
    // The card is a document a stranger controls, so its key type is checked before it becomes a
    // contract parameter. A bogus type would otherwise come back as an opaque parameter error
    // naming no field. The client here answers only `agentOf`, so it throws if `ownerOfKey` is
    // reached — which is the assertion that matters.
    const bogus = Buffer.from(
      CARD_BYTES.toString("utf8").replace(
        '"keyType":"secp256k1-compressed"',
        '"keyType":"rsa-2048-pkcs1"',
      ),
      "utf8",
    );
    expect(bogus.includes("rsa-2048-pkcs1")).toBe(true);

    const result = await verifyAgentBadge({
      client: fakeClient({ agentOf: AGENT_OF_1 }) as never,
      agentId: 1n,
      network: "testnet",
      fetch: serving(bogus),
    });

    expect(result.outcome).toBe("failed");
    expect(result.checks.find((c) => c.id === "key-well-formed")?.ok).toBe(false);
    expect(result.checks.find((c) => c.id === "key-well-formed")?.detail).toMatch(
      /unknown key type/,
    );
    // Never asked, so never claims an answer.
    expect(result.checks.find((c) => c.id === "key-active")).toBeUndefined();
    expect(result.checks.find((c) => c.id === "key-owner")).toBeUndefined();
    expect(result.keyBinding).toBeUndefined();
  });

  it("rejects a key whose length contradicts its own stated type", async () => {
    const truncated = Buffer.from(
      CARD_BYTES.toString("utf8").replace(
        "03c5528c02501158aa5286c621394ef47e95c36edc35b21c71c76d13be8e7198dd",
        "03c5528c02501158aa5286c621394ef47e95c36edc35b21c71c76d13be8e7198",
      ),
      "utf8",
    );

    const result = await verifyAgentBadge({
      client: fakeClient({ agentOf: AGENT_OF_1 }) as never,
      agentId: 1n,
      network: "testnet",
      fetch: serving(truncated),
    });

    expect(result.checks.find((c) => c.id === "key-well-formed")?.ok).toBe(false);
    expect(result.checks.find((c) => c.id === "key-well-formed")?.detail).toMatch(/33 bytes/);
  });

  it("separates a card URL that does not resolve from a card that fails its hash", async () => {
    const result = await verifyAgentBadge({
      client: healthy(),
      agentId: 1n,
      network: "testnet",
      fetch: async () => new Response("nope", { status: 503 }) as Response,
    });

    expect(result.outcome).toBe("failed");
    expect(result.checks.find((c) => c.id === "card-url")?.ok).toBe(false);
    // Nothing downstream of the body should claim to have checked it.
    expect(result.checks.find((c) => c.id === "card-hash")).toBeUndefined();
    expect(result.servedCardSha256).toBeUndefined();
  });
});
