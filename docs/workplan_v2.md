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

- [x] `QualifiedRFQRegistryV2` with a qualification gate on `commitBid`. **G3 met for commit**: a
      tender that demands a Concordium check refuses an unqualified bidder calling the contract
      directly, with no front end in the path. The gate sits in `_screenBidder`, which both commit
      entry points reach, so there is no second way in.

      **And at award.** A qualification is time-bounded because the contract cannot see a
      revocation, so checking only at commit would let a supplier revoked the day after bidding
      still be paid. `_screenWinner` asks again when the money moves, and a winner whose
      qualification was withdrawn or has lapsed is refused. The tender survives: another qualified
      bidder can still win, which is tested, because a revocation should remove one bidder rather
      than the whole process
- [ ] Concordium light client: finalization committee, epoch transitions, aggregate verification
      over `BLS.sol`. This replaces the signed permit as the source of eligibility.
      Design sketched in [`light-client-design.md`](light-client-design.md) with the costs
      measured; four questions there need answering before implementation, the first being the live
      committee size
- [x] Bulletproof verification gas measured: about a cent for a 32-member set membership proof,
      so on-chain proof checking is affordable and the design is not cost-constrained
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

### Contract addresses, found by scanning rather than by reading

The documentation gives mainnet addresses only, and its testnet pages 404. Following it would have
led to the conclusion that the registries are mainnet-only, because the documented indexes hold
unrelated contracts on testnet. They are deployed; the addresses are simply not published.

| Contract | Mainnet | Testnet |
|---|---|---|
| CIS-8004 Agent Registry | index **10082**, subindex 0 | index **13042**, subindex 0 |
| CIS-8 External Key Registry | index **10081**, subindex 0 | index **12940**, subindex 0 |

Verified by querying both networks: the testnet instance reports `init_CIS-8004` with the same 21
entrypoints as mainnet, `register` among them. Found by walking testnet indexes down from the
highest, on the reasoning that a standard drafted in May 2026 would be deployed recently.

Testnet carries two CIS-8 instances, 12939 and 12940. 12940 is the later one and additionally
exposes `migrate`, so it is the one to use; 12939 looks like its predecessor.

### What the contracts turned out to require

Everything below was established by dry-running the deployed contracts, not by reading the
documentation, and three of the four findings contradict the obvious reading.

**Registration is permissionless.** A dry run of `register` from an arbitrary account succeeds, for
1,353 energy. There is an admin, but it is not a gatekeeper on registration. `registerExternalKey`
is likewise open.

**The key binding has to come first.** CIS-8004 refuses an `external_reference` whose key is not
already an active CIS-8 entry owned by the sender, with `InvalidExternalReference` (-7206). So the
order is: bind the key in CIS-8, then register the agent, and the contract enforces it rather than
merely recommending it.

**And on testnet it is refused anyway.** The CIS-8004 instance at 13042 stores
`cis8_contract = 10081` — the *mainnet* CIS-8 address. On testnet that index holds an unrelated
`init_contract`, so no `external_reference` is acceptable to it however correct the binding is.
Read out of the instance's own state after a correct, finalised binding was still refused; a scan
of the surrounding index range finds no other CIS-8004 on testnet. It also explains why the
registry's own reference agent carries `external_reference: None`.

The binding itself is unaffected: it is a CIS-8 fact, and `ownerOfKey` answers for it directly. So
the agent card states the key, its type, its namespace and its registry, and the verifier resolves
it through CIS-8 rather than through the agent's reference. The card is trusted only for where to
look — whatever key it names, CIS-8 must say this agent's owner owns it, so a card naming someone
else's key fails the check.

**The card hash needs a second transaction.** The card names the agent id, and the id does not
exist until `register` lands. Leaving `metadata_hash` as `None` — which is what the registry's own
reference agent does — means the card can be edited afterwards and the registration attests to
nothing but a URL. So: `register`, read the id, write the card, then anchor its hash with
`setAgentURI`.

