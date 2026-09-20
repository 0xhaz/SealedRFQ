# Arc Microgrants (Circle × DoraHacks): Program Analysis & Build Recommendation

> Status: **FINAL for build** (locked 2026-09-20). Research snapshot 2026-09-19; standards check 2026-09-20. Sections are in the order they were written — "Decisions", "Standards alignment" and the "Consolidated contract set" table override anything earlier in the file where they differ.

## TL;DR
- **Build Option B — a sealed-bid tender/procurement dApp with USDC bid bonds and milestone escrow — not the invoice tool.** Invoicing is the single most saturated category in this program (roughly 15+ invoice/escrow/bounty submissions already target Arc mainnet), while tender/procurement is an uncontested white space with zero eligible competitors found, and it maps directly onto DoraHacks' stated "re-architecting B2B flows / trade finance" priority.
- **The clock is short and the bar is concrete:** submissions close **October 14, 2026, 23:59 ET** (~25 days from Sept 19), reviews are rolling with all decisions issued by **October 21, 2026** (earlier submissions get earlier answers); you must have a **live deployment on Arc mainnet** (chain ID 5042, USDC-as-gas), a public repo, a short description, and a public builder profile. Testnet-only builds, mockups, and slide decks are explicitly ineligible.
- **Grant economics are modest** (twenty microgrants of 500 USDC each from a 10,000 USDC pool) and the grants are non-dilutive with no equity, IP-transfer, or exclusivity requirements — so treat this as a fast proof-of-concept and a springboard to the larger Circle Grant Program. Malaysian e-invoicing/procurement domain expertise is the differentiator that makes a continuation story credible.

## Key Findings

### What "ARC" is
Arc is **Circle's own open Layer-1 blockchain, purpose-built for stablecoin finance**, with USDC as the native gas token. It is EVM-compatible (Reth execution client + Circle's Malachite BFT consensus), delivering deterministic sub-second finality, a built-in institutional FX engine (StableFX), and opt-in privacy on the roadmap. Public testnet launched October 28, 2025; Circle confirmed the mainnet date on August 5, 2026, and **mainnet went live September 16, 2026 — three days before today**, with eleven founding validators including BlackRock, DTCC, Visa, Mastercard, and ICE.

### The microgrant program
- **Sponsor:** Circle / Arc, run through DoraHacks.
- **Structure:** Twenty microgrants of 500 USDC each from a 10,000 USDC pool for proofs of concept, tiny apps, demos, prototypes, and technical experiments running on Arc mainnet. Paid in USDC on Arc. Non-dilutive; no equity, IP transfer, or exclusivity.
- **Selection:** Not quadratic/community voting. Submissions are screened for completeness, then shortlisted projects are scored and decided in batches by reviewers. **Rolling review** — earlier submissions get earlier answers.
- **Judging criteria (verbatim):** "Relevance to Arc, technical credibility, the quality of what you built, and whether the project is worth taking further. Promise counts for more than traction here. Microgrants reward the first proof."
- **Key dates:** Submissions close **October 14, 2026 at 23:59 ET**; all decisions issued by **October 21, 2026**. From Sept 19, about **25 days** to deadline.

### Eligibility & requirements
- **Who:** Indie developers, student teams, hackathon teams with something worth continuing, first-time founders, emerging infrastructure builders. No company, deck, roadmap, or traction required.
- **Geography:** No stated geographic restriction — Malaysia appears eligible. Payout requires a short verification step; Circle/Arc are US entities and sanctions screening applies. Verify before investing heavily.
- **Hard requirements:** (1) a live deployment on **Arc mainnet** with an openable link; (2) a public repo; (3) a short description of what it does and what it uses Arc for; (4) a public builder profile (GitHub, X, or Farcaster).
- **Not eligible:** design mockups, slide decks, **testnet-only builds**, projects with no Arc component, and **work already funded by a Circle or Arc program**.
- No explicit open-source license requirement beyond "public repo"; no mandatory demo video, pitch deck, or specific Circle product — but using Circle/Arc-native features clearly helps "relevance to Arc."

### Arc technical facts for building
- **Mainnet:** Chain ID **5042**, RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`, currency symbol USDC.
- **Testnet:** Chain ID **5042002**, RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`, faucet at `faucet.circle.com` (dispenses test USDC, EURC, cirBTC).
- **EVM compatibility:** Full. Solidity works; Foundry, Hardhat, viem, ethers all work. viem ships `arc` and `arcTestnet` as built-in chains.
- **Critical gotcha — USDC decimals:** Native USDC on Arc uses **18 decimals** as the native gas asset, while the ERC-20 USDC interface uses **6 decimals**; same balance related by 1e12. Multiple hackathon submissions flag this as the #1 integration trap.
- **Value-transfer rules:** Native sends can revert for protocol reasons (blocklist, zero address); Arc emits EIP-7708 Transfer events from a system emitter for native USDC moves. Finality is deterministic — drop Ethereum-style confirmation counters. `block.prevrandao` is always 0. Settlement is forward-only/irreversible — design refunds and disputes as new transactions.
- **Tooling:** Circle ships **Arc Foundry** (arc-forge/arc-cast/arc-anvil) because local anvil can't reproduce Arc's precompiles/EIP-7708/blocklist. Also: Arc Studio (AI contract generator), Arc App Kits (payments/swaps/onramps/yield SDK), Circle Wallets, Circle Contracts (pre-audited ERC templates), CCTP V2, Gateway, Paymaster — all with Arc support.
- **Arc-native primitives to showcase:** USDC-as-gas, sub-second finality, StableFX (USDC↔EURC RFQ FX engine — approved-institution gated), Nanopayments/x402 for agentic micropayments, opt-in privacy (in development, TEE-based with view keys — **not yet GA on mainnet**).
- **Sample apps that exist:** circlefin/arc-escrow (Next.js + Circle Wallets + AI-validated escrow), Arc Stablecoin FX, Arc Nanopayments, Arc Prediction Markets.

