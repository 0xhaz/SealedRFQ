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
 * Usage, with the key read straight out of the env file rather than pasted:
 *
 *   node scripts/concordium/register-agent.mjs --dry-run
 *
 * It reads `.env.<network>` at the repo root by itself, so nothing needs pasting onto the command
 * line where it would land in shell history. Anything already set in the environment wins over the
 * file, and `--env-file <path>` points it elsewhere.
 *
 * The sending account comes either from `CCD_WALLET`, the `<address>.export` file the browser
 * extension writes, or from `CCD_ACCOUNT` and `CCD_ACCOUNT_SIGN_KEY`, the address and the private
 * key shown on that same screen.
 *
 * `CCD_EVALUATOR_PK` is a key of its own, not a reused role key. A CIS-8 binding can be taken
 * over by whoever holds the private key — the specification lets one account replace another as
 * the active owner — so binding a key that has leaked would let a stranger claim the agent's key
 * at any moment. For the badge to attest to anything, that same key has to hold EVALUATOR_ROLE on
 * the Arc deployment this registration claims to speak for.
 *
 * The key is read from the environment, never logged, and never signed with except against the
 * Concordium account in CCD_WALLET. A proof naming some other account is precisely what someone
 * would need to bind our key to theirs, so it is not produced even in a dry run.
 *
 * Pass `--dry-run` to do everything except send, which is worth doing once before spending.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  agentOfParameter,
  parseAgentOf,
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

/** Whatever a previous run recorded, so a resumed run adds to it rather than replacing it. */
function previousRecord() {
  try {
    const parsed = JSON.parse(readFileSync(RECORD, "utf8"));
    return parsed.placeholder ? {} : parsed;
  } catch {
    return {};
  }
}

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
  if (!v) {
    die(
      `${name} is not set, and ${envFileLoaded ?? ENV_FILE} ${envFileLoaded ? "does not set it" : "does not exist"}.\n  See the comment at the top of this script for what each variable is.`,
    );
  }
  return v;
}

/**
 * A wallet export dropped in the repo root, so `CCD_WALLET` does not have to name a path at all.
 *
 * The wallet calls the file `<address>.export`. One is taken; several is ambiguous and worth
 * stopping on, because silently picking the alphabetically-first account is how you register the
 * wrong one. `.gitignore` and `.dockerignore` both exclude `*.export`, which is checked by test.
 */
function findWalletExport() {
  let found;
  try {
    found = readdirSync(ROOT).filter((f) => f.endsWith(".export"));
  } catch {
    return undefined;
  }
  if (found.length === 0) return undefined;
  if (found.length > 1) {
    die(
      `${found.length} wallet exports in the repo root: ${found.join(", ")}.\n  Set CCD_WALLET to the one to send from, so the choice is yours rather than alphabetical.`,
    );
  }
  const path = resolve(ROOT, found[0]);
  console.log(`wallet          ${found[0]} (found in the repo root)`);
  return path;
}

/** The variables this script reads. Used to keep the env report to what is relevant. */
const OURS = new Set([
  "CCD_EVALUATOR_PK",
  "CCD_WALLET",
  "CCD_ACCOUNT",
  "CCD_ACCOUNT_SIGN_KEY",
  "SITE_ORIGIN",
]);

/**
 * Load `.env.<network>` so nothing has to be pasted onto the command line, where it lands in shell
 * history. Anything already in the environment wins, so an explicit value on the command line is
 * never silently overridden by a stale file.
 *
 * Deliberately not `process.loadEnvFile`: that overwrites, which gets the precedence backwards,
 * and it throws when the file is absent rather than carrying on with whatever is already set.
 */
function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const loaded = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // An empty placeholder is not a value. Skipping it keeps `CCD_WALLET=` from counting as set
    // and keeps the report honest about what the file actually supplied.
    if (value === "") continue;
    process.env[key] = value;
    loaded.push(key);
  }
  // Only the variables this script reads, and only their names. The file holds unrelated role
  // keys whose names are nobody's business here, and the values are what must never reach a log.
  const mine = loaded.filter((k) => OURS.has(k));
  console.log(
    `env             ${path}${mine.length ? `: ${mine.join(", ")}` : " (nothing we need)"}`,
  );
  return path;
}

const ROOT = resolve(import.meta.dirname, "../..");
const ENV_FILE = resolve(
  ROOT,
  args.includes("--env-file") ? args[args.indexOf("--env-file") + 1] : `.env.${network}`,
);
const envFileLoaded = loadEnvFile(ENV_FILE);

