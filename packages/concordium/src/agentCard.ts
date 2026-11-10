/**
 * The evaluator's A2A Agent Card, and the hash anchored for it in CIS-8004.
 *
 * The card is built by one pure function so that the bytes served at `/.well-known/agent-card.json`
 * and the bytes hashed by the registration script cannot drift apart. Anyone can check the badge
 * without trusting us: fetch the URL, SHA-256 the response body, compare with `metadata_hash` from
 * `agentOf`. That only works if the serialisation is fixed, so it is RFC 8785 canonical JSON and
 * the route serves `cardBytes()` verbatim rather than re-serialising an object.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import canonicalize from "canonicalize";
import type { Network } from "./registryAddresses.js";
import { REGISTRY, agentTokenId } from "./registryAddresses.js";

/**
 * The `ccd:` URI scheme identifies a network by the first 16 bytes of its ORIGINAL genesis hash,
 * which is not the current-era genesis. Both networks are on protocol 10, so the two differ; the
 * quorum certificate work signs against current-era genesis and this does not, and conflating them
 * produces identifiers that look right and resolve nowhere.
 */
export const GENESIS_PREFIX = {
  mainnet: "9dd9ca4d19e9393877d2c44b70f89acb",
  testnet: "4221332d34e1694168c2a0c0b3fd0f27",
} as const;

/** The badge extension the Concordium A2A profile defines. */
export const BADGE_EXTENSION_URI = "https://docs.concordium.com/a2a-extensions/concordium-badge/v1";

export type AgentCardInput = {
  network: Network;
  /** Origin the card is served from, with no trailing slash, e.g. `https://sealedrfq.example`. */
  origin: string;
  /** The CIS-8004 agent id. Known only after registration, which is why the hash is a second tx. */
  agentId: bigint | number;
  /** Base58 account address that owns the agent token. */
  owner: string;
  /** Optional CIS-8 key binding, present only once a key is actually registered there. */
  /**
   * The CIS-8 binding, stated in the card because CIS-8004 cannot point at it.
   *
   * The registry deployed to testnet at 13042 is configured with cis8_contract = 10081, which is
   * the MAINNET CIS-8 address; on testnet that index holds an unrelated contract. So every
   * `external_reference` is refused with InvalidExternalReference, which is also why the
   * registry's own reference agent has none. The binding is real and on chain regardless, so the
   * card carries enough to find and check it without the registry's help.
   */
  keyBinding?: {
    // `number` as well as `bigint`: this is read back out of a JSON record, and JSON has no
    // bigint. The index is only ever interpolated into a `ccd:` identifier, so either is exact
    // for every contract index that exists.
    keyRegistry: { index: bigint | number; subindex: bigint | number };
    namespace: string;
    keyType: string;
    /** Hex, no 0x. */
    publicKey: string;
  };
};

/**
 * The CIS-2 token address, base58. Its encoding also pins the token id byte order: agent 0 on
 * testnet reads back as `0000000000000000`, so ids are u64 little-endian, which is documented
 * nowhere and was established by decoding a card already on chain.
 */
function tokenAddress(network: Network, agentId: bigint | number): string {
  // Deliberately not SDK.tokenAddressToBase58: this package is imported by the web app, and
  // pulling the SDK's wasm into a server component bundle for one base58 string is not worth it.
  // `agentCard.test.ts` checks this against the SDK's own encoder.
  const reg = REGISTRY[network];
  const id = Buffer.from(agentTokenId(agentId), "hex");
  // No length prefix on the token id: CIS-2 token addresses concatenate the raw id bytes, so the
  // encoding is only unambiguous because the id length is fixed by convention per contract.
  const body = Buffer.concat([Buffer.from([2]), uleb128(reg.index), uleb128(reg.subindex), id]);
  return base58check(body);
}

