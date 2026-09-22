/**
 * Standard terms, generated from the figures the buyer has already entered.
 *
 * Typing terms from scratch invites the one mistake this product cannot absorb: writing something
 * the contract will not do. A buyer who promises "payment 30 days after invoice" has written a term
 * the escrow contradicts, because acceptance releases money immediately and silence releases it on
 * a timer. Generating the clauses from the same values that configure the escrow keeps the prose
 * and the code describing one arrangement rather than two.
 *
 * The result is editable. These are commercial terms restating what the contract does, not legal
 * advice, and a real tender will add clauses no form can guess — warranty, liability, governing
 * law. Those belong in the attached document.
 */
export type TermsInput = {
  mode: "RFQ" | "RFP";
  budget: string;
  deposit: string;
  stakePct: string;
  retentionPct: string;
  milestones: string;
  deliveryMin: string;
  acceptMin: string;
  maxDeliveryDays?: string;
  attestations?: string[];
  lineItemCount: number;
};

const minutes = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "the stated window";
  if (n < 60) return `${n} minutes`;
  const h = n / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hours`;
};

export function generateTerms(p: TermsInput): string {
  const split = p.milestones
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const clauses: string[] = [
    `1. Scope. The supplier shall provide everything set out in this RFQ${
      p.lineItemCount > 0 ? `, covering all ${p.lineItemCount} listed line items` : ""
    }. The quotation must cover the whole scope as a single total price.`,

    `2. Price and currency. All amounts are in USDC. The published budget is ${p.budget || "0"} USDC and the contract rejects any award above it, so a quotation exceeding the budget cannot be accepted however it scores.`,

    `3. Payment. The price is paid across ${split.length || 1} milestone${
      split.length === 1 ? "" : "s"
    }${split.length ? ` of ${split.join("%, ")}%` : ""}. ${p.retentionPct || "0"}% of every milestone payment is retained and released only when the final milestone is accepted.`,

    `4. Acceptance. The buyer has ${minutes(p.acceptMin)} from each submission to accept or reject it. Rejection must state a reason. If the buyer does not respond within that window the payment is released to the supplier automatically.`,

    `5. Delivery. Each milestone must be submitted within ${minutes(p.deliveryMin)} of the engagement reaching it.${
      p.maxDeliveryDays ? ` Overall delivery is required within ${p.maxDeliveryDays} days.` : ""
    } A missed delivery window ends the engagement in the buyer's favour.`,

    `6. Bid deposit. Each bid posts a deposit of ${p.deposit || "0"} USDC. Deposits are refunded to unsuccessful bidders. A bid that is sealed but never revealed forfeits its deposit to the buyer. The winning bidder's deposit is held as a performance stake until final acceptance.`,

    `7. Buyer's stake. The buyer escrows the full budget plus a stake of ${p.stakePct || "0"}% of it before bidding opens. The stake is held until the last milestone is accepted and is what a supplier can claim against if the buyer abandons the engagement after awarding.`,

    `8. Confidentiality of bids. Bids are sealed until the reveal window opens. No party, including the operator of this deployment, can read a competing bid before then.`,

    `9. Disputes. A rejected milestone that the parties cannot settle is referred to the arbiter named on this deployment, who may divide the amount still escrowed for the engagement. There is no other route to reverse a completed payment.`,
  ];

  if (p.mode === "RFP") {
    clauses.push(
      `10. Proposals. Each bid seals a proposal document together with its price. Neither the price nor the method may be revised after rival bids are opened.`,
    );
  }

  if (p.attestations?.length) {
    clauses.push(
      `${p.mode === "RFP" ? 11 : 10}. Supplier declarations. The supplier warrants that it meets the following, and shall provide evidence on request: ${p.attestations.join("; ")}.`,
    );
  }

  return clauses.join("\n\n");
}
