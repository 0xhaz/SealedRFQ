/**
 * The evaluator's A2A Agent Card, at the well-known path the A2A specification uses.
 *
 * Serves `cardBytes()` verbatim rather than returning an object for Next to serialise, because the
 * badge is only checkable if these bytes hash to the `metadata_hash` recorded in CIS-8004. Letting
 * a JSON serialiser reorder a key would break every verification while the page still looked fine.
 */
import { agentRegistration } from "@/lib/v2/agentRegistration";
import { cardBytes, cardHashHex } from "@sealedrfq/concordium";

export const dynamic = "force-static";

export function GET() {
  if (!agentRegistration) {
    return new Response(
      JSON.stringify({
        error: "not_registered",
        detail:
          "This deployment has no Concordium agent registration yet, so it publishes no agent card.",
      }),
      {
        status: 404,
        headers: {
          "content-type": "application/json",
          // Also readable cross-origin: a verifier should be able to read "no badge here" rather
          // than see a CORS failure, which looks identical to the site being down.
          "access-control-allow-origin": "*",
        },
      },
    );
  }
  // `Uint8Array.from` rather than the Buffer itself: the response body type wants a view over a
  // plain ArrayBuffer, and the copy keeps the bytes identical to the ones that were hashed.
  const body = Uint8Array.from(cardBytes(agentRegistration));
  return new Response(body, {
    headers: {
      // The A2A content type. Served as the exact bytes that were hashed.
      "content-type": "application/json",
      // Anyone verifying the badge fetches this cross-origin, so it has to be readable.
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
      // A convenience for a reader comparing by eye. The authority is the chain, not this header.
      "x-agent-card-sha256": cardHashHex(agentRegistration),
    },
  });
}