**The namespace is serialised twice in the CIS-8 canonical message.** Once standalone as
`external_namespace`, then again as the first field of `external_key`. The specification's prose
says so and the contract confirms it: the single-namespace variant is rejected as `InvalidProof`,
an error that names no field. A test pins both halves of that, because the failure is otherwise
near-impossible to localise.

Two smaller ones. Reject reasons arrive as numeric codes with an empty return value, not as a
decodable error enum, and the codes have gaps (-7203, -7205, -7207, -7209, -7210 are unassigned),
so deriving a name from a variant's position in the enum silently mislabels everything after the
first gap. And CIS-8 checks that a public key is a real curve point, not merely the right length.

The CIS-8 instance verifies proofs against the **original** genesis hash, which is not the
current-era genesis the quorum certificate work signs against; both networks are on protocol 10, so
the two differ. The code reads it from the contract rather than assuming either.

### Binding the badge to the Arc key

The proof scheme is `ethereum-personal-sign`, so the key proved to CIS-8 is the same secp256k1 key
Arc grants `EVALUATOR_ROLE` to. That makes the Concordium badge and the Arc signing identity
checkably the same entity instead of two unrelated registrations that merely share a project name.

- [x] SDK smoke test: schemas lifted from the deployed module's own `concordium-schema` section,
      then checked by dry-running every entrypoint we send. `CCD_LIVE=1` runs those eleven tests
      against testnet; they distinguish a refusal on the merits from `ParseParams`, so a module
      upgrade that changes a parameter stops the suite instead of producing a transaction the
      contract rejects
- [x] Agent Card built by one pure function, so the bytes served at
      `/.well-known/agent-card.json` and the bytes hashed by the registration script cannot drift.
      Canonical JSON, served verbatim rather than re-serialised by the framework
- [x] `register-agent.mjs`: all three transactions, each dry-run before it is sent, stopping on a
      rejection rather than paying to discover the same thing on chain
- [x] `verify-agent.mjs`: checks the badge the way a stranger would, from an agent id alone. Run
      against the registry authors' own reference agent it reports the two gaps that really exist
      there — no anchored card hash, no key binding
- [x] A dedicated evaluator key, `CCD_EVALUATOR_PK` in `.env.testnet`, address
      `0x82d0ab44cbdd811e6836c7f88ff6ecb094d26774`. Not a reused role key: a CIS-8 binding can be
      taken over by whoever holds the private key, because the specification lets one account
      replace another as the active owner, and the only refusal is `AlreadyRegistered` for the
      same caller. Binding a key from the compromised testnet set would let a stranger claim the
      agent's key whenever they chose
- [x] **Registered. G1 met.** SealedRFQ is agent **1** in CIS-8004 on Concordium testnet, Active,
      owned by `4DBCxp3GVDmTwtB1Z718ojSCEy1eBp6oJ7RrNTJk8BUsJn7FGb`, with the SHA-256 of its agent
      card anchored on chain and matching the bytes the site serves. `verify-agent.mjs 1` passes
      all ten checks from an agent id alone, trusting neither our record nor the card's claims
      about itself.

      Test CCD comes from the wallet — Accounts, the account's Activity page, *Request CCD* —
      once per account and only while it has no incoming transactions. A testnet identity needs no
      real ID; pick the Concordium testnet identity provider.
- [x] Capture the CCDExplorer links as they happen
- [x] Presentation verification, with the challenge handling G2 asks for. Five checks, and the
      fifth is the one that is easy to omit: `verifyPresentation` returns whatever the proof
      actually proves, not what was asked for, so the proved statements are compared against the
      requested ones. Without that a holder can answer a question nobody asked — membership of a
      set containing every country — and have it accepted as the real predicate.

      Replay protection is two layers. The challenge seeds the Fiat-Shamir transcript, so a proof
      made for one challenge cannot be presented under another; that is cryptographic and needs
      nothing from us. Replaying the same proof under the same challenge is not prevented by
      anything in the proof, so the challenge is single-use and short-lived. It is verified first
      and consumed afterwards, atomically: verifying first means invalid garbage cannot burn a
      challenge a holder is entitled to retry with, and consuming last means two identical
      presentations racing cannot both win.

      The store is Postgres, not memory. On a serverless deployment each invocation has its own
      memory, so a challenge issued by one request would be unknown to the next and the symptom
      would be intermittent "unknown challenge" errors rather than anything resembling a missing
      store. Single use is enforced in the WHERE clause of a conditional UPDATE, proven by a test
      that claims one challenge eight times concurrently and expects exactly one winner.
