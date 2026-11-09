# Concordium light client on Arc: design sketch

Written 2026-11-10, before any implementation, because the storage choices here are expensive to
undo once a contract is deployed.

This is the remaining work under ADR-007 option C. Everything else about option C is measured and
settled; see [`workplan_v2.md`](workplan_v2.md) for those numbers.

## What it has to answer

Two questions, at two moments, and they are the same question:

1. **At bid time:** is this bidder qualified, according to Concordium, right now?
2. **At award time:** is that still true?

Concordium's own verifier is blunt that the second does not follow from the first.
`Presentation::verify` checks "only the cryptographic consistency of the data. It does not check
metadata, such as expiry." A proof that verifies says nothing about whether the credential behind
it has since been revoked. So the light client is not an optimisation of proof verification, it is
the thing that makes a proof mean anything at award.

## Proven end to end, 2026-11-10

A real mainnet quorum certificate verifies on Arc. Round 10506057, 72-member committee, 51
signatories carrying 68.2% of effective stake, pulled from
`grpc.mainnet.concordium.software` along with the committee for the same block, and checked
against forked Arc mainnet state in **250,508 gas**, about half a cent.

Two details were settled by testing rather than assumption, and both would have been easy to get
wrong:

**The message is signed against the current era's genesis, not the original.** From
`quorumSignatureMessageBytes` in the node's `KonsensusV1/Types.hs`, a finalizer signs
`"QUORUM." || genesisHash || blockHash || round(u64 BE) || epoch(u64 BE)`. Each protocol update
starts a new era with its own genesis, and mainnet is on protocol 10. The fixture generator tries
both and records which verifies; the original genesis fails.

**Quorum is two thirds of stake, not of signatures.** In this certificate 51 of 72 is 70.8% by
headcount but 68.2% by stake. A verifier that counted signatures would accept certificates a
stake-weighted rule rejects, so the contract sums stake.

## What Concordium gives us

Since Protocol 6, ConcordiumBFT produces a `QuorumCertificate` per round:

```rust
pub struct QuorumCertificate {
    pub block_hash: BlockHash,
    pub round: Round,
    pub epoch: Epoch,
    pub aggregate_signature: QuorumSignature,   // BLS, aggregated
    pub signatories: BTreeSet<BakerId>,         // who signed, ascending
}
```

A block is final once it and its child both carry quorum certificates in consecutive rounds of the
same epoch. A quorum is two thirds **by effective stake**, not by headcount, which matters: the
contract has to sum stake, not count signatures.

The finalization committee is the highest-staked subset of bakers, sized by governance parameters
(`min_finalizers`, `max_finalizers`, `finalizers_relative_stake_threshold`) introduced in P6.

## The design

### Verification, per certificate

Aggregate the signatories' public keys in G2 and run one pairing against the aggregate signature.
The measured primitives make the approach obvious:

| Operation | Measured on Arc |
|---|---|
| One G2 addition | 1,944 gas |
| G2MSM, k = 16 | 259,767 gas |
| BLS pairing plus hash-to-curve | 246,324 gas |

Aggregation is repeated `G2ADD`, not `G2MSM`. The scalars are all one, so a multi-exponentiation
pays for generality nobody is using: at k = 16 it costs 260k against 29k for fifteen additions.

**Subtract the absentees rather than adding the signers.** The epoch's total committee key is
aggregated once; a certificate then needs one G2 addition per baker who did *not* sign. Quorum
rules guarantee turnout above two thirds, so absentees are always the smaller set, and usually much
smaller.

### Storage, which is where this could go wrong

The tempting design is to store the committee on-chain: baker id, BLS key, stake. A G2 key is 256
bytes, so that is nine storage slots per baker, around 180,000 gas each, and a hundred-member
committee would cost roughly 18 million gas to rotate every epoch. That is not a cost to optimise,
it is a design to reject.

Instead, store per epoch:

- the aggregate committee public key, one G2 point
- the total effective stake
- a Merkle root over `(bakerId, key, stake)`, sorted by baker id

and have the caller supply the absentees with their Merkle proofs. The contract subtracts them from
the aggregate, subtracts their stake from the total, and checks the remainder against the two
thirds threshold.

### What it costs

Calldata dominates once the committee is large, since each absentee carries a 256-byte key:

Measured against the live chain rather than guessed. Mainnet governance currently sets
`minimumFinalizers` to 40, `maximumFinalizers` to 1000 and the relative stake threshold to 0.005%,
and a real quorum certificate at round 10505926 carried **53 signatories out of a 72-member
committee**.

| Committee | Absent | G2 adds | Calldata | Merkle | Pairing | Total | USDC |
|---|---|---|---|---|---|---|---|
| **72 (live)** | **19** | 36,936 | 155,648 | 15,960 | 246,324 | **454,868** | **$0.009** |
| 1000 (the governance maximum) | 333 | 647,352 | 3,194,880 | 444,096 | 246,324 | 4,532,700 | $0.091 |

