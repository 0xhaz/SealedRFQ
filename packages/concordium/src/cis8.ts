/**
 * CIS-8 External Key Registry: binding a key from another chain to a Concordium account.
 *
 * This is how SealedRFQ links the two halves of the evaluator. The same secp256k1 key that Arc
 * grants EVALUATOR_ROLE to proves possession here, so the agent holding the Concordium badge and
 * the key the Arc contract accepts recommendations from are checkably the same entity. Without
 * this the badge says only that somebody registered an agent.
 *
 * Schemas are lifted from the deployed module's `concordium-schema` section, as in `cis8004.ts`.
 */
import * as SDK from "@concordium/web-sdk";
import type { ExternalKeyId } from "./cis8Message.js";
import { KEY_REGISTRY } from "./registryAddresses.js";
import type { Network } from "./registryAddresses.js";

export const CIS8_CONTRACT_NAME = "CIS-8";

export const CIS8_SCHEMA = {
  registerExternalKeyParameter:
    "FAADAAAADAAAAGV4dGVybmFsX2tleRQAAwAAAAkAAABuYW1lc3BhY2UWAggAAABrZXlfdHlwZRYCCgAAAHB1YmxpY19rZXkQAgIFAAAAcHJvb2YUAAIAAAAGAAAAc2NoZW1lFgIJAAAAc2lnbmF0dXJlEAICCAAAAG1ldGFkYXRhEAIUAAIAAAADAAAAa2V5FgIFAAAAdmFsdWUWAg==",
  ownerOfKeyParameter:
    "FAABAAAADAAAAGV4dGVybmFsX2tleRQAAwAAAAkAAABuYW1lc3BhY2UWAggAAABrZXlfdHlwZRYCCgAAAHB1YmxpY19rZXkQAgI=",
  ownerOfKeyReturn:
    "FQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAAFAAGAAAABQAAAG93bmVyCwwAAABleHRlcm5hbF9rZXkUAAMAAAAJAAAAbmFtZXNwYWNlFgIIAAAAa2V5X3R5cGUWAgoAAABwdWJsaWNfa2V5EAICDAAAAHByb29mX3NjaGVtZRYCCAAAAG1ldGFkYXRhEAIUAAIAAAADAAAAa2V5FgIFAAAAdmFsdWUWAgYAAABzdGF0dXMVAgAAAAYAAABBY3RpdmUCBwAAAFJldm9rZWQCDAAAAGxhc3RfdXBkYXRlZA0=",
  /** `view` also returns the genesis hash the instance is configured with, which the proof needs. */
  viewReturn:
    "FAADAAAABgAAAGJ5X2tleRACFAAGAAAABQAAAG93bmVyCwwAAABleHRlcm5hbF9rZXkUAAMAAAAJAAAAbmFtZXNwYWNlFgIIAAAAa2V5X3R5cGUWAgoAAABwdWJsaWNfa2V5EAICDAAAAHByb29mX3NjaGVtZRYCCAAAAG1ldGFkYXRhEAIUAAIAAAADAAAAa2V5FgIFAAAAdmFsdWUWAgYAAABzdGF0dXMVAgAAAAYAAABBY3RpdmUCBwAAAFJldm9rZWQCDAAAAGxhc3RfdXBkYXRlZA0MAAAAZ2VuZXNpc19oYXNoEyAAAAACBQAAAGFkbWluFQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAACw==",
} as const;

export function cis8ReceiveName(entrypoint: string): SDK.ReceiveName.Type {
  return SDK.ReceiveName.create(
    SDK.ContractName.fromString(CIS8_CONTRACT_NAME),
    SDK.EntrypointName.fromString(entrypoint),
  );
}

export function keyRegistryAddress(network: Network): SDK.ContractAddress.Type {
  const a = KEY_REGISTRY[network];
  return SDK.ContractAddress.create(a.index, a.subindex);
}

/** Note CIS-8 metadata values are strings, unlike CIS-8004's, whose values are raw bytes. */
export function registerExternalKeyParameter(input: {
  externalKey: ExternalKeyId;
  proofScheme: string;
  signature: Uint8Array;
  metadata?: { key: string; value: string }[];
}): SDK.Parameter.Type {
  return SDK.Parameter.fromBase64SchemaType(CIS8_SCHEMA.registerExternalKeyParameter, {
    external_key: {
      namespace: input.externalKey.namespace,
      key_type: input.externalKey.keyType,
      public_key: Array.from(input.externalKey.publicKey),
    },
    proof: { scheme: input.proofScheme, signature: Array.from(input.signature) },
    metadata: input.metadata ?? [],
  });
}

export function ownerOfKeyParameter(externalKey: ExternalKeyId): SDK.Parameter.Type {
  return SDK.Parameter.fromBase64SchemaType(CIS8_SCHEMA.ownerOfKeyParameter, {
    external_key: {
      namespace: externalKey.namespace,
      key_type: externalKey.keyType,
      public_key: Array.from(externalKey.publicKey),
    },
  });
}

export type KeyRegistration = {
  owner: string;
  namespace: string;
  keyType: string;
  publicKey: string;
  proofScheme: string;
  status: "Active" | "Revoked";
  lastUpdated: Date;
  metadata: { key: string; value: string }[];
};

type Opt<T> = { None: [] } | { Some: [T] };
type RawRegistration = {
  owner: string;
  external_key: { namespace: string; key_type: string; public_key: number[] };
  proof_scheme: string;
  metadata: { key: string; value: string }[];
  status: { Active: [] } | { Revoked: [] };
  last_updated: string;
};

function toRegistration(r: RawRegistration): KeyRegistration {
  return {
    owner: r.owner,
    namespace: r.external_key.namespace,
    keyType: r.external_key.key_type,
    publicKey: Buffer.from(r.external_key.public_key.map(Number)).toString("hex"),
    proofScheme: r.proof_scheme,
    status: "Active" in r.status ? "Active" : "Revoked",
    lastUpdated: new Date(r.last_updated),
    metadata: r.metadata,
  };
}

export function parseOwnerOfKey(returnValue: SDK.ReturnValue.Type): KeyRegistration | undefined {
  const parsed = SDK.ReturnValue.parseWithSchemaTypeBase64(
    returnValue,
    CIS8_SCHEMA.ownerOfKeyReturn,
  ) as unknown as Opt<RawRegistration>;
  if (!("Some" in parsed)) return undefined;
  return toRegistration(parsed.Some[0]);
}

export type Cis8View = {
  /**
   * The genesis hash this instance verifies proofs against. Read it rather than assuming: testnet
   * 12940 holds the ORIGINAL genesis, which is not the current-era genesis that quorum
   * certificates sign against, and the two differ on both networks at protocol 10.
   */
  genesisHash: string;
  admin?: string;
  registrations: KeyRegistration[];
};

export function parseCis8View(returnValue: SDK.ReturnValue.Type): Cis8View {
  const v = SDK.ReturnValue.parseWithSchemaTypeBase64(
    returnValue,
    CIS8_SCHEMA.viewReturn,
  ) as unknown as {
    by_key: RawRegistration[];
    genesis_hash: number[];
    admin: Opt<string>;
  };
  return {
    genesisHash: Buffer.from(v.genesis_hash.map(Number)).toString("hex"),
    admin: "Some" in v.admin ? v.admin.Some[0] : undefined,
    registrations: v.by_key.map(toRegistration),
  };
}
