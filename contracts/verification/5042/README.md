# Verifying the Arc mainnet contracts

Arc's explorer sits behind a Cloudflare challenge that only a real browser solves, so
`forge verify-contract` and the Blockscout API both return **403** from a terminal. The files here
are what the explorer's own **Verify & publish** form needs instead.

For each contract, open its address on https://explorer.arc.io, choose
**Verify & publish → Solidity (Standard JSON Input)**, and fill in:

| Field | Value |
|---|---|
| Compiler | `v0.8.28+commit.7893614a` |
| Standard Input JSON | the `.json` file named below |
| Optimization | enabled, **200** runs |
| EVM version | `prague` |

The optimizer and EVM version are already inside the JSON, but the form asks anyway and a mismatch
is rejected without saying which field disagreed.

Paste the constructor arguments **without the leading `0x`**. A contract whose arguments are wrong
fails with the same generic "bytecode does not match" as a wrong compiler, so check these first.

## RFQRegistry — `0x0a63a12c852d92A7c187bCa6968f9abF4720420c`
File: `RFQRegistry.json` · Contract: `src/rfq/RFQRegistry.sol:RFQRegistry`
```
0000000000000000000000003600000000000000000000000000000000000000000000000000000000000000bd56363310ddc5c7a1716b158982b91acfd05c43000000000000000000000000986c49d9701a9d57dbf3786a44c108b1518542b8000000000000000000000000a2437fc10632a37cbe5f854c43d553a8e212700d0000000000000000000000003d23214d59ca3582628ffffe44d0df1cc73d98f9
```

## SealedRFQAdapter — `0xA2437fC10632A37cBe5F854C43D553A8e212700d`
File: `SealedRFQAdapter.json` · Contract: `src/rfq/SealedRFQAdapter.sol:SealedRFQAdapter`
```
000000000000000000000000360000000000000000000000000000000000000000000000000000000000000003fd0f608a8e1bee036d1d5a7a9c05349ad52534000000000000000000000000986c49d9701a9d57dbf3786a44c108b1518542b80000000000000000000000003d23214d59ca3582628ffffe44d0df1cc73d98f9
```

## AgenticCommerce — `0x03Fd0F608a8e1beE036D1d5A7a9C05349ad52534`
File: `AgenticCommerce.json` · Contract: `src/core/AgenticCommerce.sol:AgenticCommerce`
```
00000000000000000000000036000000000000000000000000000000000000000000000000000000000000003d23214d59ca3582628ffffe44d0df1cc73d98f90000000000000000000000003d23214d59ca3582628ffffe44d0df1cc73d98f9
```

## ProcurementPolicy — `0xbd56363310dDC5c7A1716b158982b91aCfd05c43`
File: `ProcurementPolicy.json` · Contract: `src/governance/ProcurementPolicy.sol:ProcurementPolicy`

The second argument is the policy struct as deployed —
`(10000, 2, 500, 500, 6000, 250000000000, 100000000)`. Note it carries **seven** fields: the
testnet deployment had six, before `concentrationFloor` was added, so the testnet script's
encoding will not work here.
```
0000000000000000000000003d23214d59ca3582628ffffe44d0df1cc73d98f90000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000017700000000000000000000000000000000000000000000000000000003a352944000000000000000000000000000000000000000000000000000000000005f5e100
```

## AttestationLog — `0x986C49d9701a9d57dbF3786a44C108b1518542b8`
File: `AttestationLog.json` · Contract: `src/governance/AttestationLog.sol:AttestationLog`
```
0000000000000000000000003d23214d59ca3582628ffffe44d0df1cc73d98f9
```

## If the API ever becomes reachable

`./script/verify-mainnet.sh` does the same thing without a browser. It checks first and exits
quietly if Cloudflare is still in the way, rather than reporting the block as a build failure —
which is how this looked the first time: forge reports an exhausted or blocked API as
"Failed to obtain contract ABI", and that reads like a compilation problem.
