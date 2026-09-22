type Requirements = {
  maxDeliveryDays?: number;
  minCompletedEngagements?: number;
  attestations?: string[];
  supplierRegion?: string;
};

/**
 * What this bid will be screened against, shown before a deposit is posted.
 *
 * A supplier could otherwise seal a bid, pay a deposit and only discover at reveal that the buyer
 * required delivery in twenty days. The split matters as much as the list: the first two are
 * decided by arithmetic on the revealed bid, so a supplier can predict them exactly, while the rest
 * are claims no bid can prove and are handed to a person. Presenting both as "requirements" without
 * saying which is which would suggest the software checks things it cannot.
 */
export function RequirementsPanel({ metadataURI }: { metadataURI?: string | null }) {
  if (!metadataURI) return null;

  let r: Requirements | null = null;
  try {
    r = (JSON.parse(metadataURI) as { requirements?: Requirements }).requirements ?? null;
  } catch {
    return null;
  }
  if (!r) return null;

  const checked: string[] = [];
  if (r.maxDeliveryDays !== undefined) {
    checked.push(
      `Delivery within ${r.maxDeliveryDays} days — a slower bid is flagged automatically`,
    );
  }
  if (r.minCompletedEngagements !== undefined) {
    checked.push(
      `At least ${r.minCompletedEngagements} completed engagement(s) here — counted from this deployment's own record`,
    );
  }

  const declared = [...(r.attestations ?? [])];
  if (r.supplierRegion) declared.push(`Established in ${r.supplierRegion}`);

  if (checked.length === 0 && declared.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h3>What your bid is screened against</h3>
      </div>
      <div className="card-body">
        {checked.length > 0 && (
          <>
            <p className="note">
              <b>Checked automatically</b> when bids are revealed, from the values in your bid:
            </p>
            <ul>
              {checked.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
        {declared.length > 0 && (
          <>
            <p className="note">
              <b>Stated by the buyer, and checked by a person.</b> Nothing here is marked satisfied
              because a bid says so — a bid cannot prove a certificate or where a company is based:
            </p>
            <ul>
              {declared.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