function uleb128(value: bigint): Buffer {
  const out: number[] = [];
  let v = value;
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return Buffer.from(out);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58check(payload: Buffer): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const full = Buffer.concat([payload, Buffer.from(checksum)]);
  let n = 0n;
  for (const b of full) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  // Leading zero bytes are not represented in the integer, so each gets its own '1'.
  for (const b of full) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/**
 * The card. Written to be accurate rather than impressive: the evaluator scores against a rubric
 * arithmetically and calls no model, so the card says that. A card that overstates what the agent
 * does is worse than no card, because the badge invites people to rely on it.
 */
export function agentCard(input: AgentCardInput): Record<string, unknown> {
  const g = GENESIS_PREFIX[input.network];
  const reg = REGISTRY[input.network];
  const registryRef = `ccd:${g}:${reg.index}.${reg.subindex}`;
  return {
    name: "SealedRFQ Evaluator",
    description:
      "Scores revealed sealed bids against the rubric that was published, and hash-fixed, before bidding opened. Scoring is integer arithmetic over the rubric weights with no model in the path, so the same bids and the same rubric always produce the same scores. The agent can recommend a winner; it cannot award one. Awarding is a separate on-chain call that re-checks the budget cap, the minimum number of bidders, the deposit ratio and the rubric hash, and refuses a recommendation that breaks any of them.",
    version: "2.0.0",
    url: `${input.origin}/api/agent`,
    documentationUrl: `${input.origin}/guide`,
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    provider: { organization: "SealedRFQ", url: input.origin },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      extensions: [
        {
          uri: BADGE_EXTENSION_URI,
          description:
            "Verified by Concordium badge: on-chain agent identity in a CIS-8004 registry",
          required: false,
          params: {
            tokenAddress: `ccd:${g}/cis-2:${tokenAddress(input.network, input.agentId)}`,
            owner: { account: `ccd:${g}:${input.owner}` },
            contracts: { cis8004: registryRef },
            ...(input.keyBinding
              ? {
                  externalKey: {
                    registry: `ccd:${g}:${input.keyBinding.keyRegistry.index}.${input.keyBinding.keyRegistry.subindex}`,
                    namespace: input.keyBinding.namespace,
                    keyType: input.keyBinding.keyType,
                    publicKey: input.keyBinding.publicKey,
                    proofScheme: "ethereum-personal-sign",
                    note: "The same secp256k1 key the Arc contracts grant EVALUATOR_ROLE to. CIS-8004 cannot reference it on testnet, so check it directly: CIS-8 ownerOfKey must return this agent's owner with status Active.",
                  },
                }
              : {}),
            verify:
              "Resolve the token address through CIS-8004 agentOf; require status Active, the owner above, and SHA-256 of this document's exact bytes equal to metadata_hash.",
          },
        },
      ],
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "score-sealed-bids",
        name: "Score revealed sealed bids",
        description:
          "Takes the revealed bids for one tender and the rubric fixed at its creation, and returns a score per criterion per bidder plus a weighted total. Requirements a bid cannot prove, such as a certification, are reported as still needing a human rather than passed.",
        tags: ["procurement", "evaluation", "deterministic"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "anchor-decision-memo",
        name: "Anchor a decision memo",
        description:
          "Serialises the decision as RFC 8785 canonical JSON, hashes it with SHA-256 and writes the hash on chain, for recommendations and rejections alike. Re-hashing the published memo is what proves it was not edited afterwards.",
        tags: ["audit", "attestation"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
    registrations: [{ agentId: Number(input.agentId), agentRegistry: registryRef }],
  };
}

/** The exact bytes to serve and to hash. */
export function cardBytes(input: AgentCardInput): Buffer {
  const json = canonicalize(agentCard(input));
  if (json === undefined) throw new Error("agent card is not JSON-serialisable");
  return Buffer.from(json, "utf8");
}

/** SHA-256 of those bytes: the value `metadata_hash` must hold. */
export function cardHash(input: AgentCardInput): Uint8Array {
  return sha256(cardBytes(input));
}

export function cardHashHex(input: AgentCardInput): string {
  return Buffer.from(cardHash(input)).toString("hex");
}
