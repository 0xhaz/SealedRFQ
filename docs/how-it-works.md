# How it works

A tender here runs in four acts: a buyer publishes what they want and funds it, suppliers bid
without seeing each other, the bids are scored against criteria fixed before any of them arrived,
and the winner is paid milestone by milestone as the work lands.

Nothing about that is new. What is new is that each step leaves a record you can check yourself,
rather than a claim you have to take on trust.

## The problem this is built around

Two people who have never met want to trade, and each has a reason to hesitate.

The supplier is asked to quote a price, disclose their costs, and start work — against a promise of
payment from a company they cannot chase cheaply if it does not arrive. The buyer is asked to hand
over money for goods they have not seen, to a supplier they cannot easily verify.

Procurement software has an answer to the second half. It has very little to say about the first,
and almost nothing to say about the question a losing supplier actually asks: *was that a fair
tender, or had they already decided?*

## Who does what

Three parties act on a tender, and the point of the design is that **none of them can do another's
job**. The evaluator judges but cannot award. The buyer awards but cannot judge for a second time.
The contract enforces but decides nothing.

![A sequence diagram across three lanes — buyer, evaluator and supplier. 1: the buyer posts a tender and funds it in the same transaction. 2: the supplier seals a bid and posts a deposit, which nobody can read. 3: bidding closes and the supplier reveals it. 4: the evaluator scores every revealed bid against the rubric published before bidding opened, writes a memo and anchors its hash on-chain, then recommends one bidder — it cannot award. 5: the buyer awards, and only the bidder the memo named. 6 and 7 repeat per milestone — the supplier delivers, and the buyer accepts or says nothing until the window lapses, with payment releasing either way. 8: final acceptance releases the retention and returns both stakes.](../apps/web/public/diagrams/tender-flow.svg)

Every arrow above is a transaction somebody signed. The contract sits underneath all of them and
refuses anything that breaks the published policy — over budget, too few bidders, a rubric that
does not match the one fixed at the start, a delivery longer than the tender allows.

### What each party cannot do

The negatives are the interesting half, because they are what the guarantees are made of.

| | Can | **Cannot** |
|---|---|---|
| **Buyer** | Publish and fund, invite, award, accept or reject a milestone with a reason, extend a delivery window, confirm receipt | Read a sealed bid, change the scope or rubric after posting, award anyone the evaluator did not name, award over budget, take back a released payment, cancel once a bid exists |
| **Evaluator** *(the AI)* | Score revealed bids, write and anchor a memo, flag a bid as non-compliant | **Award anything.** Score before the reveal window, score against a rubric other than the published one, move a single USDC |
| **Supplier** | Bid, reveal, deliver, dispute a rejection, reclaim a deposit | See a rival's price before reveal, change a bid after sealing it, extend their own deadline |
| **Operator** *(us)* | Hold role keys on this deployment — which ones is listed in the README and readable on-chain | Read a sealed bid, move escrow that is not in dispute, exempt an award from a policy check, or reverse a released payment |

That last row deserves the detail rather than a reassuring summary. On **this** deployment the
operator still holds role keys, and two of them matter: an arbiter can divide escrow on an
engagement the parties have already put into dispute, and an admin can change the policy that
future awards are checked against. Neither can reach a tender running normally, and neither can
reverse a payment that has released — but "the operator cannot touch anything" would be false, so
it is not claimed. Which roles are held is readable on-chain, and the README's table is meant to
match what is actually held at the time you read it.

### Where the AI actually sits

It is worth being blunt about this, because "AI procurement" usually means something looser.

The evaluator is **deterministic arithmetic**, not a language model: price, delivery and quality
weighted by the rubric the buyer published before bidding opened. Run it twice on the same bids and
it returns the same answer, which is the only reason a losing supplier can check it. It writes a
memo explaining the result and anchors that memo's hash on-chain **before** any award is possible.

So the sequence is fixed: **it reasons, then it is recorded, then a human commits.** Not the other
way round. A recommendation that appeared after the award would prove nothing.

And there is a cap on the other side of it. If an agent rather than the buyer sends the award
transaction, the contract refuses it above `agentAwardCap`. Above that figure a person signs, or
nobody does.

