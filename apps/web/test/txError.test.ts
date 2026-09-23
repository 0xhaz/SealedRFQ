import { BaseError, ContractFunctionRevertedError } from "viem";
import { describe, expect, it } from "vitest";
import { describeTxError } from "../lib/txError.js";

/**
 * The selector a buyer actually saw in the wallet when the form sent deadlines built from a host
 * clock that was behind the chain. Hard-coded rather than derived, so a rename of the error in the
 * contracts fails this test instead of silently changing what the UI says.
 */
const INVALID_DEADLINES = "0xa716d6d0";

function revertWith(errorName: string, args: unknown[] = []) {
  const inner = Object.assign(Object.create(ContractFunctionRevertedError.prototype), {
    name: "ContractFunctionRevertedError",
    message: `reverted with ${errorName}`,
    data: { errorName, args },
    walk: () => inner,
  });
  const outer = Object.assign(Object.create(BaseError.prototype), {
    name: "BaseError",
    message: "execution reverted",
    walk: (fn?: (e: unknown) => boolean) => (fn ? (fn(inner) ? inner : null) : inner),
  });
  return outer;
}

describe("describeTxError", () => {
  it("names the error when the node returns only the selector as text", () => {
    // This is the shape MetaMask surfaces from a failed gas estimate: no revert data to decode.
    const msg = describeTxError(
      new Error(`Execution reverted with reason: custom error ${INVALID_DEADLINES}.`),
    );
    expect(msg).toContain("bidding → reveal → award");
    expect(msg).not.toContain(INVALID_DEADLINES);
  });

  it("decodes revert data and spends the args on the numbers the user needs", () => {
    const msg = describeTxError(revertWith("AwardExceedsBudget", [3_400_000n, 3_000_000n]));
    expect(msg).toContain("3.4 USDC");
    expect(msg).toContain("3 USDC");
  });

  it("translates a phase number into the phase's name", () => {
    expect(describeTxError(revertWith("WrongPhase", [2]))).toContain("reveal phase");
  });

  it("treats a dismissed wallet prompt as a non-event, not a failure", () => {
    const msg = describeTxError(new Error("User rejected the request."));
    expect(msg).toContain("nothing was sent");
  });

  it("still says something useful for an error with no hand-written text", () => {
    // Every error name resolves; only the prose is optional.
    expect(describeTxError(revertWith("FeesTooHigh"))).toContain("FeesTooHigh");
  });

  it("rewrites USDC's developer-facing string reverts", () => {
    // Arc's USDC predates custom errors; these strings are the commonest real failures.
    expect(describeTxError(new Error("ERC20: transfer amount exceeds allowance"))).toContain(
      "larger USDC approval",
    );
    expect(describeTxError(new Error("ERC20: transfer amount exceeds balance"))).toContain(
      "does not hold enough USDC",
    );
  });

  it("explains an unreachable node instead of showing the raw transport error", () => {
    // What the deployed site actually showed a user: viem's generic transport failure, which reads
    // like the app is broken when in fact nothing was submitted.
    for (const raw of ["HTTP request failed.", "fetch failed", "Failed to fetch"]) {
      const msg = describeTxError(new Error(raw));
      expect(msg, raw).toMatch(/nothing was submitted/i);
      expect(msg, raw).not.toBe(raw);
    }
    expect(describeTxError(new Error("429 Too Many Requests"))).toMatch(/rate-limiting/i);
  });

  it("falls back to the first line when nothing about it is recognisable", () => {
    expect(describeTxError(new Error("nonce too low\nat some stack frame"))).toBe("nonce too low");
  });

  it("names a late milestone submission from the selector alone", () => {
    // Recorded from a real testnet revert: the supplier submitted 15 hours after the delivery
    // window shut. The call goes to AgenticCommerce but is vetoed by the adapter's hook, so viem
    // cannot decode it against the ABI at hand and reports the bare selector — which is exactly the
    // path that used to surface as "Execution reverted for an unknown reason".
    const asText = new Error(
      'The contract function "submit" reverted with the following signature:\n0x5a6fec96',
    );
    expect(describeTxError(asText)).toMatch(/delivery window/i);
  });

  it("does not crash when a formatted error arrives without its args", () => {
    // The selector-only path loses args, so the arg-bearing formatters must degrade rather than throw.
    expect(describeTxError(revertWith("AwardExceedsBudget", []))).toContain("AwardExceedsBudget");
  });
});
