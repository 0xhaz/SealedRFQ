#!/usr/bin/env node
/**
 * Verifies a Concordium agent badge the way a stranger would, and prints the result.
 *
 * It takes an agent id and a network and nothing else. It does not read our registration record,
 * does not trust the card's own claims about itself, and recomputes every hash. That is the point:
 * a badge nobody but us can check is decoration.
 *
 * The checks themselves live in `@sealedrfq/concordium/verifyAgent`, because the evidence
 * dashboard runs the same ones and two copies would drift — predictably in one direction, with the
 * page still reporting a pass the script had stopped giving. This file is the terminal rendering of
 * that function and nothing more.
 *
 * Usage:
 *   node scripts/concordium/verify-agent.mjs <agentId> [--network testnet]
 */
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { verifyAgentBadge } from "@sealedrfq/concordium/verifyAgent";

const NODES = {
  testnet: "grpc.testnet.concordium.com",
  mainnet: "grpc.mainnet.concordium.software",
};

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const raw = args.find((a) => /^\d+$/.test(a));
if (!raw) die("give an agent id: node scripts/concordium/verify-agent.mjs <agentId>");
const agentId = BigInt(raw);
const network = args.includes("--network") ? args[args.indexOf("--network") + 1] : "testnet";
if (!NODES[network]) die(`unknown network ${network}`);

const client = new ConcordiumGRPCNodeClient(NODES[network], 20000, credentials.createSsl());
console.log(`\nverifying agent ${agentId} on Concordium ${network}\n`);

const result = await verifyAgentBadge({ client, agentId, network });

// An outage and a finding exit differently, because a monitor that cannot tell them apart will
// eventually page someone about a network blip and ignore a revoked badge.
if (result.outcome === "unreachable") {
  die(`could not complete the check: ${result.reason}`);
}
if (result.outcome === "absent") {
  die(result.reason);
}

const { agent } = result;
console.log(`  owner      ${agent.owner}`);
console.log(`  registered ${agent.registeredAt.toISOString()}`);
console.log(
  `  binding    via ${
    result.via === "external-reference"
      ? "the registry's external_reference"
      : result.via === "card"
        ? "the card, since the registry holds no reference"
        : "nothing"
  }\n`,
);

for (const c of result.checks) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.label}`);
  if (c.detail) {
    for (const line of c.detail.split("\n")) console.log(`          ${line}`);
  }
}

if (result.keyBinding) {
  console.log(
    `\n  key        ${result.claimedKey.keyType} ${result.claimedKey.publicKey}` +
      `\n             proved by ${result.keyBinding.proofScheme} in namespace ${result.claimedKey.namespace}`,
  );
}

const failed = result.checks.filter((c) => !c.ok);
console.log(
  failed.length === 0
    ? `\n  ${result.checks.length} checks passed. The badge verifies.\n`
    : `\n  ${failed.length} of ${result.checks.length} checks failed.\n`,
);
process.exit(failed.length === 0 ? 0 : 1);
