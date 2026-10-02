# SealedRFQ — sealed-bid B2B procurement on Arc

**Live on Arc mainnet (chain 5042): [www.sealedrfq.com](https://www.sealedrfq.com)** · real USDC · [source](https://github.com/0xhaz/SealedRFQ)

## The problem

Procurement awards are decided in private. The buyer sees every bid before choosing, the scoring
criteria can be reinterpreted after the fact, and a losing supplier is rarely told why — so
favouritism and an honest decision look identical from the outside. The usual answer is an audit
trail written by the same party that made the decision.

## What it does

| Step | What the chain enforces |
|---|---|
| **Post** | Budget, deposit, timetable and a **hash of the scoring rubric** are fixed on-chain before bidding opens |
| **Bid** | Prices are sealed by commit–reveal. The chain records that you bid and takes your deposit; it does not record what you bid |
| **Reveal** | The contract checks each revealed price against the earlier commitment. Fail to reveal and you forfeit the deposit — which is what makes a sealed bid binding rather than a free option |
| **Score** | An evaluator scores revealed bids against the published rubric and anchors a signed decision memo |
| **Award** | `award()` refuses any supplier the current attestation did not name. The buyer can award the recommended bidder, or nobody |
| **Deliver** | Payment runs milestone by milestone through ERC-8183 escrow, with retention released at final acceptance |
| **Silence** | If the buyer goes quiet past the acceptance window, **anyone** can trigger release. A supplier who delivered cannot be held hostage |

## The part that is enforced, not promised

Policy checks live inside `award()`. These are real calls against the **live mainnet policy**:

| Case | Result |
|---|---|
| 2.80 on a 3.00 budget | allowed |
| 3.40 on a 3.00 budget | `AwardExceedsBudget` |
| one revealed bid | `InsufficientBidders` |
| deposit under 5% of price | `DepositRatioTooLow` |
| rubric ≠ the hash published before bidding | `RubricMismatch` |
| 75% of spend to one supplier, above the $250k floor | `ConcentrationCapExceeded` |
| the same concentration, below the floor | allowed |

The concentration cap is the one a buyer cannot opt out of: it binds how much of a buyer's
cumulative spend may go to a single supplier, and it applies to the buyer's own awards, not just
the agent's. A separate `agentAwardCap` ($100) bounds what the agent may commit unattended — set
deliberately, because zero would mean a deployment that forgets to configure it gets a human in the
loop rather than an uncapped robot.

## AI recommends; the contract decides

The evaluator is deterministic and calls no model. It reports itself as `deterministic-rubric-v1`,
and the code **refuses to start** if `LLM_PROVIDER` names a provider that is not implemented —
recording a model name in an attestation for a decision made by arithmetic would be a false claim
anchored permanently by the one system whose argument is that claims should be checkable.

Ties break on a fixed cascade — cheaper, then quicker, then the lower address — so a losing bidder
can recompute the outcome rather than take it on trust.

## Why Arc

- **USDC is both the gas token and the settlement asset** at `0x3600…0000`, so a tender never
  touches a second asset and a supplier is never paid in something they must then sell.
- **One-confirmation finality** — no confirmation counters, and `block.prevrandao` is never used.
- **Blocklist-aware payouts.** Every payment is pull-only (`withdraw()`), so a blocklisted recipient
  parks their funds instead of bricking the milestone for everyone else.

## Live on mainnet

Deployed 2026-10-02 at block 23850939. The whole deploy cost **0.1954 USDC**.

| Contract | Address |
|---|---|
| `RFQRegistry` | [`0x0a63a12c852d92A7c187bCa6968f9abF4720420c`](https://explorer.arc.io/address/0x0a63a12c852d92A7c187bCa6968f9abF4720420c) |
| `SealedRFQAdapter` | [`0xA2437fC10632A37cBe5F854C43D553A8e212700d`](https://explorer.arc.io/address/0xA2437fC10632A37cBe5F854C43D553A8e212700d) |
| `AgenticCommerce` (ERC-8183) | [`0x03Fd0F608a8e1beE036D1d5A7a9C05349ad52534`](https://explorer.arc.io/address/0x03Fd0F608a8e1beE036D1d5A7a9C05349ad52534) |
| `ProcurementPolicy` | [`0xbd56363310dDC5c7A1716b158982b91aCfd05c43`](https://explorer.arc.io/address/0xbd56363310dDC5c7A1716b158982b91aCfd05c43) |
| `AttestationLog` | [`0x986C49d9701a9d57dbF3786a44C108b1518542b8`](https://explorer.arc.io/address/0x986C49d9701a9d57dbF3786a44C108b1518542b8) |

## Paying the agent: x402

The optional fast evaluation is metered with **x402 over Circle Gateway** — $0.05, settled in USDC,
advertised in `/meta` so a buying agent can price the call before making it.

**Reading why you lost is free, permanently.** `GET /rfqs/:id/evaluation` and `GET /audit/:id` are
never paywalled. A losing bidder re-hashes the published memo and compares it with the chain; a
rationale written after the fact hashes differently and fails that check.

## Stack

Solidity 0.8.28 · OpenZeppelin 5.7 · Foundry (Arc profile) · ERC-8183 milestone escrow ·
NestJS indexer + evaluator · Next.js 15 · viem/wagmi · 303 tests.

## Honest status

Unaudited — these contracts hold escrow, so treat committed amounts as amounts you could lose. The
platform fee is **0 BP** and readable on-chain before anyone bids; the supplier pays it, not the
buyer, so a fee introduced later cannot be applied to a tender already priced against a published
rate. `ADMIN_ROLE` and `DEFAULT_ADMIN_ROLE` are not yet renounced: both are one-way, and freezing
the policy before its parameters have been exercised would be the wrong order.
