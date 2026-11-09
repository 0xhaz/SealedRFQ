import { PAUSE_REASON } from "@/lib/siteStatus";

/**
 * Shown in place of a form that would create a new commitment.
 *
 * Rendered instead of the form rather than over it, because a banner above a working form still
 * leaves the form working for anyone who scrolls past.
 */
export function PausedNotice({ action }: { action: string }) {
  return (
    <div className="panel">
      <div className="head">
        {PAUSE_REASON.headline}
        <span className="hint">{action} is unavailable</span>
      </div>
      <div className="note" style={{ margin: "0 20px 18px" }}>
        {PAUSE_REASON.body}
      </div>
    </div>
  );
}
