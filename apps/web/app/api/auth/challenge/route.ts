import { issueChallenge } from "@sealedrfq/db/auth";
import { NextResponse } from "next/server";

/**
 * Ask for something to sign.
 *
 * The server issues the nonce because a signature the client chose the contents of proves only
 * that a key exists, not that its holder is here now.
 */
export async function POST(request: Request) {
  let wallet: unknown;
  try {
    ({ wallet } = await request.json());
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof wallet !== "string") {
    return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  }
  try {
    const { nonce, message, expiresAt } = await issueChallenge(wallet);
    return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() });
  } catch (e) {
    // The address failing its format check is the caller's problem and safe to repeat back;
    // anything else is not, so it is logged rather than returned.
    const message = e instanceof Error ? e.message : "could not issue a sign-in request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
