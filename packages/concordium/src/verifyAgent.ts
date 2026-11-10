/**
 * Verifying a SealedRFQ-style Concordium badge the way a stranger would: from an agent id, a
 * network and nothing else.
 *
 * This is the shared implementation behind `scripts/concordium/verify-agent.mjs` and the evidence
 * dashboard. It lives here rather than in either of them because two copies of these checks would
 * drift, and the direction of the drift is predictable — the page would keep reporting a pass the
 * script had stopped giving. The same reasoning already keeps the agent card to one builder and the
 * qualification statement to one definition.
 *
 * Nothing here trusts our own records. The registration is read from chain, the card is fetched
 * from the URL the chain names, and its hash is recomputed from the exact bytes served. The card is
 * trusted for one thing only — *where to look* for the key binding — and CIS-8 is then asked
 * whether the agent's owner really owns the key the card names, so a card pointing at a stranger's
 * binding fails rather than passes.
 *
 * It takes its node client and its `fetch` as arguments. That is what lets the tests drive it with
 * return values captured from testnet and no network at all, including the cases that matter most:
 * an edited card, a borrowed key, and a node that cannot be reached.
 */
import type * as SDK from "@concordium/web-sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { GENESIS_PREFIX } from "./agentCard.js";
import {
  cis8ReceiveName,
  keyRegistryAddress,
  ownerOfKeyParameter,
  parseOwnerOfKey,
} from "./cis8.js";
import { KEY_TYPES, type KeyType } from "./cis8Message.js";
import {
  type AgentRecord,
  agentOfParameter,
  parseAgentOf,
  receiveName,
  registryAddress,
} from "./cis8004.js";
import { KEY_REGISTRY, type Network } from "./registryAddresses.js";

/** One checkable claim. `id` is stable so the UI can key on it and a test can name it. */
export type BadgeCheck = {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
};

export type ClaimedKey = { namespace: string; keyType: string; publicKey: string };

export type BadgeEvidence = {
  agentId: bigint;
  network: Network;
  /**
   * Four outcomes, and keeping them apart is the point.
   *
   * `verified` — every check ran and passed.
   * `failed`   — a check ran and said no. A finding.
   * `absent`   — there is no such agent. Not a failure of the badge, an absence of one.
   * `unreachable` — we could not ask. An outage, which must never be rendered as a finding.
   *
   * A confirmed failure outranks an outage: once something is proven wrong, a later unanswered
   * query does not make the result merely unknown.
   */
  outcome: "verified" | "failed" | "absent" | "unreachable";
  /** Why, for `absent` and `unreachable`. Never carries a check's reason. */
  reason?: string;
  agent?: AgentRecord;
  checks: BadgeCheck[];
  /** How the key binding was located, which differs by network and is worth showing. */
  via: "external-reference" | "card" | "none";
  claimedKey?: ClaimedKey;
  keyBinding?: {
    owner: string;
    status: "Active" | "Revoked";
    proofScheme: string;
    lastUpdated: string;
  };
  /** Hex, no 0x. Present only when a body was actually fetched and hashed. */
  servedCardSha256?: string;
  cardUrl?: string;
  checkedAt: string;
};

/**
 * The slice of a Concordium client this needs. Structural rather than the concrete class so the
 * node client, the web client and a test double are all acceptable without one of them having to
 * pretend to be another.
 */
