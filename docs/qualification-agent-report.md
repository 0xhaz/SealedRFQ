# Qualification Agent: report

## What was built

- `apps/agent/src/modules/qualifier/qualifier.core.ts`: Nest-free core, `qualify(input, deps)`. The
  script and the HTTP service run this same code.
- `apps/agent/src/modules/qualifier/qualifier.service.ts`: Nest service wiring the core to
  `ChainService` (role `CCD_QUALIFIER`, added to `Role`), a Concordium gRPC client, and
  `fetchFinalityProof`.
- `POST /qualifications` in `api.controller.ts`, behind `TokenGuard`. Body:
  `{ subject, bidder, tenderId, synthetic }`. `synthetic` must be stated as a boolean.
  Status mapping: recorded and already-qualified 200, `nullifier-used` 409, `registry-behind` 503,
  `below-quorum` 422.
- `scripts/concordium/record-qualification.mjs` with `--dry-run`. Requires `--synthetic`; it refuses
  to run without it because it has no verified-presentation input.
- `.env.example`: documented `CCD_QUALIFIER_*`, `V2_*` and `QUALIFICATION_NULLIFIER_SECRET` (empty).
  A 32-byte secret was generated into the gitignored `.env.testnet`. The qualifier key was never
  printed or logged.
- `apps/agent/test/qualifier.test.ts`: 9 tests.
- Dependencies added to `apps/agent`: `@sealedrfq/concordium` (workspace) and `@concordium/web-sdk`.
  No `@sealedrfq/db`.

Behaviour, in order: derive the nullifier from `subject` + tender + the agent-held secret (callers
supply a subject, never a nullifier); read `qualificationOf`/`isQualified` and send nothing if the
same nullifier is already recorded and unexpired; fetch the agent's own finality proof; simulate
`recordQualification` (a refusal then costs no gas); send; read back `isQualified` and
`qualificationOf`. Reverts are decoded from the revert data into four separate outcomes:
`nullifier-used`, `registry-behind` (StaleRegistry, CertificateTooOld, CertificateFromTheFuture),
`below-quorum`, `already-qualified`. Any other revert is rethrown, not relabelled.

## Tests

| | before | after |
|---|---|---|
| `apps/agent` (`pnpm test`) | 79 passing | 88 passing (10 files) |
| root `pnpm test` | 8/8 | 8/8 |

`tsc --noEmit` in `apps/agent` is clean. `biome check` is clean on everything touched. Note
`biome check --write apps/agent` also reformatted four unrelated files (stats.service.ts,
x402-buyer.ts, evaluator.test.ts and one more); those were reverted and are not in the commit.
`evaluator.service.ts` still has two pre-existing biome `useTemplate` findings, untouched.

## Live run (Arc testnet 5042002)

Preconditions printed by the script: qualifier `0xfF49A3A89739b390161Be11F57dd5c945647C334`, signer
`0xcd81F6b5c9Ae5D62fDF5af4A906916ab167144C2` (the CCD_QUALIFIER address), `periods behind 0`.

Tender `999999`. Synthetic subject `synthetic:qualification-agent-demo-1`. Bidder A
`0x00000000000000000000000000000000000A1001`, bidder B `0x00000000000000000000000000000000000b2002`
(neither is a real account; nothing about them is controlled by anyone).

Common to every command below: `node scripts/concordium/record-qualification.mjs --subject
synthetic:qualification-agent-demo-1 --tender 999999 --synthetic --bidder <A|B> [--dry-run]`.

1. `--dry-run` with bidder A: simulation passed against the live chain, nothing sent.
2. Real run with bidder A:

```
{
  "status": "recorded",
  "tx": "0x644ee73585b31667cfb84068bc410154d447b11ee42369d9c765c07ac0a0fc74",
  "nullifier": "0xcc909664816403921f8511b62bfe4182a61d91612cd73d93dc43d7c06c05e368",
  "blockHash": "0x890d5da9e303037c5e437047e6d38ad0eb9b5f2fd36c6d88e5edd6c462aedea0",
  "epoch": "6533",
  "signedStakeBps": 6668,
  "isQualified": true,
  "qualification": {
    "nullifier": "0xcc909664816403921f8511b62bfe4182a61d91612cd73d93dc43d7c06c05e368",
    "checkedAtEpoch": "6533",
    "expiresAt": "1794418438",
    "present": true
  },
  "synthetic": true
}
```

   Transaction `0x644ee73585b31667cfb84068bc410154d447b11ee42369d9c765c07ac0a0fc74`. The read-backs
   are the `isQualified: true` and `qualificationOf` fields above, read after the receipt. The Arc
   contract verified the BLS certificate itself (6668 bps of stake, just over the 6667 quorum).

