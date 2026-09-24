# For buyers

Posting a tender, choosing between the two bid modes, and what each figure on the form commits you
to. Read this once before your first tender; most of it you will not need again.

## What you are committing

When you post, the budget and your stake move into escrow. They are not spent — an award draws from
the budget and the remainder comes back to you — but they are locked, and a tender nobody funded
cannot be posted. That is what lets a supplier take your tender seriously enough to spend a deposit
bidding on it.

You can cancel while no bid has been committed, and everything returns. Once someone has bid, the
tender runs its course: they have put money at risk on the strength of it.

## Sealed or open

**Sealed** is the default and the one the integrity claim rests on. No bidder sees another's price
until the reveal window. Nobody can price against a rival, and the award can be re-checked against
the sealed bids afterwards. Use it when the purchase is contestable, when you may have to show the
award was fair, or when you simply do not want suppliers pricing off each other.

**Open** publishes every bid as it arrives. Suppliers undercut each other in the open, which is what
you want when the item is a commodity and price decides. Two things to know: the audit page will
record that this tender's prices were visible, because it cannot claim otherwise — and suppliers who
can watch each other to cut a price can also watch each other to *hold* one, which a sealed round
makes impossible.

## The figures

**Budget.** The most you will pay. The contract refuses an award above it, so this is a limit rather
than a target. The unspent remainder returns to you at award.

**Bid deposit.** What each supplier stakes to bid. Too low and bidding is free, which invites
unserious bids; too high and you narrow the field to suppliers who can afford the float. The winner's
deposit rolls into their performance stake rather than being returned.

**Your stake.** Your own skin in the game, held until the engagement finishes. It is what makes the
tender credible to a supplier who has been let down before.

**Retention.** A percentage withheld from each milestone and released when the last is accepted.
Standard practice, and the reason a supplier finishing the job matters more to them than finishing
a milestone.

**Milestones.** Any split summing to 100. Equal thirds suits services. For bulk goods the trade
convention is `30, 70` — a deposit against production and the balance against shipping documents.

**Delivery per milestone.** How long the supplier has, from the moment each milestone opens. It is a
*window*, not a date: the clock restarts each milestone. **Set it at least as long as the slowest
bid you would accept** — the contract now refuses an award to a bid quoting more days than the
window allows, so a short window quietly makes your best bids unawardable.

**Acceptance window.** How long you have to inspect after delivery before payment releases
automatically. Hours for a document. Days for anything physical. Letting it lapse pays the supplier,
which is the point: they should not be held hostage by silence.

## Scoring

You publish the weights — price, delivery, quality — before bidding opens, and they are hashed with
the rest of the tender. They cannot be adjusted after the prices arrive, which is the whole reason
they are published first.

The evaluator scores against those weights and writes a memo explaining the result. It recommends;
it cannot award. You award, and only to the supplier the recommendation named. If you disagree with
the recommendation, the honest move is to close the tender without award rather than to award
around it.

Nothing ties the weights to the category you chose. A price-dominant rubric on a consultancy tender
is permitted and is probably wrong; the form will not stop you.

## Requirements

Two kinds, and the difference is deliberate. **Checkable** requirements — a maximum delivery time, a
minimum number of completed engagements — are screened automatically and appear as red flags.
**Stated** requirements — a certification, an accreditation — are reported as *needing a person*,
never as satisfied, because nothing on-chain can verify them. A screening tool that ticked them off
because a supplier said so would be worse than one that admits it cannot tell.

## When something goes wrong

**The supplier is running late.** You can extend the delivery window, but only *before* it closes.
Afterwards nothing can reopen it — that would be reversing a forfeiture rather than preventing one.

**Nothing was delivered.** Once the window closes you recover everything that was never earned, plus
damages measured at what re-procuring would have cost — the next-cheapest revealed bid, less what
you awarded. The remainder of the supplier's stake returns to them.

**The work is wrong.** Reject the milestone with a reason. The reason is recorded, the money stays
locked, and the supplier may dispute it. A rejection nobody can read is indistinguishable from no
reason at all.
