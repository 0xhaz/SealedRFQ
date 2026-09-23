/**
 * A duration in words, for text a person has to read.
 *
 * Buyers testing the system set delivery windows in minutes and real tenders set them in weeks, so
 * any fixed unit is wrong at one end or the other — and "1209600 seconds" is wrong at both. This
 * lives in the shared package because the evaluator's memo and the bid form both quote the same
 * window, and a supplier reading "15 minutes" in one place and "0.25 hours" in the other would
 * reasonably wonder which of the two is the rule.
 */
export function describeWindow(seconds: number): string {
  const units: [number, string][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size) {
      // One decimal, so "1.5 days" survives but "1.0 days" does not.
      const n = Math.round((seconds / size) * 10) / 10;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
