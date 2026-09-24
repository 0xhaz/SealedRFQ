import Link from "next/link";
import { WalletChip } from "./WalletChip";

export function Header() {
  return (
    <header className="header">
      <Link href="/" className="wordmark" title="SealedRFQ — sealed-bid procurement on Arc">
        Sealed<em>RFQ</em>
      </Link>
      <span className="tagline">sealed-bid procurement · on arc</span>
      <div className="spacer" />
      <WalletChip />
      <Link className="chip" href="/rfqs">
        RFQ board
      </Link>
      <Link className="chip" href="/suppliers">
        Suppliers
      </Link>
      {/*
        Documentation rather than the repository. Someone asking how a tender works should not be
        sent to a source tree to find out; the source is for people who want to check the answer,
        and that link belongs in the footer where they will look for it.
      */}
      <Link className="chip" href="/docs">
        Docs
      </Link>
    </header>
  );
}
