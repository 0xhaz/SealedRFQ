import { type Hex, recoverMessageAddress } from "viem";
import { pool } from "./index.js";

/**
 * Wallet sign-in: prove control of an address, then act as the user it belongs to.
 *
 * A signature on its own proves nothing about when it was made, so the server issues the thing
 * being signed. The nonce is single-use and short-lived, and both properties are enforced in the
 * database rather than in this file: `consumeChallenge` claims the row with a conditional UPDATE,
 * so two requests racing the same nonce cannot both win. Checking first and updating after would
 * leave exactly that gap.
 */
const TTL = "5 minutes";

/** What the user signs. Readable, because a wallet shows it verbatim and a blob invites blind signing. */
export function challengeMessage(nonce: string, wallet: string, expiresAt: Date): string {
  return [
    "SealedRFQ: sign in",
    "",
    "Signing this proves you control this wallet. It does not move funds and does not approve",
    "any transaction.",
    "",
    `wallet: ${wallet}`,
    `nonce: ${nonce}`,
    `expires: ${expiresAt.toISOString()}`,
  ].join("\n");
}

export type Challenge = { nonce: string; message: string; expiresAt: Date };

export async function issueChallenge(wallet: string): Promise<Challenge> {
  const address = normalise(wallet);
  const { rows } = await pool.query<{ nonce: string; expires_at: Date }>(
    "SELECT * FROM app.issue_challenge($1, $2::interval)",
    [address, TTL],
  );
  const row = rows[0];
  if (!row) throw new AuthError("could not issue a sign-in request");
  return {
    nonce: row.nonce,
    message: challengeMessage(row.nonce, address, row.expires_at),
    expiresAt: row.expires_at,
  };
}

export class AuthError extends Error {}

/**
 * Verify a signed challenge and return the user id to pass to `withTenant`.
 *
 * Order matters. The nonce is consumed before the signature is checked, so a wrong signature still
 * burns it: otherwise an attacker holding a stolen nonce could grind signatures against it until
 * one worked.
 */
export async function verifyChallenge(nonce: string, signature: Hex): Promise<string> {
  const claimed = await consumeChallenge(nonce);
  if (!claimed) throw new AuthError("that sign-in request is unknown, used or expired");

  let signer: string;
  try {
    signer = normalise(
      await recoverMessageAddress({
        message: challengeMessage(nonce, claimed.wallet, claimed.expiresAt),
        signature,
      }),
    );
  } catch {
    throw new AuthError("the signature could not be read");
  }
  if (signer !== claimed.wallet) throw new AuthError("that signature is from a different wallet");

  const { rows } = await pool.query<{ upsert_user: string }>("SELECT app.upsert_user($1)", [
    signer,
  ]);
  const user = rows[0];
  if (!user) throw new AuthError("could not establish the user record");
  return user.upsert_user;
}

/** Claim a nonce, once. The single-use and expiry rules live in the SQL function, not here. */
async function consumeChallenge(nonce: string) {
  const { rows } = await pool.query<{ wallet: string; expires_at: Date }>(
    "SELECT * FROM app.consume_challenge($1)",
    [nonce],
  );
  const row = rows[0];
  return row ? { wallet: row.wallet, expiresAt: row.expires_at } : null;
}

/** Lower case, so a checksummed address and a lower-case one are the same account. */
function normalise(wallet: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new AuthError(`not an address: ${wallet}`);
  return wallet.toLowerCase();
}
