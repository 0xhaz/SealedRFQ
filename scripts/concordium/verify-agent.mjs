#!/usr/bin/env node
/**
 * Verifies the SealedRFQ evaluator's Concordium badge the way a stranger would.
 *
 * It takes an agent id and a network and nothing else. It does not read our registration record,
 * does not trust the card's own claims about itself, and recomputes every hash. That is the point:
 * a badge nobody but us can check is decoration.
 *
 * What it checks, and what each check buys:
 *
 *   1. The agent exists in CIS-8004 and its status is Active, not Revoked.
 *   2. The card URL recorded on chain resolves, and SHA-256 of the exact bytes served equals the
 *      `metadata_hash` on chain. This is the one that matters: without it the card is editable
 *      after the fact and the registration attests to nothing but a URL.
 *   3. The card's own badge extension points back at this agent, this registry and this owner, so
 *      a card cannot claim a registration that belongs to somebody else.
 *   4. The agent's `external_reference` resolves to an active CIS-8 entry owned by the same
 *      account, which is what ties the Concordium identity to the Arc evaluator key.
 *
 * Usage:
 *   node scripts/concordium/verify-agent.mjs <agentId> [--network testnet]
 */
import * as SDK from "@concordium/web-sdk";
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { sha256 } from "@noble/hashes/sha2.js";
import { GENESIS_PREFIX } from "@sealedrfq/concordium";
import {
  cis8ReceiveName,
  keyRegistryAddress,
  ownerOfKeyParameter,
  parseOwnerOfKey,
} from "@sealedrfq/concordium/cis8";
import {
  agentOfParameter,
  parseAgentOf,
  receiveName,
  registryAddress,
} from "@sealedrfq/concordium/cis8004";

const NODES = {
  testnet: "grpc.testnet.concordium.com",
  mainnet: "grpc.mainnet.concordium.software",
};

