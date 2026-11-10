import { CIS4 } from "@concordium/web-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TTL_SECONDS, InMemoryChallengeStore, newChallenge } from "../src/challenge.js";
import { statementsMatch, verifyQualificationPresentation } from "../src/presentation.js";

const PURPOSE = "tender:42:bid";

/** The statement we ask for: registered in one of three countries, tier revealed. */
const REQUESTED = [
  {
    idQualifier: { type: "sci" as const, issuers: [{ index: 9999n, subindex: 0n }] },
    statement: [
      { type: "AttributeInSet", attributeTag: "country", set: ["DK", "SE", "NO"] },
      { type: "RevealAttribute", attributeTag: "supplierTier" },
    ],
  },
  // biome-ignore lint/suspicious/noExplicitAny: the SDK's statement types are structural here.
] as any;

const PROVED = [
  {
    id: "did:ccd:testnet:sci:9999:0/credentialEntry/aa",
    // Deliberately a different order from REQUESTED: a wallet may answer in any order.
    statement: [
      { type: "RevealAttribute", attributeTag: "supplierTier" },
      { type: "AttributeInSet", attributeTag: "country", set: ["DK", "SE", "NO"] },
    ],
  },
];

const ACTIVE = [
  {
    status: CIS4.CredentialStatus.Active,
    inputs: { type: "web3" as const, issuerPk: "ab".repeat(32) },
  },
];

/** Stand in for the wasm verifier, so the orchestration can be tested without a real proof. */
function mockVerify(result: { challenge: string; credentialStatements: unknown[] } | Error) {
  return vi.fn(() => {
    if (result instanceof Error) throw result;
    return result;
  });
}

vi.mock("@concordium/web-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@concordium/web-sdk")>();
  return { ...actual, verifyPresentation: (...args: unknown[]) => verifyImpl(...args) };
});

// biome-ignore lint/suspicious/noExplicitAny: swapped per test.
let verifyImpl: (...args: any[]) => any;

