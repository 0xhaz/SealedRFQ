# SealedRFQ on Arc: Work Plan

> Built from `docs/architecture.md` (final, locked 2026-09-20) and `docs/techstack.md`, plus a review of the reference frontend in `web/` (the Faktura/Casper site).
> Where those docs disagree, this plan follows the order the architecture doc sets: **Decisions → Standards alignment → Consolidated contract set** win.
> Today is **Sun 2026-09-20 (Day 2)**. Check off tasks here as you go.

---

## 0. Dates and go/no-go gates

| Date | Day | Gate |
|---|---|---|
| Sep 19–21 | 1–3 | **Day-1 verification checklist is done** before any feature code |
| Sep 28 | 10 | `DemoLifecycle.s.sol` passes end to end on **Arc testnet** |
| **Oct 5** | 17 | **Scope gate.** Web happy path works on testnet. Pick the evaluator for the video (mock or LLM). Decide the 🔶 features. If mainnet USDC or gas is still not reliable → **use the fallback** (§6) |
| Oct 10 | 22 | Full lifecycle done on **Arc mainnet**, tx table in `DORAHACKS.md` |
| **Oct 12** | 24 | **Submit** (target date; rolling review rewards early entries) |
| Oct 14, 23:59 ET | 25+ | Hard close. Kept as buffer only |
| Oct 21 | — | All decisions issued |

**Hard rule:** no MCP work and no polish until the contracts and the web happy path pass on mainnet.

---

## 1. Scope: what ships

### Must ship (✅ MVP)
- **Contracts:** `Roles`, `RFQRegistry`, `BidDeposit`, `SealedBid` (commit-reveal), `AgenticCommerce` (our own minimal ERC-8183), `SealedRFQAdapter` (IACPHook), `ProcurementPolicy`, `AttestationLog`.
- **Tier 1 features:** rubric published before bids open (`rubricHash`), deposit rolls over into a performance stake, retention/holdback, acceptance window with auto-release, award timeout that refunds deposits when nobody is awarded.
- **Security model:** RFQ must be funded before it opens, buyer stake, a clock on every state, pull-payment `withdraw()`, typed errors, role checks on every mutating entrypoint.
- **Agent service:** indexer, mock evaluator, awarder (policy prefilter), verifier, attestor (mock KYB).
- **Web:** wallet connect on Arc; create RFQ; commit and reveal a bid; award; milestone submit/accept/release; audit page; landing page ported from `web/`.
- **Evidence:** contracts verified on mainnet, and one mainnet tx per lifecycle step in `DORAHACKS.md`.
- **Submission:** README, a 2–3 min video, the BUIDL page, and a public builder profile.

### Ship if the core lands by Oct 5 (🔶)
- `SupplierRegistry` + ERC-8004 (identity, Validation Registry attestations, reputation on acceptance)
- Dynamic discounting (`proposeDiscount` / `acceptDiscount`)
- `ARBITER` dispute split (see discrepancy D5)
- Evaluator on an LLM instead of the mock for the video
- MCP tools 1, 2, 5, 6 (read + audit), Days 23–24 only
- EIP-7702 batched `approve + fund`

### Roadmap only (📋: README and landing-page cards, no code)
x402 evaluation report (MCP tool 4) · MCP `submit_sealed_bid` (tool 3) · Q&A rounds · change orders · reverse auctions · multi-lot and framework agreements · liquidated damages · award-backed supplier financing / surety pool · Kleros-style arbitration · Circle Wallets · StableFX/EURC · hosted signing judge mode · Malaysia/ePerolehan market expansion.

---

## 2. Doc discrepancies to fix first

Each takes about five minutes. Fix them on Day 2 so the docs don't mislead later work.

