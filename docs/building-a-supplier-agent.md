# Building a supplier agent

Everything here is a public HTTP endpoint or a public contract call. You do not need our web app to
bid, and nothing about this integration requires permission from us — that is deliberate. A supplier
who wants their own software watching for tenders in their category, pricing them and bidding should
be able to build it.

## What you need

- A wallet with USDC on Arc. USDC is both the gas token and the settlement asset.
- The registry address and chain id, from `GET /meta` below.
- An HTTP client and an Ethereum library. Examples use viem; anything works.

## Finding tenders

The agent indexes the chain and serves it as JSON. It is a convenience, not an authority — every
figure it returns is derived from events you could read yourself, and for anything that matters you
should.

```
GET  /meta                     chain id, contract addresses, which roles the agent holds
GET  /rfqs                     every indexed tender, newest first
GET  /rfqs/{id}                one tender with its bids, engagement, milestones, attestations
GET  /rfqs/{id}/clarifications the public question thread
GET  /stats                    totals for the deployment
```

Filter on `category` and `region` — both are `bytes32` labels on-chain from a fixed vocabulary, so
they are searchable rather than free text. `GET /meta` tells you the registry address; watch
`RFQCreated` on it directly if you would rather not depend on the indexer at all.

Read `metadataURI` for the published document: scope, line items, scoring weights, requirements,
shipment terms. **Hash it and compare with `metadataHash` on-chain before you price anything.** If
they differ, the tender has been edited since it was published.

## Checking you can win before you spend a deposit

Four things will make a bid worthless. All are readable up front.

- **Invite-only.** `isInvited(rfqId, you)` must be true if `inviteOnly` is set.
- **Qualification.** If `requiresQualification`, the qualifier must return true for you.
- **The delivery window.** `deliveryWindow` is seconds per milestone. A bid quoting more days than
  it allows **cannot be awarded** — the contract refuses it. You keep your deposit, but the bid is
  wasted.
- **Budget.** A price above `budget` cannot be awarded either.

## Bidding: sealed

Read `bidMode` on the RFQ. `0` is sealed, `1` is open.

A sealed bid is a commitment, and the preimage must match exactly what the contract computes:

```solidity
keccak256(abi.encode(
  registryAddress, chainId, rfqId, bidder, price, deliverySeconds, proposalHash, salt
))
```

`price` is `uint128` in 6-decimal USDC units. `deliverySeconds` is `uint32` — **seconds**,
not days, so it can answer a window of any length the buyer set. `proposalHash` is the
sha256 of your proposal document, or 32 zero bytes if the tender does not require one.

**The salt is yours to choose.** Random bytes are fine if you will store them. Our web app derives
it from a wallet signature instead, so a bidder who loses their machine can regenerate it:

```
salt = keccak256(signature over the message below)

SealedRFQ — derive the secret for one sealed bid.

Signing this does not move funds. It regenerates the secret that hides your bid price,
so you can reveal later even if you lose the downloaded file.

chain: {chainId}
registry: {registryAddress}
rfq: {rfqId}
bidder: {yourAddress}
version: sealedrfq.salt.v1
```

Most wallets sign deterministically (RFC 6979), so the same message yields the same salt — but that
is not guaranteed by the specification. If you rely on it, verify by recomputing the commitment and
comparing with what the chain recorded before you need to reveal.

Then:

```
commitBid(rfqId, commitHash)            deposit must be approved first
commitBidWithPermit(rfqId, commitHash, deadline, v, r, s)    one transaction instead of two
```

Re-committing before the deadline replaces the hash and takes **no** second deposit, so you may
revise a sealed bid while bidding is open.

**Reveal in the reveal window or lose the deposit.** This is the only part with a hard deadline and
a real cost:

```
revealBid(rfqId, price, deliverySeconds, proposalHash, salt)
```

## Bidding: open

No commitment and nothing to reveal — the price is public when placed.

```
placeOpenBid(rfqId, price, deliverySeconds, proposalHash)
```

Call it again to improve your own bid, as often as you like while bidding is open. The deposit is
taken once. There is no reveal step and therefore nothing to forfeit by missing one.

## After an award

```
AgenticCommerce.submit(jobId, deliverableHash, "")
```

`jobId` is `currentJobId` on the engagement. `deliverableHash` is the sha256 of whatever you are
delivering — the file itself for a digital deliverable, or the shipping document set for goods. Send
the actual file to the buyer however you normally would; only the hash goes on-chain.

Then the clock runs. If the buyer accepts, the milestone releases. If the buyer says nothing, it
releases anyway once the acceptance window passes — for goods, after a transit allowance, unless
they confirm receipt sooner. Money released is credited, not transferred: call `withdraw()` on the
adapter when it suits you.

If you are going to be late, ask the buyer to extend the window **before it closes**. Nothing can
move a delivery deadline afterwards.

## Publishing what your company is

```
POST /suppliers/{address}/profile
{ "name": "...", "country": "MY", "categories": "HARDWARE",
  "website": "...", "contact": "...", "about": "...",
  "ts": 1790000000, "signature": "0x..." }
```

Sign this message with the wallet the profile describes, or it is rejected — that is the one attack
a directory of unverified claims has to stop:

```
SealedRFQ supplier profile
address:{lowercase address}
name:{name}
country:{country}
categories:{categories}
website:{website}
contact:{contact}
ts:{unix seconds}

{about}
```

The timestamp must be within ten minutes of now. Nothing you publish here is verified by anyone,
including us, and the directory says so beside it. Your counted record — bids, wins, completions,
and bids never revealed — comes from the chain and is not editable by anybody.

## Rates, costs and etiquette

Read endpoints are free and unauthenticated. `POST /rfqs/{id}/evaluate` is metered over x402;
everything a losing bidder needs to see why they lost is free and always will be.

Arc's public RPC endpoints rate-limit under load and return 429. The web app rotates between them;
your agent should too, and should back off rather than retrying hard.

Prefer watching events over polling `GET /rfqs`. The indexer is one process and you are not its only
caller.
