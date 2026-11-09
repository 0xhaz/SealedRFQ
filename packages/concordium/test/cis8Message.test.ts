import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { describe, expect, it } from "vitest";
import {
  CIS8_DOMAIN,
  KEY_TYPES,
  canonicalMessage,
  describeReject,
  ethereumPersonalSignPayload,
} from "../src/cis8Message.js";

// Deliberately legible inputs: counting bytes 0..31 makes an offset mistake visible in the hex.
const ACCOUNT = Uint8Array.from({ length: 32 }, (_, i) => i);
const GENESIS = Buffer.from(
  "4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796",
  "hex",
);
const PUBKEY = Buffer.from(
  "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
  "hex",
);
const INPUT = {
  concordiumAccount: ACCOUNT,
  contract: { index: 12940n, subindex: 0n },
  genesisHash: GENESIS,
  externalKey: {
    namespace: "sealedrfq",
    keyType: "secp256k1-compressed" as const,
    publicKey: PUBKEY,
  },
  proofScheme: "ethereum-personal-sign",
};

describe("the CIS-8 canonical message", () => {
  it("places every field where the specification says", () => {
    const m = canonicalMessage(INPUT);
    // Offsets written out rather than walked with a cursor, so the expected layout is readable on
    // its own and a wrong length shows up as a wrong offset instead of shifting everything after it.
    expect(m.subarray(0, 18).toString("ascii")).toBe(CIS8_DOMAIN);
    expect(m.subarray(18, 50)).toStrictEqual(Buffer.from(ACCOUNT));
    expect(m.readBigUInt64LE(50)).toBe(12940n);
    expect(m.readBigUInt64LE(58)).toBe(0n);
    expect(m.subarray(66, 98)).toStrictEqual(GENESIS);
    // The namespace twice: once standalone, once as the first field of the key identifier. This is
    // what the prose says and what the deployed contract accepts; the single-namespace variant is
    // rejected as InvalidProof, which names no field and so would be near-impossible to localise.
    expect(m.readUInt32LE(98)).toBe(9);
    expect(m.subarray(102, 111).toString("utf8")).toBe("sealedrfq");
    expect(m.readUInt32LE(111)).toBe(9);
    expect(m.subarray(115, 124).toString("utf8")).toBe("sealedrfq");
    expect(m.readUInt32LE(124)).toBe(20);
    expect(m.subarray(128, 148).toString("utf8")).toBe("secp256k1-compressed");
    expect(m.readUInt32LE(148)).toBe(33);
    expect(m.subarray(152, 185)).toStrictEqual(PUBKEY);
    expect(m.readUInt32LE(185)).toBe(22);
    expect(m.subarray(189, 211).toString("utf8")).toBe("ethereum-personal-sign");
    expect(m.length).toBe(211);
  });

  it("pins the exact bytes, so a refactor cannot quietly invalidate every proof", () => {
    // Chunked by field, because a wrong length prefix is otherwise invisible in 422 hex characters.
    const expected = [
      "4349532d382f76312f63616e6f6e6963616c", // "CIS-8/v1/canonical"
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", // account
      "8c32000000000000", // index 12940, u64 LE
      "0000000000000000", // subindex 0
      "4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796", // testnet genesis
      "090000007365616c6564726671", // external_namespace
      "090000007365616c6564726671", // and again, inside external_key
      "14000000736563703235366b312d636f6d70726573736564", // key_type
      "2100000002c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5", // public_key
      "16000000657468657265756d2d706572736f6e616c2d7369676e", // proof_scheme
    ].join("");
    expect(canonicalMessage(INPUT).toString("hex")).toBe(expected);
  });

  it("carries no nonce or expiry, because the transaction supplies both", () => {
    expect(canonicalMessage(INPUT)).toStrictEqual(canonicalMessage(INPUT));
  });

  it("is bound to the contract and the network, so it cannot be replayed across either", () => {
    const other = canonicalMessage({ ...INPUT, contract: { index: 12939n, subindex: 0n } });
    expect(other).not.toStrictEqual(canonicalMessage(INPUT));
    const mainnet = canonicalMessage({
      ...INPUT,
      genesisHash: Buffer.from(
        "9dd9ca4d19e9393877d2c44b70f89acbfc0883c2243e5eeaecc0d1cd0503f478",
        "hex",
      ),
    });
    expect(mainnet).not.toStrictEqual(canonicalMessage(INPUT));
  });

  it("refuses a key whose length contradicts its declared type", () => {
    expect(() =>
      canonicalMessage({
        ...INPUT,
        externalKey: { ...INPUT.externalKey, publicKey: PUBKEY.subarray(0, 32) },
      }),
    ).toThrow(/wants 33 bytes, got 32/);
    expect(KEY_TYPES["secp256k1-compressed"]).toBe(33);
  });

  it("refuses an account or genesis hash of the wrong length", () => {
    expect(() =>
      canonicalMessage({ ...INPUT, concordiumAccount: ACCOUNT.subarray(0, 31) }),
    ).toThrow(/account must be 32 bytes/);
    expect(() => canonicalMessage({ ...INPUT, genesisHash: GENESIS.subarray(0, 31) })).toThrow(
      /genesis hash must be 32 bytes/,
    );
  });
});

describe("the ethereum-personal-sign envelope", () => {
  it("writes the length in decimal ascii, not as a byte", () => {
    const payload = ethereumPersonalSignPayload(canonicalMessage(INPUT));
    const prefix = "\x19Ethereum Signed Message:\n211";
    expect(payload.subarray(0, prefix.length).toString("ascii")).toBe(prefix);
    expect(canonicalMessage(INPUT).length).toBe(211);
  });

  it("produces a signature that recovers to the signing key", () => {
    // A proof is only useful if it verifies the way the contract verifies it: by recovery.
    const priv = keccak_256(Buffer.from("cis-8 test vector"));
    const pub = secp256k1.getPublicKey(priv, true);
    const message = canonicalMessage({
      ...INPUT,
      externalKey: { ...INPUT.externalKey, publicKey: pub },
    });
    const digest = keccak_256(ethereumPersonalSignPayload(message));
    const sig = secp256k1.sign(digest, priv, { prehash: false });
    expect(Buffer.from(sig.recoverPublicKey(digest).toBytes(true))).toStrictEqual(Buffer.from(pub));
  });
});

describe("reject codes", () => {
  it("names the codes the specifications assign, gaps and all", () => {
    expect(describeReject(-7206)).toBe("InvalidExternalReference");
    expect(describeReject(-7100)).toBe("InvalidProof");
    expect(describeReject(-7211)).toBe("ReservedKey");
    // -7203 and -7205 are unassigned. Deriving a name from enum position would invent one.
    expect(describeReject(-7203)).toMatch(/unknown reject code/);
    expect(describeReject(-7205)).toMatch(/unknown reject code/);
  });
});
