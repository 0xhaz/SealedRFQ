#!/usr/bin/env node
/**
 * Exit path for the retired V1 RFQRegistry: settle every deposit still held on a closed RFQ, then
 * withdraw whatever is credited.
 *
 * The application no longer has a UI for V1, so this is the convenience route to the same two
 * permissionless calls on the immutable contract. It exists so the exit is demonstrable, not just
 * asserted, and so anyone can run it in one command.
 *
 * Usage:
 *   node scripts/v1/settle-and-withdraw.mjs --dry-run [--chain 5042002|5042]
 *   PRIVATE_KEY=0x... node scripts/v1/settle-and-withdraw.mjs [--chain ...]
 *
 * --dry-run is read-only and never needs a key. Without it, PRIVATE_KEY pays gas for every
 * settleDeposit (anyone may call it) but can only withdraw() its own credit: withdraw pays
 * msg.sender, so other beneficiaries must run this with their own key.
 */
import { readFileSync } from "node:fs";
import { RFQRegistryAbi, chainById } from "@sealedrfq/shared";
import { http, createPublicClient, createWalletClient, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const chainIdArg = args.indexOf("--chain");
const chainId = chainIdArg >= 0 ? Number(args[chainIdArg + 1]) : 5042002;
const fromArg = args.indexOf("--from-block");

// Mirrors IRFQRegistry.Status / DepositState; the ABI only carries the uint8.
const STATUS = ["None", "Open", "Awarded", "NoAward", "Cancelled"];
const DEPOSIT = ["None", "Held", "Refunded", "RolledOver", "Forfeited"];
const SETTLEABLE = new Set(["Awarded", "NoAward"]);
const usdc = (n) => formatUnits(n, 6);

const deployment = JSON.parse(
  readFileSync(new URL(`../../contracts/deployments/${chainId}.json`, import.meta.url), "utf8"),
);
const registry = deployment.RFQRegistry;
const chain = chainById(chainId);
// The public Arc RPC rate-limits aggressively; generous backoff beats failing a read-only report.
const transport = http(undefined, { retryCount: 8, retryDelay: 1_000 });
const publicClient = createPublicClient({ chain, transport });
const read = (functionName, args) =>
  publicClient.readContract({ address: registry, abi: RFQRegistryAbi, functionName, args });

// There is no bidder enumeration function, so bidders come from the two bid events. Sealed bids
// emit BidCommitted, open bids BidPlaced; Credited names beneficiaries. The RPC caps eth_getLogs at
// ~9,000 blocks and rate-limits, so one pass fetches all three events per page, paced, and a
// refused page is retried rather than aborting the report. --from-block skips empty history.
const EVENTS = ["BidCommitted", "BidPlaced", "Credited"].map((name) =>
  RFQRegistryAbi.find((x) => x.type === "event" && x.name === name),
);
async function scan(fromBlock, toBlock) {
  const out = [];
  const step = 9_000n;
  for (let from = fromBlock; from <= toBlock; from += step) {
    const to = from + step - 1n < toBlock ? from + step - 1n : toBlock;
    for (let attempt = 1; ; attempt++) {
      try {
        out.push(
          ...(await publicClient.getLogs({
            address: registry,
            events: EVENTS,
            fromBlock: from,
            toBlock: to,
          })),
        );
        break;
      } catch (err) {
        if (attempt === 6) throw err;
        await sleep(1_000 * attempt);
      }
    }
    await sleep(100);
  }
  return out;
}

const head = await publicClient.getBlockNumber();
const start = fromArg >= 0 ? BigInt(args[fromArg + 1]) : BigInt(deployment.startBlock);
const rfqCount = await read("rfqCount");
console.log(`V1 RFQRegistry ${registry} on chain ${chainId}`);
console.log(
  `rfqCount=${rfqCount} totalHeld=${usdc(await read("totalHeld"))} totalWithdrawable=${usdc(await read("totalWithdrawable"))}`,
);

const bidders = new Map(); // rfqId -> Set<address>
const credited = new Set();
for (const l of await scan(start, head)) {
  if (l.eventName === "Credited") {
    credited.add(l.args.beneficiary);
    continue;
  }
  if (!bidders.has(l.args.rfqId)) bidders.set(l.args.rfqId, new Set());
  bidders.get(l.args.rfqId).add(l.args.bidder);
}

const settlements = [];
const holders = new Set();
for (let rfqId = 1n; rfqId <= rfqCount; rfqId++) {
  const rfq = await read("getRFQ", [rfqId]);
  const status = STATUS[rfq.status];
  holders.add(rfq.buyer);
  if (rfq.winner !== "0x0000000000000000000000000000000000000000") holders.add(rfq.winner);
  for (const bidder of bidders.get(rfqId) ?? []) {
    holders.add(bidder);
    const bid = await read("getBid", [rfqId, bidder]);
    const deposit = DEPOSIT[bid.deposit];
    const act = deposit === "Held" && SETTLEABLE.has(status);
    console.log(
      `rfq ${rfqId} ${status} bidder ${bidder} deposit=${deposit}${
        deposit === "Held" && !act ? " (RFQ not yet closed; settleDeposit would revert)" : ""
      }`,
    );
    if (act) settlements.push({ rfqId, bidder });
  }
}

// Credit that already exists, plus every address a settlement could credit.
for (const who of credited) holders.add(who);
const credits = [];
for (const who of holders) {
  const amount = await read("withdrawable", [who]);
  if (amount > 0n) credits.push({ who, amount });
}

console.log(`\nWould send ${settlements.length} settleDeposit call(s):`);
for (const s of settlements) console.log(`  settleDeposit(${s.rfqId}, ${s.bidder})`);
console.log(`Already credited, awaiting withdraw() by the beneficiary (${credits.length}):`);
for (const c of credits) console.log(`  withdraw() as ${c.who}: ${usdc(c.amount)} USDC`);
console.log(
  "Deposits settled above credit their beneficiary (bidder, buyer or winner per DepositState); each then calls withdraw() with its own key.",
);

if (dryRun) {
  console.log("\n--dry-run: nothing signed or broadcast.");
  process.exit(0);
}

const key = process.env.PRIVATE_KEY;
if (!key) {
  console.error("PRIVATE_KEY is required without --dry-run.");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport });
const send = async (functionName, args) => {
  const hash = await wallet.writeContract({
    address: registry,
    abi: RFQRegistryAbi,
    functionName,
    args,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`${functionName} ${hash}`);
};

for (const s of settlements) await send("settleDeposit", [s.rfqId, s.bidder]);
const mine = await read("withdrawable", [account.address]);
if (mine > 0n) await send("withdraw", []);
else
  console.log(
    `${account.address} has nothing to withdraw; other beneficiaries must run this themselves.`,
  );
console.log(
  `totalHeld=${usdc(await read("totalHeld"))} totalWithdrawable=${usdc(await read("totalWithdrawable"))}`,
);
