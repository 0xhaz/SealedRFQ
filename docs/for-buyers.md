# For buyers

Posting a tender, choosing between the two bid modes, and what each figure on the form commits you
to. Read this once before your first tender; most of it you will not need again.

If you are looking at the form now and want to know what to type in a particular box,
[Filling in the form](filling-in-the-form.md) goes through every field in order. This page is the
reasoning behind those choices.

## What you are committing

When you post, the budget and your stake move into escrow. They are not spent — an award draws from
the budget and the remainder comes back to you — but they are locked, and a tender nobody funded
cannot be posted. That is what lets a supplier take your tender seriously enough to spend a deposit
bidding on it.

You can cancel while no bid has been committed, and everything returns. Once someone has bid, the
tender runs its course: they have put money at risk on the strength of it.

Nothing published can be edited either — scope, category, rubric and terms are fixed by a hash when
the tender opens. That is what makes it worth a supplier's time to quote. A mistake spotted before
the first bid is a cancel-and-repost; after it, the tender has to finish.

And closing a tender that found no winner is a **transaction**, not a deadline. Past the award
deadline the tender reads as closed while the budget and your stake are still held by the contract.
Someone has to close it to release them — anyone may, since the money returns to the buyer
regardless.

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

### Weights say how much a criterion *can* swing, not how much it will

This surprises people, so it is worth the arithmetic. Every criterion is scored as a ratio against
the best bid received — the cheapest price scores 100, and a bid at twice that price scores 50.
The same for delivery.

So the influence a criterion actually has depends on **how far apart the bids are on it**, not on
its weight alone. A real round:

| | Price | Delivery | Score |
|---|---|---|---|
| Supplier A | 2.95 | 5 days | **87.5** |
| Supplier B | 2.80 | 10 days | 75.0 |

B is cheaper and still loses, on a rubric weighted 50 price / 30 delivery. B's price advantage is
5%, worth 2.5 points. A's delivery advantage is 2×, worth 15. Six times the effect, from the
criterion carrying the *lower* weight.

Nothing is wrong there — halving a lead time is a bigger operational difference than paying 5% more,
and the rubric said delivery was worth 30. But if that is not the trade you meant, the fix is the
rubric rather than the result: raise the price weight, or tighten the delivery window so slow bids
are **excluded** rather than merely marked down. The window is a hard limit; the rubric is a soft
one.

In practice prices cluster — suppliers converge on the market rate — while delivery can differ by
multiples. So delivery often decides a tender that price was supposed to.

### A high score does not mean awardable

The rubric scores every revealed bid, including ones the contract will refuse. A bid over budget
still gets a number, with a red flag beside it. The flags and the contract's own checks are what
stop a bad award; the score is not a permission.

### You cannot award around the recommendation

Once the bids are revealed you have **two** choices, not three: award the supplier the evaluator
named, or award nobody.

Awarding somebody else is not a policy we ask you to respect — the contract refuses it. The
recommendation is anchored against that specific winner, so an award naming anyone else finds no
recommendation and the transaction reverts. This is the same rule that stops *us* awarding around
it, and it is why the tender can claim it was decided by criteria fixed before any bid arrived. A
buyer free to override afterwards would make the published rubric decoration.

It is stricter than common practice and closer to procurement law than common practice is: in a
classic tender a panel recommends and a decision-maker may decline, but deviating from the
published criteria is exactly what gets an award overturned on challenge.

**If you want a different winner, closing without award is the only route — and it is expensive in
a way that is easy to miss.** Deposits return and nobody is out of pocket, so the cost is not
financial. The cost is that **every price is now public.** A re-run is no longer a sealed tender:
each supplier knows precisely what the others bid last time, so the second round is a different
game, usually a worse one for you, and the fairness claim that made the first round worth entering
does not apply to it.

So the judgement belongs **before** bidding opens, because that is the only moment it is free. If
the cheapest bid should win, weight price at 100 and delivery at 0 and the arithmetic will do what
you meant. If lead time genuinely matters less than the rubric says, change the rubric while you
still can — not the outcome afterwards, which you cannot.

