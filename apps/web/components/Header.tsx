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
      <a className="chip" href="https://github.com/0xhaz/SealedTender" target="_blank" rel="noreferrer">
        ⭐ GitHub
      </a>
    </header>
  );
}
