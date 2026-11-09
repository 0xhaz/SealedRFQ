#!/usr/bin/env node
/**
 * Registers the SealedRFQ evaluator in the Concordium CIS-8004 agent registry.
 *
 * Three transactions, in an order the contracts enforce rather than one we chose:
 *
 *   1. CIS-8 `registerExternalKey` binds the Arc evaluator's secp256k1 key to the Concordium
 *      account, proved by an `ethereum-personal-sign` signature over the CIS-8 canonical message.
 *      This has to come first: CIS-8004 rejects an `external_reference` whose key is not already
 *      an active CIS-8 entry owned by the sender, with InvalidExternalReference.
 *   2. CIS-8004 `register` mints the agent token and points it at the card URL. The agent id only
 *      exists after this lands, and the card has to name it, so the hash cannot be committed here.
 *   3. CIS-8004 `setAgentURI` anchors SHA-256 of the finished card.
 *
 * Step 3 is why the registration record is written to disk between steps: the web app rebuilds the
 * card from that record with the same function this script hashes, so the bytes a stranger fetches
 * are the bytes that were hashed. Deploy the site after this script finishes, or the URL will
 * serve a 404 while the chain claims a hash.
 *
 * Every update is dry-run first and the script stops on a rejection rather than spending the fee
 * to discover the same thing on chain.
 *
 * Usage:
 *   CCD_WALLET=/path/to/wallet-export.json \
 *   ARC_EVALUATOR_PRIVATE_KEY=0x... \
 *   SITE_ORIGIN=https://www.sealedrfq.com \
 *   node scripts/concordium/register-agent.mjs [--network testnet] [--dry-run]
 *
 * The Arc key is read from the environment and never logged. Pass `--dry-run` to do everything
 * except send, which is worth doing once before spending anything.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as SDK from "@concordium/web-sdk";
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  KEY_REGISTRY,
  PROOF_SCHEMES,
  agentIdFromTokenId,
  canonicalMessage,
  cardBytes,
  cardHash,
  cardHashHex,
  describeReject,
  ethereumPersonalSignPayload,
} from "@sealedrfq/concordium";
import {
  cis8ReceiveName,
  keyRegistryAddress,
  ownerOfKeyParameter,
  parseCis8View,
  parseOwnerOfKey,
  registerExternalKeyParameter,
} from "@sealedrfq/concordium/cis8";
import {
  receiveName,
  registerParameter,
  registryAddress,
  setAgentUriParameter,
} from "@sealedrfq/concordium/cis8004";

const NODES = {
  testnet: "grpc.testnet.concordium.com",
  mainnet: "grpc.mainnet.concordium.software",
};
const EXPLORER = { testnet: "https://testnet.ccdexplorer.io", mainnet: "https://ccdexplorer.io" };
const NAMESPACE = "sealedrfq";
const KEY_TYPE = "secp256k1-compressed";
const RECORD = resolve(import.meta.dirname, "../../apps/web/lib/v2/agentRegistration.json");

const args = process.argv.slice(2);
const network = args.includes("--network") ? args[args.indexOf("--network") + 1] : "testnet";
const dryRun = args.includes("--dry-run");
if (!NODES[network]) die(`unknown network ${network}`);

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function need(name) {
  const v = process.env[name];
  if (!v) die(`${name} is not set. See the comment at the top of this script.`);
  return v;
}

const origin = need("SITE_ORIGIN").replace(/\/+$/, "");
const walletPath = need("CCD_WALLET");
// Read the Arc key, derive what we need from it, and keep it out of every log line and every
// object that might be printed.
const evaluatorPublicKey = (() => {
  const raw = need("ARC_EVALUATOR_PRIVATE_KEY").replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) die("ARC_EVALUATOR_PRIVATE_KEY must be 32 bytes of hex");
  return secp256k1.getPublicKey(Buffer.from(raw, "hex"), true);
})();

function signWithEvaluatorKey(digest) {
  const raw = process.env.ARC_EVALUATOR_PRIVATE_KEY.replace(/^0x/, "");
  const sig = secp256k1.sign(digest, Buffer.from(raw, "hex"), { prehash: false });
  return Buffer.concat([Buffer.from(sig.toBytes("compact")), Buffer.from([sig.recovery])]);
}

const wallet = (() => {
  let text;
  try {
    text = readFileSync(walletPath, "utf8");
  } catch (e) {
    die(
      `cannot read CCD_WALLET at ${walletPath}: ${e.code === "ENOENT" ? "no such file" : e.message}`,
    );
  }
  try {
    return SDK.parseWallet(text);
  } catch (e) {
    die(
      `${walletPath} is not a Concordium wallet export: ${e.message}\n  Export it from the Concordium wallet as a key file, not as a seed phrase.`,
    );
  }
})();
const sender = SDK.AccountAddress.fromBase58(wallet.value.address);
const signer = SDK.buildAccountSigner(wallet);
const client = new ConcordiumGRPCNodeClient(NODES[network], 20000, credentials.createSsl());
const REGISTRY = registryAddress(network);
const KEYS = keyRegistryAddress(network);

console.log(`\nnetwork         ${network}`);
console.log(`sender          ${SDK.AccountAddress.toBase58(sender)}`);
console.log(`agent registry  ${REGISTRY.index}.${REGISTRY.subindex}`);
console.log(`key registry    ${KEYS.index}.${KEYS.subindex}`);
console.log(`card origin     ${origin}`);
console.log(`evaluator key   ${Buffer.from(evaluatorPublicKey).toString("hex")}`);
if (dryRun) console.log("\n  --dry-run: nothing will be sent.\n");

const balance = await client.getAccountInfo(sender).catch(() => null);
if (!balance) {
  die(
    `${SDK.AccountAddress.toBase58(sender)} does not exist on ${network}.\n  Create it in the Concordium wallet and fund it from the testnet faucet first.`,
  );
}
console.log(`balance         ${balance.accountAmount.microCcdAmount} microCCD`);
if (balance.accountAmount.microCcdAmount < 1_000_000n) {
  die("Less than 1 CCD. Top the account up from the faucet before registering.");
}

function reject(result) {
  if (result.tag !== "failure") return undefined;
  const code = result.reason?.rejectReason;
  return typeof code === "number"
    ? `${describeReject(code)} (${code})`
    : JSON.stringify(result.reason);
}

/**
 * Dry-run, stop on a rejection, then send and wait. Returns the finalised summary.
 *
 * `expectedDryRunFailure` names the one rejection that is not a problem: during `--dry-run` the
 * key binding has not been sent, so CIS-8004 cannot yet see the CIS-8 entry and `register` must
 * fail. Dying there would report an inherent consequence of not sending anything as a fault.
 */
