/**
 * Bearer-token guard for the endpoints that spend a key or cost real work.
 *
 * `POST /rfqs/:id/award` makes this service broadcast a transaction signed by the AWARDER key, and
 * `POST /reindex` can be used to burn the RPC budget. On localhost that is harmless; behind a public
 * URL it means a stranger can pick the moment an award is sent and spend that key's USDC on gas.
 * The on-chain policy still stops them awarding anything the evaluator did not recommend, so this
 * is not a path to the escrow — but choosing *when* a buyer's award lands is not theirs to choose.
 *
 * These endpoints are therefore disabled unless a token is configured, rather than open unless one
 * is. Nothing in this repository calls them — the web app only asks for evaluations — so failing
 * closed costs nothing and forgetting to set the token cannot quietly leave them exposed.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

export type TokenCheck = "ok" | "not-configured" | "missing" | "bad";

/**
 * Compared over a SHA-256 of each side: timingSafeEqual throws on a length mismatch, which would
 * otherwise leak the token's length through the difference between a 500 and a 401.
 */
export function checkToken(header: string | undefined, expected: string | undefined): TokenCheck {
  if (!expected) return "not-configured";
  const presented = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!presented) return "missing";
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) ? "ok" : "bad";
}

@Injectable()
export class TokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const result = checkToken(req.headers.authorization, process.env.AGENT_API_TOKEN);

    if (result === "ok") return true;
    if (result === "not-configured") {
      throw new ServiceUnavailableException(
        "This endpoint is disabled: set AGENT_API_TOKEN on the service to enable it.",
      );
    }
    // Deliberately the same answer for a missing and a wrong token.
    throw new UnauthorizedException("A valid bearer token is required for this endpoint.");
  }
}
