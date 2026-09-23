# SealedRFQ on Arc — Tech Stack

> Companion to `architecture.md`. This file is the build reference: what we use, why, versions to pin, and the repo layout to scaffold in the IDE. Keep it updated as choices change.

## Target

| | |
|---|---|
| Chain (submit) | **Arc mainnet** — chain ID `5042`, RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io` |
| Chain (dev) | Arc testnet — chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`, faucet `https://faucet.circle.com` |
| Gas token | USDC (native) |
| Settlement asset | USDC via ERC-20 interface `0x3600000000000000000000000000000000000000` (6 decimals) |
| Deadline | Submit by **Oct 12** (hard close Oct 14, 23:59 ET) |

## Language & tooling baseline

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | 22 LTS | `.nvmrc` at root |
| Package manager | pnpm | 9.x | workspaces; `pnpm-workspace.yaml` |
| Language | TypeScript | 5.6+ | strict; shared `tsconfig.base.json` |
| Monorepo tasks | Turborepo | 2.x | `build`, `test`, `lint`, `dev` pipelines |
| Lint / format | Biome | 1.9+ | single tool for TS; `forge fmt` for Solidity |
| Solidity | 0.8.28 | | `via_ir = true` only if stack-too-deep |
| Contracts framework | **Arc Foundry** (`arc-forge`, `arc-cast`, `arc-anvil`) | v0.8.0-1 | Circle's fork; reproduces Arc precompiles, EIP-7708, blocklist. Pinned to v0.8.0-1 (last release with macOS arm64 + Linux builds); installed to `~/.local/bin/arc-*`, CI downloads it checksum-verified. Arc rules via `FOUNDRY_PROFILE=arc` (`network = "arc"`). Vanilla Foundry for unit tests (`MockUSDC`) and read-only forks; Arc Foundry for anything that moves USDC |
| Contract libs | OpenZeppelin Contracts | 5.7.0 | `AccessControl`, `ReentrancyGuard`, `SafeERC20`, `EIP712` |
| Chain client | viem | 2.x | ships `arc` / `arcTestnet` chains |
| Wallet (web) | wagmi + MetaMask | wagmi 2.x | custom Arc network; Circle Wallets only if week 3 is calm |
| Frontend | Next.js (App Router) | 15.x | React 19; **plain global CSS ported from the reference "ledger" theme** (`app/styles/*.css`, class names kept). No Tailwind, no shadcn/ui (decided 2026-09-20). Fonts via `next/font/google` |
| Backend / agent | NestJS | 11.x | REST + SSE; hosts evaluator, attestor, indexer, x402 endpoint |
| DB | SQLite via Drizzle ORM | drizzle 0.36+ | single-node; Postgres swap is a config change if ever needed |
| Indexing | viem `watchContractEvent` + backfill by block range | | no external indexer; write to SQLite |
| LLM | Anthropic SDK (`@anthropic-ai/sdk`) behind `LLM_PROVIDER` | | `rubric` (deterministic, recorded as `deterministic-rubric-v1`) is the default and the intended scorer for awards; `anthropic` / `openai` swap in for reading unstructured proposals |
| MCP | `@modelcontextprotocol/sdk` | 1.x | stdio server in `packages/mcp` |
| x402 | native fetch + Arc Nanopayments | | HTTP 402 challenge/verify; only if time remains |
| Testing (contracts) | Forge unit + fuzz + invariant | | `forge coverage` in CI |
| Testing (TS) | Vitest | 2.x | agent service + MCP |
| E2E | Playwright | 1.48+ | one happy-path run against testnet, recorded for demo |
| CI | GitHub Actions | | `forge test`, `pnpm test`, `pnpm lint`, `pnpm build` on every push |
| Hosting | Vercel (web) · existing nginx VPS or Railway/Fly (agent) | | |
| Secrets | `.env` + `dotenv`; never commit keys; separate keys per role | | |

## Repo layout (scaffold this)

