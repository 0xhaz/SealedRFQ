import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import { ChainService } from "../chain/chain.service.js";
import { type X402Config, resolveX402 } from "./x402.config.js";

/**
 * Puts the evaluation endpoint behind an x402 paywall when one is configured.
 *
 * Circle's `exact` scheme signs an EIP-712 authorisation against their GatewayWalletBatched
 * contract rather than USDC's own EIP-3009 domain, which is what makes sub-cent pricing practical:
 * payments are batched rather than settled one transaction at a time. An evaluation is worth a few
 * cents, so settling each call individually on chain would cost more than the thing being sold.
 *
 * Nest runs on Express here, so the SDK's middleware is used directly instead of being
 * reimplemented as a guard.
 */
@Injectable()
export class X402Middleware implements NestMiddleware {
  private readonly log = new Logger(X402Middleware.name);
  readonly config: X402Config | null;
  // biome-ignore lint/suspicious/noExplicitAny: the SDK's middleware is typed against node http, not Express
  private readonly gate: ((req: any, res: any, next: any) => void) | null;

  constructor(private readonly chain: ChainService) {
    this.config = resolveX402(this.chain.chainId);
    if (!this.config) {
      this.gate = null;
      return;
    }
    const gateway = createGatewayMiddleware({
      sellerAddress: this.config.payTo,
      networks: this.config.network,
      facilitatorUrl: this.config.facilitatorUrl,
      description: this.config.description,
    });
    this.gate = gateway.require(this.config.price);
    this.log.log(
      `evaluation metered at ${this.config.price} on ${this.config.network} -> ${this.config.payTo}`,
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: see above
  use(req: any, res: any, next: (err?: unknown) => void) {
    if (!this.gate) return next();
    return this.gate(req, res, next);
  }
}
