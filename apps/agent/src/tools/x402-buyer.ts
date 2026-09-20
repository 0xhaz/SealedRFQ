/**
 * The other half of x402: an agent that pays.
 *
 * The server side only proves we can *ask* for money. This is a buying agent that actually settles
 * one — the thing worth showing, because it is the whole premise of agentic commerce: software
 * paying software for a service, with no API key, no account and no human in the loop.
 *
 * Circle's batching is not pay-as-you-go. USDC is deposited into the Gateway Wallet once, and each
 * call afterwards is an off-chain signature against that balance, which is what makes a five-cent
 * price viable. So the flow is deposit once, then pay many times:
 *
 *   node dist/tools/x402-buyer.js balances
 *   node dist/tools/x402-buyer.js deposit 1
 *   node dist/tools/x402-buyer.js pay 1
 *   node dist/tools/x402-buyer.js withdraw 0.5
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

const CHAINS: Record<number, "arc" | "arcTestnet"> = { 5042: "arc", 5042002: "arcTestnet" };

const chainId = Number(process.env.ARC_CHAIN_ID ?? 5042002);
const agentUrl = (process.env.AGENT_URL ?? "http://127.0.0.1:4020").replace(/\/$/, "");
// A dedicated key is allowed so the payer need not be the buyer persona, but the buyer is the
// honest default: it is the party that wants an RFQ scored.
const privateKey = (process.env.X402_BUYER_PK ?? process.env.BUYER_PK) as Hex | undefined;

function usage(msg: string): never {
  console.error(
    `${msg}\n\nusage: x402-buyer <balances | deposit <usdc> | pay <rfqId> | withdraw <usdc>>`,
  );
  process.exit(1);
}

const chain = CHAINS[chainId];
if (!chain)
  usage(`ARC_CHAIN_ID ${chainId} is not an Arc network; Circle's Gateway cannot settle it.`);
if (!privateKey) usage("set BUYER_PK (or X402_BUYER_PK) to the wallet that should pay.");

const gateway = new GatewayClient({
  chain,
  privateKey,
  ...(process.env.ARC_RPC_URL ? { rpcUrl: process.env.ARC_RPC_URL } : {}),
});

async function balances() {
  const b = await gateway.getBalances();
  console.log(`payer      ${gateway.address} on ${chain}`);
  console.log(`wallet     ${b.wallet.formatted} USDC`);
  console.log(
    `gateway    ${b.gateway.formattedAvailable} USDC available of ${b.gateway.formattedTotal} total`,
  );
  if (b.gateway.available === 0n) {
    console.log("\nnothing deposited yet, so a paid call would be refused: run `deposit 1` first.");
  }
}

async function deposit(amount: string) {
  console.log(`depositing ${amount} USDC into the Gateway Wallet (approve + deposit)...`);
  const r = await gateway.deposit(amount);
  if (r.approvalTxHash) console.log(`  approval  ${r.approvalTxHash}`);
  console.log(`  deposit   ${r.depositTxHash}`);
  await balances();
}

async function pay(rfqId: string) {
  const url = `${agentUrl}/rfqs/${rfqId}/evaluate`;

  // Ask first, so a failure to pay is distinguishable from the endpoint simply being free.
  const s = await gateway.supports(url);
  if (!s.supported) {
    console.log(
      `${url} is not asking for payment (x402 disabled on the agent?) — calling it plainly.`,
    );
    const res = await fetch(url, { method: "POST" });
    console.log(`HTTP ${res.status}`, (await res.text()).slice(0, 400));
    return;
  }
  console.log(`terms: ${JSON.stringify(s.requirements)}`);

  const before = await gateway.getBalances();
  const { data, amount } = await gateway.pay(url, { method: "POST" });
  const after = await gateway.getBalances();

  console.log(`\npaid ${amount} USDC`);
  console.log(
    `gateway balance ${before.gateway.formattedAvailable} -> ${after.gateway.formattedAvailable}`,
  );
  console.log(`\nresponse:\n${JSON.stringify(data, null, 2).slice(0, 1200)}`);
}

async function withdraw(amount: string) {
  const r = await gateway.withdraw(amount);
  console.log(`withdrew ${amount} USDC: ${JSON.stringify(r)}`);
  await balances();
}

const [cmd, arg] = process.argv.slice(2);
const run = async () => {
  switch (cmd) {
    case "balances":
      return balances();
    case "deposit":
      return arg ? deposit(arg) : usage("deposit needs an amount, e.g. `deposit 1`");
    case "pay":
      return arg ? pay(arg) : usage("pay needs an RFQ id, e.g. `pay 1`");
    case "withdraw":
      return arg ? withdraw(arg) : usage("withdraw needs an amount");
    default:
      return usage(cmd ? `unknown command: ${cmd}` : "no command given");
  }
};

run().catch((e) => {
  console.error(`\nfailed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
