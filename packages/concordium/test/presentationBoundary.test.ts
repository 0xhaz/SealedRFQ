/**
 * The real `verifyPresentation`, not a stand-in.
 *
 * `presentation.test.ts` mocks the wasm verifier so the orchestration around it can be tested, but
 * that leaves the boundary itself unexercised: whether a malformed presentation throws or returns,
 * and whether our wrapper catches it. The SDK's verifier throws on every failure, so a missing
 * try/catch would surface as an unhandled rejection in production and as nothing at all in a
 * mocked test. This file is the one that would notice.
 */
import { CIS4 } from "@concordium/web-sdk";
import { describe, expect, it } from "vitest";
import { InMemoryChallengeStore, newChallenge } from "../src/challenge.js";
import { verifyQualificationPresentation } from "../src/presentation.js";

const PURPOSE = "tender:1:bid";
const REQUESTED = [
  {
    idQualifier: { type: "sci" as const, issuers: [{ index: 1n, subindex: 0n }] },
    statement: [{ type: "RevealAttribute", attributeTag: "supplierTier" }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: structural, and never reached by these cases.
] as any;

async function verifyGarbage(presentation: unknown) {
  const store = new InMemoryChallengeStore();
  const challenge = newChallenge(PURPOSE);
  await store.issue(challenge);
  const result = await verifyQualificationPresentation({
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed.
    presentation: presentation as any,
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed.
    globalContext: {} as any,
    credentials: [
      { status: CIS4.CredentialStatus.Active, inputs: { type: "web3", issuerPk: "ab".repeat(32) } },
    ],
    requested: REQUESTED,
    challenge: challenge.challenge,
    purpose: PURPOSE,
    store,
  });
  return { result, store, challenge };
}

describe("the boundary with the real wasm verifier", () => {
  it("turns a thrown verification error into a result, not an exception", async () => {
    const { result } = await verifyGarbage({ presentationContext: "00".repeat(32) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("proof_invalid");
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  it("survives shapes that are not presentations at all", async () => {
    for (const nonsense of [{}, { verifiableCredential: [] }, { type: "wrong" }]) {
      const { result } = await verifyGarbage(nonsense);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("proof_invalid");
    }
  });

  it("leaves the challenge unspent, so garbage cannot deny a holder their attempt", async () => {
    const { store, challenge } = await verifyGarbage({});
    expect(await store.peek(challenge.challenge)).toBeDefined();
  });
});