- [x] The browser-wallet request flow: `/qualify` asks the wallet for a proof, and
      `/api/concordium/{challenge,verify}` issue and check it. Both routes import one statement
      from one place, because a request and a check that could drift would mean verifying a
      question nobody asked while still appearing to work.

      The statement proves residence or registration inside the tender's jurisdiction by set
      membership rather than by revealing the country: in a thin market, revealing where a losing
      bidder is established can identify them.

      Smoke-tested against the live routes and the real database. A malformed presentation, a
      challenge issued for another tender and a challenge never issued are each refused with their
      own reason, and none of them spends the challenge.
- [ ] Drive it with a real wallet. Everything up to the wallet prompt is exercised; producing a
      proof needs a Concordium identity in the browser extension, which is a manual step
- [x] The pieces the Qualification Agent is made of. `fetchFinalityProof` assembles a real quorum
      certificate — the certified block, the committee in force for *its* reward period, the
      signer bitmap and the aggregate signature, decompressed for EIP-2537. A live test verifies
      the result cryptographically with an independent implementation, so a mistake in assembling
      the committee or the bitmap surfaces here rather than as a reverted Arc transaction.

      That test also pins the genesis distinction: the certificate verifies against the
      **current-era** genesis and does **not** verify against the original, while the CIS-8
      registry commits to the original. Both networks are on protocol 10, so the two differ, and
      confusing them fails silently.

      `deriveNullifier` is HMAC over a server-held secret, scoped per tender: stable for the same
      prover so a second wallet collides, unlinkable across tenders, and one-way so an on-chain
      value does not identify a supplier. It binds a *credential*, not a person — one Concordium
      identity can back several, so this resists casual duplication rather than a deliberate sybil.
- [x] **V2 deployed to Arc testnet**, and the badge's claim made true. The key bound in CIS-8,
      `0x82D0ab44CBdd811E6836C7F88ff6eCb094D26774`, now holds `EVALUATOR` on the attestation log,
      so the agent that holds the Concordium badge and the key Arc records decisions from are the
      same key, checkably.

      | Contract | Address |
      |---|---|
      | `ConcordiumEpochRegistry` | `0xf5c335a603193ca5CBb93b6362510d022F264EA6` |
      | `ConcordiumQualifier` | `0xfF49A3A89739b390161Be11F57dd5c945647C334` |
      | `QualifiedRFQRegistryV2` | `0x24cedDfcBd0E63829a561fb5c701a9Dc4430FF6c` |

      Only these three were deployed. The policy, attestation log and escrow adapter already on
      this chain are reused: redeploying them would orphan the evidence V1 produced and change
      nothing about how V2 behaves.

      The Concordium testnet committee for period 271 is registered and `periodsBehind` reads 0.
      **It must be re-registered every reward period, which is 24 hours.** The registry is
      fail-closed, so a period with no committee refuses every certificate — the intended failure,
      and still one that needs someone to notice. `scripts/concordium/update-committee.mjs` does
      it, refusing to register against a period the registry disagrees about.
- [ ] Wire the Qualification Agent end to end: verify a presentation, derive the nullifier, call
      `recordQualification`. Every piece exists and is tested; what is missing is the agent process
      that joins them
- [ ] Capture CCDExplorer links for every registration as they happen, not at the end

### Evidence

