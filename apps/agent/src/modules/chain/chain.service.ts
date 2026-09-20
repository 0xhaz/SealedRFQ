import { readFileSync } from "node:fs";
import { Injectable, Logger } from "@nestjs/common";
import {
  AgenticCommerceAbi,
  AttestationLogAbi,
  RFQRegistryAbi,
  SealedRFQAdapterAbi,
  arcMainnet,
  arcTest,
} from "@sealedrfq/shared";
import {
  http,
  type Hex,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Role = "EVALUATOR" | "AWARDER" | "VERIFIER" | "ATTESTOR" | "ARBITER" | "ADMIN";

type Deployment = {
  chainId: number;
  startBlock: number;
  RFQRegistry: Hex;
  SealedRFQAdapter: Hex;
  AgenticCommerce: Hex;
  AttestationLog: Hex;
  ProcurementPolicy: Hex;
};

/**
 * One viem client for reads, one wallet per role for writes. Each agent role holds its own key so
 * a leaked evaluator key can score and attest but can never award or move escrow.
 */
@Injectable()
export class ChainService {
  private readonly log = new Logger(ChainService.name);
  readonly chainId = Number(process.env.ARC_CHAIN_ID ?? 5042002);
  readonly chain = this.chainId === arcMainnet.id ? arcMainnet : arcTest;
  readonly deployment: Deployment;
  /** Explicitly typed: pnpm keeps several viem copies, so inferred client types are not portable. */
  readonly publicClient: PublicClient;

  constructor() {
    const path = process.env.DEPLOYMENT_JSON ?? `../../contracts/deployments/${this.chainId}.json`;
    this.deployment = JSON.parse(readFileSync(path, "utf8")) as Deployment;
    const rpc = process.env.ARC_RPC_URL ?? this.chain.rpcUrls.default.http[0];
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(rpc),
    }) as PublicClient;
    this.log.log(`chain ${this.chainId} · registry ${this.deployment.RFQRegistry}`);
  }

  get registry() {
    return { address: this.deployment.RFQRegistry, abi: RFQRegistryAbi } as const;
  }
  get adapter() {
    return { address: this.deployment.SealedRFQAdapter, abi: SealedRFQAdapterAbi } as const;
  }
  get attestationLog() {
    return { address: this.deployment.AttestationLog, abi: AttestationLogAbi } as const;
  }
  get acp() {
    return { address: this.deployment.AgenticCommerce, abi: AgenticCommerceAbi } as const;
  }

  hasKey(role: Role) {
    return Boolean(process.env[`${role}_PK`]);
  }

  /** Wallet client for a role. Throws rather than silently falling back to another key. */
  wallet(role: Role): WalletClient {
    const pk = process.env[`${role}_PK`];
    if (!pk) throw new Error(`${role}_PK is not set: this agent cannot act as ${role}`);
    const rpc = process.env.ARC_RPC_URL ?? this.chain.rpcUrls.default.http[0];
    return createWalletClient({
      account: privateKeyToAccount(pk as Hex),
      chain: this.chain,
      transport: http(rpc),
    });
  }

  address(role: Role) {
    const pk = process.env[`${role}_PK`];
    return pk ? privateKeyToAccount(pk as Hex).address : null;
  }

  /**
   * Send a write as `role`. Callers pass only what the call is; the chain and the signing account
   * come from the role's own wallet, so a call can never be sent from the wrong key by accident.
   *
   * Arc finality is deterministic: one confirmation is final, so never count confirmations.
   */
  async send(
    role: Role,
    request: {
      address: Hex;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    },
  ) {
    const wallet = this.wallet(role);
    const hash = await wallet.writeContract({
      ...request,
      chain: this.chain,
      account: wallet.account ?? null,
    } as never);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${role} tx reverted: ${hash}`);
    return hash;
  }
}
