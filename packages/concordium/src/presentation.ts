/**
 * Verifying a Concordium identity presentation.
 *
 * The wallet produces the proof; this checks it. Five things have to hold, and the fifth is the
 * one that is easy to leave out:
 *
 *   1. The challenge is one we issued, for this purpose, and has not expired.
 *   2. Every credential behind the proof is Active — not revoked, expired or not yet activated.
 *   3. The proof verifies against the chain's cryptographic parameters and the credential's
 *      public data. This is `verifyPresentation`, and it throws rather than returning false.
 *   4. The challenge inside the verified request equals the one we are checking.
 *   5. **The statements proved are the statements we asked for.** `verifyPresentation` returns
 *      whatever the proof actually proves, not what you wanted it to prove. Skip this and a
 *      holder can answer a question you never asked — prove membership of a set containing every
 *      country, say — and have it accepted as if it were the real predicate.
 *
 * Only then is the challenge consumed, and only atomically: verifying first means a bad proof
 * cannot burn a challenge the holder is entitled to retry with, while consuming last means two
 * identical presentations racing each other cannot both succeed.
 */
import { CIS4 } from "@concordium/web-sdk";
import type {
  CredentialStatements,
  CredentialsInputs,
  CryptographicParameters,
  RequestStatement,
  VerifiablePresentation,
} from "@concordium/web-sdk";
import { verifyPresentation } from "@concordium/web-sdk";
import type { Challenge, ChallengeStore } from "./challenge.js";

export type CredentialWithStatus = {
  status: CIS4.CredentialStatus;
  inputs: CredentialsInputs;
};

export type VerificationFailure = {
  ok: false;
  /** A short machine-readable reason, so a caller can distinguish retryable from final. */
  reason:
    | "unknown_challenge"
    | "expired_challenge"
    | "wrong_purpose"
    | "credential_not_active"
    | "proof_invalid"
    | "challenge_mismatch"
    | "statement_mismatch"
    | "challenge_already_used";
  detail: string;
};

export type VerificationSuccess = {
  ok: true;
  /** The credential identifiers the proof speaks for, as DIDs. Stable per credential. */
  subjects: string[];
  /** The statements, as verified. Equal to what was requested, having been compared. */
  statements: RequestStatement[];
  challenge: Challenge;
};

export type VerificationResult = VerificationSuccess | VerificationFailure;

const fail = (reason: VerificationFailure["reason"], detail: string): VerificationFailure => ({
  ok: false,
  reason,
  detail,
});

/**
 * Compare what was proved against what was asked.
 *
 * Order is not significant for the statement list as a whole — a wallet may answer the credentials
 * in a different order — so each requested credential statement must be matched by exactly one
 * proved statement. Within a credential the atomic statements are compared as a set too, but
 * every one of them must be present and identical: a proof covering a subset is a different claim.
 */
export function statementsMatch(
  requested: CredentialStatements,
  proved: RequestStatement[],
): boolean {
  if (requested.length !== proved.length) return false;
  const remaining = [...proved];
  for (const want of requested) {
    const index = remaining.findIndex((got) =>
      atomicStatementsEqual(want.statement, got.statement),
    );
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

function atomicStatementsEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const remaining = [...b];
  for (const want of a) {
    const index = remaining.findIndex((got) => canonical(got) === canonical(want));
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

/** Key-ordered JSON, with bigints as strings: contract indexes arrive as bigints. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/**
 * The cheap half of verification: is this challenge ours, live, and for this purpose?
 *
 * Exported so a caller can ask before doing the expensive half. Resolving a presentation's
 * credentials means several round trips to a Concordium node, and there is no sense spending them
 * on a challenge we were never going to accept — nor reporting the result as though the node were
 * at fault. `verifyQualificationPresentation` repeats these checks, so skipping this is safe and
 * only wasteful.
 */
export async function precheckChallenge(
  store: ChallengeStore,
  challenge: string,
  purpose: string,
  now = Date.now(),
): Promise<VerificationFailure | undefined> {
  const issued = await store.peek(challenge);
  if (!issued) return fail("unknown_challenge", "this challenge was never issued, or is spent");
  if (issued.expiresAt <= now) {
    return fail("expired_challenge", `expired at ${new Date(issued.expiresAt).toISOString()}`);
  }
  if (issued.purpose !== purpose) {
    return fail("wrong_purpose", `issued for ${issued.purpose}, presented for ${purpose}`);
  }
  return undefined;
}

export type VerifyPresentationInput = {
  presentation: VerifiablePresentation;
  /** From `client.getCryptographicParameters()`. Fixed per network, so cache it. */
  globalContext: CryptographicParameters;
  /** From `getPublicData(grpc, network, presentation)`. */
  credentials: CredentialWithStatus[];
  /** Exactly what was asked for. Compared against what the proof actually proves. */
  requested: CredentialStatements;
  /** The challenge this presentation is answering, and what it was issued for. */
  challenge: string;
  purpose: string;
  store: ChallengeStore;
  now?: number;
};

export async function verifyQualificationPresentation(
  input: VerifyPresentationInput,
): Promise<VerificationResult> {
  const now = input.now ?? Date.now();

  // 1. Ours, for this purpose, still live. Peeked rather than consumed: a proof that turns out to
  //    be invalid should not cost the holder the challenge they were legitimately issued.
  const issued = await input.store.peek(input.challenge);
  if (!issued) return fail("unknown_challenge", "this challenge was never issued, or is spent");
  if (issued.expiresAt <= now) {
    return fail("expired_challenge", `expired at ${new Date(issued.expiresAt).toISOString()}`);
  }
  if (issued.purpose !== input.purpose) {
    return fail("wrong_purpose", `issued for ${issued.purpose}, presented for ${input.purpose}`);
  }

  // 2. A revoked credential still produces a mathematically valid proof. Status is a separate
  //    question from validity, and the chain is the only thing that can answer it.
  const inactive = input.credentials.find((c) => c.status !== CIS4.CredentialStatus.Active);
  if (inactive) {
    return fail(
      "credential_not_active",
      `a credential is ${CIS4.CredentialStatus[inactive.status]}`,
    );
  }
  if (input.credentials.length === 0) {
    return fail("credential_not_active", "no credential data accompanied the presentation");
  }

  // 3. The cryptography. This throws on any failure rather than returning a verdict.
  let request: { challenge: string; credentialStatements: RequestStatement[] };
  try {
    request = verifyPresentation(
      input.presentation,
      input.globalContext,
      input.credentials.map((c) => c.inputs),
    );
  } catch (e) {
    return fail("proof_invalid", e instanceof Error ? e.message : String(e));
  }

  // 4. The proof is bound to a challenge; make sure it is bound to this one.
  if (request.challenge.toLowerCase() !== input.challenge.toLowerCase()) {
    return fail("challenge_mismatch", `proof answers ${request.challenge}`);
  }

  // 5. The question that was answered has to be the question that was asked.
  if (!statementsMatch(input.requested, request.credentialStatements)) {
    return fail("statement_mismatch", "the proof proves something other than what was requested");
  }

  // Only now spend it, and atomically: two identical presentations racing cannot both win.
  const consumed = await input.store.consume(input.challenge, now);
  if (!consumed) return fail("challenge_already_used", "another presentation consumed it first");

  return {
    ok: true,
    subjects: request.credentialStatements.map((s) => s.id),
    statements: request.credentialStatements,
    challenge: consumed,
  };
}