const origin = need("SITE_ORIGIN").replace(/\/+$/, "");
// Read the Arc key, derive what we need from it, and keep it out of every log line and every
// object that might be printed.
const evaluatorPublicKey = (() => {
  const raw = need("CCD_EVALUATOR_PK").replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) die("CCD_EVALUATOR_PK must be 32 bytes of hex");
  return secp256k1.getPublicKey(Buffer.from(raw, "hex"), true);
})();

function signWithEvaluatorKey(digest) {
  const raw = process.env.CCD_EVALUATOR_PK.replace(/^0x/, "");
  const sig = secp256k1.sign(digest, Buffer.from(raw, "hex"), { prehash: false });
  return Buffer.concat([Buffer.from(sig.toBytes("compact")), Buffer.from([sig.recovery])]);
}

/**
 * Two ways in, because which one is available depends on the wallet.
 *
 * The browser extension writes a `<address>.export` key file, which is the `CCD_WALLET` path and
 * the one to prefer. The same screen also shows the raw private key, and the mobile wallet only
 * offers that, so an address plus the signing key works too — and it is the way through if the
 * export file turns out to be passphrase-wrapped.
 *
 * The single-key path assumes one credential with one keypair and a threshold of one, which is
 * what a wallet-created account is. An account with a higher threshold needs the key file.
 */
