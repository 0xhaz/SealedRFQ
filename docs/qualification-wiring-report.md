# Qualification wiring report

## What changed
- `purposeFor(tenderId, bidder, action)` now returns `tender:<id>:<action>:<lowercased bidder>`. Max length is far under the 200-character column.
- `POST /api/concordium/challenge` takes `{ tenderId, bidder }`; `verify` takes `{ tenderId, bidder, challenge, presentation }`. Both validate the bidder with viem `isAddress` and return 400 early. Verify recomputes the purpose from its own arguments and passes it to both `precheckChallenge` and `verifyQualificationPresentation`.
- After a verified presentation, verify calls the new `recordQualification` in `apps/web/lib/agent.ts`, which POSTs `/qualifications` to the agent with `Authorization: Bearer $AGENT_API_TOKEN` (server-only env, same `TokenGuard` header the agent checks) and `synthetic: false`. It reuses `BASE` and `agentConfigError` from the existing resolver. No signing key is in the web app.
- The verify response no longer returns `subjects`. The subject is passed to the agent and nowhere else; the agent-call error paths return fixed strings, never thrown messages or response bodies.
- `/qualify` UI: bidder input, a warning that the proof is bound to an address and control of it is not proven, and distinct renderings of the three outcomes. `/qualify` remains public.

## The three outcomes
1. Refused: HTTP 400 `{ ok:false, reason, detail }` (e.g. `wrong_purpose`, `proof_invalid`). Challenge not spent. UI "Not accepted".
2. Recorded: HTTP 200 `{ ok:true, qualification:{ status:"recorded", tx } }` (or `already-qualified`, no tx). UI shows the hash.
3. Accepted, not recorded: HTTP 200 `{ ok:true, qualification:{ status:"not-recorded", reason, detail } }`. Reasons: `agent-unreachable` (fetch threw, including the agent not running), `agent-not-configured` (no token on web, bad URL, 404, or agent 503 with token unset), `agent-error`, `registry-behind` (agent 503 status; detail names `update-committee.mjs`), `below-quorum`, `nullifier-used` (agent 409, worded as a decision about the credential, not an outage). UI "Accepted, but not recorded. This is not a rejection of you", and says the proof is spent so they must prove again.

## Tests
Before: web 223 / 31 files, agent 88, root 8/8. After: web 233 / 32 files, agent 88, root 8/8. `tsc --noEmit` clean in apps/web. Biome not run on apps/web (processes zero files).
Changes in `test/concordiumRoutes.test.ts` (all deliberate): the existing requests now carry a bidder (the routes require one); the `purposeFor` case now asserts the bidder-bearing format; added 4 cases (malformed bidder on challenge, on verify; one-address-per-casing and different-bidder purposes; length bound). New file `test/qualificationBinding.test.ts`, 6 tests.

## Proof the binding refuses
- Offline test: issues a challenge for address A through the real challenge route, presents it to the real verify route for address B, expects 400 `wrong_purpose` and the challenge still unspent (peek). Same address in another casing passes `precheckChallenge`.
- Live, against the dev server on 3111 with the real database: challenge issued for A, submitted for 0x...dEaD, see the output of the curl run in the session (wrong_purpose expected, from the precheck before any node call).
- The check inside `verifyQualificationPresentation` is the existing one, unchanged and covered by the concordium package tests.

## Unsure / limits
- Binding is to an address string only; control of the address is not proven (stated in the UI).
- Only `subjects[0]` is sent. A presentation with several credentials qualifies on the first.
- The challenge is consumed on a successful verification, before the agent call. An outcome-3 failure therefore needs a fresh proof. Deferring consumption until recording succeeds would avoid that but would let one proof be used for repeated attempts; I kept the existing semantics.
- The agent 503 for registry-behind is identified by body status; I did not run the real agent end to end here, so the mapping is tested against mocked replies shaped like the controller's.
- Existing mocked fetch tests do not cover a real timeout (90s).