## Act one: the buyer publishes a tender

The buyer writes what they need, what they will pay for it, and how bids will be judged — then
funds the whole thing before a single supplier sees it.

That last part matters more than it sounds. The budget and the buyer's own stake are moved into
escrow when the tender is posted. A supplier deciding whether to spend time on a bid can see the
money is already there. A tender nobody funded is a request for free work, and this one cannot be
posted.

Everything the buyer publishes — the scope, the line items, the scoring weights, the terms — is
hashed, and that hash is written to the chain. Change a word afterwards and the hash no longer
matches. The tender you bid on is the tender that gets judged.

## Act two: suppliers bid, sealed

A sealed bid is submitted as a **commitment**: a hash of your price, your delivery time and your
proposal, with a secret only you hold. The chain records that you bid and takes your deposit. It
does not record what you bid, because nobody — not rivals, not the buyer, not us — can read it yet.

When bidding closes, everyone reveals. The contract checks each revealed price against the
commitment made earlier, so a bid cannot be altered after seeing the competition.

The deposit is what makes this binding. Reveal, and you get it back whether you win or lose. Fail to
reveal, and it goes to the buyer — because a sealed bid you can walk away from is a free option, not
a bid.

Some tenders run **open** instead, where every price is public as it arrives. That suits commodity
buying where speed decides. It is a different promise, and the pages that report on it say which one
was made.

## Act three: the decision, and why it can be checked

Once bids are revealed, an evaluator scores each one against the rubric the buyer published *before*
bidding opened — price, delivery and quality, weighted as stated. It writes a memo explaining the
result, and anchors that memo's hash on the chain.

The scoring is arithmetic, not judgement. That is deliberate: a decision worth money should be one
anybody can recompute, and a scorer that answered differently on a second run could not be checked
at all.

Then the part that is unusual. The evaluator **cannot award**. It recommends and signs its
reasoning. The buyer awards — and can only award the supplier the recommendation named. And the
contract refuses an award that breaks the published policy, whoever asks: over budget, too few
bidders, a rubric that does not match the one fixed at the start.

Three parties, three powers, none able to take another's. A losing supplier can read the memo,
re-hash it, compare it with the chain, and see that the reasoning was written before the result and
not after.

## Act four: payment follows the work

The award does not hand over the money. It opens the first milestone.

Each milestone holds only its own share in escrow, less a retention withheld until the end. The
supplier delivers, the buyer accepts, and that milestone releases. The most that is ever at risk is
one milestone, not the whole contract.

If the buyer goes quiet, the milestone releases anyway once the acceptance window passes. A supplier
who has delivered cannot be held hostage by silence.

Where a deployment charges a **platform fee**, it is taken here — a percentage of each milestone,
deducted inside the escrow as that milestone is accepted, and borne by the supplier rather than
added to the buyer's bill. Nothing accrues: it transfers to the treasury in the same transaction
that pays the supplier, so no operator ever holds a balance of other people's money in transit.
Retention is exempt, because final acceptance credits it directly rather than through an escrow
job. The rate is published on the bid page and written into the tender's terms before anyone bids,
because it changes what a supplier receives and they price against it. **It is zero here.**

If the supplier goes quiet, the delivery window closes and the buyer recovers what was never earned
— plus damages measured against what re-procuring would actually have cost, which the tender already
knows because the next-cheapest bid was revealed. The rest of the supplier's stake comes back. A
security is there to cover a loss, not to be confiscated because one occurred.

## What this cannot do

The contract can check that a document matches a hash. It cannot see a container.

For a deliverable that *is* a file — a report, a design, code — the hash is the thing, and the
guarantee is real. For physical goods the hash is a bill of lading: useful, checkable, and not the
same as proof the goods exist or arrived. There is a receipt step and a transit allowance to keep
the clock honest, but in the end a person inspects what turned up. The system's job is to make what
they decide attributable and bounded by time, not to decide it for them.

It also cannot tell you a supplier is competent, solvent or real. It can tell you exactly what they
have done here, counted from the chain, which is a smaller claim and a true one.