```
sealedrfq/
├─ .github/workflows/ci.yml
├─ .nvmrc                       # 22
├─ package.json                 # pnpm workspaces root, turbo scripts
├─ pnpm-workspace.yaml
├─ turbo.json
├─ biome.json
├─ tsconfig.base.json
├─ README.md                    # submission-facing (what it does, what it uses Arc for)
├─ DORAHACKS.md                 # evidence pack: one mainnet tx per lifecycle step
├─ docs/
│  ├─ architecture.md           # ← the design doc
│  └─ techstack.md              # ← this file
│
├─ contracts/                   # Arc Foundry project
│  ├─ foundry.toml
│  ├─ remappings.txt
│  ├─ src/
│  │  ├─ core/
│  │  │  ├─ AgenticCommerce.sol       # ERC-8183 (own minimal impl)
│  │  │  ├─ IAgenticCommerce.sol
│  │  │  └─ IACPHook.sol
│  │  ├─ rfq/
│  │  │  ├─ RFQRegistry.sol
│  │  │  ├─ SealedBid.sol             # commit-reveal
│  │  │  ├─ BidDeposit.sol
│  │  │  └─ SealedRFQAdapter.sol      # IACPHook: retention, stakes, discount, dispute, withdraw()
│  │  ├─ governance/
│  │  │  ├─ ProcurementPolicy.sol
│  │  │  ├─ AttestationLog.sol
│  │  │  └─ Roles.sol                 # OZ AccessControl role ids
│  │  ├─ identity/
│  │  │  └─ SupplierRegistry.sol      # thin gate over ERC-8004
│  │  └─ interfaces/
│  │     ├─ IERC8004Identity.sol
│  │     ├─ IERC8004Reputation.sol
│  │     └─ IERC8004Validation.sol
│  ├─ script/
│  │  ├─ Deploy.s.sol
│  │  ├─ Configure.s.sol              # roles + policy
│  │  └─ DemoLifecycle.s.sol          # full RFQ → award → milestone run, prints tx table
│  └─ test/
│     ├─ unit/
│     ├─ fuzz/
│     └─ invariant/
│
├─ apps/
│  ├─ web/                      # Next.js
│  │  ├─ app/
│  │  │  ├─ (buyer)/rfqs/new
│  │  │  ├─ (buyer)/rfqs/[id]
│  │  │  ├─ (supplier)/rfqs
│  │  │  ├─ (supplier)/rfqs/[id]/bid
│  │  │  ├─ audit/[id]                # verify decision hash
│  │  │  └─ agents/                   # MCP page (Faktura-style)
│  │  ├─ components/
│  │  ├─ lib/
│  │  │  ├─ chain.ts                  # arc / arcTestnet config, addresses
│  │  │  ├─ abis/                     # generated by wagmi cli from forge out/
│  │  │  └─ usdc.ts                   # 6-decimal helpers
│  │  └─ wagmi.config.ts
│  │
│  └─ agent/                    # NestJS
│     ├─ src/
│     │  ├─ main.ts
│     │  ├─ modules/
│     │  │  ├─ chain/                 # viem clients, signers per role
│     │  │  ├─ indexer/               # event → SQLite
│     │  │  ├─ evaluator/             # score(rfq,bids,rubric) → memo; mock | anthropic
│     │  │  ├─ attestor/              # KYB mock → ERC-8004 Validation + AttestationLog
│     │  │  ├─ awarder/               # policy prefilter → award tx
│     │  │  ├─ verifier/              # milestone complete/reject
│     │  │  ├─ x402/                  # 402 challenge + verify (stretch)
│     │  │  └─ api/                   # REST + SSE for web + MCP
│     │  └─ db/                       # drizzle schema + migrations
│     └─ test/
│
└─ packages/
   ├─ shared/                   # types, canonical memo schema + hashing, zod schemas
   └─ mcp/                      # stdio MCP server: 6 tools
```

## Keys / personas (testnet + mainnet, separate sets)

