import type { DurationUnit } from "./duration";

/**
 * Tender deadlines as dates, which is how buyers actually think about them.
 *
 * The contract has always stored absolute unix timestamps; only this form used to think in
 * "minutes from now", which is a demo affordance and reads as a toy to anyone who runs tenders for
 * a living. A closing date is part of the tender notice.
 *
 * Everything here is checked against *chain* time rather than the browser's. That matters more with
 * a date picker than it did with offsets: a machine whose clock is behind will happily offer a time
 * that looks future to the person choosing it and is already past on-chain, and the only symptom
 * would be a rejected transaction.
 */

/** `<input type="datetime-local">` gives local wall-clock with no zone; treat it as the user's own. */
export function toUnix(local: string): number | null {
  if (!local) return null;
  const ms = new Date(local).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Formats unix seconds back into the value a datetime-local input expects, in local time. */
export function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type Deadlines = { bid: string; reveal: string; award: string };

/** An amount and a unit, matching the duration selector on the form. */
export type WindowSpec = [amount: string, unit: DurationUnit];

/**
 * The same order the contract requires, checked before a wallet is ever opened. Mirrors
 * RFQRegistry._validate: now < bid < reveal < award.
 */
export function checkDeadlines(d: Deadlines, chainNow: number): string | null {
  const bid = toUnix(d.bid);
  const reveal = toUnix(d.reveal);
  const award = toUnix(d.award);

  if (bid === null || reveal === null || award === null) {
    return "Set all three dates: when bidding closes, when revealing closes, and the award deadline.";
  }
  if (bid <= chainNow) {
    return "Bidding must close in the future. If this looks wrong, this device's clock may differ from the network's.";
  }
  if (reveal <= bid) return "Revealing has to close after bidding does.";
  if (award <= reveal) return "The award deadline has to come after revealing closes.";
  return null;
}

/** Presets. The realistic ones are the point; the short one keeps a trial run to one sitting. */
/**
 * Each preset also carries the delivery and acceptance windows that belong with it.
 *
 * Those two are durations rather than dates, so they were previously left untouched by a preset —
 * which meant choosing "Demo" gave a tender whose bidding closed in twelve minutes and whose
 * milestones were due in a fortnight, and choosing "2 weeks" after a demo left fifteen-minute
 * milestones on a real tender. A timetable should set the whole clock, not part of it.
 */
export const PRESETS: {
  label: string;
  hint: string;
  offsets: [number, number, number];
  windows: { delivery: WindowSpec; accept: WindowSpec };
}[] = [
  {
    label: "2 weeks",
    hint: "bids close in 14 days",
    offsets: [14 * 1440, 15 * 1440, 21 * 1440],
    windows: { delivery: ["14", "days"], accept: ["3", "days"] },
  },
  {
    label: "1 week",
    hint: "bids close in 7 days",
    offsets: [7 * 1440, 8 * 1440, 14 * 1440],
    windows: { delivery: ["7", "days"], accept: ["2", "days"] },
  },
  {
    label: "48 hours",
    hint: "for an urgent buy",
    offsets: [2880, 3240, 5760],
    windows: { delivery: ["24", "hours"], accept: ["4", "hours"] },
  },
  {
    label: "Demo",
    // Not "for a testnet run": this preset is offered on mainnet too, where the windows are the
    // same minutes but the USDC is real. What makes it a demo is the timescale, not the chain.
    hint: "minutes end to end — for trying the flow, not for a real purchase",
    offsets: [12, 22, 80],
    windows: { delivery: ["15", "minutes"], accept: ["3", "minutes"] },
  },
];

/** Builds the three input values from a preset, measured from chain time. */
export function applyPreset(offsetsMinutes: [number, number, number], chainNow: number): Deadlines {
  const [b, r, a] = offsetsMinutes;
  return {
    bid: toLocalInput(chainNow + b * 60),
    reveal: toLocalInput(chainNow + r * 60),
    award: toLocalInput(chainNow + a * 60),
  };
}
