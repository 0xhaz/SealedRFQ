#!/usr/bin/env node
/**
 * Register the Concordium committee for the current reward period in the Arc epoch registry.
 *
 * The registry is fail-closed: it refuses a certificate from a period it has no committee for,
 * so this has to run before any qualification works and again every reward period — once a day,
 * since a period is 24 one-hour epochs. A registry that has fallen behind refuses everything,
 * which is the intended failure and still needs someone to notice.
 *
 * The committee is asserted rather than proven, because Concordium exposes no state proof for it.
 * What makes that tolerable is that the assertion is public and falsifiable: anyone can read the
 * same committee off a Concordium node and check the hash registered here against it. That is a
 * weaker claim than a proof and is described as one.
 *
 * Usage:
 *   node scripts/concordium/update-committee.mjs [--dry-run]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { fetchFinalityProof } from "@sealedrfq/concordium/finality";
import { http, createPublicClient, createWalletClient, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = resolve(import.meta.dirname, "../..");
const dryRun = process.argv.includes("--dry-run");
/** Report whether the registry is current and exit non-zero if not. Needs no signing key. */
const checkOnly = process.argv.includes("--check");

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// Locally, read the env file so nothing lands in shell history. In CI there is no file and the
// values come from the environment already, so a missing file is normal rather than an error.
// Overridable through CCD_ENV_FILE rather than a flag: Node has its own `--env-file` and would
// consume the argument before this script ever saw it, failing with a message about a file this
// script never asked for.
const ENV_FILE = process.env.CCD_ENV_FILE
  ? resolve(process.env.CCD_ENV_FILE)
  : resolve(ROOT, ".env.testnet");
try {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

const REGISTRY = process.env.V2_EPOCH_REGISTRY;
const RPC = process.env.ARC_TESTNET_RPC_URL;
const PK = process.env.ADMIN_PK;
if (!REGISTRY || !RPC) die("V2_EPOCH_REGISTRY and ARC_TESTNET_RPC_URL must be set");
if (!PK && !checkOnly) die("ADMIN_PK must be set, or pass --check to report without updating");

const ABI = parseAbi([
  "function currentPeriod() view returns (uint64)",
  "function currentEpoch() view returns (uint64)",
  "function periodsBehind() view returns (uint64)",
  "function proposeCommittee(uint64 period, bytes32 membersHash, uint128 totalStake)",
  "function committees(uint64 period) view returns (bytes32 membersHash, uint128 totalStake, uint64 registeredAt, bool present)",
]);

const arc = {
  id: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  name: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
};
const publicClient = createPublicClient({ chain: arc, transport: http(RPC) });
const account = PK ? privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`) : undefined;
const wallet = account
  ? createWalletClient({ account, chain: arc, transport: http(RPC) })
  : undefined;

const ccd = new ConcordiumGRPCNodeClient(
  process.env.CCD_GRPC_HOST ?? "grpc.testnet.concordium.com",
  Number(process.env.CCD_GRPC_PORT ?? 20000),
  credentials.createSsl(),
);

const [period, epoch, behind] = await Promise.all([
  publicClient.readContract({ address: REGISTRY, abi: ABI, functionName: "currentPeriod" }),
  publicClient.readContract({ address: REGISTRY, abi: ABI, functionName: "currentEpoch" }),
  publicClient.readContract({ address: REGISTRY, abi: ABI, functionName: "periodsBehind" }),
]);
console.log(`\nregistry        ${REGISTRY}`);
console.log(`updater         ${account?.address ?? "(none: --check)"}`);
console.log(`epoch / period  ${epoch} / ${period}`);
console.log(`periods behind  ${behind}`);

if (checkOnly) {
  // Behind by one period or more means the registry is refusing every certificate right now.
  console.log(
    behind === 0n
      ? "\nregistry is current\n"
      : `\nREGISTRY IS ${behind} PERIOD(S) BEHIND — every qualification is being refused\n`,
  );
  process.exit(behind === 0n ? 0 : 1);
}

// The committee comes from a real finalized block, so what is registered is what actually signs.
const proof = await fetchFinalityProof(ccd);
console.log(`\ncommittee from block ${proof.blockHash}`);
console.log(`  epoch ${proof.epoch}, ${proof.signedStakeBps} bps of stake signed`);
console.log(`  membersHash ${proof.membersHash}`);
console.log(`  totalStake  ${proof.totalStake}`);

// The registry's clock, not Concordium's: they are derived from the same era genesis, but a
// drifting Arc timestamp would otherwise register a committee against the wrong period.
const proofPeriod = proof.epoch / BigInt(process.env.CCD_REWARD_PERIOD_EPOCHS ?? 24);
if (proofPeriod !== period) {
  die(
    `the certificate is from period ${proofPeriod} but the registry says ${period}.\n  Registering a committee against the wrong period makes it unusable, silently.`,
  );
}

const existing = await publicClient.readContract({
  address: REGISTRY,
  abi: ABI,
  functionName: "committees",
  args: [period],
});
if (existing[0] === proof.membersHash) {
  console.log(`\nperiod ${period} already registered with this committee; nothing to do\n`);
  process.exit(0);
}
if (existing[0] !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
  die(
    `period ${period} already holds a different committee (${existing[0]}).\n  Two committees for one period means one of them is wrong; investigate before overwriting.`,
  );
}

if (dryRun) {
  console.log("\n  --dry-run: nothing sent.\n");
  process.exit(0);
}

const hash = await wallet.writeContract({
  address: REGISTRY,
  abi: ABI,
  functionName: "proposeCommittee",
  args: [period, proof.membersHash, proof.totalStake],
});
console.log(`\nproposeCommittee ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") die(`the transaction reverted: ${hash}`);

const after = await publicClient.readContract({
  address: REGISTRY,
  abi: ABI,
  functionName: "committees",
  args: [period],
});
console.log(
  after[0] === proof.membersHash
    ? `\nperiod ${period} registered\n`
    : `\nproposal recorded but not yet confirmed: ${after[0]} (more confirmations required)\n`,
);
