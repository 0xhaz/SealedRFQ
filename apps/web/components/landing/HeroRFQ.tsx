"use client";

import { useEffect, useState } from "react";

/**
 * The hero ornament: an RFQ document walking its own lifecycle. Two runs alternate — an award,
 * and the policy firewall blocking an AI-recommended over-budget bid. Replaces the reference
 * site's invoice ornament; same .doc / .stamp vocabulary.
 */
const RUNS = [
  {
    variant: "awarded" as const,
    winner: "Meridian Systems",
    price: "2.80 USDC",
    phases: [
      "OPEN FOR BIDS",
      "3 SEALED BIDS",
      "REVEALED",
      "AI SCORED",
      "POLICY CHECK",
      "AWARDED",
      "MILESTONE 1 PAID",
    ],
  },
  {
    variant: "blocked" as const,
    winner: "Calder Freight",
    price: "3.40 USDC",
    phases: ["OPEN FOR BIDS", "3 SEALED BIDS", "REVEALED", "AI SCORED", "POLICY CHECK", "BLOCKED"],
  },
];

export function HeroRFQ() {
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState(0);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) {
      if (phase !== 5) setPhase(5);
      return;
    }
    const r = RUNS[run];
    const last = phase >= r.phases.length - 1;
    const t = setTimeout(
      () => {
        if (last) {
          setRun((run + 1) % RUNS.length);
          setPhase(0);
        } else {
          setPhase(phase + 1);
        }
      },
      last ? 3400 : 1400,
    );
    return () => clearTimeout(t);
  }, [run, phase, reduced]);

  const r = RUNS[run];
  const label = r.phases[phase];
  const scored = phase >= 3;
  const blocked = r.variant === "blocked" && phase >= 5;
  const awarded = r.variant === "awarded" && phase >= 5;
  const paid = r.variant === "awarded" && phase >= 6;
  const sealed = phase >= 1 && phase < 2;

  return (
    <div className="doc-wrap" aria-hidden>
      <div className={`doc ${blocked ? "doc-blocked" : ""}`}>
        <header>
          RFQ <span>№ 2026-0{14 + run}</span>
        </header>
        <div className="doc-row doc-row-optional">
          <span>Buyer</span>
          <b>Northwind Logistics</b>
        </div>
        <div className="doc-row doc-row-optional">
          <span>Scope</span>
          <b>Route-optimisation SaaS</b>
        </div>
        <div className="doc-row">
          <span>Published budget</span>
          <b>3.00 USDC</b>
        </div>
        <div className="doc-row">
          <span>Sealed bids</span>
          <b className="mono">{phase >= 1 ? (phase >= 2 ? "3 revealed" : "███ ███ ███") : "…"}</b>
        </div>
        <div className="doc-row">
          <span>AI recommends</span>
          <b className="r-red">{scored ? r.winner : "…"}</b>
        </div>
        <div className="doc-row">
          <span>Budget check</span>
          <b className={blocked ? "doc-bad" : ""}>
            {r.variant === "blocked"
              ? phase >= 4
                ? "EXCEEDED"
                : "checking…"
              : phase >= 4
                ? "within budget"
                : "…"}
          </b>
        </div>
        <div className="doc-total">
          <span>AWARD</span>
          <b>{scored ? r.price : "…"}</b>
        </div>
        <div className={`doc-status ${blocked ? "bad" : paid || awarded ? "good" : ""}`}>
          <i className="doc-status-dot" />
          {label === "BLOCKED" ? "BLOCKED — AwardExceedsBudget" : label}
        </div>
      </div>
      {sealed && <div className="stamp s1">SEALED</div>}
      {(awarded || paid) && <div className="stamp s2">{paid ? "PAID" : "AWARDED"}</div>}
      {blocked && <div className="stamp s2 blocked">BLOCKED BY CONTRACT</div>}
      <div className="doc-caption">
        Illustrative loop — both endings ran on Arc, with a transaction for every step.
      </div>
    </div>
  );
}