### The competition (decisive for the recommendation)
- **Invoice/payment/escrow/bounty is heavily saturated.** A GitHub/DoraHacks scan found ~15+ projects already targeting Arc mainnet for this program, including at least seven direct invoicing tools: elikem2021/arc-invoice, softalpha0/Arc-Invoice, rishu4436/final-arc, Paramchoudhary/Till, fusae/arc-split, dlkakbs/FlowPay, M4N4N22/arcdot — plus milestone-escrow tools (A-Raphie/troth, envexx/commit, elzuzu/otter-arc) and bounty boards (Sofiia7/ARC, sissokocheick/arc-bounty, YashMak-code/proofbounty-arc, Osfoce/Bounty_on_Arc_Network).
- **Tender/procurement is a white space.** No eligible on-chain tender, procurement, RFP, or bid-bond project on Arc mainnet was found. The only sealed-bid-auction-on-Arc reference (xseven0908) is testnet-only and therefore ineligible; Gamferno/sealed-bid-rfp is on Midnight Network, not Arc. juangh123/ArcProof is a paid document-extraction service, not a bidding platform.
- **DoraHacks explicitly wants B2B/trade flows.** The organizer's "Startup Ideas 2026" post (Steve Ngok, DoraHacks CSO) looks beyond payroll/merchant checkout toward re-architecting B2B flows, and headlines "Programmable Trade Finance" — importer locks USDC in an Arc escrow, an oracle triggers on cargo signed, the contract autonomously releases USDC. No Circle/Arc source explicitly names "tender," "procurement," or "sealed bid," but the B2B-settlement/trade-finance framing is unambiguous.

## Details

### Why Option A (invoice) scores worse here
Option A fits the themes on paper (stablecoin B2B payments, cross-border settlement), but fails the two criteria that matter most in a 500-USDC "first proof" contest: **differentiation and relevance-to-judges-who've-seen-it-already.** Invoice-to-USDC with pay-by-link and escrow is a solved template — Request Network / Request Finance, Bulla Network, and Sphere already do it in production off-Arc, and at least seven teams have cloned the pattern onto Arc mainnet for this exact program. Bolting a MyInvois reference onto a USDC invoice is a narrative, not a moat, and much of the compliance value (LHDN clearance, UUID/QR, UBL 2.1) lives off-chain in Malaysia's clearance model — hard to demo convincingly on Arc mainnet in 25 days.

### Why Option B (tender/procurement) wins
1. **Uncontested niche + judge-stated priority.** Likely the only procurement/sealed-bid project in the pool, and it directly answers DoraHacks' "re-architecting B2B flows / trade finance" call. Scarcity plus fit is the highest-leverage combination in a rolling, quality-judged microgrant.
2. **Arc-native features are load-bearing, not decorative.** A tender flow genuinely needs: USDC bid bonds (native USDC, sub-cent gas, no volatile collateral token), sub-second deterministic finality (bid acceptance and bond forfeiture must be final), milestone escrow with forward-only settlement, and — as the headline "why Arc" — **opt-in privacy / commit-reveal for sealed bids**.
3. **Domain expertise becomes a genuine moat.** Malaysia's **ePerolehan** is one of the world's largest G2B marketplaces — over 3,800 government agencies, 180,000+ registered suppliers, 2M+ transactions annually worth RM21B+. Plus the anti-corruption/transparency framing. The SME-factoring angle (ePerolehan already supports a tri-party paymaster/borrower/financier framework) is a natural post-hackathon extension into supply-chain finance — the "worth taking further" story.
4. **Reuse proven primitives.** Milestone escrow and worker-bond mechanics are already demonstrated working on Arc mainnet (envexx/commit, Sofiia7/ARC) — recombining validated building blocks into a product nobody has built.

### Recommended scoped concept
**"SealedTender on Arc" — a sealed-bid procurement flow with USDC bid bonds and milestone-based escrow settlement.**

MVP loop: Buyer posts a tender (title, scope, deadline, bond amount) → suppliers submit **commit-reveal sealed bids** and post a **USDC bid bond** → after the deadline, bids reveal, buyer awards → winner's bond rolls into a **milestone escrow**; losers' bonds auto-refund → buyer releases USDC per milestone; timeout/refund paths protect both sides.

