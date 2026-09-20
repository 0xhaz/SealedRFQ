/**
 * Turns a failed transaction into a sentence a buyer or supplier can act on.
 *
 * Every rule this app enforces lives in the contracts, so a rejection arrives as a four-byte
 * selector. Showing that raw ("custom error 0xa716d6d0") tells the user nothing and, worse, reads
 * like a bug in the site rather than a rule they tripped. Two shapes have to be handled: viem
 * decodes the error itself when the node returns revert data, but a node that only returns a
 * *message* — which is what MetaMask's gas estimate surfaces — leaves the selector as text, so we
 * also keep a selector table built from the ABIs at import time.
 */
import {
  AttestationLogAbi,
  ProcurementPolicyAbi,
  RFQRegistryAbi,
  SealedRFQAdapterAbi,
} from "@sealedrfq/shared";
import { BaseError, ContractFunctionRevertedError, formatUnits, toFunctionSelector } from "viem";

const ABIS = [RFQRegistryAbi, SealedRFQAdapterAbi, AttestationLogAbi, ProcurementPolicyAbi];

/** selector -> error name, for the case where all we get back is the selector as text. */
const BY_SELECTOR = new Map<string, string>();
for (const abi of ABIS) {
  for (const item of abi) {
    if (item.type !== "error") continue;
    const sig = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
    try {
      BY_SELECTOR.set(toFunctionSelector(sig).toLowerCase(), item.name);
    } catch {
      // A shape we cannot hash is one we simply cannot name; the fallback still explains itself.
    }
  }
}

const PHASES = ["not created", "bidding", "reveal", "award", "awarded", "no award", "cancelled"];

const usdc = (v: unknown) => `${formatUnits(BigInt(v as bigint | number | string), 6)} USDC`;

/**
 * Plain-English text per error. Args are passed through where they carry the number the user needs;
 * anything absent from this table falls back to its name, which is still better than a selector.
 */
const EXPLAIN: Record<string, (a: readonly unknown[]) => string> = {
  // ── creating an RFQ ──
  InvalidDeadlines: () =>
    "The deadlines must run bidding → reveal → award, and bidding must still be in the future. If your device's clock is behind the network's, reload the page and submit again.",
  InvalidAmount: () => "The budget and the bid deposit both have to be greater than zero.",
  InvalidBps: () => "Retention and buyer stake can each be at most 50%.",
  InvalidWindows: () =>
    "The delivery window must be at least 5 minutes and the acceptance window at least 1 minute.",
  InvalidMilestones: () => "The milestone percentages have to add up to exactly 100%.",
  InvalidTerms: () => "These terms are not accepted by the policy contract.",
  TooManyInvitees: () => "That is more invited suppliers than the contract accepts.",

  // ── bidding ──
  BuyerCannotBid: () => "The buyer who posted an RFQ cannot bid on it.",
  ProposalRequired: () =>
    "This is an RFP, so a proposal document is required — attach the file you hashed into your sealed bid.",
  NoCommitment: () => "No sealed bid from this wallet was found on this RFQ.",
  AlreadyRevealed: () => "This bid has already been revealed.",
  CommitmentMismatch: () =>
    "These values do not match the sealed bid. The price, delivery days, proposal hash and salt must all be exactly what you committed — recover them from your saved bid file or re-sign with the same wallet.",
  DepositNotHeld: () => "There is no deposit held for this wallet on this RFQ.",
  NotInviteOnly: () => "This RFQ is open to everyone, so no invitation is needed.",
  NotInvited: () => "This RFQ is invite-only and this wallet is not on the list.",
  NotQualified: () => "This wallet is not qualified for this RFQ's category.",

  // ── awarding ──
  AwardExceedsBudget: (a) =>
    `The award is ${usdc(a[0])} but the published budget is ${usdc(a[1])}. The contract refuses to award above the budget.`,
  EvaluationNotAttested: () =>
    "No evaluation has been anchored for this award yet. The evaluator has to publish its recommendation before an award can go through.",
  RubricMismatch: () =>
    "The rubric being scored against does not hash to the one published when the RFQ opened.",
  InsufficientBidders: (a) =>
    `This RFQ has ${a[0]} revealed bid(s) but the policy requires at least ${a[1]}.`,
  WinnerNotRevealed: () => "The chosen winner never revealed their bid.",
  ConcentrationCapExceeded: (a) =>
    `This award would put ${usdc(a[0])} with one supplier, above the policy cap of ${usdc(a[1])}.`,
  DepositRatioTooLow: (a) =>
    `The deposit is ${usdc(a[0])} but the policy requires at least ${usdc(a[1])}.`,
  BuyerStakeTooLow: (a) =>
    `The buyer stake is ${usdc(a[0])} but the policy requires at least ${usdc(a[1])}.`,
  NotAuthorizedToAward: () => "This wallet is not allowed to award this RFQ.",
  CannotCancel: () => "This RFQ can no longer be cancelled.",

  // ── delivery and payment ──
  AlreadyStarted: () => "This engagement has already been started.",
  DeliveryWindowClosed: () => "The delivery window for this milestone has closed.",
  AcceptanceWindowOpen: () =>
    "The buyer still has time to accept or dispute, so this cannot be released yet.",
  DisputeWindowOpen: () => "The dispute window is still open.",
  DisputeWindowClosed: () => "The dispute window has closed.",
  NotExpired: () => "This has not expired yet.",
  NothingToWithdraw: () => "There is nothing to withdraw from this wallet.",
  ReasonRequired: () => "A reason has to be given for this action.",
  ReasonNotAttested: () => "The reason for this action has not been anchored on chain.",
  WrongJobStatus: () => "This job is not in a state where that action is allowed.",

  // ── phase and permission ──
  WrongPhase: (a) => {
    const phase = PHASES[Number(a[0])] ?? `phase ${a[0]}`;
    return `This RFQ is in its ${phase} phase, which does not allow that action.`;
  },
  WrongStatus: () => "This RFQ is not in a state where that action is allowed.",
  NotBuyer: () => "Only the buyer who posted this RFQ can do that.",
  NotSupplier: () => "Only the awarded supplier can do that.",
  NotBuyerOrVerifier: () => "Only the buyer or an assigned verifier can do that.",
  Unauthorized: () => "This wallet is not authorised to do that.",
  AccessControlUnauthorizedAccount: () =>
    "This wallet does not hold the role this action requires.",
  NotAuthorizedForKind: () => "This wallet cannot attest that kind of statement.",
  AlreadyAttested: () => "That statement has already been attested.",

  // ── lookups and money ──
  RFQNotFound: (a) => `RFQ ${a[0]} does not exist on this deployment.`,
  NotFound: (a) => `Record ${a[0]} does not exist on this deployment.`,
  SafeERC20FailedOperation: () =>
    "The USDC transfer failed. Check that this wallet holds enough USDC and has approved the contract for the full amount.",
  ZeroAddress: () => "An address is required here and a zero address was given.",
  ZeroAmount: () => "An amount above zero is required.",
  ZeroBudget: () => "A budget above zero is required.",
  ZeroPrice: () => "A price above zero is required.",
  ZeroHash: () => "A document hash is required here.",
};

