# V2 SaaS refactor: follow-up work

Carried out of the execution ledger for the `v2-saas-identity` branch before its scratch workspace was
deleted, because none of this lives in git history. Written 2026-11-10.

The branch itself is reviewed and merge-recommended. Everything here was deliberately deferred, with a
reason recorded at the time. Items are numbered as the ledger numbered them; gaps are items that were
fixed during execution rather than deferred.

## Known-false statement still in the product

`apps/web/app/app/[org]/requests/new/page.tsx` says "An RFQ is binding and enters the sealed-bid
lifecycle." It does not — the form writes a Postgres row with no chain interaction. Same class as the
defect that blocked merge, one sentence, on an authenticated page. Parked only because the process
allows a single fix wave.

## Open decision: the unauthenticated challenge surface

`/qualify` and `/api/concordium(.*)` were made public because public documentation and `/evidence`
both linked to them. The consequence is that `POST /api/concordium/challenge` now writes a
`presentation_challenges` row per anonymous call with no rate limit, which Clerk gating used to cover.
Rows are small, carry a five-minute TTL, and `app.evict_expired_presentation_challenges` exists.

Two clean resolutions, and the choice is a product one: rate-limit the route, or re-gate `/qualify`
and the Concordium routes and change `/evidence`'s call to action. `/audit` must stay public either
way — the project's verification claim depends on a stranger being able to reach it.

## Three follow-up tasks named during execution

1. **A reconciliation sweep against Clerk's API, keyed on `synced_at`.** Svix exhausts roughly five
   delivery attempts over about 24 hours, so an `organizationMembership.deleted` lost during a
   database outage leaves a removed member in the projection permanently. The `0009` tombstone blocks
   a resurrecting `created` but cannot recover a delete that never arrived.
2. **A dedicated `sealedrfq_webhook` login role.** The projection functions are granted to
   `sealedrfq_app` because the webhook route shares its pool, so an actor with arbitrary SQL as that
   role could forge a membership. That actor can already impersonate anyone through
   `set_config('app.current_user_id', …)`, so this changes no posture today — it is the only real
   narrowing available.
3. **A wallet-link challenge issuer.** `0012` dropped `app.issue_challenge`; `app.consume_challenge`
   and `wallet_challenges` survive for linking. Nothing can issue a nonce, and nothing calls
   `linkWallet` either, so there is no reachable half-feature — but the first linking surface needs a
   `SECURITY DEFINER` issuer and a migration.

## The wallet-linking bundle

None of these is reachable today; all become wrong together the moment a caller exists, so do them
with the first one.

