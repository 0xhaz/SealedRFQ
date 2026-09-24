# Verifying a decision

Every claim this project makes is supposed to be checkable by someone who does not trust it. This
page is how you do the checking — by hand, without our software, using only the chain and a
hashing tool.

## What is actually being claimed

Three things, and it is worth separating them because they are proved differently.

1. **The tender you bid on is the tender that was judged.** Proved by a hash fixed on-chain before
   bidding opened.
2. **The reasoning behind the award was written before the result, not after.** Proved by a second
   hash, anchored when the decision was made.
3. **Nobody could see a rival's price before the reveal.** Proved by the commit–reveal mechanism —
   and only for sealed tenders. An open tender makes no such claim, and its audit page says so.

Everything else — that a supplier is competent, that goods arrived, that a certificate is genuine —
is **not** claimed and cannot be. See the limits at the end.

## Checking the tender has not changed

The RFQ carries a `metadataHash` on-chain. The document it describes — scope, line items, terms,
rubric, requirements — is published separately.

Download the published document from the tender pack, then:

```
shasum -a 256 <the downloaded file>
```

Compare it with `metadataHash` on the RFQ. If they match, nothing has been edited since bidding
opened. If they do not, something changed after suppliers priced against it, and that is a serious
finding rather than a technicality.

## Checking the decision memo

The memo is the evaluator's reasoning: every bid, its score under each criterion, the flags raised,
and which supplier was recommended. Its hash is anchored in the `AttestationLog` contract.

To check it yourself:

1. Fetch the memo (`/audit/{id}` shows it, or the agent's API returns it)
2. Canonicalise it — [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785), which orders keys so
   that two systems serialising the same object produce identical bytes
3. Take the SHA-256 of those bytes
4. Read the attestation from the contract and compare

A memo rewritten afterwards hashes differently and fails at step four. This is why the reasoning is
worth something: not because we say it was written honestly, but because a later edit is detectable.

The `/audit/{id}` page does this for you and reports four distinct outcomes. They are deliberately
not collapsed into "valid / invalid":

| | Meaning |
|---|---|
| **Verified** | The published memo hashes to the anchored value |
| **Mismatch** | The memo has been altered since the decision. A serious finding |
| **Anchored only** | A decision is on-chain but this agent does not hold the memo |
| **None** | Nothing has been anchored for this tender |

"Anchored only" is not a failure. A decision can be anchored by an evaluator we do not run; saying
"not verified" for a decision the chain plainly recorded would be crying wolf.

## Checking the award itself

The contract enforces this, so it does not require trust — but it can be confirmed:

- The winner must have revealed a bid. A supplier who never revealed cannot be awarded.
- The award must cite an evaluation attested **for that specific winner**. Swapping in a different
  supplier reverts.
- The price must sit inside the published budget, the policy's caps, and the delivery window.

The evidence pack contains a deliberately reverted transaction where an over-budget award was
refused. That is the firewall working, and it is on-chain to be looked at.

## Checking a supplier's record

The supplier directory shows counts — tenders bid, revealed, won, engagements completed, milestones
delivered and rejected, and bids sealed but never revealed. Every one is derived from events the
chain published, so you can recount them from the chain yourself.

Deliberately not a score. A single number would be the one figure on this site nobody could
recompute, and a reputation derived by a formula only we know would be exactly the unaccountable
judgement this project argues against.

Company names, countries and certifications are **claimed**, signed by the wallet that published
them. The signature proves that address published those words. It proves nothing about whether they
are true, and the directory says so on every entry.

## What none of this proves

- **That goods exist or arrived.** The contract compares hashes. For a file, the hash is the thing.
  For a shipment it is a document about the thing, and a person still has to open the box.
- **That a certification is genuine.** Stated requirements are reported as needing a human, never as
  satisfied.
- **That the buyer or supplier is who they say.** Identity here is a wallet address and a signature.
- **That an open tender was not priced off rivals.** On an open tender everybody could see every
  price; that is the mode working as designed, and the audit page states it rather than inheriting
  the sealed claim.

The operator of a deployment also holds keys, and what those keys can and cannot do is set out in
the repository's README. Read it before trusting any deployment, including this one.
