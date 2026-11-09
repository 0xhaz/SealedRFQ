import { AuthError, verifyChallenge } from "@sealedrfq/db/auth";
import { sessionCookie } from "@/lib/v2/session";
import { NextResponse } from "next/server";

/** Hand back a signed challenge and receive a session. */
export async function POST(request: Request) {
  let nonce: unknown;
  let signature: unknown;
  try {
    ({ nonce, signature } = await request.json());
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof nonce !== "string" || typeof signature !== "string") {
    return NextResponse.json({ error: "nonce and signature are required" }, { status: 400 });
  }

  try {
    const userId = await verifyChallenge(nonce, signature as `0x${string}`);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(userId));
    return res;
  } catch (e) {
    // AuthError messages are written for the person signing in and say nothing about anyone else.
    // Any other failure gets a flat refusal rather than its internals.
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json({ error: "could not complete sign-in" }, { status: 500 });
  }
}