async function submit(label, { contract, method, parameter, energy, expectedDryRunFailure }) {
  const dry = await client.invokeContract({ invoker: sender, contract, method, parameter });
  const refusal = reject(dry);
  if (refusal && dryRun && expectedDryRunFailure && refusal.startsWith(expectedDryRunFailure)) {
    console.log(`\n${label}`);
    console.log(`  ${refusal}, as expected: the key binding above was not sent`);
    return null;
  }
  if (refusal) die(`${label} would be rejected: ${refusal}`);
  const used = dry.usedEnergy.value;
  // Headroom over the dry run, because the real call runs against a later block.
  const maxEnergy = energy ?? used + used / 4n + 500n;
  console.log(`\n${label}`);
  console.log(`  dry run ok, ${used} energy; sending with a ${maxEnergy} limit`);
  if (dryRun) return null;
  const hash = await client.sendUpdateTransaction(
    {
      amount: SDK.CcdAmount.zero(),
      address: contract,
      receiveName: method,
      maxContractExecutionEnergy: SDK.Energy.create(maxEnergy),
    },
    parameter,
    sender,
    signer,
  );
  console.log(`  ${SDK.TransactionHash.toHexString(hash)}`);
  const summary = await client.waitForTransactionFinalization(hash);
  if (summary.summary.transactionType === "failed") {
    die(`${label} failed on chain: ${JSON.stringify(summary.summary.rejectReason)}`);
  }
  console.log(
    `  finalised: ${EXPLORER[network]}/${network}/transaction/${SDK.TransactionHash.toHexString(hash)}`,
  );
  return { hash: SDK.TransactionHash.toHexString(hash), summary, dryReturnValue };
}

// ---- 1. Bind the Arc evaluator key in CIS-8 -------------------------------------------------

const view = await client.invokeContract({ contract: KEYS, method: cis8ReceiveName("view") });
if (view.tag !== "success") die("could not read the CIS-8 registry");
const genesisHash = Buffer.from(parseCis8View(view.returnValue).genesisHash, "hex");
console.log(`cis-8 genesis   ${genesisHash.toString("hex")}`);

const externalKey = { namespace: NAMESPACE, keyType: KEY_TYPE, publicKey: evaluatorPublicKey };

const existingOwner = await client.invokeContract({
  contract: KEYS,
  method: cis8ReceiveName("ownerOfKey"),
  parameter: ownerOfKeyParameter(externalKey),
});
const alreadyBound =
  existingOwner.tag === "success" && existingOwner.returnValue
    ? parseOwnerOfKey(existingOwner.returnValue)
    : undefined;

let keyBindingTx;
if (alreadyBound?.status === "Active") {
  if (alreadyBound.owner !== SDK.AccountAddress.toBase58(sender)) {
    die(
      `The evaluator key is already bound to ${alreadyBound.owner}, not to this sender.\n  Either send from that account or revoke the binding first.`,
    );
  }
  console.log("\nCIS-8 key binding\n  already active for this sender; skipping");
} else {
  const message = canonicalMessage({
    concordiumAccount: SDK.AccountAddress.toBuffer(sender),
    contract: KEY_REGISTRY[network],
    genesisHash,
    externalKey,
    proofScheme: PROOF_SCHEMES.ethereumPersonalSign,
  });
  const signature = signWithEvaluatorKey(keccak_256(ethereumPersonalSignPayload(message)));
  const sent = await submit("CIS-8 registerExternalKey", {
    contract: KEYS,
    method: cis8ReceiveName("registerExternalKey"),
    parameter: registerExternalKeyParameter({
      externalKey,
      proofScheme: PROOF_SCHEMES.ethereumPersonalSign,
      signature,
      metadata: [
        { key: "role", value: "arc-evaluator" },
        { key: "chain", value: "arc" },
      ],
    }),
  });
  keyBindingTx = sent?.hash;
}

