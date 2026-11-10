import { QUALIFICATION_STATEMENT, purposeFor } from "@/lib/v2/qualification";
import {
  precheckChallenge,
  verifyQualificationPresentation,
} from "@sealedrfq/concordium/presentation";
import { PostgresChallengeStore } from "@sealedrfq/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const store = new PostgresChallengeStore();
const NETWORK = "Testnet" as const;

/**
 * Check a proof.
 *
 * The heavy imports are deferred: `@concordium/web-sdk`'s verifier brings wasm, and loading it on
 * every request to this app rather than on requests to this route is a cost paid for nothing.
 */
export async function POST(request: Request) {
  let body: { tenderId?: unknown; challenge?: unknown; presentation?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const { tenderId, challenge, presentation } = body;
  if (typeof tenderId !== "number" || !Number.isInteger(tenderId) || tenderId < 1) {
    return NextResponse.json({ error: "tenderId must be a positive integer" }, { status: 400 });
  }
  if (typeof challenge !== "string" || !/^[0-9a-fA-F]{64}$/.test(challenge)) {
    return NextResponse.json({ error: "challenge must be 32 bytes of hex" }, { status: 400 });
  }
  if (!presentation || typeof presentation !== "object") {
    return NextResponse.json({ error: "presentation is required" }, { status: 400 });
  }

  // The cheap checks first. Resolving credentials costs several round trips to a Concordium node,
  // and spending them on a challenge we were never going to accept would also mean reporting the
  // refusal as though the node were at fault.
  const precheck = await precheckChallenge(store, challenge, purposeFor(tenderId));
  if (precheck) {
    return NextResponse.json(
      { ok: false, reason: precheck.reason, detail: precheck.detail },
      { status: 400 },
    );
  }

  const [{ ConcordiumGRPCNodeClient, credentials }, { getPublicData, VerifiablePresentation }] =
    await Promise.all([import("@concordium/web-sdk/nodejs"), import("@concordium/web-sdk")]);
  const client = new ConcordiumGRPCNodeClient(
    process.env.CCD_GRPC_HOST ?? "grpc.testnet.concordium.com",
    Number(process.env.CCD_GRPC_PORT ?? 20000),
    credentials.createSsl(),
  );

  let parsed: ReturnType<typeof VerifiablePresentation.fromString>;
  try {
    parsed = VerifiablePresentation.fromString(JSON.stringify(presentation));
  } catch {
    return NextResponse.json({ error: "that is not a verifiable presentation" }, { status: 400 });
  }

  // Reaching the node and reading the presentation are separate failures and lead to opposite
  // actions: one says try again later, the other says your proof is wrong. `fromString` does not
  // validate, so a malformed presentation surfaces here, and reporting it as a node problem would
  // tell a supplier to wait when they need to fix something.
  let globalContext: Awaited<ReturnType<typeof client.getCryptographicParameters>>;
  try {
    globalContext = await client.getCryptographicParameters();
  } catch (e) {
    console.error("could not reach Concordium", e);
    return NextResponse.json(
      { error: "could not reach Concordium to check the proof" },
      { status: 503 },
    );
  }

  // `fromString` does not check the shape, so this does: without it a presentation carrying no
  // credentials reaches `getPublicData` and fails as a TypeError about reading 'map', which tells
  // a supplier nothing they can act on.
  const carried = (parsed as { verifiableCredential?: unknown }).verifiableCredential;
  if (!Array.isArray(carried) || carried.length === 0) {
    return NextResponse.json(
      { ok: false, reason: "proof_invalid", detail: "the presentation carries no credentials" },
      { status: 400 },
    );
  }

  let credentialData: Awaited<ReturnType<typeof getPublicData>>;
  try {
    credentialData = await getPublicData(client, NETWORK, parsed);
  } catch (e) {
    // The node answered a moment ago, so this is about the presentation: malformed, or naming
    // credentials that do not resolve on this network.
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, reason: "proof_invalid", detail: `could not resolve its credentials: ${detail}` },
      { status: 400 },
    );
  }

  try {
    const result = await verifyQualificationPresentation({
      presentation: parsed,
      globalContext,
      credentials: credentialData,
      requested: QUALIFICATION_STATEMENT,
      challenge,
      purpose: purposeFor(tenderId),
      store,
    });

    if (!result.ok) {
      // The reason is safe to return and useful: a supplier needs to know whether to try again.
      return NextResponse.json(
        { ok: false, reason: result.reason, detail: result.detail },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, subjects: result.subjects });
  } catch (e) {
    console.error("concordium verification could not complete", e);
    return NextResponse.json({ error: "could not reach Concordium to check the proof" }, {
      status: 503,
    });
  }
}