| What | Transaction |
|---|---|
| CIS-8 `registerExternalKey` — binds the evaluator key | [`2223b6f8…9148b`](https://testnet.ccdexplorer.io/testnet/transaction/2223b6f821569e613fed7950ddf5633d95ce4712b9413eb3bea23a01cbe9148b) |
| CIS-8004 `register` — mints agent 1 | [`eb5305bf…85d37`](https://testnet.ccdexplorer.io/testnet/transaction/eb5305bf7d6aceda1285ecc7a9f2ba447da7749013298bb27b64cac0baf85d37) |
| CIS-8004 `setAgentURI` — anchors the card hash | [`a872ab1c…821a1`](https://testnet.ccdexplorer.io/testnet/transaction/a872ab1c6a792362f153807ef0e1eb031b017aa753e1aa98de7b50bb749821a1) |

Account: [`4DBCxp3G…n7FGb`](https://testnet.ccdexplorer.io/testnet/account/4DBCxp3GVDmTwtB1Z718ojSCEy1eBp6oJ7RrNTJk8BUsJn7FGb) ·
Registry: [13042](https://testnet.ccdexplorer.io/testnet/instance/13042/0) ·
Card: `https://www.sealedrfq.com/.well-known/agent-card.json`, SHA-256
`dc12f239397f6af32010bdc2f26b31e154958240809afd9c74874418f4162e12`

A fourth transaction,
[`2adbb408…b5295`](https://testnet.ccdexplorer.io/testnet/transaction/2adbb4085ba39adadfc66893601257d913e6e0d77c49ae01750a31e2c15b5295),
re-anchored the same hash on a re-run. It changed nothing and cost a fee to do it, because the
script noticed the agent already existed but did not compare the hash before setting it. Fixed:
re-running the script now performs no transactions at all.

Exit condition: G1 and G2. A badge verifies, a proof verifies with replay protection, and the
explorer links exist. **G1 is met.** G2 — a Web3 ID presentation with replay protection — is not.

State the predicate honestly in the UI from the first screen that shows it. A verified Concordium
account is not company registration, purchasing authority or beneficial ownership, and the RFC is
blunt about this in four separate places.

## Phase 4: vertical slice (Nov 30 to Dec 5)

- [x] Deploy V2 contracts to Arc testnet, granting `EVALUATOR_ROLE` to
      `0x82d0ab44cbdd811e6836c7f88ff6ecb094d26774`, the key bound in CIS-8. Until that holds, the
      badge demonstrates the binding mechanism while attesting to nothing: the claim it makes is
      that the agent controls the key Arc accepts recommendations from.
      Done in Phase 3; `/evidence` reads the role holder live, so the claim is checkable rather
      than recorded
- [ ] Wire the application to V2 and to the Qualification Agent
- [ ] Deterministic evaluator with cited observations and a reproducible score calculation
- [ ] Human approval that the model cannot bypass, plus one deliberately rejected unauthorized
      agent action kept visible as evidence
- [ ] One milestone escrow receipt with real transaction hashes
- [x] **Evidence dashboard linking both chains.** `/evidence` checks both halves when it loads
      rather than reciting a recorded pack: fourteen badge checks against Concordium, the Arc
      contracts read live, and the claim that joins them — that the key bound in CIS-8 is the key
      holding `EVALUATOR` on Arc — computed in the request by decompressing the secp256k1 point
      and hashing it, then compared against the role holder read off chain.

      The badge checks are the same function `verify-agent.mjs` runs, extracted to
      `packages/concordium/src/verifyAgent.ts`. Two copies would have drifted in a predictable
      direction: the page continuing to report a pass the script had stopped giving.

      Four outcomes stay distinct — verified, failed, absent and **unreachable** — because a
      dashboard that renders "we could not ask" as "the answer is no" is worse than no dashboard.
      Arc is read live and fails closed the same way: an unreachable RPC shows nothing rather than
      zeroes, since a zero `periodsBehind` and a false `hasRole` would read as a registry that had
      fallen behind and a role never granted.

      `periodsBehind > 0` is rendered as a failure, not a tick. The registry is fail-closed, so
      that state is the design working *and* an outage of the feature.

      Two defects surfaced while building it, both in the same family the project cares about.
      `biome check --write` reformatted the checked-in agent card fixture — 3036 bytes became 3508
      and its SHA-256 changed — so `**/test/fixtures/**` is now ignored by the formatter with a
      guard test that fails first and states why. And the committee stake, about 2.7e16 microCCD,
      is past `Number.MAX_SAFE_INTEGER`, so converting it through a double silently lost the low
      digits of the one figure on the page whose whole purpose is comparison against a node; it is
      integer arithmetic now, with a test pinning it against what the lossy version produced

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

1. **ed25519: avoidable, by choosing the credential type.** Concordium's `CredentialProof` has two
   variants and only one of them involves ed25519 at all.

   `Web3Id` carries a `holder: CredentialHolderId`, which is an ed25519 verifying key, and the
   presentation's `linking_proof` signs with it. `Account` carries only `cred_id` and `issuer`:
   no holder key, no signature, with the commitments living in the account's on-chain credential.
   The field comment in concordium-base is explicit that the linking proof holds "signatures from
   keys of Web3 credentials (not from ID credentials)".

   The RFC's suggested MVP predicate is an account-attribute one, so the MVP never touches
   ed25519. The light client has to read Concordium account state anyway, for the revocation
   freshness that motivated option C, so it is already fetching what an `Account` proof verifies
   against. Issuer-signed business credentials are `Web3Id` and would need a Solidity ed25519
   verifier, which is a known quantity and a post-MVP problem.

   **Confirmed 2026-11-10** in `web3id/proofs.rs`, which is where `Presentation::verify` actually
   lives rather than `mod.rs` where its doc comment points. The verifier opens with:

   ```rust
   let mut transcript = RandomOracle::domain("ConcordiumWeb3ID");
   transcript.add_bytes(self.presentation_context);
   transcript.append_message(b"ctx", &params);
   ```

   The challenge seeds the transcript before any proof is checked, so every Fiat-Shamir challenge
   derives from it and a proof is cryptographically bound to the context it was made for. Binding
   that context to the Arc bidder address therefore makes a proof unusable by anyone else, which
   is the non-transferability the whole eligibility gate rests on.

   The same function confirms the credential split from the code rather than the data structures:
   the ed25519 check is inside `if let CredentialProof::Web3Id { holder, .. }`, so `Account` proofs
   skip it entirely.

   It also binds `params`, the `GlobalContext`, into the transcript. The on-chain verifier needs
   the same cryptographic parameters Concordium used, which it reads through the light client.
2. **Bulletproof gas: measured, 2026-11-10, and affordable.** Concordium offers four statement
   types, and the RFC's suggested MVP predicate is jurisdiction membership, so `AttributeInSet` is
   the one that matters. Its verification reduces to one multi-exponentiation of about
   `2n + 2*log2(n)` G1 points, which `G1MSM` performs in a single call. Measured against forked
   Arc mainnet:

   | Set size | Points | Gas | USDC | Share of a 30M block |
   |---|---|---|---|---|
   | 32 members | 74 | 502,538 | $0.010 | 1.7% |
   | 64 members | 140 | 873,589 | $0.018 | 2.9% |
   | 256 members | 528 | 3,293,262 | $0.066 | 11.0% |

   The multi-exponentiation dominates; scalar arithmetic and the Fiat-Shamir transcript add
   perhaps a fifth again, since scalar work is native `mulmod` rather than precompile calls.

   So a jurisdiction predicate over a realistic country set costs about a cent to verify on-chain.
   `RevealAttribute` is cheaper still, needing only a commitment opening. Verification cost does
   not constrain the design, which is the answer this spike existed to get.
3. **Committee tracking.** Verifying a signature is settled; knowing *whose* signature to expect
   across epochs and stake changes is the actual light-client work, and it is ongoing rather than
   one-off. This is now the only unresolved risk in option C.

   Its scope grew slightly on inspection, in a way that is useful to know early.
   `Presentation::verify` carries an explicit warning: *"This only verifies the cryptographic
   consistency of the data. It does not check metadata, such as expiry. This should be checked
   separately by the verifier."* A valid proof therefore says nothing about whether the credential
   behind it is still valid. That is precisely the gap the RFC's revocation-freshness requirement
   names, and the light client is what closes it: the same component that reads account credential
   commitments also reads their current status. Proof verification and revocation checking are one
   piece of work, not two.

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