"Why Arc" framing: USDC-native bonds, sub-second final awards, sealed-bid confidentiality (commit-reveal now, aligned to Arc opt-in privacy later).

Optional flourish: Peppol/PINT-MY-style structured award document hash anchored on-chain; StableFX/EURC nod for cross-border (MY↔SG/ID) bids.

### Suggested MVP feature list
- Solidity contracts (Foundry): `TenderRegistry`, `SealedBid` (commit-reveal), `BidBond` (post/forfeit/refund), `MilestoneEscrow` (fund/release/refund/timeout). Reentrancy guards; handle Arc's native-USDC value rules and 18/6 decimal split correctly.
- Next.js + wagmi/viem frontend; connect wallet, switch to Arc (chain 5042); create tender, commit bid, reveal, award, release milestone — live on-chain state.
- Deployed and verified on **Arc mainnet**; tx hashes and contract addresses in README.
- 2–3 minute demo video: one full tender → bond → award → milestone-release cycle on mainnet with the explorer open.
- README naming the real-world wedge (ePerolehan / SME procurement / anti-corruption transparency) and the Arc features used.

### Build plan / timeline (Sept 19 → Oct 14)
- **Days 1–3 (Sep 19–21):** Arc Foundry + testnet setup; faucet USDC; deploy a "hello" contract to nail the 18/6 decimal and native-value gotchas. Lock contract interfaces.
- **Days 4–10 (Sep 22–28):** Build and unit/fuzz-test the four contracts on Arc testnet. Risk-heavy core — do it first.
- **Days 11–17 (Sep 29–Oct 5):** Next.js frontend, wallet connect, full happy-path UI + read-side event indexing.
- **Days 18–22 (Oct 6–10):** Deploy to **Arc mainnet**, verify, run a real end-to-end tender with small USDC amounts; capture tx hashes. Polish README + one-liner.
- **Days 23–24 (Oct 11–12):** Record demo video; write BUIDL page; public builder profile. **Submit early (by ~Oct 12).**
- **Day 25 (Oct 13–14):** Buffer for instability, fixes, resubmission.

### Submission checklist
- [ ] Contracts live on Arc mainnet (chain 5042), addresses public
- [ ] Public GitHub repo with clear README (what it does + what it uses Arc for)
- [ ] Openable live app link
- [ ] Public builder profile (GitHub/X/Farcaster)
- [ ] Short description on the DoraHacks BUIDL page
- [ ] (Recommended) 2–3 min demo video
- [ ] Submitted well before Oct 14, 23:59 ET

## Recommendations
1. **Commit to Option B (SealedTender), scoped to the MVP above.** If too heavy for 25 days solo, **fall back to a merged minimal concept: "USDC bid-bond + milestone-escrow contract"** (drop commit-reveal, keep bonds + escrow) — still avoids the invoice crowd, still procurement-flavored.
2. **Do the contract core first, on testnet, in week one.** The 18/6 decimal and native-value-revert semantics are the real risks. Use Arc Foundry, not vanilla anvil.
3. **Submit early (target Oct 11–12).** Rolling review rewards early submissions and buys a second review window if something breaks.
4. **Lean on the domain story in README/BUIDL page.** ePerolehan, SME procurement pain, transparency/anti-corruption angle, supply-chain-finance continuation.
5. **Thresholds that change the plan:** If Arc mainnet is unstable or mainnet USDC for gas isn't reliably available by ~Oct 5, pivot to the bond+escrow fallback to guarantee a working mainnet deployment. If a competing procurement project appears on the BUIDL list, double down on Malaysia/ePerolehan specificity.

## Caveats
- **Grant is small (500 USDC) and not guaranteed** — 20 grants only. Value is the proof + the door to the larger Circle Grant Program.
- **Mainnet is 3 days old.** Expect RPC hiccups, wallet UX warnings (MetaMask flags USDC-as-gas symbol mismatch), thin tooling. Budget buffer time.
- **Real USDC on Arc mainnet is needed for gas** (deployment reportedly well under $0.10, but must bridge/acquire some). Faucet is testnet-only.
- **StableFX and some Circle products may require KYB / approved-institution access.** Don't make the MVP depend on a gated API; core is plain native-USDC contract logic, Circle SDKs are optional enhancements. (CCTP, Gateway, Paymaster are permissionless.)
- **Opt-in privacy is not yet GA on mainnet.** Implement sealed bids via commit-reveal; describe Arc privacy as the future path, not a current dependency.
- **Payout verification / geography:** No geographic restriction stated and Malaysia is not sanctioned, but confirm the verification step can be completed.
- **Competition count (~15) is a lower bound** — DoraHacks doesn't expose a complete public BUIDL list.
- Some Arc technical parameters (RPC hosts, StableFX access terms) come from third-party sources; verify against `docs.arc.io` before relying on them.