3. Re-run with bidder A: exit 0, `status: "already-qualified"`, no transaction sent.
4. Same subject, **different bidder B**, same tender: exit 2.

```
{
  "status": "nullifier-used",
  "claimedBy": "0x00000000000000000000000000000000000A1001",
  "nullifier": "0xcc909664816403921f8511b62bfe4182a61d91612cd73d93dc43d7c06c05e368",
  "synthetic": true
}
```

   The same simulation made directly against the contract, verbatim from the node (the long
   `args:` blob of certificate bytes is elided):

```
The contract function "recordQualification" reverted.
Error: NullifierAlreadyUsed(uint256 tenderId, bytes32 nullifier, address claimedBy)
  (999999, 0xcc909664816403921f8511b62bfe4182a61d91612cd73d93dc43d7c06c05e368, 0x00000000000000000000000000000000000A1001)
Contract Call:
  address:   0xfF49A3A89739b390161Be11F57dd5c945647C334
  function:  recordQualification(address, uint256, bytes32, bytes32, uint64, uint64, bytes, bytes, bytes)
  args: (0x00000000000000000000000000000000000b2002, 999999, 0xcc90...e368, ..., <certificate bytes elided>)
  sender:    0xcd81F6b5c9Ae5D62fDF5af4A906916ab167144C2
```

   `claimedBy(999999, nullifier)` reads back `0x...0A1001`. Bidder B was refused in simulation, so
   the second wallet cost no gas and wrote nothing. So the one-principal rule is shown working on
   chain for the first time: two wallets, one subject, one tender, second refused.

Only one transaction was sent in total (the record in step 2).

An early attempt for bidder B failed with viem's `InvalidAddressError`: I had typed a mixed-case
address with a wrong checksum. That is a bad demo input, not a code path in the agent; nothing was
sent. The HTTP endpoint validates `^0x[0-9a-fA-F]{40}$` and viem still rejects a bad checksum.

## What the synthetic subject does and does not prove

Proves: the agent derives a nullifier from a subject; the agent fetches its own certificate from a
Concordium node; the `CCD_QUALIFIER` key alone can write (the admin key lost the role); the Arc
contract verified a genuine, recent, quorum-signed Concordium finality certificate before recording;
the record is readable back; and a second wallet for the same subject on the same tender is refused
with `NullifierAlreadyUsed`.

Does not prove: anything about any person or organization. The subject is a string typed on a
command line. No Web3 ID presentation was verified and no Concordium credential was checked. As the
contract header says, the credential check against the block's state is *asserted* by the qualifier,
and here it was not even asserted honestly about anyone; it was skipped. The qualification for
tender 999999 must not be read as evidence about any identity. Every result carries `synthetic:
true` and the script prints that on exit.

## Unsure / limits

- **Subject provenance over HTTP is the token.** `POST /qualifications` accepts a subject on the
  caller's word; `TokenGuard` is the only thing standing for "verified". Wiring
  `verifyQualificationPresentation` in front of it is the next step and was out of scope.
- **Below-quorum detection on the off-chain path matches on the error text** of
  `fetchFinalityProof` (`/quorum|bps|signed/`). If that message changes, it would be rethrown as a
  generic error rather than mislabelled, which is the safe direction, but the refusal would stop
  being named. The on-chain `BelowQuorum` revert is decoded by name regardless.
- The below-quorum and registry-behind paths are covered by unit tests with injected faults. They
  were not exercised live (the registry was current and the certificate had quorum).
- Quorum margin on the live run was thin (6668 vs 6667 bps); a real run can legitimately land on
  the refusing side of it.
- Rotating `QUALIFICATION_NULLIFIER_SECRET` silently splits one principal into two nullifiers.
  Documented in `.env.example`; there is no migration.
- The script imports `apps/agent/dist`, so `pnpm build` must run first.
- Tender 999999 now holds a nullifier claim for the synthetic subject. It expires as a
  qualification (`expiresAt` 1794418438) but `claimedBy` is permanent by contract design.
