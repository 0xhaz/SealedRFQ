import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/*
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`; Clerk's handler is unchanged.
 *
 * The agent card is public by design and must stay untouched: its SHA-256 is anchored on
 * Concordium, so any redirect or rewritten body would make the on-chain claim false. The webhook
 * is public because Clerk calls it unauthenticated and proves itself by signature.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/evidence(.*)",
  "/docs(.*)",
  "/.well-known/agent-card.json",
  "/api/clerk/webhook",
  // Must be public: a pending session (organization not yet chosen) is sent by the server to the
  // hosted /tasks page, never to `taskUrls`, so protecting this route would make it unreachable.
  "/app/choose-organization",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static files, unless they appear in the search params.
    "/((?!_next|\\.well-known|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
