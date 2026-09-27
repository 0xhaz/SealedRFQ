"use client";

import { DocumentCheck } from "@/components/DocumentCheck";
import { Prose } from "@/components/Prose";
import { hashText, sameHash } from "@/lib/docHash";
import type { Hex } from "viem";

type Props = {
  /** The published metadata document, as served by the indexer. */
  metadataURI?: string | null;
  /** sha256 of that document, read from the chain. */
  metadataHash: Hex;
};

type Terms = { name?: string; sha256?: Hex; uri?: string; summary?: string };

/**
 * The buyer's terms, and proof they are the ones the RFQ was opened with.
 *
 * The chain stores only `metadataHash`, so the document itself arrives from the indexer — which is
 * to say, from a server. That would normally be something a supplier has to take on trust, except
 * that re-hashing the document and comparing it with the chain settles it without trusting anyone:
 * if an operator altered a payment term after bids were sealed, the hashes stop matching and this
 * panel says so.
 *
 * A separate hash covers the terms *file* where one was attached, because a PDF cannot be inlined
 * into the metadata. The buyer sends it by whatever channel they already use; this checks the bytes.
 */
export function TermsPanel({ metadataURI, metadataHash }: Props) {
  if (!metadataURI) return null;

  let terms: Terms | null = null;
  try {
    terms = (JSON.parse(metadataURI) as { terms?: Terms }).terms ?? null;
  } catch {
    return null; // metadata is a bare URI or free text; nothing to show
  }
  if (!terms) return null;

  const documentMatches = sameHash(hashText(metadataURI), metadataHash);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Terms of this tender</h3>
      </div>
      <div className="card-body">
        {terms.summary && <Prose text={terms.summary} className="note terms-body" />}

        <div className={documentMatches ? "note ok" : "note warn"}>
          {documentMatches ? (
            <>
              <b>These terms match the chain.</b> The published document hashes to the value fixed
              when this RFQ opened, so nothing in it has been changed since bidding was announced.
            </>
          ) : (
            <>
              <b>These terms do not match the chain.</b> The document being served does not hash to
              the value recorded when the RFQ opened. Do not bid against it — ask the buyer for the
              original and verify it below.
            </>
          )}
        </div>

        {terms.uri ? (
          <p className="note">
            <a className="btn-outline" href={terms.uri} target="_blank" rel="noreferrer noopener">
              ↓ {terms.name ?? "Download the terms document"}
            </a>
            <span className="under-button">
              Hosted for convenience, not on trust — verify the download below.
            </span>
          </p>
        ) : terms.sha256 ? (
          <p className="note">
            The buyer has published the hash of a terms document but is not hosting it. Ask them for
            the file, then check it below.
          </p>
        ) : null}

        {terms.sha256 && (
          <DocumentCheck
            expected={terms.sha256}
            label={terms.name ? `Verify "${terms.name}"` : "Verify the terms document"}
            hint="Check the file the buyer sent you against the hash fixed before bidding opened."
          />
        )}

        <div className="note">
          Submitting a bid accepts these terms as published here. They cannot be revised afterwards
          without changing the hash, which every bidder can see.
        </div>
      </div>
    </div>
  );
}
