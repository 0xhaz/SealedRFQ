"use client";

import { createRequestAction } from "@/app/workspace/requests/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewRequestForm({
  organisations,
}: {
  organisations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const result = await createRequestAction(form);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/workspace/requests/${result.id}`);
  }

  return (
    <form className="panel" action={submit}>
      <div className="head">Details</div>
      <div className="form" style={{ padding: "0 20px 18px" }}>
        <div className="field">
          <label htmlFor="orgId">Posting as</label>
          <select id="orgId" name="orgId" required>
            {organisations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <span className="field-hint">
            The organisation that owns the request, and the only one that can change it.
          </span>
        </div>

        <div className="field">
          <label htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue="RFI">
            <option value="RFI">RFI, to find out what is possible</option>
            <option value="RFQ">RFQ, binding</option>
          </select>
        </div>

        <div className="field full">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            name="title"
            required
            placeholder="Route-optimisation software for a 40-vehicle fleet"
          />
          <span className="field-hint">
            What you are asking about, specifically enough that a supplier can tell whether it is
            for them.
          </span>
        </div>

        {error && <div className="full note warn">{error}</div>}

        <div className="full button-row">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create as a draft"}
          </button>
          <span className="under-button">
            A draft is visible only to your organisation until you open it.
          </span>
        </div>
      </div>
    </form>
  );
}
