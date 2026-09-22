"use client";

type Props = {
  rfqId: number;
  /** The exact published document. Its sha256 is what the chain holds. */
  metadataURI?: string | null;
};

/**
 * Taking the tender pack away with you.
 *
 * Nobody prices a basket of line items inside a web form. A tender pack gets downloaded, sent to
 * whoever does the pricing and whoever reads the contract, and quoted offline — so the page has to
 * leave the browser in two forms.
 *
 * The PDF is for people: printing is the browser's own job and needs no library, no server and no
 * fonts we would have to ship. The JSON is the artifact that can actually be checked — it is the
 * byte-for-byte document whose sha256 the chain stores, so a supplier's lawyer can re-hash the file
 * and confirm the terms they were sent are the ones the RFQ was opened with. The PDF cannot do
 * that, because printing reflows it.
 */
export function TenderPackActions({ rfqId, metadataURI }: Props) {
  function downloadJson() {
    if (!metadataURI) return;
    const blob = new Blob([metadataURI], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sealedrfq-${rfqId}-tender.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pack-actions no-print">
      <button type="button" className="btn-primary" onClick={() => window.print()}>
        Print / save as PDF
      </button>
      {metadataURI && (
        <button type="button" className="btn-outline" onClick={downloadJson}>
          Download the published document (JSON)
        </button>
      )}
    </div>
  );
}