const { sender, signer } = (() => {
  const walletPath = process.env.CCD_WALLET || findWalletExport();
  const address = process.env.CCD_ACCOUNT;
  const signKey = process.env.CCD_ACCOUNT_SIGN_KEY?.replace(/^0x/, "");

  if (walletPath) {
    let text;
    try {
      text = readFileSync(walletPath, "utf8");
    } catch (e) {
      die(
        `cannot read CCD_WALLET at ${walletPath}: ${e.code === "ENOENT" ? "no such file" : e.message}`,
      );
    }
    let wallet;
    try {
      wallet = SDK.parseWallet(text);
    } catch (e) {
      die(
        `${walletPath} is not a Concordium wallet key export: ${e.message}\n  If your wallet cannot write one, set CCD_ACCOUNT and CCD_ACCOUNT_SIGN_KEY instead.`,
      );
    }
    return {
      sender: SDK.AccountAddress.fromBase58(wallet.value.address),
      signer: SDK.buildAccountSigner(wallet),
    };
  }

  if (!address || !signKey) {
    die(
      "No account to send from. Either drop the wallet's <address>.export file in the repo root\n" +
        "  (or set CCD_WALLET to it), or set both CCD_ACCOUNT, the base58 address, and\n" +
        "  CCD_ACCOUNT_SIGN_KEY, the account private key as 32 bytes of hex.",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(signKey)) {
    die(
      "CCD_ACCOUNT_SIGN_KEY must be 32 bytes of hex: the account private key, not a seed phrase.",
    );
  }
  let parsed;
  try {
    parsed = SDK.AccountAddress.fromBase58(address);
  } catch {
    return die(`CCD_ACCOUNT is not a Concordium address: ${address}`);
  }
  return { sender: parsed, signer: SDK.buildAccountSigner(signKey) };
})();

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

/** A reject reason as readable text. Never JSON.stringify: these objects carry bigints and throw. */
function describeReason(reason) {
  if (!reason) return "no reason given";
  const code = reason.rejectReason;
  if (typeof code === "number") return `${describeReject(code)} (${code})`;
  return String(reason.tag ?? "rejected");
}

function reject(result) {
  return result.tag === "failure" ? describeReason(result.reason) : undefined;
}

/** Dry-run, stop on a rejection, then send and wait. Returns the finalised summary. */
async function submit(label, { contract, method, parameter, energy }) {
  const dry = await client.invokeContract({ invoker: sender, contract, method, parameter });
  const refusal = reject(dry);
  if (refusal) die(`${label} would be rejected: ${refusal}`);

  const dryReturnValue = dry.returnValue;
  const used = dry.usedEnergy.value;
  // Headroom over the dry run, because the real call runs against a later block.
  const maxEnergy = energy ?? used + used / 4n + 500n;
  console.log(`\n${label}`);
  console.log(`  dry run ok, ${used} energy; sending with a ${maxEnergy} limit`);

  // Built and signed even on a dry run. Only the send is skipped, so a mistake in the header, the
  // payload or the signer surfaces here instead of after the first transaction has already landed.
  const nonce = await client.getNextAccountNonce(sender);
  const transaction = {
    type: SDK.AccountTransactionType.Update,
    header: { sender, nonce: nonce.nonce, expiry: SDK.TransactionExpiry.futureMinutes(10) },
    payload: {
      amount: SDK.CcdAmount.zero(),
      address: contract,
      receiveName: method,
      message: parameter,
      maxContractExecutionEnergy: SDK.Energy.create(maxEnergy),
    },
  };
  const signature = await SDK.signTransaction(transaction, signer);
  if (dryRun) {
    const credentials = Object.keys(signature).length;
    console.log(`  built and signed with ${credentials} credential(s); not sending`);
    return null;
  }

  const hash = await client.sendAccountTransaction(transaction, signature);
  console.log(`  ${SDK.TransactionHash.toHexString(hash)}`);
  const summary = await client.waitForTransactionFinalization(hash);
  // The SDK's own predicate rather than a string compare, and its reason decoder rather than
  // JSON: a reject reason carries bigints, so stringifying one throws at exactly the moment the
  // message is needed and turns a plain on-chain refusal into a crash.
  if (SDK.isRejectTransaction(summary.summary)) {
    die(
      `${label} was rejected on chain: ${describeReason(
        SDK.getTransactionRejectReason(summary.summary),
      )}\n  ${EXPLORER[network]}/${network}/transaction/${SDK.TransactionHash.toHexString(hash)}`,
    );
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

/**
 * Can this registry accept a reference to our CIS-8 entry at all?
 *
 * On testnet it cannot. The instance at 13042 is configured with cis8_contract = 10081, which is
 * the MAINNET CIS-8 address; on testnet that index holds an unrelated contract, so every
 * external_reference is refused with InvalidExternalReference no matter how correct it is. The
 * registry's own reference agent has none either, which fits.
 *
 * So the reference is attempted and dropped if refused, rather than taken as fatal — but only
 * once the binding has been confirmed Active and ours. Dropping it on an unverified binding would
 * turn a real problem with our key into a silent downgrade.
 */
const externalReference = await (async () => {
  const confirmed = await client.invokeContract({
    contract: KEYS,
    method: cis8ReceiveName("ownerOfKey"),
    parameter: ownerOfKeyParameter(externalKey),
  });
  const binding =
    confirmed.tag === "success" && confirmed.returnValue
      ? parseOwnerOfKey(confirmed.returnValue)
      : undefined;
  if (binding?.status !== "Active" || binding.owner !== SDK.AccountAddress.toBase58(sender)) {
    die(
      `The CIS-8 binding is not an active entry owned by this sender, so the agent cannot\n  reference it: ${binding ? `status ${binding.status}, owner ${binding.owner}` : "no entry"}`,
    );
  }

  const reference = { keyRegistry: KEY_REGISTRY[network], ...externalKey };
  const probe = await client.invokeContract({
    invoker: sender,
    contract: REGISTRY,
    method: receiveName("register"),
    parameter: registerParameter({ agentUri: cardUrl, externalReference: reference }),
  });
  if (probe.tag !== "failure") return reference;

  const reason = reject(probe);
  if (!reason.startsWith("InvalidExternalReference")) {
    die(`CIS-8004 register would be rejected: ${reason}`);
  }
  console.log(
    `\nCIS-8004 external reference\n  refused: ${reason}. This registry cannot resolve our CIS-8 entry — on testnet it is\n  configured against the mainnet CIS-8 address, so no reference is acceptable to it.\n  Registering without one. The binding is still on chain and the agent card states it,\n  so it stays checkable through CIS-8 directly.`,
  );
  return undefined;
})();

/**
 * Find an agent this sender already registered for this card URL.
 *
 * The three steps are separate transactions, so the script has to be safe to re-run: the first
 * attempt bound the key and registered the agent, then fell over before anchoring the hash. Without
 * this it would mint a second agent on every retry and leave the first orphaned.
 */
async function findExistingAgent(limit = 64n) {
  const mine = SDK.AccountAddress.toBase58(sender);
  for (let id = 0n; id < limit; id++) {
    const result = await client.invokeContract({
      contract: REGISTRY,
      method: receiveName("agentOf"),
      parameter: agentOfParameter(id),
    });
    if (result.tag !== "success" || !result.returnValue) continue;
    const agent = parseAgentOf(result.returnValue);
    // Revoked agents are skipped: a revoked registration is not one to resume into.
    if (agent?.owner === mine && agent.agentUri === cardUrl && agent.status === "Active") {
      return agent;
    }
  }
  return undefined;
}

const existing = await findExistingAgent();
let registerTx;

const agentId = await (async () => {
  if (existing) {
    console.log("\nCIS-8004 register");
    console.log(`  agent ${existing.agentId} is already registered for this card URL; skipping`);
    if (existing.metadataHash) {
      console.log(`  its card hash is already anchored: ${existing.metadataHash}`);
    }
    return existing.agentId;
  }

  const registered = await submit("CIS-8004 register", {
    contract: REGISTRY,
    method: receiveName("register"),
    parameter: registerParameter({
      agentUri: cardUrl,
      externalReference,
      initialMetadata: registerMetadata,
    }),
  });

  // Not read from the transaction summary: an update summary carries trace events, not a return
  // value, so the id is not there. The dry run that preceded the send does return it, and
  // `agentOf` then confirms the registration landed as ours rather than taking it on faith.
  registerTx = registered.hash;
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
        id === predicted ? `  agent id ${id}` : `  agent id ${id} (dry run predicted ${predicted})`,
      );
      return id;
    }
  }
  return die(
    `register finalised in ${registered.hash} but no agent near id ${predicted} is owned by\n  ${mine} with the card URL. Find the id on the explorer and anchor the hash by hand with\n  setAgentURI; the registration itself is fine.`,
  );
})();

