# For suppliers

What you are agreeing to when you bid, what your deposit is actually at risk for, and what happens
if delivery slips. Worth ten minutes before your first bid.

## Read the tender before you bid

Every tender has a **tender pack** — scope, line items, commercial terms, timetable, requirements
and scoring weights, with the hashes that fix them. Open it. Everything in it was published before
bidding opened and cannot be changed afterwards without the hash failing, so what you read is what
you will be judged against.

Check the **delivery window** in particular. It is how long you have per milestone, and a bid
quoting more days than it allows cannot win — the contract refuses that award. You will keep your
deposit, but you will have wasted the bid.

If something is unclear, ask in the clarification round. Questions can be asked anonymously, because
asking one reveals something about your approach. Answers go to every bidder, always — an answer
given to one supplier and withheld from the rest is the favour sealed bidding exists to prevent.

## Sealed bids

Your price is hashed with a secret derived from your wallet. The chain records that you bid and
takes your deposit; it does not record what you bid. Nobody can read it — not rival bidders, not the
buyer, not the people who run this.

When bidding closes you reveal, and the contract checks your revealed price against the commitment
you made earlier. This is why nobody can alter a bid after seeing the competition, including you.

**Reveal, or you lose your deposit.** That is the one rule worth setting a reminder for. A sealed bid
you can abandon after seeing how the field looks is a free option rather than a bid, and the
forfeiture is what makes it binding. Reveal and your deposit comes back whether you win or lose.

The secret is derived from a wallet signature, so the same wallet can regenerate it even if you clear
your browser. The reveal file is a backup for the same thing. Keep at least one.

**Unless you bid from a team account, where the file is the only route.** A multisig signs with
whichever owners are available, and a different set of signers produces different signature bytes —
so a colleague revealing your bid would derive a different secret, which would not match what you
sealed. The reveal would fail and the deposit would be forfeited. If the address you bid from is a
contract, the bid page says so and the file stops being a backup: download it and put it somewhere
the person who reveals can actually reach. This is a limitation of how the secret is derived, not a
rule about who may bid, and it is one we intend to remove.

## Open tenders

Some tenders run in the open, badged as such on the board. Your price is public the moment you place
it. Rivals will see it and undercut you; you can see theirs and improve yours, as often as you like
while bidding is open, without paying a second deposit.

There is no reveal step and therefore nothing to forfeit for failing to reveal. If you would rather
competitors did not see your number, do not bid on an open tender.

## Being chosen

Bids are scored against the weights the buyer published before bidding opened — price, delivery,
quality. The scoring is arithmetic, and the memo explaining the result is published and anchored on
the chain.

**Read the weights before you price, because undercutting may not win.** Each criterion is scored as
a ratio against the best bid received, so what counts is how far apart the bids are on it rather
than the weight alone. Prices cluster; delivery often does not. A bid 5% cheaper but twice as slow
loses to one that is quicker, even on a rubric that weights price higher — the price gap is worth a
couple of points and the delivery gap fifteen. If you can move a lead time more easily than a
price, that is usually where the tender is decided.

**Your record here is worth real money, and it is worth knowing how much.** The quality score is
`50 + 10 for every engagement you have completed on this deployment`, capped at 100 — so five
completed jobs is the ceiling and a sixth adds nothing. On a typical 50 / 30 / 20 rubric, holding
delivery equal, that lets you price above a newcomer and still tie: about **4% with one completed
job, 8% with two, 20% at the cap**.

Which is the argument for taking a first job at a thin margin. It is also the reason the number
that matters most early on is not price at all — it is finishing, because until you complete one
engagement you score the same 50 as a wallet created this morning, however long you have been
trading. Nothing on-chain can see a reputation you earned elsewhere.

If two bids score exactly the same, the tie is settled by a fixed cascade — cheaper first, then
quicker, then the lower wallet address — so the outcome is one you can recompute rather than one
decided on the day. The last step is arbitrary; it only comes up when two bids match exactly, which
in a sealed tender you could not have arranged.

You cannot set the criteria — no supplier can, here or in any procurement process. What you can do
is **question them while bidding is open**, in the clarification round. Every answer goes to every
bidder, so asking whether a requirement is realistic costs you nothing and occasionally gets the
tender reposted. Once bids are in, the terms are fixed for everyone.

So if you lose, you can read exactly why: what each bid scored, what flags were raised, and which
one was recommended. Re-hash the memo yourself and compare it with the chain. A rationale written
after the fact hashes differently and fails that check. **You never have to pay to see why you
lost.**

The evaluator recommends; it cannot award. The buyer awards, and only to the supplier the
recommendation named — the contract refuses an award to anyone else, so a buyer who prefers a
different bid cannot simply take it. Their only alternative is to award nobody, which returns every
revealed bidder's deposit.

That is worth knowing when you price. **You are bidding against the published rubric, not against
the buyer's preference**, and nobody can quietly substitute the second for the first after seeing
what arrived.

## Delivering, and getting paid

The award opens the first milestone, with its share of the price in escrow less a retention held
until the end. You deliver, the buyer accepts, and it releases.

**If the buyer goes quiet, you still get paid.** Once the acceptance window passes, anyone can
trigger the release. You cannot be held hostage by silence — that guarantee is the point of the
clock.

Money released is *credited*, not transferred. It waits under **Your payouts** until you withdraw
it, which is one transaction whenever suits you.

**If a platform fee is set, you pay it, not the buyer.** It is deducted from each milestone inside
the escrow when that milestone is accepted, so you receive less than you quoted while the buyer
pays the quoted price in full. It is charged after retention is withheld and never on the retention
itself, which reaches you whole at final acceptance. The bid page says the rate before you bid and
the tender's terms state it — **price it in**. It is zero on this deployment, and the bid page says
nothing at all when it is.

For physical goods there is a transit allowance before that clock starts, so a buyer is not paying
for a container still at sea. If they confirm receipt, the inspection window runs from arrival
instead — which is sooner, so it is in their interest as well as yours.

## If you are going to be late

**Tell the buyer before the window closes.** They can extend it — that is the only thing anywhere
that can move a delivery deadline, and it stops working the moment the deadline passes. There is a
private, encrypted thread with them on the tender page for exactly this.

If the window closes with nothing delivered, the buyer recovers what was never earned and damages
measured at what re-procuring would have cost them — the next-cheapest revealed bid, less what you
were awarded. **The rest of your stake comes back.** You are not stripped of everything regardless of
what it cost them; the security covers the loss and the surplus is returned.

Note that a delay caused by *your own* supplier is not treated as an excuse anywhere in procurement,
here included. Choice of manufacturer is the supplier's risk, and the assumption is that you priced
it.

## Building a record

Everything you do here is counted from the chain and shown on the supplier directory: tenders bid,
revealed, won, engagements completed, milestones delivered and rejected — and bids sealed but never
revealed.

That last number is the least flattering one you have and the one buyers will look at hardest. It is
also the only evidence that someone treats a sealed bid as a free option. You can publish a company
profile alongside it, signed by your wallet so nobody can write one in your name, but the counted
half is not editable by anyone, including you.