| # | Issue | Resolution |
|---|---|---|
| D1 | Filenames still say "SealedTender" (`architecture-SealedTender.md`), and techstack refers to `architecture.md` | Rename to `docs/architecture.md` and `docs/techstack.md` when scaffolding the repo (the layout already expects this) |
| D2 | The "Suggested MVP feature list" and first "Impact on contract set" still name `TenderRegistry` / `BidBond` / `MilestoneEscrow` | Superseded by the consolidated table. Add a strikethrough note so nobody builds from them |
| D3 | Techstack sets **Next.js 15 + Tailwind 4 + shadcn/ui**, but the design reference is **Vite + React 18 + 5.2k lines of hand-written CSS** | ✅ **Decided 2026-09-20:** Next.js 15 + `styles.css` ported as global CSS; **no Tailwind, no shadcn**. `techstack.md` updated |
| D4 | Techstack "out of MVP" says *"ERC-8183 hooks beyond retention/stake"*, yet dynamic discount (🔶, in the adapter) is committed | Treat discount as 🔶 in the adapter. Update the techstack line to "beyond retention/stake/discount" |
| D5 | The security model lists an `ARBITER` escape hatch as core, while the feature map marks "Dispute → ARBITER" as 📋 | Build the **single-call `arbiterSplit()`** (small) as 🔶. The dispute *fee / escalation flow* stays 📋 |
| D6 | The acceptance window, award window and reveal window must be **days on testnet** (clock drift), but the demo needs them to lapse on camera | Make every window **a per-RFQ parameter**. Seed scripts use days on testnet and **minutes on mainnet** for the demo RFQ. Verify mainnet `block.timestamp` on Day 18 |
| D7 | The demo budget (3.00 USDC) doesn't include the **buyer stake (~5%)** or **retention (10%)** | Budget 3.00 + stake 0.15. Retention comes out of milestone payouts. Recheck the float in `DemoLifecycle.s.sol` |

---

## 3. Phased task list

### Phase 0: Setup and verification (Sep 19–21, Days 1–3)

**Verification checklist (blocks everything):**
- [ ] Mainnet USDC sourcing from Malaysia (CCTP V2 from Base/Polygon/Ethereum, or a CEX with Arc withdrawals). Move **a few dollars** end to end
- [x] Does the `0x3600…` USDC precompile support ERC-2612 `permit`? → **Yes, on both networks (2026-09-20).** EIP-712 domain = name `USDC`, version `2`, chainId, `0x3600…`; standard `PERMIT_TYPEHASH`; `permit()` reaches signature check. **Approve UX = permit** (one tx). Also: decimals 6 on the ERC-20 view
- [x] Do the ERC-8004 registries exist on Arc **mainnet**? → **No** (no code at `0x8004A818…` / `0x8004B663…` on 5042; present on testnet). **Plan: deploy our own singleton on mainnet** unless they appear by Oct 5
- [x] Foundry contract verification works (Blockscout). **Testnet verified 2026-09-20** with `--verify --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/`; mainnet (`explorer.arc.io/api/`) to confirm on Day 18
- [ ] DoraHacks payout verification requirements; does the BUIDL page have a video field?
- [ ] Name collisions for "SealedRFQ" on DoraHacks / GitHub. **GitHub: clear** (only `Adarsh-Dhar/sealed-rfq` = "Veil RFQ", Solana RWA quotes, and a Flare OTC desk; neither on Arc or procurement). DoraHacks BUIDL list: check manually
- [ ] Builder profile (GitHub/X); domain: `sealedrfq.axiqo.xyz` or a fresh domain

**Findings (2026-09-20):**
- Both RPCs live; chain IDs 5042 / 5042002; block timestamps matched wall-clock at check time.
- Arc USDC `0x3600…` is a proxy; transfers call system precompiles `0x1800…01` (`isBlocklisted`) and `0x1800…00` (native `transfer`). Vanilla Foundry forks can **read** USDC and `vm.deal` shows up in `balanceOf` (18d→6d), but **cannot move it**. Unit tests use `MockUSDC`; transfer tests on a fork need Arc Foundry with `FOUNDRY_PROFILE=arc` (`network = "arc"`). **Full approve → deposit → pay → withdraw cycle passes against real testnet USDC on an Arc fork.**
- **Every USDC move emits two `Transfer` logs**: one from the system emitter `0xffff…fffe` in **18 decimals** (EIP-7708) and one from `0x3600…` in **6 decimals**. The indexer counts **only the `0x3600` ERC-20 event** (seen on the probe `withdraw` tx).
- viem's built-in `arcTestnet` points at `rpc.testnet.arc.network` / `testnet.arcscan.app`; we pin the `.arc.io` hosts in `packages/shared/src/chains.ts`.

