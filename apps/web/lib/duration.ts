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
 * The shortest delivery window worth offering.
 *
 * Delivery used to be a whole number of days while the window was seconds, so nothing below a day
 * could be met by any bid and such a tender refused every award. Both are seconds now, so a
 * two-hour window can be answered with ninety minutes and every unit below is legitimate. The
 * floor is only here to stop a window so short that nobody could act on it.
 */
export const MIN_DELIVERY_SECONDS = 300;