const args = process.argv.slice(2);
const agentId = BigInt(args.find((a) => /^\d+$/.test(a)) ?? die("give an agent id"));
const network = args.includes("--network") ? args[args.indexOf("--network") + 1] : "testnet";
if (!NODES[network]) die(`unknown network ${network}`);

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const checks = [];
const check = (ok, label, detail) => {
  checks.push({ ok, label, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `\n          ${detail}` : ""}`);
};

const client = new ConcordiumGRPCNodeClient(NODES[network], 20000, credentials.createSsl());
console.log(`\nverifying agent ${agentId} on Concordium ${network}\n`);

// ---- 1. The registration ---------------------------------------------------------------------

const onChain = await client.invokeContract({
  contract: registryAddress(network),
  method: receiveName("agentOf"),
  parameter: agentOfParameter(agentId),
});
if (onChain.tag !== "success" || !onChain.returnValue) die("agentOf failed");
const agent = parseAgentOf(onChain.returnValue);
if (!agent) die(`no agent ${agentId} in the ${network} registry`);

check(agent.status === "Active", "registration is Active", `status ${agent.status}`);
check(Boolean(agent.agentUri), "an agent card URL is recorded", agent.agentUri ?? "none");
check(Boolean(agent.metadataHash), "a card hash is anchored", agent.metadataHash ?? "none");
console.log(`          owner ${agent.owner}, registered ${agent.registeredAt.toISOString()}`);

// ---- 2. The card hash ------------------------------------------------------------------------

let card;
if (agent.agentUri && agent.metadataHash) {
  const response = await fetch(agent.agentUri).catch((e) => ({ ok: false, error: e.message }));
  if (!response.ok) {
    check(false, "the card URL resolves", response.error ?? `HTTP ${response.status}`);
  } else {
    // Hash the raw body. Parsing and re-serialising would compare a reading of the card rather
    // than the card, and that is exactly the gap an edited card would slip through.
    const body = Buffer.from(await response.arrayBuffer());
    const computed = Buffer.from(sha256(body)).toString("hex");
    check(
      computed === agent.metadataHash,
      "SHA-256 of the served bytes equals the anchored hash",
      `served ${computed}\n          chain  ${agent.metadataHash}`,
    );
    try {
      card = JSON.parse(body.toString("utf8"));
    } catch {
      check(false, "the card is valid JSON");
    }
  }
}

// ---- 3. What the card claims about itself ----------------------------------------------------

if (card) {
  const badge = (card.capabilities?.extensions ?? []).find((e) =>
    String(e.uri).includes("concordium-badge"),
  );
  check(Boolean(badge), "the card carries the Concordium badge extension");
  const params = badge?.params ?? {};
  const reg = registryAddress(network);
  const expectedRegistry = `ccd:${GENESIS_PREFIX[network]}:${reg.index}.${reg.subindex}`;
  check(
    params.contracts?.cis8004 === expectedRegistry,
    "the card names this registry",
    `card ${params.contracts?.cis8004 ?? "none"}`,
  );
  check(
    params.owner?.account === `ccd:${GENESIS_PREFIX[network]}:${agent.owner}`,
    "the card names the on-chain owner",
    `card ${params.owner?.account ?? "none"}`,
  );
  const claimed = (card.registrations ?? []).some((r) => BigInt(r.agentId ?? -1) === agentId);
  check(claimed, "the card claims this agent id");
}

// ---- 4. The Arc key binding ------------------------------------------------------------------

/**
 * Two routes to the same fact, because the registry cannot always carry it.
 *
 * Preferred: the agent's own `external_reference`. On testnet that is never present — the registry
 * at 13042 is configured against the mainnet CIS-8 address, so it refuses every reference. The
 * card then states the key itself, and the binding is checked directly in CIS-8.
 *
 * The card is not trusted for the answer, only for where to look: whatever key it names, CIS-8
 * has to say that this agent's owner owns it. A card naming a key somebody else owns fails here.
 */
const keys = keyRegistryAddress(network);
const fromRegistry = agent.externalReference;
const fromCard = (() => {
  const badge = (card?.capabilities?.extensions ?? []).find((e) =>
    String(e.uri).includes("concordium-badge"),
  );
  const k = badge?.params?.externalKey;
  return k?.publicKey
    ? { namespace: k.namespace, keyType: k.keyType, publicKey: k.publicKey }
    : undefined;
})();

if (fromRegistry) {
  check(
    fromRegistry.keyRegistry === `${keys.index}.${keys.subindex}`,
    "the external reference points at the CIS-8 registry we expect",
    `reference ${fromRegistry.keyRegistry}`,
  );
}

const claimed = fromRegistry ?? fromCard;
if (!claimed) {
  check(false, "a CIS-8 key binding is claimed", "neither the registry nor the card names one");
} else {
  console.log(
    `          via ${fromRegistry ? "the registry's external_reference" : "the card, since the registry holds no reference"}`,
  );
  const owner = await client.invokeContract({
    contract: keys,
    method: cis8ReceiveName("ownerOfKey"),
    parameter: ownerOfKeyParameter({
      namespace: claimed.namespace,
      keyType: claimed.keyType,
      publicKey: Buffer.from(claimed.publicKey, "hex"),
    }),
  });
  const binding =
    owner.tag === "success" && owner.returnValue ? parseOwnerOfKey(owner.returnValue) : undefined;
  check(
    binding?.status === "Active",
    "the key binding is Active in CIS-8",
    `status ${binding?.status ?? "no entry"}`,
  );
  check(
    binding?.owner === agent.owner,
    "the key is bound to the same account that owns the agent",
    `key owner   ${binding?.owner ?? "none"}\n          agent owner ${agent.owner}`,
  );
  console.log(
    `          ${claimed.keyType} ${claimed.publicKey}` +
      `\n          proved by ${binding?.proofScheme ?? "?"} in namespace ${claimed.namespace}`,
  );
}

const failed = checks.filter((c) => !c.ok);
console.log(
  failed.length === 0
    ? `\n  ${checks.length} checks passed. The badge verifies.\n`
    : `\n  ${failed.length} of ${checks.length} checks failed.\n`,
);
process.exit(failed.length === 0 ? 0 : 1);