| Key | Role | Holds |
|---|---|---|
| `ADMIN` | deploy, roles, policy | gas |
| `EVALUATOR` | scores + attests; cannot award | gas |
| `AWARDER` | awards within policy | gas |
| `VERIFIER` | ERC-8183 evaluator on milestone jobs | gas |
| `ATTESTOR` | qualification attestations | gas |
| `ARBITER` | dispute split | gas |
| `BUYER` (demo) | funds RFQ + buyer stake | ~5 USDC mainnet |
| `SUPPLIER_1..3` (demo) | deposits, bids | ~1 USDC each mainnet |

Generate with `cast wallet new`; store in `.env.testnet` / `.env.mainnet` (gitignored). Mainnet total float ≈ 10–15 USDC.

## Canonical memo & hashing (shared package)

- Memo schema `sealedrfq.decision.v1` (zod): `{ rfqId, kind, actor, model, ts, inputsHash, scores[], rationale, decision }`.
- Canonicalise with RFC 8785 JCS → `sha256` → anchored in `AttestationLog` and echoed in ERC-8183 `complete/reject(reason)`.
- `verify_decision_hash` re-hashes the stored memo and compares against on-chain — never compares two stored strings.

## Arc-specific rules (enforce in code review)

- USDC amounts are **6-decimal** everywhere in app code; contract uses `IERC20(0x3600…)`. Never `msg.value`.
- Never force-send: all payouts via `withdraw()` (pull). Blocklisted recipients park funds.
- Finality is deterministic: treat 1 confirmation as final; no confirmation counters.
- `block.prevrandao == 0`; do not use for randomness (salts are client-generated).
- Every USDC move emits two `Transfer` logs: EIP-7708 from system emitter `0xffff…fffe` (18d) **and** ERC-20 from `0x3600…` (6d). Index **only** the `0x3600…` event (verified on testnet 2026-09-20).
- Testnet `block.timestamp` may drift fast: use day-scale windows in seed scripts; mainnet verify on first deploy.
- Every mutating entrypoint: role check + typed custom error.

## Environment variables

```
ARC_RPC_URL=
ARC_CHAIN_ID=5042002            # 5042 for mainnet
USDC_ADDRESS=0x3600000000000000000000000000000000000000
ERC8004_IDENTITY=               # verify per network
ERC8004_REPUTATION=
ERC8004_VALIDATION=
ADMIN_PK= EVALUATOR_PK= AWARDER_PK= VERIFIER_PK= ATTESTOR_PK= ARBITER_PK=
LLM_PROVIDER=rubric             # rubric (default, deterministic) | anthropic | openai
ANTHROPIC_API_KEY=
DATABASE_URL=file:./data/sealedrfq.db
NEXT_PUBLIC_ARC_CHAIN_ID=
NEXT_PUBLIC_CONTRACTS_JSON=     # path to deployed addresses
```

## Build order (mirrors architecture.md timeline)

1. **Days 1–3** — scaffold repo; Arc Foundry hello deploy on testnet; verify USDC `permit`; confirm mainnet USDC path; ERC-8004 mainnet addresses.
2. **Days 4–10** — contracts: `AgenticCommerce` → `RFQRegistry` → `BidDeposit` → `SealedBid` → `SealedRFQAdapter` → `ProcurementPolicy` → `AttestationLog` → `SupplierRegistry`. Unit + fuzz + invariant. `DemoLifecycle.s.sol` green on testnet.
3. **Days 11–17** — agent service (indexer, mock evaluator, awarder, verifier, attestor) + web happy path.
4. **Days 18–22** — mainnet deploy + verify; real lifecycle with small USDC; `DORAHACKS.md` tx table.
5. **Days 23–24** — MCP (read tools + audit first), demo video, BUIDL page. Submit.
6. **Day 25** — buffer.

## Explicitly out of MVP

StableFX/EURC · Circle Wallets · Kleros-style arbitration · liquidity/surety pool · reverse auctions · change orders · Q&A rounds · Judge-mode signing on hosted site · ERC-8183 hooks beyond retention/stake.
