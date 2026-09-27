/**
 * Durations entered as a number and a unit, stored as seconds.
 *
 * The contract has always held these as seconds; only this form insisted on minutes. That was a
 * demo affordance — the same one the deadline fields already shed when they became date pickers —
 * and it survives badly outside a demo. A buyer furnishing an office types "30" into a field
 * labelled minutes and publishes a tender whose first milestone expires while the supplier is
 * still reading it, and a supplier quoting 21 days against it has no way to say so.
 *
 * Months are 30 days. A window here is a rolling duration measured from an event rather than a
 * date in a calendar, so there is no month to be the length of, and the label says 30 days so
 * nobody has to guess which convention was used.
 */

export type DurationUnit = "minutes" | "hours" | "days" | "weeks" | "months";

export const DURATION_UNITS: { value: DurationUnit; label: string; seconds: number }[] = [
  { value: "minutes", label: "minutes", seconds: 60 },
  { value: "hours", label: "hours", seconds: 3_600 },
  { value: "days", label: "days", seconds: 86_400 },
  { value: "weeks", label: "weeks", seconds: 604_800 },
  { value: "months", label: "months (30 days)", seconds: 2_592_000 },
];

const SIZE = new Map(DURATION_UNITS.map((u) => [u.value, u.seconds]));

export function toSeconds(amount: string, unit: DurationUnit): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * (SIZE.get(unit) ?? 60));
}

/**
 * Seconds back into the largest unit that divides them exactly, so a window set as "2 weeks"
 * reopens as "2 weeks" rather than "14 days" and a buyer editing a tender does not have to
 * recognise their own figure in a different unit.
 */
export function fromSeconds(seconds: number): { amount: string; unit: DurationUnit } {
  for (const u of [...DURATION_UNITS].reverse()) {
    if (seconds >= u.seconds && seconds % u.seconds === 0) {
      return { amount: String(seconds / u.seconds), unit: u.value };
    }
  }
  return { amount: String(Math.round(seconds / 60)), unit: "minutes" };
}

/**
 * Units valid for a delivery window, which is not every unit.
 *
 * A bid carries `uint32 deliveryDays` — whole days — and the award check refuses a bid whose days
 * exceed the window. The smallest bid anyone can place is therefore one day, so a window shorter
 * than that cannot be met by any bid at all: the tender takes bids normally, reveals them
 * normally, and then refuses every award with `DeliveryExceedsWindow`. Offering minutes and hours
 * here would be offering a setting whose only effect is to waste a supplier's deposit.
 *
 * The acceptance window has no such limit — it is the buyer's own clock and is measured in
 * seconds throughout.
 */
export const DELIVERY_UNITS = DURATION_UNITS.filter((u) => u.seconds >= 86_400);

/** One day, in seconds: the shortest delivery window any bid can satisfy. */
export const MIN_DELIVERY_SECONDS = 86_400;
