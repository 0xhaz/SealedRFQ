import { explorerAddress } from "@/lib/chain";

/**
 * A wallet, shown with whatever name it claims.
 *
 * The name never replaces the address. A buyer deciding whether to award, or a supplier deciding
 * whether to bid, is deciding about an *address* — that is what the contracts compare and what the
 * escrow pays — and `some-large-retailer.eth` is registrable by anyone willing to pay for it.
 * Swapping the address out for a name would hand a convincing disguise to whoever wanted one.
 *
 * So the name is a label and the address stays legible beside it, linking to the explorer where it
 * can be checked. With no name, this renders exactly what it rendered before.
 */
export function Party({
  address,
  name,
  badge,
  className,
}: {
  address: string;
  /** From ENS, already forward-verified. Null when there is none or it could not be read. */
  name?: string | null;
  /** Anything that belongs immediately after, such as a WON marker. */
  badge?: React.ReactNode;
  className?: string;
}) {
  const shortened = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <span className={className}>
      {name ? (
        <>
          <span className="party-name" title={`${name} — a name this wallet claims, not a verified identity`}>
            {name}
          </span>{" "}
          <a
            className="mono party-addr"
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
          >
            {shortened}
          </a>
        </>
      ) : (
        <a className="mono" href={explorerAddress(address)} target="_blank" rel="noreferrer">
          {shortened}
        </a>
      )}
      {badge}
    </span>
  );
}
