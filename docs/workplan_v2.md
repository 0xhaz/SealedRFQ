# Workplan V2: SealedRFQ × Concordium

Execution plan for the V2 architecture RFC, v0.5.0.
Target: Concordium Trusted Agents Hackathon, **2026-12-09 23:59 UTC**.

The RFC itself is deliberately not in this repository. It carries commercialisation and
go-to-market thinking that does not need to be in git history, so it is gitignored at
`docs/architecture_sealedRFQ_V2.md` and lives alongside the checkout rather than inside it. A
trimmed architecture document gets published at submission, which is what the hackathon checklist
asks for. Anything from the RFC that this plan depends on is restated here rather than linked, so
this file stands on its own for anyone who does not have it.

Written 2026-11-10. The architecture RFC decides *what*; this decides *in what order*, and records
what was checked rather than assumed.

## Where V1 actually stands

Checked on-chain today, because the retirement path depends on it and the RFC's G7 gate asks for it:

| Check | Result |
|---|---|
| Mainnet `rfqCount` | **0**. No tender has ever run on mainnet |
| `RFQRegistry` / `SealedRFQAdapter` / `AgenticCommerce` balances | **0 USDC each** |
| Testnet `rfqCount` | 6, from the walkthroughs |
| Customers | None |

So there is nothing in flight, nothing to migrate and nobody to notify. G7 is satisfied now, and
that is worth recording with a date, because it stops being true the moment somebody posts a real
tender.

The mainnet deployment stays exactly where it is. ADR-001 keeps it as an immutable reference, and
there is no upgrade to perform: V2 is a new deployment with new addresses, not a migration.

## Two constraints that set the order

**Concordium has no local chain.** Agent registration, CIS-8004 badges, CIS-8 key binding and
identity presentation are testnet-only. "Localhost first" therefore applies to the Arc V2 contracts,
PostgreSQL and the application, and the Concordium half has to be exercised against testnet from the
day it starts. Phases 2 and 3 are deliberately parallel for that reason.

**The dependency chain is long and mostly serial.** The permit cannot be signed before the proof is
verifiable, the Arc gate cannot be tested before the permit exists, and the vertical slice needs
both. Anything that slips in Phase 3 pushes everything behind it, so Phase 3 starts before Phase 2
finishes rather than after.

The hackathon brief reportedly opens its formal build window on 2026-11-19. Confirm whether work
before that date counts as eligible before relying on any of Phase 0 or 1 as submitted work.

## Phase 0: pause the live site (now, half a day)

The site currently invites anyone to post a tender against V1 contracts we are about to stop
developing. It should stop inviting that before anything else happens.

- [ ] Add a site status flag driven by an environment variable, defaulting to live so a
      misconfiguration cannot silently take the site down
- [ ] Block the **entry points to new commitments**: posting an RFQ, and committing or revealing a
      bid
- [ ] Keep **every exit path open**: `withdraw()`, deposit settlement, and anything that returns
      money already committed. G7 says a new deployment must not hide withdrawal paths, and a
      maintenance banner that also disables withdrawals is exactly the pattern it warns about. The
      balances are zero today, so this costs nothing and protects against the case where they are
      not
- [ ] Keep the whole audit surface readable: the board, tender pages, decision memos and
      `/audit/:id`. A project whose argument is that claims are checkable must not make them
      uncheckable while it rebuilds
- [ ] Say plainly on the page what is paused, why, and that the V1 contracts remain on-chain and
      readable

A banner alone is not enough. A user with the URL can still reach the form, so the gate belongs in
the pages that transact, not only in the header.

## Phase 1: application foundation on localhost (Nov 10 to Nov 22)

Everything here runs locally with no chain involved beyond `arc-anvil`.

- [ ] PostgreSQL schema for organizations, members, roles, invitations and wallet challenges
- [ ] Server-side tenant isolation with row-level security, plus the negative tests for it. G4 is a
      stop/go gate and tenant leakage is the kind of bug that is cheap now and fatal later
- [ ] Encrypted document store for RFI responses, credentials and files, with access keyed to
      organization membership rather than to URL knowledge
- [ ] `New Request` wizard covering RFI as a first-class type, and conversion from RFI to a
      separately versioned RFQ carrying `parentRfiId`
- [ ] Buyer copilot producing one RFI analysis and a draft RFQ with citations back to source
      documents
- [ ] Frozen rubric format and evidence snapshot format, versioned from the first commit

Exit condition: two tenants cannot see each other's documents through the API or by guessing a
document URL, and an RFI converts to a draft RFQ a human must approve.