describe("challenges", () => {
  it("is 32 bytes of randomness, and never the same twice", () => {
    const a = newChallenge(PURPOSE);
    const b = newChallenge(PURPOSE);
    expect(a.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it("expires, and a spent challenge is gone whether or not it had expired", async () => {
    const store = new InMemoryChallengeStore();
    const c = newChallenge(PURPOSE, 60, 1_000);
    await store.issue(c);
    expect(await store.consume(c.challenge, 1_000 + 61_000)).toBeUndefined();
    // Deleted even though it was refused, so it cannot be retried into a window of clock skew.
    expect(await store.peek(c.challenge)).toBeUndefined();
  });

  it("can only be consumed once", async () => {
    const store = new InMemoryChallengeStore();
    const c = newChallenge(PURPOSE);
    await store.issue(c);
    expect(await store.consume(c.challenge)).toBeDefined();
    expect(await store.consume(c.challenge)).toBeUndefined();
  });

  it("refuses a challenge with no purpose or a non-positive lifetime", () => {
    expect(() => newChallenge("")).toThrow(/purpose/);
    expect(() => newChallenge(PURPOSE, 0)).toThrow(/positive/);
    expect(DEFAULT_TTL_SECONDS).toBeGreaterThan(0);
  });
});

describe("comparing what was proved with what was asked", () => {
  it("accepts the same statements in a different order", () => {
    expect(statementsMatch(REQUESTED, PROVED)).toBe(true);
  });

  it("rejects a widened set, which would otherwise prove nothing at all", () => {
    // The attack this check exists for: answer a question nobody asked. Membership of a set
    // containing every country is trivially true and would sail through without this.
    const widened = [
      {
        ...PROVED[0],
        statement: [
          { type: "RevealAttribute", attributeTag: "supplierTier" },
          { type: "AttributeInSet", attributeTag: "country", set: ["DK", "SE", "NO", "XX"] },
        ],
      },
    ];
    expect(statementsMatch(REQUESTED, widened)).toBe(false);
  });

  it("rejects a proof that drops one of the statements", () => {
    const partial = [{ ...PROVED[0], statement: [PROVED[0].statement[0]] }];
    expect(statementsMatch(REQUESTED, partial)).toBe(false);
  });

  it("rejects a different attribute under the same shape", () => {
    const swapped = [
      {
        ...PROVED[0],
        statement: [
          { type: "RevealAttribute", attributeTag: "nationality" },
          { type: "AttributeInSet", attributeTag: "country", set: ["DK", "SE", "NO"] },
        ],
      },
    ];
    expect(statementsMatch(REQUESTED, swapped)).toBe(false);
  });

  it("rejects extra credentials beyond those requested", () => {
    expect(statementsMatch(REQUESTED, [...PROVED, PROVED[0]])).toBe(false);
  });
});

describe("verifying a presentation", () => {
  let store: InMemoryChallengeStore;
  // biome-ignore lint/suspicious/noExplicitAny: the presentation is opaque to these tests.
  const presentation = {} as any;

  beforeEach(() => {
    store = new InMemoryChallengeStore();
  });

  async function verify(overrides: Record<string, unknown> = {}, challengeOverride?: string) {
    const c = newChallenge(PURPOSE);
    await store.issue(c);
    return verifyQualificationPresentation({
      presentation,
      // biome-ignore lint/suspicious/noExplicitAny: only passed through to the mocked verifier.
      globalContext: {} as any,
      credentials: ACTIVE,
      requested: REQUESTED,
      challenge: challengeOverride ?? c.challenge,
      purpose: PURPOSE,
      store,
      ...overrides,
    });
  }

  it("accepts a sound proof and spends the challenge", async () => {
    const c = newChallenge(PURPOSE);
    await store.issue(c);
    verifyImpl = mockVerify({ challenge: c.challenge, credentialStatements: PROVED });
    const result = await verifyQualificationPresentation({
      presentation,
      // biome-ignore lint/suspicious/noExplicitAny: only passed through to the mocked verifier.
      globalContext: {} as any,
      credentials: ACTIVE,
      requested: REQUESTED,
      challenge: c.challenge,
      purpose: PURPOSE,
      store,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subjects).toStrictEqual([PROVED[0].id]);
    expect(store.size).toBe(0);
  });

  it("refuses the same proof a second time", async () => {
    const c = newChallenge(PURPOSE);
    await store.issue(c);
    verifyImpl = mockVerify({ challenge: c.challenge, credentialStatements: PROVED });
    const args = {
      presentation,
      // biome-ignore lint/suspicious/noExplicitAny: only passed through to the mocked verifier.
      globalContext: {} as any,
      credentials: ACTIVE,
      requested: REQUESTED,
      challenge: c.challenge,
      purpose: PURPOSE,
      store,
    };
    expect((await verifyQualificationPresentation(args)).ok).toBe(true);
    const replayed = await verifyQualificationPresentation(args);
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) expect(replayed.reason).toBe("unknown_challenge");
  });

  it("leaves the challenge spendable when the proof is bad", async () => {
    // A failed attempt must not cost the holder a challenge they are entitled to retry with,
    // or anyone who can submit garbage can deny them the chance to qualify.
    const c = newChallenge(PURPOSE);
    await store.issue(c);
    verifyImpl = mockVerify(new Error("proof does not verify"));
    const result = await verifyQualificationPresentation({
      presentation,
      // biome-ignore lint/suspicious/noExplicitAny: only passed through to the mocked verifier.
      globalContext: {} as any,
      credentials: ACTIVE,
      requested: REQUESTED,
      challenge: c.challenge,
      purpose: PURPOSE,
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("proof_invalid");
    expect(await store.peek(c.challenge)).toBeDefined();
  });

  it("refuses a proof answering a different challenge", async () => {
    verifyImpl = mockVerify({ challenge: "ff".repeat(32), credentialStatements: PROVED });
    const result = await verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("challenge_mismatch");
  });

  it("refuses a challenge issued for something else", async () => {
    const c = newChallenge("tender:42:award");
    await store.issue(c);
    verifyImpl = mockVerify({ challenge: c.challenge, credentialStatements: PROVED });
    const result = await verifyQualificationPresentation({
      presentation,
      // biome-ignore lint/suspicious/noExplicitAny: only passed through to the mocked verifier.
      globalContext: {} as any,
      credentials: ACTIVE,
      requested: REQUESTED,
      challenge: c.challenge,
      purpose: PURPOSE,
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_purpose");
  });

  it("refuses a revoked credential, however sound the proof", async () => {
    verifyImpl = mockVerify({ challenge: "unused", credentialStatements: PROVED });
    const result = await verify({
      credentials: [{ ...ACTIVE[0], status: CIS4.CredentialStatus.Revoked }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("credential_not_active");
      expect(result.detail).toContain("Revoked");
    }
  });

  it("refuses a challenge it never issued", async () => {
    verifyImpl = mockVerify({ challenge: "aa".repeat(32), credentialStatements: PROVED });
    const result = await verify({}, "aa".repeat(32));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_challenge");
  });

  it("refuses a proof of something other than what was requested", async () => {
    const c = newChallenge(PURPOSE);
    await store.issue(c);
    verifyImpl = mockVerify({
      challenge: c.challenge,
      credentialStatements: [
        { ...PROVED[0], statement: [{ type: "RevealAttribute", attributeTag: "supplierTier" }] },
      ],
    });
    const result = await verifyQualificationPresentation({
      presentation,
      // biome-ignore lint/suspicious/noExplicitAny: only passed through to the mocked verifier.
      globalContext: {} as any,
      credentials: ACTIVE,
      requested: REQUESTED,
      challenge: c.challenge,
      purpose: PURPOSE,
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("statement_mismatch");
    // The challenge survives: the holder may present the right proof instead.
    expect(await store.peek(c.challenge)).toBeDefined();
  });
});