**Scaffold:**
- [x] Monorepo per techstack layout: pnpm 9 workspaces, Turborepo 2, Biome, `tsconfig.base.json`, `.nvmrc` = 22
- [x] `contracts/`: Solidity 0.8.28, OZ 5.7.0 + forge-std submodules, remappings. Arc Foundry **v0.8.0-1** installed natively (`arc-forge`; v0.8.0-2 has no macOS build yet); Arc rules via `FOUNDRY_PROFILE=arc`
- [x] `packages/shared`: `usdc.ts` (6-decimal helpers), `chains.ts`, memo schema `sealedrfq.decision.v1` (zod), JCS canonicalisation + sha256 (9 tests)
- [x] Hello contract deployed to **testnet** that pulls USDC via `IERC20(0x3600…)` and pays out via `withdraw()`. `UsdcProbe` at [`0x2FaFaf85…924c`](https://explorer.testnet.arc.io/address/0x2FaFaf85929fAd9d13B7DC9a18CeD09A2D5B924c), verified; deploy → approve → deposit → pay → withdraw all succeeded (hashes in `contracts/deployments/probe-5042002.json`)
- [ ] Generate keys per role with `cast wallet new` → `.env.testnet` / `.env.mainnet` (gitignored). Fund testnet keys from the faucet. Testnet keys generated; BUYER + SUPPLIER_1 funded (20 USDC each); other keys funded as needed; mainnet set on Day 18
- [x] CI: `forge test`, `pnpm lint`, `pnpm test`, `pnpm build` (`.github/workflows/ci.yml`; runs once the repo is pushed)
- [x] **Freeze the contract interfaces** (function signatures, events, custom errors) in `contracts/src/interfaces/` — `IRFQRegistry`, `ISealedRFQAdapter`, `IProcurementPolicy`, `IAttestationLog`, `ISupplierQualifier`, `IAgenticCommerce`, `IACPHook`

### Phase 1: Contracts (Sep 22–28, Days 4–10)

Build in this order. Each contract is done when it has unit tests and fuzz tests on its money paths.

| Day | Contract | Key points | Status |
|---|---|---|---|
| 4 | `Roles` + `PullPayments` | role ids for `ADMIN`, `EVALUATOR`, `AWARDER`, `VERIFIER`, `ATTESTOR`, `ARBITER`, `REGISTRY`; pull-payment base | ✅ |
| 4–5 | `AgenticCommerce` (ERC-8183) | port of the reference Circle deployed on Arc, ABI-identical; all 6 states | ✅ 8 tests |
| 5–6 | `RFQRegistry` | funded-before-open, `rubricHash`, windows, invite allowlist, qualification gate, award, no-award close | ✅ 24 tests |
| 6 | `BidDeposit` | refund / rollover / forfeit, settled per bidder (no loops) | ✅ |
| 7 | `SealedBid` | commit-reveal bound to (chain, contract, rfq, bidder); no-reveal forfeits | ✅ |
| 7–8 | `ProcurementPolicy` | budget cap, min bidders, deposit ratio, rubric match, concentration cap; typed errors | ✅ 8 tests |
| 8 | `AttestationLog` | one role per decision kind; approvals **and** rejections | ✅ 4 tests |
| 8–9 | `SealedRFQAdapter` | ERC-8183 client + evaluator + hook; retention, stakes, auto-release, delivery deadline, expiry, dispute → ARBITER | ✅ 17 tests |
| 9 | 🔶 `SupplierRegistry` | thin gate over ERC-8004 Validation Registry | ⏳ not started (`qualifier` hook is in place) |
| 10 | Scripts | `Deploy.s.sol`, `Configure.s.sol`, `DemoLifecycle.s.sol` (staged) + `demo.sh` | ✅ **full lifecycle ran on Arc testnet 2026-09-20** |

**Test suite:** 75 tests — unit + fuzz (money is conserved for any price/milestone split/retention) + 3 invariants over 128k random calls (registry books == balance, adapter never insolvent, ERC-8183 holds exactly the live budgets).

**Deployed on Arc testnet (chain 5042002), 2026-09-20:**

| Contract | Address |
|---|---|
| `AgenticCommerce` | `0x78406DB668a3FCE7485f4fBc44fCF50Bf976fb86` |
| `AttestationLog` | `0x70D744E0caf335Fe53bd2B65CaC3bE9bDF9601A2` |
| `ProcurementPolicy` | `0xf0A23194D61220c09cE0B43CEe2ABe949B8d65aB` |
| `SealedRFQAdapter` | `0xBBd4474DbDB09711BB3654D5Ed1B78991Ee6CE42` |
| `RFQRegistry` | `0xC298eBa4051779cE856ADA673e65AD3B14CE287D` |

Policy-firewall evidence: [`0xa9195ed1…faff4`](https://explorer.testnet.arc.io/tx/0xa9195ed1c622aeca7483552954d9e05e99bdbd91756af953ce9bdc7a2c1faff4) — award of an AI-recommended 3.40 bid reverted with `AwardExceedsBudget(3400000, 3000000)`.

**Lessons for the mainnet run (Day 18–22):**
- Blockscout rate-limits verification: verify **one contract at a time with pauses**, not in one `--verify` sweep.
- Keep hashes out of arguments evaluated after `vm.broadcast` (a `constant` defined with `sha256(...)` is re-evaluated at each use and counts as a staticcall).
- A fork of Arc under `arc-anvil` can run its clock far faster than wall-clock; never derive demo timing from it.

Arc rules to enforce in every PR: 6-decimal USDC, **never `msg.value`**, never push payments, no `prevrandao`, 1 confirmation = final, typed errors, role check on every write.

### Phase 2: Agent service and web (Sep 29–Oct 5, Days 11–17)

**Agent (NestJS 11, `apps/agent`), Days 11–13:**
- [ ] `chain`: viem clients plus one signer per role
- [ ] `indexer`: `watchContractEvent` + block-range backfill → SQLite/Drizzle. Read EIP-7708 native logs **and** `0x3600…` ERC-20 `Transfer` without double-counting
- [ ] `evaluator`: `score(rfq, bids, rubric) → memo`. `LLM_PROVIDER=mock` is a deterministic rubric scorer; the `anthropic` provider plugs in behind it
- [ ] `awarder`: policy prefilter (stricter than the contract) → `award()` tx
- [ ] `verifier`: ERC-8183 `complete/reject(reason = memoHash)`
- [ ] `attestor`: mock KYB → `AttestationLog` (+ 🔶 ERC-8004 Validation)
- [ ] `api`: REST + SSE. Endpoints are listed in §4.5
- [ ] Vitest for memo hashing, evaluator determinism and the prefilter

**Web (`apps/web`), Days 13–17.** Port the design first, then the chain flows. Details in §4.
- [ ] Day 13: Next.js shell + global `styles.css` port + fonts + header/footer + `chain.ts` / wagmi (MetaMask, add the Arc network)
- [ ] Day 14: landing page (hero, story, capabilities, evidence) with **static content**
- [ ] Day 15: buyer flow: `/rfqs/new` (form → approve → create + fund), `/rfqs/[id]` (bids, evaluation, award, milestones)
- [ ] Day 16: supplier flow: `/rfqs` board, `/rfqs/[id]/bid` (commit with a salt the user keeps, reveal)
- [ ] Day 17: `/audit/[id]` (re-hash the memo vs the on-chain anchor), then a Playwright happy path on testnet
- [ ] **Oct 5 gate:** check the scope gate in §0. Freeze features

### Phase 3: Mainnet (Oct 6–10, Days 18–22)
- [ ] Fund the mainnet keys (float ≈ 10–15 USDC). Recheck the `block.timestamp` behaviour
- [ ] `Deploy.s.sol` + `Configure.s.sol` on **chain 5042**. Verify every contract on `explorer.arc.io`
- [ ] Run `DemoLifecycle.s.sol` on mainnet with minute-scale windows. Capture **one tx per step** (list in §5)
- [ ] Deploy the agent (Faktura nginx box, or Railway/Fly) and the web (Vercel) pointing at mainnet
- [ ] Run the lifecycle again **through the UI** with MetaMask as buyer + 3 suppliers
- [ ] Fill `evidence.ts` / `DORAHACKS.md` only from verified explorer links. Never hand-type a hash
- [ ] README: what it does, what it uses Arc for, contract addresses, tx table, "worth taking further" (Malaysia/ePerolehan, supplier financing)

### Phase 4: MCP, video, submission (Oct 11–12, Days 23–24)
- [ ] 🔶 `packages/mcp` stdio server: `list_open_rfqs`, `get_rfq`, `verify_decision_hash`, `escrow_status` (read + audit only)
- [ ] `/agents` page (Faktura MCP-drawer style). Tools 3 and 4 appear as **roadmap cards with sample output**; never ship a half-working writer
- [ ] Record the 2–3 min video (script in §5) with the explorer open
- [ ] BUIDL page: one-liner, description, links, builder profile
- [ ] **Submit by Oct 12**

### Phase 5: Buffer (Oct 13–14)
Only fixes for RPC instability and resubmission. No new features.

---

## 4. Frontend: porting `web/` to SealedRFQ

The reference is a single-page Vite app (`App.tsx` ≈ 4.7k lines, `styles.css` ≈ 5.2k lines) for Faktura, an AI invoice-financing desk on Casper. **Keep the design system and the page's storytelling pattern. Replace every piece of content, every chain integration and the branding.**

### 4.1 Framework decision (D3): decided 2026-09-20

**Decision:** Next.js 15 App Router (as locked in techstack), and **import the ported `styles.css` as global CSS instead of rebuilding it in Tailwind/shadcn.**
- Rebuilding the "ledger" look (paper, ink, stamps, hard shadows) in Tailwind would cost 2–3 days inside the tightest window.
- Keep the class names (`.hero`, `.story-act`, `.stamp`, `.panel`, `.lj-*`). Split the file into `app/styles/{base,landing,desk,walkthrough,drawer}.css` while porting.
- ~~Update `techstack.md`~~: done.


### 4.2 Keep, adapt, drop

| Item in `web/` | Action | Notes |
|---|---|---|
| `styles.css` tokens (`--paper`, `--ink`, `--red`, `--green`, `--amber`, `--blue`, `--shadow`) | **Keep** | The print-red becomes the **wax-seal red**, which suits "sealed bids". Update the header comment |
| Fonts: Space Grotesk / IBM Plex Mono / Fraunces | **Keep** | Load via `next/font/google` |
| Dot-grid paper background, hard shadows, stamps | **Keep** | Stamps become `SEALED`, `REVEALED`, `AWARDED`, `PAID`, `BLOCKED BY CONTRACT` |
| `useModalA11y.ts` | **Keep as is** | Use it for the drawers and modals |
| `TxLink`, toast, drawer, feed, stat tiles, table, badges, form | **Adapt** | Explorer → `explorer.arc.io` |
| `evidence.ts` pattern ("single source of truth for tx links") | **Adapt** | Arc mainnet addresses + lifecycle txs (§5) |
| Guided walkthrough (`JudgeGuided`, `lj-*` timeline, predictions, AI-thinking orb, signing timer) | **Adapt** | Hosted signing is **out of scope**. Recast it as a **replay of the recorded mainnet run**: each step shows the real tx and its explorer link, and a "Do it yourself" button deep-links into the real flow using the visitor's own wallet |
| `PolicyFirewall` | **Adapt** | Check rows against `ProcurementPolicy` (see §4.3) |
| `PoolEconomics` | **Adapt → `EscrowEconomics`** | budget · escrowed · retention held · stakes · released |
| `AgentRoles` | **Adapt** | 6 system keys + buyer + supplier |
| MCP band + `McpDrawer` | **Adapt** | 6 SealedRFQ tools. Tools 3–4 get a "roadmap" badge |
| `ProofStrip`, `LatestRunReceipt`, desk status bar | **Adapt** | Mode pill: `LIVE · ARC MAINNET` / `SHOWCASE`. Popovers: "Arc proof" and "Procurement rules" |
| `wallet.ts`, `ClickBridge`, `WalletChip`, CSPR.click, `styled-components`, `main.tsx` provider | **Drop → wagmi** | MetaMask with a custom Arc network, 6-dec USDC balance. The wallet now **signs** (Faktura's was read-only) |
| `api.ts` types (invoice, pool, CSPR motes) | **Rewrite** | see §4.5 |
| `motesToCspr`, `CasperWordmark`, Casper links, `casper-word` class | **Drop** | Use Arc/Circle brand assets only if their brand guidelines allow; otherwise plain text "Built on Arc" |
| `public/*.png` (Faktura logos, Casper wordmark, og.png) | **Replace** | New SealedRFQ logo (wax-seal "S" mark), new og image, favicon SVG in the same style |
| `index.html` meta / OG / Twitter tags | **Rewrite** | → Next `metadata` export |
| `vite.config.ts` base `/faktura/`, `/api` proxy on :4020 | **Drop** | Use Next rewrites to the agent service |
| `package.json` name `@faktura/web` | **Rename** | `@sealedrfq/web` |
| `react-country-flag`, `react-modal` | **Drop** | unused in the new content |

### 4.3 Content mapping, section by section

**Header.** Logo · wallet chip (connect / switch to Arc 5042 / USDC balance) · `MCP · 6 tools ▾` · GitHub. Keep the small-screen "more" menu.

**Status bar.** `LIVE · ARC MAINNET` pill with the text *"Every RFQ, bid and payout on this page is a real Arc transaction."* Popovers:
- *Arc proof*: contract addresses and tx count.
- *Procurement rules*: reads `ProcurementPolicy`, e.g. *"Award ≤ published budget · ≥ 3 revealed bids · deposit ≥ 5% of bid · rubric hash must match · one supplier ≤ 40% of buyer spend. The awarder pre-filters stricter; the contract is the final authority."*

**Hero** (replaces "AI underwrites. Casper decides. Suppliers get paid.")
- H1 (draft): **"Sealed bids. AI scores. Arc awards.** <span class=accent>Suppliers get paid.</span>"
- Sub: *SealedRFQ is sealed-bid procurement for B2B buyers. Suppliers commit sealed bids with a refundable USDC deposit. An AI evaluator scores them against a rubric published before bidding opened. An Arc contract enforces the award rules and pays the winner milestone by milestone. Every decision is on-chain and can be verified.*
- Tagline: *An AI can recommend the winner. **Only the contract can award.***
- CTAs: `▶ Walk the mainnet run · 3 min` · `Post an RFQ` · `Browse open RFQs →`. Links: *contract & tx evidence →*, *3-min demo ↗*, *Developers: MCP · GitHub*.
- Metrics: **N** real Arc txs per full run · **<1 s** final awards · **Sealed** until the reveal window.
- **Ornament (`HeroRFQ`, replaces `HeroInvoice`).** An RFQ document (`RFQ № 2026-014`, buyer "Northwind Logistics Inc.", scope "Route-optimisation SaaS integration", budget 3.00 USDC). It cycles through two runs:
  - *Awarded:* `OPEN → 3 SEALED BIDS (██████) → REVEALED → AI SCORED → POLICY CHECK → AWARDED → MILESTONE 1 PAID`
  - *Blocked:* `… → AI RECOMMENDS 3.40 USDC → POLICY CHECK → BLOCKED — AwardExceedsBudget`
  - Stamps: `SEALED`, `AWARDED`, `BLOCKED BY CONTRACT`. Keep the reduced-motion single frame.

**Story section** (replaces "One invoice. Two gates. Two credit outcomes.")
- Title: **"One RFQ. Sealed bids. Two gates. Paid by milestone."**
- Lede: *Northwind needs a vendor. Three suppliers bid without seeing each other's prices. Before any money moves, the award passes two gates. After that, payment follows delivery.*
- Acts (four instead of three; switch the grid to 4 columns, or 2×2 on tablet):
  1. **SEALED · COMMIT-REVEAL**: bids go on-chain as hashes with a USDC deposit. They are revealed after the deadline, and a supplier that doesn't reveal forfeits its deposit. Verdicts: `REVEAL ✓` / `NO-SHOW ✕ forfeit`.
  2. **GATE 1 · AI EVALUATION**: the evaluator scores against the rubric whose hash was published at creation. The memo is hash-anchored whether it recommends or rejects. `REJECT ✕` / `RECOMMEND →`.
  3. **GATE 2 · ARC POLICY** (red card): caps enforced inside `award()`. An over-budget recommendation reverts with `AwardExceedsBudget`. Link: *open a real reverted tx ↗*. `BLOCK ⛔` / `AWARD →`.
  4. **MILESTONES · ERC-8183**: one job per milestone; the supplier submits a deliverable hash, and the buyer accepts or rejects with a reason. If the buyer stays silent past the window, payment auto-releases. Retention is held until the final milestone. `ACCEPT ↗ paid` / `SILENCE ⏱ auto-release`.
- Side quest (only if x402 ships; otherwise leave it out): *"Another agent buys the evaluation report over HTTP 402 …"*

**Capabilities** ("What makes it different")
- ⛔ **AI proposes, the contract disposes.** Six policy caps live in `award()`.
- 🔒 **Sealed until reveal.** Commit-reveal plus USDC deposits. Losing bidders are refunded automatically; the winner's deposit becomes a performance stake.
- ⏱ **Nobody can hold the other side hostage.** Every state has a clock: award timeout refunds, acceptance timeout releases, and there is a buyer stake.
- 🔑 **Least-privilege keys.** The evaluator can score but not award. The verifier can release but not refund.
- 🧾 **Audit any award.** Re-hash the memo and compare it with the on-chain anchor (`/audit/[id]`).
- 🪪 (🔶) **Supplier identity on ERC-8004.** Qualification attestations; reputation is recorded on acceptance.

**MCP band.** Title: *"Don't just watch the RFQ desk. Plug your agent in."* Tools: `list_open_rfqs` · `get_rfq` · `verify_decision_hash` · `escrow_status` (live), plus `submit_sealed_bid` · `get_evaluation_report` (roadmap badge). Command: `claude mcp add sealedrfq -e SEALEDRFQ_API=https://… -- npx tsx packages/mcp/src/index.ts`.

**"Run it yourself" card.** Title: *"Don't take our word for it. Open every transaction."* Two buttons: `▶ Walk the recorded mainnet run` and `Bid on the live demo RFQ with your wallet`. The copy should say plainly that this costs a few cents of real USDC.

**Walkthrough steps** (replace `JUDGE_STEPS` and `PRESET_META`)
1. Buyer posts the RFQ and escrows budget + buyer stake (*funded before open*)
2. Suppliers commit sealed bids + deposits
3. Bids are revealed (the no-reveal preset shows a forfeit)
4. Gate 1: the AI evaluates against the rubric, and the memo hash is attested
5. Gate 2: the policy check (the **policy-firewall preset** shows the revert)
6. Award: the winner's deposit becomes a performance stake, and losers are refunded
7. Milestone submitted, then accepted, then paid, minus retention (the **timeout preset** shows auto-release)
8. Final milestone: retention and stakes are released; 🔶 reputation feedback on ERC-8004

Presets: `full-lifecycle` (3 min), `policy-block` (1 min, fastest proof), `no-reveal-forfeit`, `timeout-release`, `ai-reject` (the evaluator flags a lowball bid with no delivery record; the rejection is anchored too).

Predict-then-verify prompts (replace `PREDICTIONS`):
- *"The AI recommends a bid 13% over the published budget. Will Arc award it?"* → **BLOCK**.
- *"Supplier 3 never revealed. What happens to its 0.25 USDC deposit?"* → **forfeited**.
- *"The buyer says nothing for the whole acceptance window. What happens to milestone 2?"* → **auto-released to the supplier**.

**Desk → RFQ board** (replaces "The desk: live book & controls")
- Stat tiles: Open RFQs · USDC in escrow · Deposits held · Milestones paid · AI attestations
- Table: `RFQ · Buyer · Budget · Bids (sealed/revealed) · Phase · Next deadline · Status`
- Row drawer: scope · rubric weights + `rubricHash` · bids (sealed rows are masked until reveal) · evaluation memo with the score ring and red flags · policy firewall rows · milestone timeline · attestation hashes · tx links
- Forms (replace `SubmitPanel`):
  - **Post RFQ:** title, scope, category, budget, milestones, deposit, windows, rubric weights, optional invite list.
  - **Submit sealed bid:** price, delivery days. The salt is generated in the browser, stored locally and offered as a **downloadable reveal file**. Warn clearly: *"lose this and you cannot reveal; your deposit will be forfeited."*

**Footer / continuation.** A "worth taking further" line: Malaysia ePerolehan and SME procurement, and award-backed supplier financing.

### 4.4 File map: reference → Next.js

| New file (`apps/web`) | Source in `web/src` |
|---|---|
| `app/layout.tsx` (fonts, metadata, wagmi provider) | `index.html`, `main.tsx` |
| `app/page.tsx` + `components/landing/{Hero,HeroRFQ,Story,Caps,McpBand,RunIt}.tsx` | `App.tsx` 745–1070, `HeroInvoice` 280–390 |
| `app/(supplier)/rfqs/page.tsx` + `components/desk/{Stats,RfqTable,RfqDrawer}.tsx` | `App.tsx` 1073–1450, `Drawer` 2054 |
| `app/(buyer)/rfqs/new/page.tsx` | `SubmitPanel` 1777 |
| `app/(buyer)/rfqs/[id]/page.tsx` + `PolicyFirewall`, `EscrowEconomics` | 2289, 3157 |
| `app/(supplier)/rfqs/[id]/bid/page.tsx` | new |
| `app/walkthrough/page.tsx` + `components/walkthrough/*` | `JudgeGuided` 3283, `GuidedStep` 2886, `AiDecisionCard` 2852 |
| `app/audit/[id]/page.tsx` | MCP `verify_decision_hash` preview |
| `app/agents/page.tsx` | `McpDrawer` 4387, `MCP_TOOLS` 4232, `AgentRoles` 4183 |
| `components/Header.tsx`, `WalletChip.tsx` | 121–280, 392 |
| `lib/evidence.ts`, `lib/api.ts`, `lib/chain.ts`, `lib/usdc.ts` | `evidence.ts`, `api.ts`, `wallet.ts` |
| `lib/useModalA11y.ts` | copy |
| `app/styles/*.css` | `styles.css` |

### 4.5 Data contract (replaces `api.ts`)
- Types: `Rfq`, `Bid` (`commitHash`, `revealed`, `price?`, `deliveryDays?`), `Evaluation` (memo `sealedrfq.decision.v1`, `decisionHash`, `model`, scores[]), `Milestone` (ACP job id, status, deadline, retention), `EscrowStats`, `ProcurementPolicy`, `Meta` (`mode`, contracts, chain, explorer, `llmProvider`, `mcp`).
- Endpoints: `GET /meta`, `GET /rfqs`, `GET /rfqs/:id`, `GET /rfqs/:id/evaluation`, `GET /rfqs/:id/escrow`, `GET /audit/:id`, `GET /events` (SSE). Writes go **wallet → contract directly**; the API is read-only except for agent-side jobs.

---

## 5. Demo and evidence pack

**Mainnet tx list** (one each; they feed `evidence.ts`, `DORAHACKS.md` and the README):
deploy ×N · configure roles/policy · createRFQ + fund · commit ×3 · reveal ×2–3 · attest evaluation · **award revert (`AwardExceedsBudget`)** · award · deposit refund (loser) · milestone fund · submit · complete · auto-release (timeout) · final release of retention + stake · withdraw · (🔶 ERC-8004 reputation feedback).

**Video, 2–3 min:**
1. 0:00–0:15. The problem: B2B vendor selection runs on email and trust; bid-rigging and payment disputes follow.
2. 0:15–0:45. Buyer posts an RFQ in USDC; suppliers commit sealed bids (explorer open).
3. 0:45–1:20. Reveal → AI scores against the published rubric → the memo hash is anchored.
4. 1:20–1:45. **Policy firewall:** an over-budget recommendation reverts on-chain.
5. 1:45–2:30. Award → losers refunded → milestone paid → auto-release on buyer silence.
6. 2:30–2:50. Audit page re-hashes the memo. Why Arc: USDC-native, sub-second finality, ERC-8183.

---

## 6. Risks and plan-changing triggers

| Trigger | Response |
|---|---|
| Mainnet USDC or gas unreliable by **Oct 5** | **Fallback:** USDC deposit + milestone escrow only (drop commit-reveal; open bids). Still procurement, still not an invoice app |
| Contracts slip past **Sep 28** | Cut 🔶 in this order: discount → `SupplierRegistry`/ERC-8004 → `arbiterSplit`. Then retention (keep the acceptance auto-release) |
| Web slips past **Oct 5** | Landing page + walkthrough replay + buyer/supplier forms only; the RFQ board becomes read-only |
| USDC `permit` unsupported | 7702 batch if MetaMask supports it; otherwise one approve per persona |
| ERC-8004 not on mainnet | Deploy our own singleton and say so in the README |
| Another procurement project appears on DoraHacks | Lean harder on the policy firewall and audit trail; bring the ePerolehan continuation story forward |
| Arc RPC instability | Pre-record the video on the Day-22 run; SHOWCASE mode reads from a captured snapshot (the Faktura pattern) |

---

## 7. Submission checklist
- [ ] Contracts live and verified on Arc mainnet (chain 5042), addresses in the README
- [ ] Public GitHub repo; README covers what it does and what it uses Arc for
- [ ] Live app link that opens (Vercel)
- [ ] `DORAHACKS.md` evidence pack with one explorer link per lifecycle step
- [ ] Public builder profile (GitHub / X)
- [ ] BUIDL page: short description + links + video
- [ ] 2–3 min demo video
- [ ] No Faktura/Casper strings or assets left anywhere: `grep -ri "faktura\|casper\|cspr" apps/web` returns nothing
- [ ] Submitted by **Oct 12**