## Phase 2: Arc V2 contracts on localhost (Nov 16 to Nov 29)

Starts before Phase 1 ends. The contracts are the long pole and do not depend on the wizard.

- [ ] `QualifiedRFQRegistryV2` with a qualification gate on `commitBid` and at award
- [ ] Concordium light client: finalization committee, epoch transitions, aggregate verification
      over `BLS.sol`. This replaces the signed permit as the source of eligibility
- [ ] Measure bulletproof verification gas before committing to on-chain proof checking
- [ ] Keep the qualification check behind an interface, so a signed attestor remains a drop-in
      fallback if the light client slips
- [ ] Invitation gate enforced on-chain, separately from qualification. ADR-006 is explicit that a
      UI invite list is not enforcement
- [ ] Unique-principal checks replacing wallet counting for minimum bidders and concentration
- [ ] Foundry property and fuzz tests: escrow conservation, refunds, deposit forfeiture, milestone
      claimability, timeout paths, unauthorized award
- [ ] Negative tests that matter more than the positive one: direct `commitBid` without a permit,
      expired permit, replayed permit, permit scoped to a different RFQ, revoked principal at award

Exit condition: a valid permit succeeds and every one of those five bypasses reverts, proved by
test, against a local chain.

## Phase 3: Concordium testnet (Nov 16 to Dec 2, parallel with Phase 2)

Testnet from day one, because there is no local option.

- [ ] SDK smoke test and a throwaway transaction, to find the integration surprises early
- [ ] Register the evaluator agent: real Agent Card, active CIS-8004 badge, committed card hash
- [ ] CIS-8 external key binding where the SDK supports it
- [ ] One supported identity or Web3 ID presentation with a fresh challenge and replay protection
- [ ] Qualification Agent: verifies the proof off-chain, then signs the Arc permit
- [ ] Capture CCDExplorer links for every registration as they happen, not at the end

Exit condition: G1 and G2. A badge verifies, a proof verifies with replay protection, and the
explorer links exist.

State the predicate honestly in the UI from the first screen that shows it. A verified Concordium
account is not company registration, purchasing authority or beneficial ownership, and the RFC is
blunt about this in four separate places.

## Phase 4: vertical slice (Nov 30 to Dec 5)

- [ ] Deploy V2 contracts to Arc testnet
- [ ] Wire the application to V2 and to the Qualification Agent
- [ ] Deterministic evaluator with cited observations and a reproducible score calculation
- [ ] Human approval that the model cannot bypass, plus one deliberately rejected unauthorized
      agent action kept visible as evidence
- [ ] One milestone escrow receipt with real transaction hashes
- [ ] Evidence dashboard linking both chains

Only after this works end to end, and only if there is time: the single optional Concordium x402
paid agent call. ADR-014 allows one rail, so the legacy Arc Gateway paid evaluation must be disabled
for V2 paid APIs rather than running alongside it.

Exit condition: the full slice runs twice in a row from a clean state.

## Phase 5: harden and submit (Dec 6 to Dec 9)

- [ ] Red-team the permissions and privacy surface: direct RPC, URL guessing, uninvited agents
- [ ] Confirm no PII, confidential proposal or reveal salt appears in any explorer, the repo or the
      demo recording
- [ ] Write the production caveats honestly, including what is fixture rather than issuer-backed
- [ ] Record the demo, three minutes or less, against transactions captured beforehand
- [ ] Submit by **2026-12-09 23:59 UTC**

## Stop/go gates

Carried from RFC §12.5 so they are checkable here. G1 to G5 are the ones that decide whether there
is a submission at all.

| Gate | Decides |
|---|---|
| G1 | Real Concordium agent registration and badge verification |
| G2 | Real identity semantics with replay protection |
| G3 | Arc V2 rejects an unqualified direct `commitBid` |
| G4 | Tenant isolation holds against API and URL attacks |
| G5 | Escrow invariants hold under property tests |
| G6 | Concordium x402, optional. Defer rather than ship a second Arc stack |
| G7 | Legacy safety. **Satisfied 2026-11-10**, recheck before retiring any interface |
| G8 | AI cannot award, release escrow or change criteria |
| G9 | Invitations cannot be bypassed by qualification alone |
| G10 | No unattended agent spending until the bypass is prevented in contract |
| G11 | No hard-coded jurisdiction, no implied legal certification |

If G10 cannot be met, demonstrate a human-approved delegated bid instead. That is a scope
reduction, not a failure, and the RFC anticipates it.

