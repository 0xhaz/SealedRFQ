import { QUALIFICATION_DESCRIPTION, QUALIFICATION_STATEMENT, purposeFor } from "@/lib/v2/qualification";
import { newChallenge } from "@sealedrfq/concordium";
import { PostgresChallengeStore } from "@sealedrfq/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const store = new PostgresChallengeStore();

/**
 * Ask for something to prove.
 *
 * The server issues the challenge because a proof whose challenge the holder chose shows only
 * that they once held a credential, not that they are here now answering this tender. The
 * statement goes back with it so the wallet and the verifier are working from the same question,
 * and so the supplier can read what they are about to approve.
 */
export async function POST(request: Request) {
  let tenderId: unknown;
  try {
    ({ tenderId } = await request.json());
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof tenderId !== "number" || !Number.isInteger(tenderId) || tenderId < 1) {
    return NextResponse.json({ error: "tenderId must be a positive integer" }, { status: 400 });
  }

  const challenge = newChallenge(purposeFor(tenderId));
  try {
    await store.issue(challenge);
  } catch {
    // The reason is for our logs. A caller learns only that it did not work.
    return NextResponse.json({ error: "could not issue a challenge" }, { status: 503 });
  }
  return NextResponse.json({
    challenge: challenge.challenge,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    statement: QUALIFICATION_STATEMENT,
    description: QUALIFICATION_DESCRIPTION,
  });
}
