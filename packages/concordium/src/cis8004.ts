/**
 * CIS-8004 Agent Registry: the parameter and return shapes we actually send and read.
 *
 * Every base64 blob below is a Concordium schema type lifted out of the deployed module's
 * `concordium-schema` custom section, not transcribed from documentation. `schema.test.ts`
 * re-derives them from the chain and fails if they drift, so a module upgrade that changes a
 * parameter cannot pass silently — it stops the test rather than producing a transaction the
 * contract will reject.
 *
 * To re-derive by hand: GetInstanceInfo gives `sourceModule`; GetModuleSource returns the wasm;
 * the schema is the `concordium-schema` custom section; `ccd-js-gen` prints the types.
 */
import * as SDK from "@concordium/web-sdk";
import type { Network } from "./registryAddresses.js";
import { REGISTRY, agentIdFromTokenId, agentTokenId } from "./registryAddresses.js";

export { KEY_REGISTRY, REGISTRY, agentIdFromTokenId, agentTokenId } from "./registryAddresses.js";
export type { Network } from "./registryAddresses.js";

export const CONTRACT_NAME = "CIS-8004";

/** Schema types, keyed the way the generated client names them. */
export const SCHEMA = {
  registerParameter:
    "FAAEAAAACQAAAGFnZW50X3VyaRUCAAAABAAAAE5vbmUCBAAAAFNvbWUBAQAAABYCDQAAAG1ldGFkYXRhX2hhc2gVAgAAAAQAAABOb25lAgQAAABTb21lAQEAAAATIAAAAAISAAAAZXh0ZXJuYWxfcmVmZXJlbmNlFQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAAFAACAAAAEAAAAGNvbnRyYWN0X2FkZHJlc3MMBAAAAGtpbmQVAQAAAAQAAABDaXM4AQEAAAAUAAMAAAAJAAAAbmFtZXNwYWNlFgIIAAAAa2V5X3R5cGUWAgoAAABwdWJsaWNfa2V5EAICEAAAAGluaXRpYWxfbWV0YWRhdGEQAhQAAgAAAAMAAABrZXkWAgUAAAB2YWx1ZRACAg==",
  setAgentUriParameter:
    "FAADAAAACAAAAHRva2VuX2lkHQAJAAAAYWdlbnRfdXJpFQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAAFgINAAAAbWV0YWRhdGFfaGFzaBUCAAAABAAAAE5vbmUCBAAAAFNvbWUBAQAAABMgAAAAAg==",
  /** A bare CIS-2 token id. Both `agentOf`'s parameter and `register`'s return value are this. */
  tokenId: "HQA=",
  agentOfReturn:
    "FQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAAFAALAAAACAAAAHRva2VuX2lkHQANAAAAb3duZXJfYWNjb3VudAsJAAAAYWdlbnRfdXJpFQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAAFgINAAAAbWV0YWRhdGFfaGFzaBUCAAAABAAAAE5vbmUCBAAAAFNvbWUBAQAAABMgAAAAAhIAAABleHRlcm5hbF9yZWZlcmVuY2UVAgAAAAQAAABOb25lAgQAAABTb21lAQEAAAAUAAIAAAAQAAAAY29udHJhY3RfYWRkcmVzcwwEAAAAa2luZBUBAAAABAAAAENpczgBAQAAABQAAwAAAAkAAABuYW1lc3BhY2UWAggAAABrZXlfdHlwZRYCCgAAAHB1YmxpY19rZXkQAgIMAAAAYWdlbnRfd2FsbGV0FQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAACwYAAABzdGF0dXMVAgAAAAYAAABBY3RpdmUCBwAAAFJldm9rZWQCDQAAAHJlZ2lzdGVyZWRfYXQNCgAAAHJldm9rZWRfYXQVAgAAAAQAAABOb25lAgQAAABTb21lAQEAAAANEQAAAHJldm9jYXRpb25fcmVhc29uFQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAAFgIRAAAAb25fY2hhaW5fbWV0YWRhdGEQAhQAAgAAAAMAAABrZXkWAgUAAAB2YWx1ZRACAg==",
} as const;

/** A 32-byte hash as the fixed-length byte array the schema wants. */
function hashBytes(hash: Uint8Array): number[] {
  if (hash.length !== 32) throw new Error(`expected a 32-byte hash, got ${hash.length}`);
  return Array.from(hash);
}

function option<T>(value: T | undefined, key: "Some" = "Some") {
  return value === undefined ? { None: [] } : { [key]: [value] };
}

export type Cis8Reference = {
  /** The CIS-8 instance holding the key. */
  keyRegistry: { index: bigint; subindex: bigint };
  namespace: string;
  keyType: string;
  publicKey: Uint8Array;
};

export type RegisterInput = {
  agentUri?: string;
  /** SHA-256 of the exact bytes served at `agentUri`. */
  metadataHash?: Uint8Array;
  externalReference?: Cis8Reference;
  initialMetadata?: { key: string; value: Uint8Array }[];
};