So a certificate costs about a cent to verify today. Even if the committee grew to the maximum the
chain parameters permit, which is fourteen times its current size, verification stays under ten
cents and uses 15% of a block.

A tender needs two verifications, one at bid and one at award, so the chain cost of enforcing
Concordium eligibility is a few cents per tender even for a large committee.

**Not every block is verified.** The contract tracks checkpoints, not the chain. A tender needs a
verified Concordium state root at two moments, so two certificates are verified per tender rather
than one per round.

## Open, and needed before implementation

1. ~~The live committee size.~~ **Answered 2026-11-10** by querying
   `grpc.mainnet.concordium.software:20000` with the protos from `concordium-grpc-api`, since the
   node exposes reflection for health only and CCDScan's documented GraphQL hosts return 404. The
   numbers are in the table above. Worth rechecking before launch, because they are governance
   parameters and can be voted up.
2. **Epoch transitions.** A new committee has to be introduced by something the contract already
   trusts, which means the previous committee signing the next one, through `EpochFinalizationEntry`.
   The bootstrap case, the very first committee, is a trusted write and should be stated as such
   rather than dressed up.
3. ~~How far behind Arc may be.~~ **Decided 2026-11-10: fail closed, everywhere.** If the current
   reward period's committee is not registered, every check reverts. No grace period, and no
   softer rule at bid than at award.

   The alternative considered was a bounded grace at bid with strict checking at award, on the
   grounds that a wrong "yes" at bid is caught by the award re-check while a wrong "no" can cost a
   supplier a tender they cannot get back. The consequence analysis holds, but the implementation
   does not: two rules mean two chances to apply the wrong one, the whole argument rests on an
   award re-check being unskippable along every path, and a stale registry under grace produces no
   visible symptom until award. This project has already been bitten by a component reporting
   healthy while doing nothing.

   Fail closed is one invariant, states in a line, and fails loudly.

   **The cost it leaves, and where that belongs.** A supplier can lose a bidding window because the
   updater was down, through no fault of their own. That is real, and the answer is the tender
   timetable rather than the verification rule: a buyer can extend a bidding window that closed
   while the registry was stale, which turns an unrecoverable loss into an administrative one.
   `periodsBehind()` is public so the condition is visible rather than inferred. Not yet
   implemented; tracked here so the mitigation is not forgotten along with the reason for it.

   With 24-hour reward periods there is a full day of slack before anything fails.
4. **`GlobalContext`.** The proof transcript binds Concordium's cryptographic parameters, so the
   verifier needs the same ones. They change rarely, so they can be stored once and updated by the
   same mechanism as the committee.

## Point compression, which the contract should never see

Concordium serialises BLS points compressed: the aggregate signature in a real certificate is 48
bytes, which is a G1 x-coordinate with a sign bit. EIP-2537 takes uncompressed points, 128 bytes
for G1 and 256 for G2, and decompressing means a square root in the field, or in Fp2 for a public
key, which is a modexp the contract would pay for on every call.

It does not have to. Whoever submits a certificate supplies the uncompressed form, and a wrong one
simply fails the pairing. The precompiles also perform the subgroup checks that would otherwise
have to be written by hand, so a point that is off-curve or off-subgroup is rejected by the
precompile rather than trusted. Compression is a wire format, and converting it is the submitter's
job.

Committee keys are stored uncompressed in the epoch Merkle tree for the same reason.

## Built, 2026-11-10

`ConcordiumEpochRegistry` holds one committee per reward period and verifies certificates against
it, fail closed. Measured against the real mainnet fixture, 72 members and 51 signers:

| | Gas |
|---|---|
| Execution | 354,778 |
| Calldata, if sent by an account | ~331,776 |
| **Total** | **~686,000**, about $0.014 |

**The committee is a hash, not a Merkle tree.** The sketch above had callers prove each signer with
a Merkle path. Supplying the whole committee and a bitmap of who signed turned out cheaper, 685k
against 810k, because Merkle paths cost more calldata than the twenty-one absent members they save.
It also removes a tree to build, store and get wrong.

**Signers are added rather than absentees subtracted.** Subtraction is fewer G2 additions, since
quorum guarantees more signers than absentees, but it needs every key negated and a caller-supplied
negation has to be checked. The saving is under a cent and the extra path is not worth it.

A note on measuring: the first number this produced was 1.78M, and most of it was the test reading
the committee out of its own storage. 20,736 bytes is 648 words and a cold word is 2,100 gas. The
registry never pays that, the test did, and a figure like that is exactly the kind that gets quoted
later as though it meant something.

## The fallback, kept deliberately

The qualification check stays behind an interface. If the light client is not ready, a signed
attestor drops in without touching the registry. That is ADR-007 option A as a contingency rather
than as the plan, and the point of writing it down is that the contingency must stay cheap to
exercise rather than becoming a rewrite.