// ---- 2. Register the agent ------------------------------------------------------------------

const cardUrl = `${origin}/.well-known/agent-card.json`;
const registerMetadata = [
  { key: "role", value: Buffer.from("evaluator", "utf8") },
  { key: "settlementChain", value: Buffer.from("arc", "utf8") },
];

if (dryRun) {
  // The external reference cannot validate until the binding is on chain, so check everything
  // else about the parameter now: the URI, the metadata entries and the energy cost.
  await submit("CIS-8004 register, without the external reference", {
    contract: REGISTRY,
    method: receiveName("register"),
    parameter: registerParameter({ agentUri: cardUrl, initialMetadata: registerMetadata }),
  });
}

const registered = await submit("CIS-8004 register", {
  contract: REGISTRY,
  method: receiveName("register"),
  parameter: registerParameter({
    agentUri: cardUrl,
    // Deliberately absent: the card names the agent id, and the id does not exist until this
    // transaction lands. Anchored in step 3 rather than left as None forever.
    externalReference: { keyRegistry: KEY_REGISTRY[network], ...externalKey },
    initialMetadata: registerMetadata,
  }),
  expectedDryRunFailure: "InvalidExternalReference",
});

if (dryRun) {
  console.log(
    "\n  --dry-run complete. The key binding and the register parameter are both accepted;" +
      "\n  the external reference can only be checked once the binding is on chain.\n",
  );
  process.exit(0);
}

/**
 * Which agent id we got.
 *
 * Not read from the transaction summary: an update summary carries trace events, not a return
 * value, so the id is not there. The dry run that preceded the send does return it, and `agentOf`
 * then confirms the registration actually landed as ours. If someone else registered in the same
 * window the id shifts, so a short forward scan covers that rather than trusting the prediction.
 */
const agentId = await (async () => {
  const predicted = registered.dryReturnValue
    ? agentIdFromTokenId(
        SDK.ReturnValue.parseWithSchemaTypeBase64(registered.dryReturnValue, "HQA="),
      )
    : 0n;
  const mine = SDK.AccountAddress.toBase58(sender);
  for (let id = predicted; id < predicted + 16n; id++) {
    const result = await client.invokeContract({
      contract: REGISTRY,
      method: receiveName("agentOf"),
      parameter: agentOfParameter(id),
    });
    if (result.tag !== "success" || !result.returnValue) continue;
    const agent = parseAgentOf(result.returnValue);
    if (agent?.owner === mine && agent.agentUri === cardUrl) {
      console.log(
        id === predicted
          ? `  agent id ${id}`
          : `  agent id ${id} (the dry run predicted ${predicted})`,
      );
      return id;
    }
  }
  return die(
    `register finalised in ${registered.hash} but no agent near id ${predicted} is owned by\n  ${mine} with the card URL. Find the id on the explorer and anchor the hash by hand with\n  setAgentURI; the registration itself is fine.`,
  );
})();

// ---- 3. Anchor the card hash ----------------------------------------------------------------

const record = {
  network,
  origin,
  agentId: Number(agentId),
  owner: SDK.AccountAddress.toBase58(sender),
  keyBinding: { keyRegistry: KEY_REGISTRY[network], namespace: NAMESPACE },
};
const hash = cardHash(record);
console.log(`\ncard            ${cardBytes(record).length} bytes, sha256 ${cardHashHex(record)}`);

const anchored = await submit("CIS-8004 setAgentURI", {
  contract: REGISTRY,
  method: receiveName("setAgentURI"),
  parameter: setAgentUriParameter({ agentId, agentUri: cardUrl, metadataHash: hash }),
});

writeFileSync(
  RECORD,
  `${JSON.stringify(
    {
      ...record,
      keyBinding: {
        keyRegistry: {
          index: Number(KEY_REGISTRY[network].index),
          subindex: Number(KEY_REGISTRY[network].subindex),
        },
        namespace: NAMESPACE,
      },
      cardHash: cardHashHex(record),
      transactions: {
        keyBinding: keyBindingTx,
        register: registered.hash,
        anchorHash: anchored.hash,
      },
      registeredAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`\nwrote ${RECORD}`);
console.log(
  `\nagent    ${EXPLORER[network]}/${network}/account/${SDK.AccountAddress.toBase58(sender)}`,
);
console.log(
  `registry ${EXPLORER[network]}/${network}/instance/${REGISTRY.index}/${REGISTRY.subindex}`,
);
console.log(
  "\nNext: deploy the site so the card URL resolves, then run verify-agent.mjs, which checks the\n" +
    "served bytes against the hash on chain the way any third party would.\n",
);
