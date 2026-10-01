"use client";

import { milestoneLedger } from "@/lib/milestones";
import { type ProformaLine, buildProforma, formatUsdc, renderProforma } from "@sealedrfq/shared";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
 * Produced as a printed page rather than a generated PDF. The browser already makes PDFs, a
 * customs authority will not accept a .txt, and a PDF library would be a megabyte of dependency to
 * reproduce what `window.print()` does — the tender pack takes the same route for the same reason.
 * The text download stays for anyone who wants to paste the figures somewhere else.
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
  /*
   * Legal names and postal addresses for both parties.
   *
   * Customs wants to know who is shipping and who is receiving, and a wallet address answers
   * neither — an import licence naming `0x5481…B9Ae` as the seller is a document that will be
   * handed back. The seller's name is prefilled from their published profile where they have one,
   * because that is at least signed by the wallet it describes, but everything here stays editable:
   * a trading name on a customs form is frequently not the name in a directory.
   *
   * Typed here and used here. None of it is stored, hashed or sent anywhere — it is a party's own
   * detail about themselves, needed for one document, and collecting it would make this project
   * hold personal data it has no reason to keep.
   */
  const [sellerName, setSellerName] = useState(supplierName ?? "");
  const [sellerAddress, setSellerAddress] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [hsCodes, setHsCodes] = useState("");
  /**
   * Whether the DOM exists yet, for the portalled print copy below.
   *
   * Above the early return, with every other hook. Placed after it — which is where it started —
   * the hook count changed the moment a third party opened the page, and React tore the tree down
   * with error #310.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
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
        seller: {
          name: sellerName.trim() || undefined,
          address: [sellerAddress.trim(), supplier].filter(Boolean).join("\n"),
          country: origin.trim() || undefined,
        },
        buyer: {
          name: buyerName.trim() || undefined,
          address: [buyerAddress.trim(), buyer].filter(Boolean).join("\n"),
        },
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

  /**
   * Print, which is how this becomes a PDF.
   *
   * A customs authority will not take a .txt, and the browser already makes PDFs — so the document
   * is printed rather than built with a PDF library, the same way the tender pack is. The class
   * hides everything else on the page for the duration: without it the print carries the tender,
   * the bids and the actions panel, and the proforma arrives on page three.
   */
  function print() {
    document.body.classList.add("printing-doc");
    const restore = () => document.body.classList.remove("printing-doc");
    window.addEventListener("afterprint", restore, { once: true });
    window.print();
  }

  /*
   * The printable copy lives at the top of `<body>`, not inside the panel.
   *
   * Hiding the page with `visibility` left every hidden element occupying its space, so the sheet
   * stayed as tall as the whole tender page and a one-page invoice printed across six. Height is
   * what had to go, and only `display: none` removes it — which cannot be used on the ancestors of
   * something that must stay visible. Moving the copy out of that subtree solves both: the page
   * collapses entirely, and the document is exactly as long as its own text.
   */

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
            <label htmlFor="pf-seller-name">Seller — legal name</label>
            <input
              id="pf-seller-name"
              value={sellerName}
              placeholder="The name the business trades and ships under"
              onChange={(e) => setSellerName(e.target.value)}
            />
            <span className="field-hint">
              {supplierName
                ? "Prefilled from the supplier's published profile, which they signed. Edit it if the shipping name differs."
                : "This supplier has not published a name, so it has to be typed."}
            </span>
          </div>
          <div className="field">
            <label htmlFor="pf-buyer-name">Buyer — legal name</label>
            <input
              id="pf-buyer-name"
              value={buyerName}
              placeholder="The importing business"
              onChange={(e) => setBuyerName(e.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="pf-seller-addr">Seller — address</label>
            <input
              id="pf-seller-addr"
              value={sellerAddress}
              placeholder="Street, city, postcode, country"
              onChange={(e) => setSellerAddress(e.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="pf-buyer-addr">Buyer — address</label>
            <input
              id="pf-buyer-addr"
              value={buyerAddress}
              placeholder="Where the goods are being imported to"
              onChange={(e) => setBuyerAddress(e.target.value)}
            />
            <span className="field-hint">
              Postal addresses, not wallet addresses — both are printed, but customs reads this
              one. Nothing typed here is stored or sent anywhere; it goes into the document only.
            </span>
          </div>
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

          {(() => {
            // Said before the button rather than after the rejection. A proforma missing a party's
            // name is not a weaker document, it is one that gets handed back.
            const missing = [
              !sellerName.trim() && "the seller's name",
              !buyerName.trim() && "the buyer's name",
              !sellerAddress.trim() && "the seller's address",
              !buyerAddress.trim() && "the buyer's address",
              !origin.trim() && "the country of origin",
              !hsCodes.trim() && "an HS code",
            ].filter(Boolean) as string[];
            if (missing.length === 0) return null;
            return (
              <div className="full note warn">
                <b>Customs will refuse this as it stands.</b> It is missing {missing.join(", ")}.
                A wallet address identifies neither party to an import authority, so the document
                prints both but the names are what it is read by. You can still generate it — it is
                your document — but expect it back.
              </div>
            );
          })()}

          <div className="full note">
            Total <b>{formatUsdc(BigInt(awardPrice))} USDC</b>, the milestone schedule and the
            delivery terms all come from the tender and cannot be edited here — they are what was
            agreed. The document states plainly that it is not a demand for payment, and it names
            anything a customs authority commonly wants that you have left blank.
          </div>

          <div className="full button-row">
            <button type="button" className="btn-primary" onClick={print}>
              Print / save as PDF
            </button>
            <button type="button" className="btn-outline" onClick={download}>
              Download as text
            </button>
            <button type="button" className="chip" onClick={() => setOpen(false)}>
              cancel
            </button>
          </div>

          <div className="full">
            <pre className="memo proforma-doc" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
              {text()}
            </pre>
          </div>

          {mounted &&
            createPortal(
              <pre className="print-sheet">{text()}</pre>,
              document.body,
            )}
        </div>
      )}
    </div>
  );
}