// ---- 3. Anchor the card hash ----------------------------------------------------------------

const previous = previousRecord();
const record = {
  network,
  origin,
  agentId: Number(agentId),
  owner: SDK.AccountAddress.toBase58(sender),
  keyBinding: {
    keyRegistry: KEY_REGISTRY[network],
    namespace: NAMESPACE,
    keyType: KEY_TYPE,
    publicKey: Buffer.from(evaluatorPublicKey).toString("hex"),
  },
};
const hash = cardHash(record);
console.log(`\ncard            ${cardBytes(record).length} bytes, sha256 ${cardHashHex(record)}`);

/**
 * Anchor the hash, unless it is already the hash on chain.
 *
 * Re-anchoring the same value costs a fee to change nothing, and it replaces the transaction in
 * the record with a later one that is less informative than the original. The first run found the
 * agent already registered, said its hash was already anchored, and anchored it again regardless;
 * noticing the agent was not enough, the value had to be compared.
 */
const anchored = await (async () => {
  if (existing?.metadataHash === cardHashHex(record) && existing.agentUri === cardUrl) {
    console.log("\nCIS-8004 setAgentURI");
    console.log("  the card hash on chain already matches; nothing to anchor");
    return { hash: previous.transactions?.anchorHash };
  }
  return submit("CIS-8004 setAgentURI", {
    contract: REGISTRY,
    method: receiveName("setAgentURI"),
    parameter: setAgentUriParameter({ agentId, agentUri: cardUrl, metadataHash: hash }),
  });
})();

if (dryRun) {
  console.log(
    `\n  --dry-run complete. Nothing was sent.${
      externalReference ? "" : "\n  The agent carries no external reference."
    }`,
  );
  process.exit(0);
}

writeFileSync(
  RECORD,
  `${JSON.stringify(
    {
      ...record,
      // bigint indexes do not survive JSON, so they are written as numbers and read back as such.
      keyBinding: {
        keyRegistry: {
          index: Number(KEY_REGISTRY[network].index),
          subindex: Number(KEY_REGISTRY[network].subindex),
        },
        namespace: NAMESPACE,
        keyType: KEY_TYPE,
        publicKey: Buffer.from(evaluatorPublicKey).toString("hex"),
      },
      /** False on testnet: the registry there cannot resolve a CIS-8 entry. See the probe above. */
      referencedFromRegistry: externalReference !== undefined,
      cardHash: cardHashHex(record),
      // A resumed run skips steps it already did, and knows no hash for them. JSON.stringify drops
      // an undefined value silently, so merging with whatever the last run recorded is what keeps
      // the evidence trail whole across a retry instead of quietly shortening it.
      transactions: {
        ...previous.transactions,
        ...(keyBindingTx ? { keyBinding: keyBindingTx } : {}),
        ...(registerTx ? { register: registerTx } : {}),
        ...(anchored?.hash ? { anchorHash: anchored.hash } : {}),
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