export function registerParameter(input: RegisterInput): SDK.Parameter.Type {
  return SDK.Parameter.fromBase64SchemaType(SCHEMA.registerParameter, {
    agent_uri: option(input.agentUri),
    metadata_hash: option(input.metadataHash && hashBytes(input.metadataHash)),
    external_reference: option(
      input.externalReference && {
        contract_address: {
          index: Number(input.externalReference.keyRegistry.index),
          subindex: Number(input.externalReference.keyRegistry.subindex),
        },
        kind: {
          Cis8: [
            {
              namespace: input.externalReference.namespace,
              key_type: input.externalReference.keyType,
              public_key: Array.from(input.externalReference.publicKey),
            },
          ],
        },
      },
    ),
    initial_metadata: (input.initialMetadata ?? []).map((m) => ({
      key: m.key,
      value: Array.from(m.value),
    })),
  });
}

/**
 * The card has to name the agent id, and the id only exists once registration has landed. So the
 * hash is committed in a second transaction rather than left as `None` forever: register, read the
 * id, write the final card, then anchor the hash of the bytes actually served.
 */
export function setAgentUriParameter(input: {
  agentId: bigint | number;
  agentUri?: string;
  metadataHash?: Uint8Array;
}): SDK.Parameter.Type {
  return SDK.Parameter.fromBase64SchemaType(SCHEMA.setAgentUriParameter, {
    token_id: agentTokenId(input.agentId),
    agent_uri: option(input.agentUri),
    metadata_hash: option(input.metadataHash && hashBytes(input.metadataHash)),
  });
}

export function agentOfParameter(agentId: bigint | number): SDK.Parameter.Type {
  return SDK.Parameter.fromBase64SchemaType(SCHEMA.tokenId, agentTokenId(agentId));
}

export type AgentRecord = {
  agentId: bigint;
  owner: string;
  agentUri?: string;
  /** Hex, no 0x. */
  metadataHash?: string;
  externalReference?: {
    keyRegistry: string;
    namespace: string;
    keyType: string;
    publicKey: string;
  };
  agentWallet?: string;
  status: "Active" | "Revoked";
  registeredAt: Date;
  revocationReason?: string;
};

type Opt<T> = { None: [] } | { Some: [T] };
const some = <T>(o: Opt<T>): T | undefined => ("Some" in o ? o.Some[0] : undefined);
const hex = (b: number[]) => Buffer.from(b).toString("hex");

/** The JSON shape `SCHEMA.agentOfReturn` deserialises to. Named so the parse is checked, not cast. */
type Cis8Kind = { Cis8: [{ namespace: string; key_type: string; public_key: number[] }] };
type RawAgent = {
  token_id: string;
  owner_account: string;
  agent_uri: Opt<string>;
  metadata_hash: Opt<number[]>;
  external_reference: Opt<{
    contract_address: { index: number; subindex: number };
    kind: Cis8Kind;
  }>;
  agent_wallet: Opt<string>;
  status: { Active: [] } | { Revoked: [] };
  registered_at: string;
  revoked_at: Opt<string>;
  revocation_reason: Opt<string>;
  on_chain_metadata: { key: string; value: number[] }[];
};

/** Parse `agentOf`'s return value. Returns undefined when no such agent exists. */
export function parseAgentOf(returnValue: SDK.ReturnValue.Type): AgentRecord | undefined {
  const parsed = SDK.ReturnValue.parseWithSchemaTypeBase64(
    returnValue,
    SCHEMA.agentOfReturn,
  ) as unknown as Opt<RawAgent>;
  const r = some(parsed);
  if (!r) return undefined;
  const ext = some(r.external_reference);
  const metadataHash = some(r.metadata_hash);
  return {
    agentId: agentIdFromTokenId(r.token_id),
    owner: r.owner_account,
    agentUri: some(r.agent_uri),
    metadataHash: metadataHash && hex(metadataHash),
    externalReference: ext && {
      keyRegistry: `${ext.contract_address.index}.${ext.contract_address.subindex}`,
      namespace: ext.kind.Cis8[0].namespace,
      keyType: ext.kind.Cis8[0].key_type,
      publicKey: hex(ext.kind.Cis8[0].public_key),
    },
    agentWallet: some(r.agent_wallet),
    status: "Active" in r.status ? "Active" : "Revoked",
    registeredAt: new Date(r.registered_at),
    revocationReason: some(r.revocation_reason),
  };
}

export function receiveName(entrypoint: string): SDK.ReceiveName.Type {
  return SDK.ReceiveName.create(
    SDK.ContractName.fromString(CONTRACT_NAME),
    SDK.EntrypointName.fromString(entrypoint),
  );
}

export function registryAddress(network: Network): SDK.ContractAddress.Type {
  const a = REGISTRY[network];
  return SDK.ContractAddress.create(a.index, a.subindex);
}