function fromName(name: string, args: readonly unknown[]): string {
  const explain = EXPLAIN[name];
  if (!explain) return `The contract rejected this transaction (${name}).`;
  try {
    return explain(args);
  } catch {
    // Arg formatting must never turn a useful name into a crash.
    return `The contract rejected this transaction (${name}).`;
  }
}

/**
 * USDC on Arc predates custom errors and reverts with a string, so the most ordinary failures a
 * user will ever hit — no allowance, no balance — arrive as prose written for a developer. Matched
 * on a substring because the prefix differs between the token's own checks and SafeERC20's.
 */
const STRING_REVERTS: [RegExp, string][] = [
  [
    /exceeds allowance/i,
    "This transaction needs a larger USDC approval than the one on file. Approve the amount shown and submit again.",
  ],
  [
    /exceeds balance/i,
    "This wallet does not hold enough USDC for this transaction. On Arc, USDC pays for gas as well as the amount itself.",
  ],
  [
    /blacklisted|blocklisted/i,
    "This address is blocked from moving USDC, so the transfer cannot go through.",
  ],
  [/paused/i, "USDC transfers are paused right now, so this cannot be sent."],
];

function fromString(reason: string): string {
  return STRING_REVERTS.find(([re]) => re.test(reason))?.[1] ?? reason;
}

/** True when the wallet popup was dismissed, which is not an error worth dressing up. */
function isRejection(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("user rejected") || msg.includes("user denied") || msg.includes("request rejected")
  );
}

export function describeTxError(e: unknown): string {
  if (isRejection(e)) return "You dismissed the wallet prompt, so nothing was sent.";

  // Best case: the node returned revert data and viem decoded it against the ABI.
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) return fromName(name, reverted.data?.args ?? []);
      if (reverted.reason) return fromString(reverted.reason);
    }
  }

  const raw = e instanceof Error ? e.message : String(e);
  const asString = STRING_REVERTS.find(([re]) => re.test(raw));
  if (asString) return asString[1];

  // Fallback: some nodes report the selector inside the message text instead of as revert data,
  // so recover the name from it. Args are lost in that path, hence the no-arg call.
  const selector = raw.match(/0x[0-9a-fA-F]{8}\b/)?.[0]?.toLowerCase();
  if (selector) {
    const name = BY_SELECTOR.get(selector);
    if (name) return fromName(name, []);
  }

  if (/insufficient funds/i.test(raw))
    return "This wallet does not hold enough USDC to cover the transaction and its gas.";

  return raw.split("\n")[0];
}