export type ContractInvoker = {
  invokeContract(input: {
    contract: SDK.ContractAddress.Type;
    method: SDK.ReceiveName.Type;
    parameter: SDK.Parameter.Type;
  }): Promise<{ tag: string; returnValue?: SDK.ReturnValue.Type }>;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Whether a claimed key is one CIS-8 could even hold, checked before asking it.
 *
 * The key type and its public key arrive from an agent card, which is a document a stranger
 * controls. An unrecognised type or the wrong length for a recognised one would be refused by the
 * contract anyway, but as a parameter error that says nothing about which field was wrong — so it
 * is caught here, where the reason can be stated.
 */
function wellFormedKey(
  claimed: ClaimedKey,
): { ok: true; keyType: KeyType; publicKey: Buffer } | { ok: false; reason: string } {
  const expected = (KEY_TYPES as Record<string, number | undefined>)[claimed.keyType];
  if (expected === undefined) {
    return {
      ok: false,
      reason: `unknown key type "${claimed.keyType}"; CIS-8 defines ${Object.keys(KEY_TYPES).join(", ")}`,
    };
  }
  if (!/^[0-9a-fA-F]*$/.test(claimed.publicKey) || claimed.publicKey.length % 2 !== 0) {
    return { ok: false, reason: "the public key is not hex" };
  }
  const publicKey = Buffer.from(claimed.publicKey, "hex");
  if (publicKey.length !== expected) {
    return {
      ok: false,
      reason: `a ${claimed.keyType} key is ${expected} bytes, the card names ${publicKey.length}`,
    };
  }
  return { ok: true, keyType: claimed.keyType as KeyType, publicKey };
}

/** The badge extension out of an agent card, by URI rather than by position. */
function badgeExtension(card: unknown): Record<string, unknown> | undefined {
  const extensions = (card as { capabilities?: { extensions?: unknown[] } })?.capabilities
    ?.extensions;
  if (!Array.isArray(extensions)) return undefined;
  const found = extensions.find(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      String((e as { uri?: unknown }).uri).includes("concordium-badge"),
  );
  return found as Record<string, unknown> | undefined;
}

export async function verifyAgentBadge(opts: {
  client: ContractInvoker;
  agentId: bigint;
  network: Network;
  fetch?: typeof globalThis.fetch;
}): Promise<BadgeEvidence> {
  const { client, agentId, network } = opts;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const checks: BadgeCheck[] = [];
  const check = (id: string, ok: boolean, label: string, detail?: string) => {
    checks.push({ id, ok, label, detail });
  };
  const base = { agentId, network, checkedAt: new Date().toISOString() };

  // ---- 1. The registration ---------------------------------------------------------------

  let agent: AgentRecord | undefined;
  try {
    const result = await client.invokeContract({
      contract: registryAddress(network),
      method: receiveName("agentOf"),
      parameter: agentOfParameter(agentId),
    });
    if (result.tag !== "success" || !result.returnValue) {
      return {
        ...base,
        outcome: "unreachable",
        reason: `agentOf returned ${result.tag}`,
        checks: [],
        via: "none",
      };
    }
    agent = parseAgentOf(result.returnValue);
  } catch (e) {
    return { ...base, outcome: "unreachable", reason: message(e), checks: [], via: "none" };
  }
  if (!agent) {
    return {
      ...base,
      outcome: "absent",
      reason: `no agent ${agentId} in the ${network} registry`,
      checks: [],
      via: "none",
    };
  }

  check(
    "status",
    agent.status === "Active",
    "The registration is Active",
    `status ${agent.status}`,
  );
  check(
    "card-url-recorded",
    Boolean(agent.agentUri),
    "An agent card URL is recorded on chain",
    agent.agentUri,
  );
  check(
    "card-hash-anchored",
    Boolean(agent.metadataHash),
    "A card hash is anchored on chain",
    agent.metadataHash ??
      "none — without this the card can be edited after the fact and the registration attests to nothing but a URL",
  );

  // ---- 2. The card, and whether its bytes still hash to the anchor -------------------------

  let card: unknown;
  let servedCardSha256: string | undefined;
  if (agent.agentUri && agent.metadataHash) {
    let body: Buffer | undefined;
    try {
      const response = await doFetch(agent.agentUri);
      if (!response.ok) {
        check("card-url", false, "The card URL resolves", `HTTP ${response.status}`);
      } else {
        body = Buffer.from(await response.arrayBuffer());
        check("card-url", true, "The card URL resolves", `${body.length} bytes`);
      }
    } catch (e) {
      check("card-url", false, "The card URL resolves", message(e));
    }

    if (body) {
      // The raw body, not a re-serialisation of a parse of it. Comparing a reading of the card
      // rather than the card is precisely the gap an edited card would slip through.
      servedCardSha256 = Buffer.from(sha256(body)).toString("hex");
      check(
        "card-hash",
        servedCardSha256 === agent.metadataHash,
        "SHA-256 of the bytes served equals the hash anchored on chain",
        `served ${servedCardSha256}\nchain  ${agent.metadataHash}`,
      );
      try {
        card = JSON.parse(body.toString("utf8"));
        check("card-json", true, "The card parses as JSON");
      } catch {
        check("card-json", false, "The card parses as JSON");
      }
    }
  }

  // ---- 3. What the card claims about itself -----------------------------------------------

  if (card) {
    const badge = badgeExtension(card);
    check("badge-extension", Boolean(badge), "The card carries the Concordium badge extension");
    const params = (badge?.params ?? {}) as {
      contracts?: { cis8004?: string };
      owner?: { account?: string };
    };
    const reg = registryAddress(network);
    const expected = `ccd:${GENESIS_PREFIX[network]}:${reg.index}.${reg.subindex}`;
    check(
      "card-registry",
      params.contracts?.cis8004 === expected,
      "The card names the registry it is registered in",
      `card ${params.contracts?.cis8004 ?? "none"}\nexpected ${expected}`,
    );
    check(
      "card-owner",
      params.owner?.account === `ccd:${GENESIS_PREFIX[network]}:${agent.owner}`,
      "The card names the account that owns the agent on chain",
      `card ${params.owner?.account ?? "none"}`,
    );
    const registrations = (card as { registrations?: { agentId?: unknown }[] }).registrations ?? [];
    check(
      "card-agent-id",
      registrations.some((r) => {
        try {
          return BigInt(r.agentId as never) === agentId;
        } catch {
          return false;
        }
      }),
      "The card claims this agent id",
      "so a card cannot claim a registration belonging to somebody else",
    );
  }

  // ---- 4. The Arc key binding --------------------------------------------------------------

  /**
   * Two routes to the same fact, because the registry cannot always carry it.
   *
   * Preferred: the agent's own `external_reference`. On testnet that is never present — CIS-8004 at
   * 13042 is configured against the *mainnet* CIS-8 address, so it refuses every reference however
   * correct the binding is. The card then states the key and the binding is checked directly.
   */
  const keys = keyRegistryAddress(network);
  const fromRegistry = agent.externalReference;
  if (fromRegistry) {
    const expected = `${KEY_REGISTRY[network].index}.${KEY_REGISTRY[network].subindex}`;
    check(
      "reference-registry",
      fromRegistry.keyRegistry === expected,
      "The external reference points at the CIS-8 registry we expect",
      `reference ${fromRegistry.keyRegistry}\nexpected  ${expected}`,
    );
  }

  const fromCardKey = (() => {
    const k = (badgeExtension(card)?.params as { externalKey?: ClaimedKey } | undefined)
      ?.externalKey;
    return k?.publicKey
      ? { namespace: k.namespace, keyType: k.keyType, publicKey: k.publicKey }
      : undefined;
  })();

  const claimedKey: ClaimedKey | undefined = fromRegistry
    ? {
        namespace: fromRegistry.namespace,
        keyType: fromRegistry.keyType,
        publicKey: fromRegistry.publicKey,
      }
    : fromCardKey;
  const via = fromRegistry ? "external-reference" : fromCardKey ? "card" : "none";

  let keyBinding: BadgeEvidence["keyBinding"];
  let unreachableReason: string | undefined;

  if (!claimedKey) {
    check(
      "key-claimed",
      false,
      "A CIS-8 key binding is claimed",
      "neither the registry's external reference nor the card names one",
    );
  } else {
    check(
      "key-claimed",
      true,
      "A CIS-8 key binding is claimed",
      `${claimedKey.keyType} ${claimedKey.publicKey}`,
    );
  }

  const wellFormed = claimedKey ? wellFormedKey(claimedKey) : undefined;
  if (wellFormed) {
    check(
      "key-well-formed",
      wellFormed.ok,
      "The claimed key is a type and length CIS-8 defines",
      wellFormed.ok
        ? `${claimedKey?.keyType}, ${wellFormed.publicKey.length} bytes`
        : wellFormed.reason,
    );
  }

  if (claimedKey && wellFormed?.ok) {
    try {
      const result = await client.invokeContract({
        contract: keys,
        method: cis8ReceiveName("ownerOfKey"),
        parameter: ownerOfKeyParameter({
          namespace: claimedKey.namespace,
          keyType: wellFormed.keyType,
          publicKey: wellFormed.publicKey,
        }),
      });
      const binding =
        result.tag === "success" && result.returnValue
          ? parseOwnerOfKey(result.returnValue)
          : undefined;
      if (binding) {
        keyBinding = {
          owner: binding.owner,
          status: binding.status,
          proofScheme: binding.proofScheme,
          lastUpdated: binding.lastUpdated.toISOString(),
        };
      }
      check(
        "key-active",
        binding?.status === "Active",
        "The key binding is Active in CIS-8",
        `status ${binding?.status ?? "no entry for this key"}`,
      );
      check(
        "key-owner",
        binding?.owner === agent.owner,
        "The key is bound to the same account that owns the agent",
        `key owner   ${binding?.owner ?? "none"}\nagent owner ${agent.owner}`,
      );
    } catch (e) {
      // The query failed rather than answered. Recorded as an outage, not as a refusal.
      unreachableReason = message(e);
    }
  }

  const failed = checks.filter((c) => !c.ok);
  const outcome: BadgeEvidence["outcome"] =
    failed.length > 0 ? "failed" : unreachableReason ? "unreachable" : "verified";

  return {
    ...base,
    outcome,
    reason: outcome === "unreachable" ? unreachableReason : undefined,
    agent,
    checks,
    via,
    claimedKey,
    keyBinding,
    servedCardSha256,
    cardUrl: agent.agentUri,
  };
}
