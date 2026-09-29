# Filling in the form

Every field on the tender form, in the order you meet them, with what to type and the mistake each
one invites. Written for a first tender — if you buy for a living, the headings alone will do.

You do not need a company to post one. An individual buying a single machine and a procurement team
buying five hundred use the same form; where the answer differs, it says so.

## Before you start

You need a wallet with **USDC on Arc**, enough for the budget plus your stake plus a little for gas.
USDC is the gas token here, so there is no second currency to acquire.

The tender is funded the moment you post. That is the point — a supplier can see the money is
already there — but it means you cannot post one to "see what comes back" without committing the
funds.

## Details

**Type.** *RFQ* when you know exactly what you want and are choosing mainly on price and delivery —
five hundred scanners to a named specification. *RFP* when you are describing a problem and want
suppliers to propose an approach, so their method is judged too. If in doubt, RFQ: it is the
simpler contract and the faster round.

**Visibility.** *Public* lists the tender on the board for anyone to find. *Invited* restricts
bidding to addresses you name, and is the only setting that actually restricts anyone — everything
else on this form is published rather than enforced. Public is the right default unless you have a
reason.

**Invited suppliers** (invited only). One wallet address per line, or pasted comma-separated.
Suppliers you have completed a job with are offered as one-click additions. You can invite more
while bidding is still open, so a supplier who asks to be included is not shut out.

**How bids are taken.** *Sealed* hides every price until the reveal window; nobody can price
against a rival and the award can be re-checked afterwards. *Open* publishes each bid as it
arrives. Open suits commodities where price and speed decide — but suppliers who can watch each
other to undercut can also watch each other to **hold** a price, and the audit page will record that
this tender's prices were visible. For anything contestable, sealed.

**Scope** (or *Problem statement* in RFP mode). What you are buying, in enough detail that two
suppliers would quote the same thing. `500 barcode scanners, 2D, USB-C, 2-year warranty` is a good
scope. `Barcode scanners` is not — you will get five quotes for five different products and no
way to compare them. Put the specification here and the commercial detail in the terms document.

**Category** and **Delivery region.** Both published on-chain so suppliers can find work in their
field. Category is how a supplier filters the board; pick the closest, it does not affect scoring.
Delivery region is where the goods or work are **going**, not where the supplier is.

## Budget and stakes

**Budget (USDC).** The most you will pay. It is a ceiling the contract enforces — an award above it
is refused however well it scores — so set it to the most you would genuinely accept, not to what
you hope to pay. The unspent remainder comes back to you when you award. A budget far below the
market rate produces no bids rather than cheap ones.

**Bid deposit (USDC).** What each supplier stakes to place a bid, returned when they reveal. It
exists to make bidding cost something, so the field is people who mean it. Too low and you invite
unserious bids; too high and you exclude smaller suppliers who cannot float it. Somewhere near
5–10% of the budget is a reasonable starting point. The winner's deposit is not returned — it rolls
into their performance stake until the job is finished.

**Your stake (% of budget).** Your own money at risk alongside theirs, held until the engagement
finishes. It is what makes the tender credible to a supplier who has been let down before. There is
a minimum the policy enforces; above that it is a signal, and a bigger one costs you nothing if you
behave.

**Retention (% per milestone).** Withheld from every milestone payment and released only when the
final milestone is accepted. Ordinary construction and manufacturing practice: it is what makes
finishing matter more to a supplier than finishing *a milestone*. 5–10% is typical.

**Not a field, but it belongs here: the platform fee.** If the deployment charges one, it is
deducted from each milestone as that milestone is accepted and is borne by the **supplier** — you
pay the price you agreed, and they receive that much less. You cannot set it and it is not part of
your budget arithmetic, but it is published on the bid page and written into your terms, because a
supplier who found out after winning would have bid on a different deal. It is **zero** on this
deployment, and nothing about it appears anywhere while that is true.

## Timetable

The four preset buttons set every date and window together. **Demo** is for walking the system
through in one sitting — minutes, not days — and is not a tender anyone should bid on seriously.

**Bidding closes.** After this nobody can submit or change a bid. Give suppliers real time to
price: a day for something off a shelf, a week or two for anything that needs quoting from a
factory.

**Revealing closes.** Sealed tenders only in spirit — the window exists either way. Every bidder
must return and reveal in this window or forfeit their deposit. **Do not make it tight.** An hour
is fine for people watching for it; overnight is kinder and costs you nothing. The commonest cause
of a forfeited deposit is a reveal window that closed while someone slept.

**Award deadline.** Your own deadline to decide. Let it pass and the tender closes with no award,
deposits return, and everyone's time is wasted — so give yourself more than you think. This is the
one that most often lapses.

**Delivery per milestone.** How long the supplier has from the moment *each* milestone opens. It is
a window that restarts each time, not a final date: three milestones of 14 days is a six-week job.
**Set it at least as long as the slowest delivery you would accept** — the contract refuses an award
to a bid quoting longer, so a short window silently makes good bids unawardable.

Suppliers quote delivery in the same units you set here, so any window you can express is one a bid
can answer. Remember it is a deadline rather than a wait: a supplier can deliver the moment a
milestone opens, and the window only matters if they are late.

**Acceptance window.** How long you have to inspect before payment releases on its own. Hours for a
document, days for anything physical — and for goods it must cover **shipping plus inspection**, not
just your review. Letting it lapse pays the supplier, which is deliberate: someone who has delivered
should not be held hostage by silence.

