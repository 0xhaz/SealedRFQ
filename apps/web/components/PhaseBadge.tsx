import { formatUsdc } from "@sealedrfq/shared";
import type { Phase } from "@/lib/rfq";

const TONE: Record<Phase, string> = {
  None: "p-none",
  Bidding: "p-bidding",
  Reveal: "p-reveal",
  Award: "p-award",
  Awarded: "p-awarded",
  NoAward: "p-noaward",
  Cancelled: "p-cancelled",
};

const LABEL: Record<Phase, string> = {
  None: "—",
  Bidding: "SEALED BIDDING",
  Reveal: "REVEAL",
  Award: "AWAITING AWARD",
  Awarded: "AWARDED",
  NoAward: "NO AWARD",
  Cancelled: "CANCELLED",
};

export function PhaseBadge({
  phase,
  winner,
  price,
}: {
  phase: Phase;
  winner?: string;
  price?: bigint;
}) {
  const awarded = phase === "Awarded" && winner && price !== undefined;
  return (
    <span className={`badge ${TONE[phase]}`} title={awarded ? winner : undefined}>
      {LABEL[phase]}
      {awarded ? ` · ${formatUsdc(price)}` : ""}
    </span>
  );
}