- **6** (Task 1): workspace copy promises visibility that is false for a two-org user, and names no
- **7** (Task 1): isOwner/mySupplierOrgs computed across all memberships, not the active one.
- **9** (Task 1): red run skipped. Reviewer read the suite and showed it is not vacuous (positive
Task 1: minor (deferred): 3b — putDocument still takes input.orgId at the db layer (documents.ts). Disclosed; no
- **10** (Task 1): the shadow test's comment claims search_path is what defeats the forged row; the
- **11** (Task 2): Clerk logs a createRouteMatcher deprecation warning; kept because the brief
- **12** (Task 2): all non-public routes are now Clerk-gated including the old wallet pages and
- **13** (Task 2): proxy headers verified in dev only; recheck on a production build before submission.
- **14** (Task 2): missing Clerk keys make clerkMiddleware throw, 500ing even public routes and the
- **15** (Task 2): matcher /docs(.*) and /evidence(.*) also match /docsXYZ; harmless, no such routes.
- **16** (Task 2): the \.well-known exclusion is a prefix match, so a hypothetical /.well-known-x
- **17** (Task 3): Clerk id uniqueness is case-sensitive with no format CHECK. Task 4 owns id format.
- **18** (Task 3): any future SELECT * on organizations now fails for the app role. That is the
- **19** (Task 4): membership events can now rename an organization back, since names have no
- **20** (Task 5): the app role has no UPDATE on wallet_links, so revocation (setting revoked_at)
- **21** (Task 5): identity.ts:162 compares wallet/address with toLowerCase() for EVERY namespace,
- **22** (Task 5): the spent-challenge rollback is asserted only on the mismatch path, not on an
- **23** (Task 5): organization_signers' WITH CHECK pins only organization_id, not that
- **24** (Task 5): identity.ts's header comment claims every write goes through a definer function,
- **25** (Task 5): linkWallet does not verify the signature and only a docstring says so. Matches
- **26** (Task 6a): no real signed-in or two-organization session was verified, so the switcher and
- **27** (Task 6a): requireOrg redirects to /sign-in but no such page exists; the proxy catches
- **28** (Task 6a): SignIn.tsx/SignOut.tsx are now unused and SignOut still points at /workspace.
- **29** (Task 6a): Tenant.orgSlug holds the id fallback for slugless orgs. Every consumer uses it
- **30** (Task 6b): no test pins that the dropped login functions are actually gone; verified via
- **31** (Task 6b): nothing issues challenges now (issue_challenge dropped, consume_challenge and
- **32** (Task 6b): no test pins that issue_challenge/upsert_user/member_role are gone or that
- **33** (Task 7): a full BidCommitted/BidPlaced log scan takes ~10 minutes on the public Arc RPC
- **34** (Task 7): scripts/v1 was made a workspace package and its importer block hand-added to
- **35** (Task 7): about 16 now-unreachable lib modules remain (the brief named components only).
- **36** (Task 7): root `pnpm test` was not run, only the two suites directly. Controller to run it.
- **37** (Task 7): *** TOP PRIORITY FOR THE FINAL REVIEW *** the exit script imports
- **38** (Task 7): the settle loop has no try/catch, so one revert (e.g. someone else settles first)
- **39** (Task 7): the "site status never gates a route that returns money" guarantee now lives only
- **40** (Task 7): README does not mention that RFQ 3 is Open and so its 4.40 held cannot be settled
- **41** (Task 8): the unit fake answers eth_call with a bool, so the 0x1626ba7e magic-value
- **42** (Task 8): viem turns a failed eth_call into plain `false`, so an RPC outage during EIP-1271
- **43** (Task 8): an undeployed ERC-6492 counterfactual account cannot verify, because EOAs take the
- **44** (Task 8): pre-existing biome error (noNonNullAssertion, packages/shared/test/invoice.test.ts
- **45** (Task 8): the new EIP-7702 delegated-EOA branch (code starting 0xef0100) goes via recovery

- **3b** (Task 4): `packages/db/src/documents.ts:69` takes `input.orgId` from its caller while
  `requireTenant` beside it is documented as never doing that. No web caller exists and the policy's
  `WITH CHECK` refuses a wrong organization, so nothing is reachable — but the asymmetry invites the
  first caller to get it wrong.

## Everything else

The list above is the full deferred set as recorded. The final whole-branch review triaged it into
must-fix-before-merge (all applied), follow-up, and drop; the drops were items already fixed during
execution or patterns judged not worth narrowing. Two it singled out as worth doing deliberately:

- `0006`'s four `SECURITY DEFINER` functions are the only unpinned ones left — they reference
  `presentation_challenges` unqualified with no `SET search_path`, while `0012`'s own comment asserts
  every other such function pins one. Four clauses and a comment correction in an `0014`.
- `migrate.sh` applies each migration outside a transaction, so a mid-file failure leaves a
  half-applied schema that a re-run cannot repair — while the script's header says running it twice is
  a no-op. Postgres DDL is transactional; this is a one-line fix.

## Still unverified by a human

One real browser sign-in with two organizations, exercising the switcher. The final review called it
the cheapest high-value check remaining and noted it would have caught the slugless-organization
dead-end that was found by reading instead. The data layer's half is proven: the webhook and session
paths resolve identical UUIDs for the same Clerk organization, and isolation holds in both directions.