## Delivery terms — physical goods only

Leave as *Not a goods tender* for anything delivered as a file, and skip to milestones.

**Delivery terms (incoterm).** Who pays for carriage and insurance, and — the part that matters —
where **risk passes** from supplier to you. The form states the risk point for whichever you pick.
This is the single thing most often left undefined in a goods contract and the first thing argued
about when a pallet arrives damaged.

**Named place.** The port, city or address the incoterm refers to. Required once an incoterm is
set, because the term says who pays but not to where. `Port Klang`, `Rotterdam`, `our Shah Alam
warehouse`.

**Transit allowance (days).** How long shipping is expected to take. It holds the acceptance clock
back until goods could plausibly have arrived, so a supplier is not paid automatically while the
container is still at sea.

## Milestones

**Milestones (% split).** Any list of percentages adding to 100, between one and ten of them. Equal
thirds suits services delivered in stages. `30, 70` is the trade convention for bulk goods — a
deposit against production, the balance against shipping documents. `100` pays once, on completion,
which is safest for you and hardest to get a manufacturer to accept.

More milestones means less money exposed at any moment, and more times you have to turn up and
inspect. That is the whole trade-off.

The field adds them up as you type and shows what each one is worth at your published budget, so a
split that is five per cent short — the usual way this goes wrong, by deleting a stage and
forgetting the rest — says so before you sign anything rather than reverting afterwards.

## Scoring rubric

**Rubric weights — price / delivery / quality.** How the evaluator scores, published before bidding
and hashed so it cannot be adjusted once prices arrive. `50 / 30 / 20` is a sensible default for a
defined purchase. Weight quality higher for an RFP where method matters.

Nothing ties the weights to what you are buying. A price-dominant rubric on a consultancy tender is
permitted and is probably wrong; the form will not stop you.

## What to quote

**Line items.** Optional. Leave empty for a single-line buy, or list item, quantity and unit so
every supplier prices the same basket. You can paste straight from a spreadsheet. Worth doing for
anything with more than one part, because it is what makes two quotations comparable.

## Terms and conditions

**Where to send quotations.** Published permanently with the tender, so use an address meant to be
public — `tenders@` or `procurement@`, never a personal inbox. Suppliers send the priced quotation
here; only its hash goes on-chain.

**Terms and conditions.** Press *Generate standard terms* for clauses built from the figures you
entered, then edit. These restate what the escrow actually does — they are **not legal advice and
not a complete contract**. Warranty, liability, governing law and termination are not things a form
can guess, and they belong in the attached document. Once posted, the terms are hashed and bind
you.

**Terms document.** Optional for an invited tender, where you can email the file. **Required in
practice for an open one**, since otherwise only the people you happened to email can read the
terms. It is uploaded so any supplier can download it, and hashed so they can prove their copy is
the one you published.

## Requirements

Everything in this section except *Visibility* is **published, not enforced**. An address has no
country and no certificate, so nothing on-chain can check these. They are screened by the evaluator
and flagged, which is worth having — but if you need to actually restrict who bids, use invited
visibility.

**Who may bid.** The supplier's own location, as distinct from where delivery goes. Leave open
unless it genuinely matters.

**Required delivery (days).** A bid slower than this is flagged automatically when revealed. Note
this is separate from *Delivery per milestone*, which is the one the contract enforces.

**Minimum completed jobs here.** Counted from this deployment's own record, not from anything a
supplier claims. Setting it above zero on a new deployment will exclude everybody.

**Other requirements.** One per line — `ISO 9001 certification`, `24-month warranty`, `Net 30
payment terms`. The evaluator marks these *unverified* rather than satisfied, because nothing
on-chain can confirm them. That is honest rather than useless: a supplier who ignores a stated
requirement is visible in the memo.

## When you submit

You will sign twice: once to permit the USDC, once to post. The budget and your stake move into
escrow, the tender appears on the board, and the metadata hash is fixed — after this the scope,
rubric and terms cannot be changed without every bidder seeing it.

## If you get something wrong

Nothing published can be edited. The scope, category, rubric and terms are fixed by a hash when the
tender opens, which is exactly what lets a supplier spend a day quoting against it — a tender whose
terms could move under them would be worth nothing. So a typo in the scope or the wrong category
cannot be corrected in place.

What you can do depends on whether anyone has bid yet.

**Nobody has bid: cancel and repost.** The Actions panel offers this while `0` bids are committed.
Your budget and stake come back in full, nothing has cost anyone anything, and you post a corrected
tender. This is the common case for a typo, because most mistakes are spotted in the first minutes.

**Somebody has bid: it runs its course.** Cancelling is refused once a sealed bid exists, because
that bidder has a deposit at risk on the strength of what you published. If the mistake makes the
tender unusable, the honest move is to let the award deadline pass and close it without an award —
everyone who revealed gets their deposit back, and you have lost only time. Say so in the
clarification round rather than leaving bidders to work it out.

**Closing without an award is a transaction, not a deadline.** Once the award deadline passes the
tender *reads* as closed, but the budget and your stake are still held by the contract until
somebody calls it. The Actions panel has a button; anyone may press it, because the money goes to
the buyer either way and a buyer who has given up is precisely the person who will not return to
press it.
