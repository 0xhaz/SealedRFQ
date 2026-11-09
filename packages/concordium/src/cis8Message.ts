/**
 * The CIS-8 canonical signed message, serialised by hand.
 *
 * This is the one place where getting a byte wrong fails silently in a way that looks like a key
 * problem: the contract reconstructs these bytes itself and rejects with InvalidProof, which says
 * nothing about which field was wrong. So the layout is written out field by field against the
 * specification, and `cis8Message.test.ts` pins the result against a fixture.
 *
 * Kept free of `@concordium/web-sdk` so the web app can verify a binding without the SDK's wasm.
 *
 * CanonicalSignedMessage ::=
 *   ("CIS-8/v1/canonical": Byte18)
 *   (concordium_account: Byte32)
 *   (contract_address: index u64 LE, subindex u64 LE)
 *   (concordium_genesis_hash: Byte32)
 *   (external_namespace: String)
 *   (external_key: ExternalKeyId)
 *   (proof_scheme: String)
 *
 * String    ::= (n: u32 LE) (utf8: Byte n)
 * Bytestring::= (n: u32 LE) (Byte n)
 * ExternalKeyId ::= (namespace: String) (key_type: String) (public_key: Bytestring)
 *
 * The message carries no nonce and no expiry on purpose: replay protection comes from the
 * Concordium transaction itself, which is bound to the sender, a sequential nonce and an expiry.
 * The contract address and genesis hash are what stop it being replayed on another contract or
 * another network.
 */

/** The 18-byte ASCII domain separation tag. Its length is part of the specification. */
export const CIS8_DOMAIN = "CIS-8/v1/canonical";

/** Proof schemes the specification defines. A contract may implement only some of them. */
export const PROOF_SCHEMES = {
  ethereumPersonalSign: "ethereum-personal-sign",
  solanaEd25519: "solana-ed25519",
  cosmosSecp256k1: "cosmos-secp256k1",
  fetchAiEd25519: "fetch-ai-ed25519",
} as const;

/** Key type identifiers, and the public key length each one fixes. */
export const KEY_TYPES = {
  "secp256k1-compressed": 33,
  "secp256k1-uncompressed": 65,
  ed25519: 32,
} as const;

export type KeyType = keyof typeof KEY_TYPES;

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

/** `String`: a u32 little-endian byte length, then UTF-8. The length counts bytes, not characters. */
function str(value: string): Buffer {
  const utf8 = Buffer.from(value, "utf8");
  return Buffer.concat([u32le(utf8.length), utf8]);
}

/** `Bytestring`: the same framing, over raw bytes. */
function bytestring(value: Uint8Array): Buffer {
  return Buffer.concat([u32le(value.length), Buffer.from(value)]);
}

export type ExternalKeyId = {
  namespace: string;
  keyType: KeyType;
  publicKey: Uint8Array;
};

export type CanonicalMessageInput = {
  /** The 32 raw bytes of the Concordium account that will send the registration. */
  concordiumAccount: Uint8Array;
  /** The CIS-8 instance the registration goes to. */
  contract: { index: bigint; subindex: bigint };
  /**
   * The genesis hash the contract is configured with. Testnet 12940 holds the ORIGINAL genesis,
   * not the current-era one, which is the opposite of what Concordium's quorum certificates sign
   * against. Read it from the contract's `view` rather than assuming either.
   */
  genesisHash: Uint8Array;
  externalKey: ExternalKeyId;
  proofScheme: string;
};

export function canonicalMessage(input: CanonicalMessageInput): Buffer {
  if (input.concordiumAccount.length !== 32) {
    throw new Error(`account must be 32 bytes, got ${input.concordiumAccount.length}`);
  }
  if (input.genesisHash.length !== 32) {
    throw new Error(`genesis hash must be 32 bytes, got ${input.genesisHash.length}`);
  }
  const expected = KEY_TYPES[input.externalKey.keyType];
  if (expected === undefined) throw new Error(`unknown key type ${input.externalKey.keyType}`);
  if (input.externalKey.publicKey.length !== expected) {
    throw new Error(
      `${input.externalKey.keyType} wants ${expected} bytes, got ${input.externalKey.publicKey.length}`,
    );
  }
  const domain = Buffer.from(CIS8_DOMAIN, "ascii");
  if (domain.length !== 18) throw new Error("the domain tag must be 18 bytes");
  return Buffer.concat([
    domain,
    Buffer.from(input.concordiumAccount),
    u64le(input.contract.index),
    u64le(input.contract.subindex),
    Buffer.from(input.genesisHash),
    // The namespace appears twice: once on its own, and again inside the key identifier. That is
    // what the specification says, and omitting either copy changes the bytes the contract rebuilds.
    str(input.externalKey.namespace),
    str(input.externalKey.namespace),
    str(input.externalKey.keyType),
    bytestring(input.externalKey.publicKey),
    str(input.proofScheme),
  ]);
}

/**
 * What `ethereum-personal-sign` actually signs: the EIP-191 personal-message envelope around the
 * canonical bytes, hashed with Keccak-256. `ascii(len(m))` is the decimal length as text, so a
 * 139-byte message contributes the three characters "139" and not the byte 0x8b.
 */
export function ethereumPersonalSignPayload(message: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`\x19Ethereum Signed Message:\n${message.length}`, "ascii"),
    message,
  ]);
}

/** CIS-8 reject codes, from the specification rather than from the error enum's order. */
export const CIS8_ERRORS: Record<number, string> = {
  [-7100]: "InvalidProof",
  [-7101]: "UnsupportedProofScheme",
  [-7102]: "MalformedExternalKey",
  [-7103]: "Unauthorized",
  [-7104]: "AlreadyRegistered",
  [-7105]: "NotRegistered",
  [-7106]: "AmbiguousIdentifier",
  [-7107]: "UnsupportedKeyType",
  [-7108]: "InvalidMetadata",
};

/**
 * CIS-8004 reject codes. The numbering has gaps — -7203, -7205, -7207, -7209 and -7210 are
 * unassigned — so these cannot be derived from the position of a variant in the error enum, and
 * doing so silently mislabels every code after the first gap.
 */
export const CIS8004_ERRORS: Record<number, string> = {
  [-7200]: "AgentNotFound",
  [-7201]: "Unauthorized",
  [-7202]: "AgentRevoked",
  [-7204]: "ExternalReferenceTaken",
  [-7206]: "InvalidExternalReference",
  [-7208]: "InvalidMetadata",
  [-7211]: "ReservedKey",
  [-7212]: "InvalidAgentWalletProof",
  [-7213]: "InvalidTransfer",
};

export function describeReject(code: number): string {
  return CIS8004_ERRORS[code] ?? CIS8_ERRORS[code] ?? `unknown reject code ${code}`;
}