## What carries over from V1

Worth being concrete, because "revamp" can mean anything from a reskin to a rewrite.

**Reusable with changes:** the milestone escrow model and its pull-payment discipline; the
commit and reveal mechanics; the deterministic scoring engine; the attestation log; the indexer; the
document store; the Next.js application shell and the ledger theme.

**Replaced:** `RFQRegistry` becomes `QualifiedRFQRegistryV2`; `ProcurementPolicy` gains
unique-principal and invitation enforcement; wallet-based identity becomes organization membership
backed by PostgreSQL; the Arc Gateway x402 rail becomes the Concordium rail.

**Preserved untouched:** the mainnet deployment, as a reference. New addresses, new names, no
upgrade path, and the README keeps the V1 addresses labelled as legacy rather than deleting them.

## ADR-007 decided, 2026-11-10: verify the proof on Arc

**Option C.** Arc verifies Concordium's signatures itself. No trusted attestor, no signer to steal
a key from, and no "Arc trusts the signer" caveat in the submission.

This was taken against my recommendation, and the measurement that followed says the decision was
right and my advice was wrong. I had argued C meant building cross-chain verification
infrastructure before building any product. That was reasoning from the RFC's statement that Arc
"cannot natively verify Concordium's proof format", which was written without checking what Arc
actually supports.

### What the spike measured

Arc runs Prague, so EIP-2537 supplies BLS12-381 operations as precompiles. Probed on mainnet
rather than assumed: present, computing, and validating. The identity pairing returns 1 and
malformed points revert with `PrecompileError` instead of being waved through.

Concordium's cryptography lines up with exactly those precompiles. From concordium-base:
`pub type ArCurve = ArkGroup<G1Projective>`, so the identity layer's commitments and sigma
protocols are on BLS12-381 G1; and `aggregate_sig` implements IRTF draft-irtf-cfrg-bls-signature-04
with signatures in G1 and public keys in G2, verified by the pairing identity
`e(sig, g2) == e(H(m), pk)`. That is the precise operation `BLS12_PAIRING_CHECK` exists to perform.

`contracts/src/concordium/BLS.sol` implements it, and the test runs against forked Arc mainnet
state rather than a local EVM alone:

| | |
|---|---|
| One signature verified | **246,324 gas**, about **$0.005** at Arc's measured price |
| Of which hash-to-curve | 78,882 gas |
| Hash-to-curve output | byte-identical to concordium-base under Concordium's own DST |
| Wrong message, wrong DST, tampered signature | all refused |

Aggregation is what makes this comfortable rather than merely affordable: BLS aggregates, so a
finalization committee of any size verifies in one pairing check plus a G2 addition per key.

### What is still genuinely hard

Three things, none of them the pairing arithmetic that worried me:

1. **ed25519.** Web3 ID presentations are signed with an ed25519 holder key and there is no
   precompile for it. Either implement a verifier in Solidity, or bind wallet possession through an
   Arc signature instead, which the RFC already recommends doing independently of the proof.
2. **Bulletproof gas.** Range proofs are log-sized multi-scalar multiplications. `G1MSM` makes them
   far cheaper than a loop, but the number is unmeasured. It needs its own spike before anything
   depends on it.
3. **Committee tracking.** Verifying a signature is settled; knowing *whose* signature to expect
   across epochs and stake changes is the actual light-client work, and it is ongoing rather than
   one-off.

A fallback that keeps the decision safe: the qualification check sits behind an interface, so if
the light client slips, a signed attestor can be dropped in without touching the registry. That is
option A as a contingency rather than as the plan.

## Decisions still needed

These are open in the RFC and block specific tasks rather than the whole plan.
1. **ADR-004:** one evaluator badge for the MVP, or a badge per operational role. The RFC recommends
   one. Blocks Phase 3 registration
2. **ADR-005:** whether any low-value award may complete without a human. Blocks the approval
   threshold in Phase 4
3. **ADR-009 and ADR-010** are open but do not block the hackathon

## Honest risk

The largest is Phase 3. Everything financial depends on a permit that depends on a proof that
depends on SDK behaviour nobody here has exercised yet. The smoke test is scheduled first for that
reason, and the fallback is a clearly labelled integration fixture, which the RFC permits and which
costs credibility rather than the submission.

The second is scope. The RFC describes a product considerably larger than four weeks. The P0 list is
the submission; P1 and P2 are not, and should be cut without discussion if P0 is not running twice
in a row by December 5.
