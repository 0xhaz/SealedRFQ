import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

/*
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`; Clerk's handler is unchanged.
 *
 * The agent card is public by design and must stay untouched: its SHA-256 is anchored on
 * Concordium, so any redirect or rewritten body would make the on-chain claim false. The webhook
 * is public because Clerk calls it unauthenticated and proves itself by signature.
 *
 * The verification surfaces are public because that is the project's central claim: anyone can
 * re-check a decision against the chain. `/audit` re-hashes a published memo, `/qualify` proves a
 * wallet's own attributes, and `/api/concordium` reads a badge off a public chain — none of them
 * touch organization-scoped data, and `docs/verifying-a-decision.md` sends anonymous readers
 * straight to `/audit/{id}`. Requiring an account to check a decision would be the end of the
 * claim, not a tightening of it.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/evidence(.*)",
  "/docs(.*)",
  "/audit(.*)",
  "/qualify",
  "/api/concordium(.*)",
  "/.well-known/agent-card.json",
  "/api/clerk/webhook",
  // Must be public: a pending session (organization not yet chosen) is sent by the server to the
  // hosted /tasks page, never to `taskUrls`, so protecting this route would make it unreachable.
  "/app/choose-organization",
]);

const guarded = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

/*
 * A clone with no Clerk keys still serves everything that does not need an account.
 *
 * `clerkMiddleware` throws at request time without a publishable key, and because the matcher
 * below covers nearly every path that used to mean HTTP 500 on the landing page and on
 * `/evidence` — the two pages a stranger is sent to first. Degrading instead of throwing keeps
 * `pnpm local` honest for someone who has not signed up to Clerk.
 *
 * It degrades one way only. Public routes serve; everything else answers 503, because a protected
 * route that cannot authenticate anyone must refuse rather than admit. The alternative — skipping
 * the gate when the key is missing — would turn a missing environment variable in production into
 * an open tenant boundary.
 */
const keyed = Boolean(
  process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
let warned = false;

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (keyed) return guarded(req, event);
  if (!warned) {
    warned = true;
    console.warn(
      "No Clerk publishable key: serving public pages only. Everything under /app answers 503. " +
        "Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in " +
        "apps/web/.env.local to enable accounts.",
    );
  }
  if (isPublicRoute(req)) return NextResponse.next();
  return new NextResponse("Accounts are not configured on this deployment.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: [
    // Skip Next internals and static files, unless they appear in the search params.
    "/((?!_next|\\.well-known|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