## Ideas ported from Faktura (Casper Agentic Buildathon 2026 winner)

Faktura's win came from its *agent governance* pattern, not the factoring product. Port the pattern; do not port the receivables (invoicing is the saturated category here).

### Port — high payoff, directly serves Arc judging criteria
1. **"AI proposes, the contract disposes" → `ProcurementPolicy`.** On-chain, admin-set, enforced in `award()` / `releaseMilestone()`: max award vs. published budget, min bidder count, bond-to-bid ratio (bps), hash of the published scoring rubric, award window, per-supplier concentration cap. AI evaluator scores bids off-chain; contract reverts with typed errors (`AwardExceedsBudget`, `InsufficientBidders`, `RubricMismatch`) if violated. Demo preset: **"Policy firewall"** — AI recommends an over-budget award, contract reverts, failed tx linked. Framed as *anti-corruption by construction*.
2. **Attestation log for every AI decision.** `attest(actor, kind, subjectId, payloadHash, model, ts)` — SHA-256 of each bid-evaluation memo and the award justification anchored on Arc, for approvals *and* rejections. Tamper-proof "why this supplier won" audit trail — the ePerolehan/transparency narrative with teeth. Provide a `verifyDecisionHash` path (re-hash memo, compare on-chain).
3. **Least-privilege agent keys (roles).** `EVALUATOR` (scores + attests; cannot award), `AWARDER` (awards within policy only), `VERIFIER` (confirms milestones; can only release, never award or refund bonds), `ADMIN` (rotates keys, sets policy). Typed errors on every mutating entrypoint.
4. **Evidence pack + Judge Mode.** Reuse the `DORAHACKS.md` pattern: one explorer-linkable Arc mainnet tx per lifecycle step (create → commit → reveal → attest → award → bond refund → milestone release → policy revert). Live "judge mode" presets with small-capped, budgeted demo keys; safe showcase as fallback. Arc's sub-second finality makes live mode far snappier than Casper's 30–120 s blocks.
5. **x402 oracle — stronger on Arc than on Casper.** Arc has native Nanopayments/x402. Sell a pay-per-call **supplier risk / bid-evaluation report** in USDC over HTTP 402. Hits Circle's agentic-commerce priority → "relevance to Arc."

### Stretch / post-hackathon
6. **MCP server** — see "Agent interface (MCP)" section below for the full design and sequencing.
7. **Liquidity pool → surety pool.** LPs underwrite bid/performance bonds for SMEs who can't lock capital; yield accrues to share price. Or SME award-financing after award. Continuation story only — too heavy for 25 days.
8. **Mock-LLM fallback** (`LLM_PROVIDER=mock`) so the pipeline demos without a key — cheap, worth keeping.

### Cautions
- Keep product identity firmly "sealed-bid procurement"; the agent layer is the *how*, not the *what*.
- Faktura is Rust/Odra + a heavy livenet CLI; on Arc everything is rewritten in Solidity/Foundry + viem. Treat Faktura as a design reference, fresh repo, fresh code. Eligibility is fine (Casper-funded, not Circle/Arc-funded).
- Revised contract set: `TenderRegistry`, `SealedBid` (commit-reveal), `BidBond`, `MilestoneEscrow`, **`ProcurementPolicy`**, **`AttestationLog`**, **`Roles`** (or fold Roles into an access-control base).

## Decisions (locked 2026-09-19)

- **Target: private B2B procurement, US-based companies as the demo persona.** No government/region-specific framing — avoids public-procurement protocol baggage and keeps the pitch aligned with Circle/DoraHacks' "re-architecting B2B flows" language. "US-based" shapes demo personas, currency assumptions and copy only; nothing on-chain is region-restricted and the README does not exclude other regions.
- **Vocabulary:** use US private-sector terms — **RFQ/RFP → sealed bid → award → PO/milestones**. Product working name: **"SealedRFQ on Arc"** (was "SealedTender"). The refundable stake is a **bid deposit** (not "bid bond" — reads as government/construction).
- **Malaysia / ePerolehan / e-invoicing expertise** moves to the continuation ("worth taking further") paragraph as credibility and a future market — not the wedge.
- Demo personas: a US mid-market buyer (e.g. a logistics or SaaS company sourcing a vendor) and 3 US suppliers; amounts in USDC, single-currency. StableFX/EURC stays out of code.
- **Settlement asset: Arc native USDC via its ERC-20 interface at `0x3600000000000000000000000000000000000000`** (6 decimals, `safeTransferFrom` in, pull-payment `withdraw()` out). *Reversed on 2026-09-20 from `msg.value`* — see "Standards alignment": ERC-8183 requires an ERC-20, Arc's own tutorial does it this way, and 6-decimal math sidesteps the 18-decimal native trap. Approve-tx UX solved with ERC-2612 `permit` if the USDC precompile supports it (verify day 1) or EIP-7702 batching; fallback is one approve per persona in the demo. Reverted transfers to blocklisted recipients are handled by the pull-payment design (funds park in the contract until claimable).
- **Demo amounts are tiny by design** (mainnet, real USDC — the faucet is testnet-only): RFQ budget 3.00 · bid deposit 0.25 × 3 suppliers · milestones 1.00 × 3 · policy-revert preset + retries ~2.00 buffer. Total float ≈ 10–15 USDC across keys; most of it cycles back (deposits refund to losers, milestones pay the winner). Gas is sub-cent. Testnet faucet USDC is for hardening the native-value paths before mainnet.
- Mainnet USDC sourcing (day 1–3 task): CCTP V2 from Base/Polygon/Ethereum, or a CEX that supports Arc withdrawals. Confirm with a few dollars before anything else.

