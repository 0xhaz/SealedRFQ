#!/usr/bin/env node
/**
 * Record a qualification on Arc through the same code the agent's HTTP endpoint runs.
 *
 * Usage:
 *   node scripts/concordium/record-qualification.mjs --subject <id> --bidder 0x.. --tender <n>
 *        --synthetic [--dry-run]
 *
 * `--synthetic` is required while there is no verified-presentation input here, and it is stated
 * rather than assumed. A qualification recorded from a synthetic subject proves the plumbing and
 * that the Arc contract verified a genuine finality certificate. It proves nothing about anyone's
 * identity: the subject is a string somebody typed, and no Concordium credential was checked.
 *
 * Needs `pnpm build` first: this imports the agent's compiled qualifier core.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { fetchFinalityProof } from "@sealedrfq/concordium/finality";
import { http, createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DryRun,
  QUALIFIER_ABI,
  qualify,
} from "../../apps/agent/dist/modules/qualifier/qualifier.core.js";

const ROOT = resolve(import.meta.dirname, "../..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
function die(m) {
  console.error(`\n  ${m}\n`);
  process.exit(1);
}

const ENV_FILE = process.env.CCD_ENV_FILE
  ? resolve(process.env.CCD_ENV_FILE)
  : resolve(ROOT, ".env.testnet");
try {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (v && process.env[k] === undefined) process.env[k] = v;
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

const subject = opt("subject");
const bidder = opt("bidder");
const tender = opt("tender");
if (!subject || !bidder || !tender) die("--subject, --bidder and --tender are required");
if (!flag("synthetic")) {
  die(
    "--synthetic is required: this script has no verified-presentation input yet, so every\n  subject it is given is made up. Say so rather than let it pass for verified.",
  );
}
const {
  V2_QUALIFIER,
  V2_EPOCH_REGISTRY,
  ARC_TESTNET_RPC_URL: RPC,
  CCD_QUALIFIER_PK: PK,
} = process.env;
const SECRET = process.env.QUALIFICATION_NULLIFIER_SECRET;
if (!V2_QUALIFIER || !V2_EPOCH_REGISTRY || !RPC || !PK || !SECRET) {
  die(
    "V2_QUALIFIER, V2_EPOCH_REGISTRY, ARC_TESTNET_RPC_URL, CCD_QUALIFIER_PK and QUALIFICATION_NULLIFIER_SECRET must be set",
  );
}

const arc = {
  id: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  name: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain: arc, transport: http(RPC) });
const account = privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`);
const wallet = createWalletClient({ account, chain: arc, transport: http(RPC) });

// The registry is fail-closed. Check before building a certificate, so that a lagging registry
// is reported as the operational problem it is and not discovered as a revert.
const behind = await pub.readContract({
  address: V2_EPOCH_REGISTRY,
  abi: [
    {
      type: "function",
      name: "periodsBehind",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint64" }],
    },
  ],
  functionName: "periodsBehind",
});
console.log(`\nqualifier       ${V2_QUALIFIER}`);
console.log(`signer          ${account.address}`);
console.log(`periods behind  ${behind}`);
if (behind !== 0n) {
  die(
    `the epoch registry is ${behind} period(s) behind: every qualification will be refused.\n  Operational, not a bad proof. Run scripts/concordium/update-committee.mjs.`,
  );
}

const ccd = new ConcordiumGRPCNodeClient(
  process.env.CCD_GRPC_HOST ?? "grpc.testnet.concordium.com",
  Number(process.env.CCD_GRPC_PORT ?? 20000),
  credentials.createSsl(),
);
const base = { address: V2_QUALIFIER, abi: QUALIFIER_ABI };
const secret = /^(0x)?[0-9a-fA-F]{64,}$/.test(SECRET)
  ? Buffer.from(SECRET.replace(/^0x/, ""), "hex")
  : Buffer.from(SECRET, "utf8");

try {
  const result = await qualify(
    { subject, bidder, tenderId: BigInt(tender), synthetic: true },
    {
      fetchProof: () => fetchFinalityProof(ccd),
      nullifierSecret: secret,
      qualifier: V2_QUALIFIER,
      read: (c) => pub.readContract({ ...base, ...c }),
      simulate: (args) =>
        pub.simulateContract({
          ...base,
          functionName: "recordQualification",
          args,
          account,
        }),
      send: async (args) => {
        const hash = await wallet.writeContract({
          ...base,
          functionName: "recordQualification",
          args,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") die(`the transaction reverted: ${hash}`);
        return hash;
      },
      dryRun: flag("dry-run"),
      log: (m) => console.log(`  ${m}`),
    },
  );
  console.log(
    `\n${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`,
  );
  console.log(
    "SYNTHETIC: this proves the plumbing and the on-chain certificate check, not anyone's identity.\n",
  );
  // A refusal is an outcome with its own exit code, not a crash.
  const codes = {
    recorded: 0,
    "already-qualified": 0,
    "nullifier-used": 2,
    "registry-behind": 3,
    "below-quorum": 4,
  };
  process.exit(codes[result.status] ?? 1);
} catch (e) {
  if (e instanceof DryRun) {
    console.log("\n  --dry-run: simulation passed against the live chain; nothing sent.\n");
    process.exit(0);
  }
  throw e;
}