## Requirements

Two kinds, and the difference is deliberate. **Checkable** requirements — a maximum delivery time, a
minimum number of completed engagements — are screened automatically and appear as red flags.
**Stated** requirements — a certification, an accreditation — are reported as *needing a person*,
never as satisfied, because nothing on-chain can verify them. A screening tool that ticked them off
because a supplier said so would be worse than one that admits it cannot tell.

## Buying as a team

Most buying is not one person's job. A requisition comes from one place, approval from another, and
above some figure a second signature is required — a delegation of authority that already exists in
writing at most companies.

By default a tender is posted from one wallet, which means **one private key carries your entire
purchasing authority**. That is fine for a sole trader and uncomfortable for anyone else: the person
holding it can award unilaterally, and if they leave you have a problem with live tenders.

**Team accounts are coming, and are not usable yet.** The contracts already support them: every
permission check asks *which address is calling*, never whether that address is a person, so a
multisig satisfies them exactly as a single wallet does, and Safe is deployed on Arc. What is
missing is on this end — the app connects browser wallets only, so there is currently no way to sign
*as* a Safe rather than as one of its owners. Connecting an owner's wallet makes that person the
buyer, which is the thing a team account exists to avoid.

This section describes where this is going, so you can plan around it. What it will buy you:

- **A threshold.** Two signatures above a figure, one below it, however your own rules read.
- **Segregation of duties.** The person who requests need not be the person who approves, which is
  ordinary practice and impossible with a single key.
- **Continuity.** Someone leaves, you rotate the owners, and live tenders are unaffected.

Every buyer action would run through it — awarding, accepting a milestone, confirming receipt,
extending a delivery window — so an award genuinely requires whoever your threshold says it
requires. Tenders posted from a team account are already labelled on the tender page with their
threshold, because a supplier deciding whether to spend a day preparing a bid should know whether
the counterparty has internal controls or is one person with a hot key.

We deliberately will not manage the account here. Adding and removing owners is the one screen where
being wrong locks a company out of its own money, and Safe has spent years getting it right.

**What is verified and what is not.** Safe is deployed on Arc, and nothing in these contracts
assumes a single-key wallet — both checked. Connecting one is not built, and no tender has ever been
run from a team account. Until both are true, post from an ordinary wallet.

There is a second kind of delegation worth knowing about: an address holding the awarder role can
award without being the buyer, capped at a figure the policy sets. That is how an agent is allowed
to act, and it is the same mechanism that would let a junior buyer award below a threshold.

## How you find out a supplier is waiting

Nothing here emails you, and that is deliberate rather than unfinished. A tender identifies people
by wallet address, and an address is not a contact method — nothing can send to `0x0C01…`.
Collecting email addresses would mean accounts, passwords and a database of who is buying what,
which is a larger thing to trust than the contracts are.

So notice is **pulled, not pushed**: connect your wallet and the board lists what is waiting on you,
including any question a supplier has asked and nobody has answered. Questions close when bidding
does, and you cannot answer after that, so the item disappears once acting on it is no longer
possible.

The practical consequence: if you post a tender and never return until the award deadline, you will
have missed every question asked in between. Look in once a day while bidding is open — the panel
is at the top of the board and says nothing at all when there is nothing to do.

## When something goes wrong

**The supplier is running late.** You can extend the delivery window, but only *before* it closes.
Afterwards nothing can reopen it — that would be reversing a forfeiture rather than preventing one.

**Nothing was delivered.** Once the window closes you recover everything that was never earned, plus
damages measured at what re-procuring would have cost — the next-cheapest revealed bid, less what
you awarded. The remainder of the supplier's stake returns to them.

**The work is wrong.** Reject the milestone with a reason. The reason is recorded, the money stays
locked, and the supplier may dispute it. A rejection nobody can read is indistinguishable from no
reason at all.