- **Milestone release authority = the ERC-8183 `evaluator` role.** Per milestone job: buyer is `client`, winner is `provider`, evaluator is the `VERIFIER` key for the demo; roadmap: an evaluator *contract* that accepts buyer sign-off, times out to auto-release, and lets an `ARBITER` split on dispute. (Closes former open question #2.)

- **Commit-reveal sealed bids are in the MVP.** `SealedBid` is small and self-contained (`commit(hash)`, `reveal(price, days, salt)`, forfeit on no-reveal) and is the headline privacy hook. Open-bid fallback remains the late-stage panic switch only.
- **Evaluator: mock-first, LLM swap-in.** Scorer sits behind `score(rfq, bids, rubric) → memo`; deterministic rubric scorer proves the contract + attestation path; Anthropic/OpenAI key plugs in for the demo video. Decide which the video shows on ~Oct 5.
- **Wallet: MetaMask with custom Arc network first.** Circle Wallets (embedded) only if week 3 is calm — scores "uses Circle products" and avoids the USDC-as-gas symbol warning.
- **ERC-8183: write our own minimal `AgenticCommerce` from the spec** (~200 lines) rather than pull a reference implementation — draft-status standards have divergent implementations; we control the hook surface.
  - *Revised 2026-09-20:* Arc's own testnet ERC-8183 deployment (`0x0747EE…4583`, verified) turned out to be the EIP's reference implementation. We now **port that reference, ABI-identical**, so Arc tooling decodes our instance the same way. Deltas: not upgradeable; `setBudget` callable by client or provider (EIP text). The adapter is each job's client + **evaluator** + hook, which is what makes on-chain auto-release possible.
- **Repo: monorepo** — `contracts/` (Foundry), `apps/web` (Next.js), `apps/agent` (NestJS), `packages/mcp`.
- **Hosting:** Vercel for web; agent service on the existing Faktura nginx box (fastest) or Railway/Fly.
- **Name:** build under `SealedRFQ`; brand later.

## Day-1 verification checklist (before any feature code)

- [ ] Mainnet USDC sourcing path from Malaysia (CCTP V2 or a CEX with Arc withdrawals) — move a few dollars end-to-end.
- [ ] Does the `0x3600…` USDC precompile support ERC-2612 `permit`? Decides approve UX (permit → 7702 batch → plain approve).
- [ ] ERC-8004 registry addresses on Arc **mainnet** (testnet known; may not exist yet → deploy own singleton).
- [ ] Foundry contract verification against explorer.arc.io.
- [ ] DoraHacks payout verification requirements; whether the BUIDL page has a video field.
- [ ] Name collisions for "SealedRFQ" on DoraHacks / GitHub.
- [ ] Solo builder profile (GitHub/X) chosen; `axiqo.xyz` subdomain vs. fresh domain.

## Standards alignment (checked 2026-09-20)

Build on recognised standards rather than a bespoke escrow — reviewers scoring "technical credibility" and "relevance to Arc" will know these.

### ERC-8183 — Agentic Commerce Protocol (Draft) — **adopt as the milestone escrow core**
- Job lifecycle `Open → Funded → Submitted → Completed | Rejected | Expired`; roles `client` / `provider` / `evaluator`; `createJob`, `setBudget`, `fund`, `submit(deliverable)`, `complete(reason)`, `reject(reason)`, `claimRefund`; typed events; optional `IACPHook` `beforeAction` / `afterAction`; ERC-2771 + ERC-2612 support for gasless / x402-signed flows. Single ERC-20 token per contract.
- **Arc has an official tutorial running ERC-8183 on Arc with native USDC via the ERC-20 interface** — strongest available signal of what Circle/Arc reviewers expect.
- Gaps we fill in an adapter: **no milestones** (→ one ACP job per milestone, parented by the RFQ), **no disputes** (→ evaluator contract with `ARBITER` split), **no deposits / retention / buyer stake** (→ adapter holds them; retention released on final milestone via `afterAction` hook).
- `submit(deliverable)` + `complete/reject(reason)` map one-to-one onto our evidence-based release; `reason` strings carry the memo hash → attestation log becomes partly native.
- Contract set update: `MilestoneEscrow` → **`SealedRFQAdapter` wrapping an ERC-8183 `AgenticCommerce` instance**; adapter implements `IACPHook` for retention + performance-stake release.

### ERC-8004 — Trustless Agents (Draft) — **adopt for supplier identity + reputation**
- Identity Registry (ERC-721 `agentId`, endpoints incl. MCP/A2A), Reputation Registry (client feedback + tags, off-chain detail files with hashes), Validation Registry (hash-committed validation requests, 0–100 responses).
- Deployed on Arc **testnet** (Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`); mainnet addresses to verify.
- Replaces most of our custom `SupplierRegistry`: suppliers register an `agentId`; our hash-only qualification attestations (`KYB_VERIFIED`, etc.) go to the **Validation Registry** from the `ATTESTOR`; buyer posts **Reputation** feedback on milestone acceptance → the Tier-3 "supplier reputation" roadmap item becomes near-free. Keep a thin `SupplierRegistry` only for RFQ-specific gating (`requiresQualification` reads the Validation Registry).
- If mainnet registries aren't live by ~Oct 5, deploy our own singleton per the spec and note it.

### EIP-7702 — smart EOAs
- Batch `approve + fund` (or `approve + submitBid`) into one user op → removes the extra approval tx from the demo without `msg.value`. viem supports it natively. Optional; use only if the wallet in the demo supports it.

### EIP-7708 — native transfer logs (already in Arc)
- Arc emits Transfer events for native USDC moves from a system emitter. Indexer should read both these and the ERC-20 `Transfer` from `0x3600…` — do not double-count.

### Field lessons from ERC-8183/8004 builds on Arc
- The one existing Arc microgrant entry using both standards explicitly **rejects `msg.value`** and uses the ERC-20 interface — matches our reversal.
- It needed a `_payOrPark` fallback for blocklisted recipients — our pull-payment `withdraw()` covers this by design.
- **Arc testnet `block.timestamp` has episodically run faster than wall-clock**, lapsing deadlines early. Use generous windows on testnet (days, not minutes) and never derive demo timing from testnet clocks; mainnet is expected to be well-behaved but verify on day 18.

### Not adopted
- ERC-6506 (escrowed governance incentives) — unrelated domain.
- Older "ERC-2000 escrow token" issue — never advanced.
- Kleros / on-chain courts — roadmap for the `ARBITER` role, not MVP.

### Consolidated contract set (supersedes the per-section "impact" notes above)
| Contract | Role | Origin |
|---|---|---|
| `RFQRegistry` | RFQ metadata, `rubricHash`, windows, funded-before-open, category/region, invite allowlist, `requiresQualification` | ours |
| `SealedBid` | commit-reveal bids, reveal-window forfeiture | ours |
| `BidDeposit` | USDC deposits: refund / rollover-to-performance / slash | ours |
| `AgenticCommerce` (ERC-8183) | one job per milestone: fund / submit / complete / reject / refund | standard |
| `SealedRFQAdapter` (`IACPHook`) | ERC-8183 client + evaluator + hook per milestone job; retention/holdback, buyer stake, performance-stake release, acceptance auto-release, delivery deadline (hook), dispute → `ARBITER` split, pull-payment `withdraw()`; 🔶 dynamic discount | ours, around the standard |
| `ProcurementPolicy` | on-chain caps enforced in `award()` / hook `beforeAction` | ported from Faktura |
| `AttestationLog` | AI decision hashes (evaluations, awards, rejections) | ported from Faktura |
| ERC-8004 registries | supplier `agentId`, qualification via Validation Registry, reputation on acceptance | standard (use deployed, else own singleton) |
| `SupplierRegistry` (thin) | RFQ-gating reads over ERC-8004 | ours |
| `Roles` | `ADMIN`, `EVALUATOR`, `AWARDER`, `VERIFIER`, `ATTESTOR`, `ARBITER` | ours (OZ AccessControl) |

## Procurement feature map

Legend: ✅ committed (MVP) · 🔶 committed if core lands by ~Oct 5 · 📋 README roadmap only

### Tier 1 — cheap, strengthens the core demo (✅ all committed)
- ✅ **Weighted scoring rubric, published before bids open** — price / delivery / quality weights, `rubricHash` stored at RFQ creation; AI evaluator must score against it; attestation proves it did. Core anti-manipulation story.
- ✅ **Bid deposit → performance deposit rollover** — winner's deposit becomes a performance stake, released with final milestone or slashed on abandonment.
- ✅ **Retention / holdback** — buyer withholds e.g. 10% of each milestone until final acceptance.
- ✅ **Acceptance window with auto-release** — buyer has N days to reject a milestone; silence = release. Also a demo preset ("timeout release").
- ✅ **Award timeout / no-award refund** — if buyer never awards, all deposits auto-refund after the window.

### Tier 2 — meaningful, weeks 2–3 if on schedule
- 🔶 **Dynamic discounting (early-payment discount)** — supplier offers X% off for immediate release vs. waiting; buyer accepts on-chain. Best "why stablecoins" story that isn't an invoice app. **Committed.**
- 🔶 **Supplier qualification registry** — minimal on-chain vendor profile + `ATTESTOR` role stamping hash-only attestations (KYB verified, insurance on file); RFQs can require qualification. Ties to Circle Compliance Engine narrative without depending on it. **Committed.**
- 📋 Clarification round (Q&A) — buyer answers questions publicly, answers hash-anchored so all bidders provably saw the same info.
- 📋 Change orders — buyer proposes scope/price delta → supplier accepts → escrow re-funds the difference.
- 📋 Dispute → `ARBITER` role — single-call escrow split; no full arbitration flow.

### Tier 3 — roadmap / continuation story (📋 all)
- Reverse auction mode (open descending-price) as an alternative to sealed bids.
- Multi-lot RFQs and framework agreements (award a rate card, then call-off POs).
- Liquidated-damages schedule (auto-deduct for late milestones).
- Award-backed supplier financing — Faktura's pool reframed: LPs advance against an awarded PO; 3-way match PO ↔ milestone acceptance ↔ payment. Roadmap only, to keep the product procurement-first.
- Supplier reputation derived from on-chain history (on-time milestones, disputes lost).
- Agentic suppliers — MCP tools to qualify, ask questions, and bid on a supplier's behalf.

### Impact on contract set
`TenderRegistry` → rename **`RFQRegistry`** (holds `rubricHash`, windows, required-qualification flag). `BidBond` → **`BidDeposit`** (refund / rollover-to-performance / slash). `MilestoneEscrow` gains retention %, acceptance window + auto-release, performance-stake release, and a `proposeDiscount` / `acceptDiscount` pair. New: **`SupplierRegistry`** (profile + attestations; `ATTESTOR` role). `ProcurementPolicy`, `AttestationLog`, `SealedBid`, `Roles` unchanged.

## Security & trust model

Permissionless setting: any company can post or bid. The primitive is **conditional escrow with symmetric skin-in-the-game and time-locks** — neither party can hold the other hostage, and the contract (not a counterparty) resolves inaction.

1. **Money-in is atomic, never promised.** Buyer cannot open bidding until the RFQ budget (minimum: milestone 1 + retention) is locked. Suppliers never bid against an unfunded RFQ.
2. **Both sides stake.** Supplier: bid deposit → performance stake. Buyer: **buyer stake** (~5% of budget), slashed to the winner if the buyer abandons after award or refuses acceptance without cause.
3. **Every state has a clock.**
   - Award window → deposits auto-refund if no award.
   - Reveal window → unrevealed sealed bids forfeit deposit.
   - Delivery deadline → supplier stake slashable if nothing submitted.
   - Acceptance window → milestone auto-releases on buyer silence.
4. **Evidence-based release.** `submitMilestone(deliverableHash)` → buyer `accept()` or `reject(reasonHash)`. Both attested. Refusal to pay is a recorded, contestable act, not silence.
5. **Escape hatch.** `ARBITER` role (single trusted key for the hackathon; panel / on-chain court on roadmap). Either party escalates with a small dispute fee (loser pays); arbiter resolves in one call by splitting the escrow.
6. **Contract hygiene.**
   - Pull-over-push payouts: beneficiaries `withdraw()`; the contract never force-sends, so a reverting native send (blocklisted address, contract without `receive()`) cannot brick a milestone.
   - Reentrancy guards, checks-effects-interactions, no unbounded loops over bidders.
   - Per-RFQ accounting; funds of one RFQ can never touch another's.
   - Use Circle Contracts / OpenZeppelin bases where they fit; audited primitives over novelty.

### Alternatives considered
- **Streaming payments** (Sablier-style): good for retainers/services, poor fit for milestone deliverables — roadmap "retainer mode."
- **Oracle-triggered release** (delivery API / Chainlink): matches DoraHacks' trade-finance narrative; mention as roadmap, but a physical-delivery oracle would be fake in a 25-day demo. Hash-attested acceptance is the honest version.
- **2-of-2 multisig only**: dies when one party disappears; time-locks solve what multisig cannot.

### Participation & visibility
- Permissionless + deposits = spam-resistant by default. RFQs may set `requiresQualification` to restrict to `SupplierRegistry`-attested vendors.
- Visibility is off-chain filtering, not on-chain secrecy: RFQs carry category / region / currency fields; the indexer/UI shows suppliers matching RFQs.
- Private RFQs: optional **invite allowlist** (mapping of supplier addresses) on the RFQ. Sealed bids keep prices private; the allowlist keeps the RFQ private.

### Compliance & identity — "qualification, not KYC"
- **Hackathon:** no user KYC required. The only identity check is DoraHacks/Circle's builder verification before the grant payout.
- **Protocol:** non-custodial contracts; funds sit in code, never with the operator, no fiat touched. Arc's protocol-level blocklist screens native USDC transfers at chain level (the revert case already handled). Not legal advice — get a compliance read before real users.
- **B2B norms (off-chain):** US vendor onboarding typically wants business registration / EIN, W-9, certificate of insurance, sometimes ISO / SOC 2, references; regulated industries add OFAC screening and beneficial-ownership. The product gives these a *place* without making the protocol depend on them.
- **Design:** core stays permissionless (deposits handle spam). `SupplierRegistry` = optional profile (name, category, jurisdiction) + **hash-only attestations** stamped by an `ATTESTOR` key: `KYB_VERIFIED`, `INSURANCE_ON_FILE`, `CERT:<name>`, `SANCTIONS_SCREENED`. No documents on-chain — only proof that a named attestor checked something on a date. Buyers opt in per RFQ via `requiresQualification`.
- **Demo:** the agent service runs the attestor key with a mock KYB. **Roadmap:** pluggable attestors — real KYB providers (Persona / Middesk / Sumsub), Circle Compliance Engine for address screening, EAS-style verifiable credentials so a supplier's KYB travels across buyers.

### Impact on contract set
`MilestoneEscrow` gains: buyer stake, `submitMilestone` / `accept` / `reject(reasonHash)`, dispute escalation + `ARBITER` split, pull-payment `withdraw()`. `RFQRegistry` gains: funded-before-open check, category/region fields, optional invite allowlist. `Roles` gains `ARBITER` and `ATTESTOR`.

## Agent interface (MCP)

Ported from Faktura's "Your agent talks to this desk directly" pattern, but split by persona — procurement has agents on **both** sides (buyer and supplier), whereas Faktura's MCP only talked to the desk. Six tools over stdio, wrapping the same NestJS agent service the web UI calls; each tool documented "you say → tool → real output" as on the Faktura page.

| # | Tool | Persona | Kind |
|---|---|---|---|
| 1 | `list_open_rfqs` (category, budget range, `requiresQualification`) | supplier agent | read · live chain |
| 2 | `get_rfq` (scope, rubric weights, windows, deposit, funded status) | both | read · live chain |
| 3 | `submit_sealed_bid` (rfqId, price, deliveryDays, salt) → commit hash + deposit tx | supplier agent | write · mode-aware |
| 4 | `get_evaluation_report` (rfqId) → HTTP 402 challenge → scored bids + rationale | buyer agent / third party | x402 · machine-payable |
| 5 | `verify_decision_hash` (rfqId) → re-hash canonical award memo vs on-chain anchor | anyone / auditor | audit · trustless |
| 6 | `escrow_status` (rfqId) → milestones, retention, stakes, windows, next auto-action | both | read · live chain |

Direct ports from Faktura: `verify_decision_hash` (identical mechanism), `get_evaluation_report` (the x402 oracle), `escrow_status` (≈ `pool_stats`), and the hosted-showcase vs. local-live-keys mode banner.

### Why it's a stronger story here
- **Agentic suppliers are a real use case, not a judge demo** — a supplier's agent watching its category and bidding within a policy it was given is the "agentic commerce" thread Circle promotes.
- **x402 is native on Arc** (Nanopayments), so tool 4 costs little and scores "relevance to Arc."
- **The audit tool sells the thesis** in one line: "ask any agent to prove the award wasn't rewritten."

### Sequencing (hard gate)
- **No MCP work until contracts + web happy path pass on Arc mainnet** (days 18–22).
- **Days 23–24:** ship tools 1, 2, 5, 6 — reads + audit, zero signing risk. That alone is a complete "your agent talks to the RFQ desk" page.
- **Only if time remains:** tool 3 (needs a signing key + commit-reveal) and tool 4 (x402). Otherwise list them as roadmap with sample-output cards; never ship a half-working writer.
- **Hosted "run live" buttons are read-only tools only.** Faktura's budgeted signing judge mode (per-IP caps, daily gas budget, cleanup worker) is too much for a 25-day solo build; the demo video does that job.
- Keep `LLM_PROVIDER=mock` so the evaluation pipeline runs without a key.

## Sources
- DoraHacks — Arc Microgrants: https://dorahacks.io/hackathon/arc-microgrants
- The Block — Circle launches Arc mainnet (2026-09-16): https://www.theblock.co/news/ecosystems/2026-09-16-circle-launches-arc-mainnet-with-blackrock-and-visa-among-validators-mints-10-billion-arc-tokens-415250
- GitHub — elikem2021/arc-invoice (example competing submission): https://github.com/elikem2021/arc-invoice
- Trade Finance Global — Malaysia's digital procurement system (ePerolehan): https://www.tradefinanceglobal.com/posts/how-malaysias-digital-procurement-system-empowers-smes-factoring-companies/
- ERC-8183 Agentic Commerce (Draft): https://eips.ethereum.org/EIPS/eip-8183
- ERC-8004 Trustless Agents (Draft): https://eips.ethereum.org/EIPS/eip-8004
- Arc blog — Running an agentic economic flow on Arc with ERC-8183: https://www.arc.io/blog/running-an-agentic-economic-flow-on-arc-with-erc-8183
- Sofiia7/ARC — ERC-8183 + ERC-8004 bounty board on Arc (field lessons, registry addresses): https://github.com/Sofiia7/ARC
- viem — EIP-7702 overview: https://viem.sh/docs/eip7702
- Dwellir — ERC-8183 explained: https://www.dwellir.com/blog/erc-8183-agentic-commerce-explained
