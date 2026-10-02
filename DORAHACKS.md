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
| **Award** | The contract refuses to award any supplier the published evaluation did not name. The buyer can award the recommended bidder, or nobody — there is no third option |
| **Deliver** | Payment runs milestone by milestone through ERC-8183 escrow, with retention released at final acceptance |
| **Silence** | If the buyer goes quiet past the acceptance window, **anyone** can trigger release. A supplier who delivered cannot be held hostage |

## The part that is enforced, not promised

These limits are checked by the contract at the moment of award, not by the application around it.
Every row below is a real call against the **live mainnet policy contract** — anyone can repeat
them, and the right-hand column is the refusal the contract gives back:

| Case | Result |
|---|---|
| 2.80 on a 3.00 budget | allowed |
| 3.40 on a 3.00 budget | `AwardExceedsBudget` |
| one revealed bid | `InsufficientBidders` |
| deposit under 5% of price | `DepositRatioTooLow` |
| rubric ≠ the hash published before bidding | `RubricMismatch` |
| 75% of spend to one supplier, above the $250k floor | `ConcentrationCapExceeded` |
| the same concentration, below the floor | allowed |

Two of those caps do quite different jobs, and it is worth separating them.

The **concentration cap** limits how much of a buyer's cumulative spend may go to one supplier —
60% here — and it applies to the buyer's own awards, not only the agent's. A buyer cannot waive it
for themselves, which is the point: routing repeat business to a favoured supplier is the ordinary
shape of procurement abuse, and it is done by the person with the authority to approve it. It binds
only once that buyer's cumulative spend passes $250,000, so a small buyer with one supplier is
never blocked from using them.

The **`agentAwardCap`** is a separate limit, and it constrains only the agent: $100 is the most the
evaluator may award without the buyer pressing the button themselves. A buyer is never capped by
it. Zero is the fail-safe value — it switches agent awards off entirely — so a deployment that
forgets to configure this ends up with a human in the loop rather than an unbounded agent.

## AI recommends; the contract decides

The evaluator scores bids by arithmetic against the published rubric. It does not call a language
model, and the deployment holds no API key to call one with. That is deliberate rather than
unfinished: a score has to be reproducible by anyone holding the same rubric and the same bids, and
a model's answer is not.

Every decision is published along with the name of whatever produced it, and that name is hashed
onto the chain permanently. So the agent **refuses to start** if it is configured to use an AI
provider it cannot actually call — a deployment that advertised a model it never ran would be
making exactly the kind of unverifiable claim this project exists to remove. It reports itself as
`deterministic-rubric-v1`, which is what it is.

When two bids score the same, the tie breaks on a fixed order — cheaper first, then quicker, then
the lower wallet address. A losing bidder can therefore recompute the result themselves instead of
taking it on trust.

## Why Arc

- **USDC is both the gas token and the settlement asset**, at a single system address. A tender
  never touches a second asset: the deposit, the escrow, each milestone payment and the evaluation
  fee are all the same USDC the buyer already holds, and a supplier is never paid in something they
  have to sell before it is money.
- **One confirmation is final.** There are no reorganisations to wait out, so nothing in the app
  counts confirmations before treating a tender as live. It also means the chain's own randomness
  is never used anywhere — on any chain that value is weak enough for a miner or validator to
  influence, and a sealed bid must not depend on it. The secret that seals a bid is derived from
  the bidder's own wallet signature instead.
- **Payments are pull, not push.** Arc enforces a compliance blocklist, so a payment pushed to a
  blocked address fails — and inside a shared escrow, that failure would stall the counterparty's
  money too. Here a payment is credited to the recipient and they withdraw it when they choose, so
  a blocked recipient parks their own funds and nobody else's milestone is held up.

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

Scoring a tender early — ahead of the schedule it would otherwise run on — costs **$0.05 in USDC**.
It is charged with x402, the HTTP payment standard, and settled through Circle Gateway. The agent
publishes its own price list, so a buying agent can look up what a call costs before committing to
it rather than discovering the price from a rejected request.

**Reading why you lost is free, and always will be.** The endpoints that return the evaluation and
the full audit trail are never charged for. A losing bidder re-hashes the published decision memo
and compares it against the hash stored on-chain: a rationale rewritten after the fact produces a
different hash and fails that check. The payment buys speed, never the explanation.

## Stack

Solidity 0.8.28 · OpenZeppelin 5.7 · Foundry (Arc profile) · ERC-8183 milestone escrow ·
NestJS indexer + evaluator · Next.js 15 · viem/wagmi · 303 tests.

## Honest status

Unaudited — these contracts hold escrow, so treat committed amounts as amounts you could lose. The
platform fee is **zero** and readable on-chain before anyone bids; the supplier pays it, not the
buyer, so a fee introduced later cannot be applied to a tender already priced against a published
rate. The administrative roles — which can change the policy limits and the fee — have not yet been
given up. Giving them up is irreversible and freezes those settings for good, which is the
intention eventually; doing it before the limits have been exercised on a real tender would be the
wrong order.
