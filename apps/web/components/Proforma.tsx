"use client";

import { milestoneLedger } from "@/lib/milestones";
import { type ProformaLine, buildProforma, formatUsdc, renderProforma } from "@sealedrfq/shared";
import { useState } from "react";
import { useAccount } from "wagmi";

/**
 * A proforma invoice for an awarded tender, generated from figures the tender already fixed.
 *
 * Offered rather than issued automatically, because most of the time it is not needed. Escrow
 * already answers the questions a proforma traditionally answers — the buyer's authorisation, the
 * firmness of the offer, whether payment will come — and answers them better, since the funds can
 * be checked on-chain rather than asserted on paper. What escrow does not answer is customs: import
 * licensing in many jurisdictions wants this document before goods move.
 *
 * Two fields are asked of the supplier rather than taken from the tender. The tender does not know
 * where the goods were produced or how they are classified for tariff, and guessing either would
 * put a wrong answer on a customs document — which is worse than leaving it blank, because a blank
 * gets queried and a wrong one gets believed.
 */
export function Proforma({
  rfqId,
  buyer,
  supplier,
  awardPrice,
  retentionBps,
  milestoneBps,
  incoterm,
  namedPlace,
  lineItems,
  supplierName,
  supplierCountry,
}: {
  rfqId: number;
  buyer: string;
  supplier: string;
  awardPrice: string;
  retentionBps: number;
  milestoneBps: number[];
  incoterm?: string;
  namedPlace?: string;
  lineItems?: { item: string; qty?: number; uom?: string }[];
  supplierName?: string;
  supplierCountry?: string;
}) {
  const { address, isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState(supplierCountry ?? "");
  const [hsCodes, setHsCodes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");

  const isSupplier = Boolean(
    isConnected && address && address.toLowerCase() === supplier.toLowerCase(),
  );
  const isBuyer = Boolean(isConnected && address && address.toLowerCase() === buyer.toLowerCase());
  if (!isSupplier && !isBuyer) return null;

  function text(): string {
    const codes = hsCodes
      .split(/[,\n]/)
      .map((c) => c.trim())
      .filter(Boolean);
    const lines: ProformaLine[] = (lineItems ?? []).map((l, i) => ({
      description: l.item,
      quantity: l.qty ?? 1,
      unit: l.uom ?? "ea",
      // One code covers every line when only one is given: a single-product shipment is the
      // common case and making the seller repeat it would invite a mismatch.
      hsCode: codes.length === 1 ? codes[0] : codes[i],
      countryOfOrigin: origin.trim() || undefined,
    }));

    const ledger = milestoneLedger(BigInt(awardPrice), milestoneBps, retentionBps);
    return renderProforma(
      buildProforma({
        rfqId,
        seller: { name: supplierName, address: supplier, country: origin.trim() || undefined },
        buyer: { address: buyer },
        awardPrice,
        incoterm,
        namedPlace,
        lines: lines.length ? lines : undefined,
        milestones: ledger.lines.map((m) => ({
          index: m.index + 1,
          label: `Milestone ${m.index + 1} of ${ledger.lines.length}`,
          amount: m.gross.toString(),
        })),
        issuedAt: new Date().toISOString().slice(0, 10),
        validUntil: validUntil || undefined,
        notes: notes.trim() || undefined,
      }),
    );
  }

  function download() {
    const blob = new Blob([text()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `proforma-rfq-${rfqId}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="panel">
      <div className="head">
        Proforma invoice
        <span className="hint">for customs and import licensing</span>
      </div>

      <div className="note">
        You probably do not need this. The escrow already shows a buyer's funds are committed, which
        is what a proforma is usually asked to assert — and it can be checked on-chain rather than
        taken on trust. It is here for the one thing escrow cannot do: satisfy a customs authority
        or an import licence that wants the document before goods move.
      </div>

      {!open ? (
        <div style={{ padding: "0 20px 14px" }}>
          <button type="button" className="chip" onClick={() => setOpen(true)}>
            {isSupplier ? "issue a proforma" : "generate a proforma"}
          </button>
          {isBuyer && (
            <span className="under-button">
              Normally the supplier issues this — they know the origin and classification.
            </span>
          )}
        </div>
      ) : (
        <div className="form" style={{ padding: "0 20px 16px" }}>
          <div className="field">
            <label htmlFor="pf-origin">Country of origin</label>
            <input
              id="pf-origin"
              value={origin}
              placeholder="Where the goods were made"
              onChange={(e) => setOrigin(e.target.value)}
            />
            <span className="field-hint">
              Where the goods were produced — not necessarily where the supplier is registered.
            </span>
          </div>
          <div className="field">
            <label htmlFor="pf-hs">HS code(s)</label>
            <input
              id="pf-hs"
              value={hsCodes}
              placeholder="8471.60 — one, or one per line item"
              onChange={(e) => setHsCodes(e.target.value)}
            />
            <span className="field-hint">
              Customs classifies by this, not by your description. One code applies to every line.
            </span>
          </div>
          <div className="field">
            <label htmlFor="pf-valid">Valid until</label>
            <input
              id="pf-valid"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="pf-notes">Notes</label>
            <input
              id="pf-notes"
              value={notes}
              placeholder="Packaging, marks, anything the authority asks for"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="full note">
            Total <b>{formatUsdc(BigInt(awardPrice))} USDC</b>, the milestone schedule and the
            delivery terms all come from the tender and cannot be edited here — they are what was
            agreed. The document states plainly that it is not a demand for payment, and it names
            anything a customs authority commonly wants that you have left blank.
          </div>

          <div className="full filter-row">
            <button type="button" className="btn-primary" onClick={download}>
              Download proforma
            </button>
            <button type="button" className="chip" onClick={() => setOpen(false)}>
              cancel
            </button>
          </div>

          <div className="full">
            <pre className="memo" style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 280 }}>
              {text()}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
