"use client";

import { agent, profileMessage } from "@/lib/agent";
import { CATEGORIES } from "@/lib/taxonomy";
import { REGIONS } from "@/lib/taxonomy";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

/**
 * Publish what your own wallet says about itself.
 *
 * Shown only to the wallet it describes, because that is the only wallet that can sign it. The
 * signature is not decoration: without it, a directory of unverified claims lets anyone publish a
 * competitor's name over a worse record, which is the one attack this has to stop. It cannot make
 * the claims true — nothing can — so the form says plainly which half a buyer should trust.
 */
export function SupplierProfile({
  address,
  initial,
}: {
  address: string;
  initial: {
    name: string;
    country: string;
    categories: string[];
    website: string;
    contact: string;
    about: string;
  } | null;
}) {
  const { address: connected, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");
  const [categories, setCategories] = useState((initial?.categories ?? []).join(","));
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [about, setAbout] = useState(initial?.about ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isMine = Boolean(
    isConnected && connected && connected.toLowerCase() === address.toLowerCase(),
  );
  if (!isMine) return null;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const fields = {
        address,
        name: name.trim(),
        country: country.trim(),
        categories: categories.trim(),
        website: website.trim(),
        contact: contact.trim(),
        about: about.trim(),
        ts: Math.floor(Date.now() / 1000),
      };
      const signature = await signMessageAsync({ message: profileMessage(fields) });
      const res = await agent.publishProfile(address, { ...fields, signature });
      if (res && "error" in res) throw new Error(res.error);
      setSaved(true);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not publish that");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ padding: "0 20px 14px" }}>
        <button type="button" className="chip" onClick={() => setOpen(true)}>
          {initial ? "edit your profile" : "add your company details"}
        </button>
        {saved && <span className="hint"> Published. Reload to see it.</span>}
      </div>
    );
  }

  return (
    <div className="form" style={{ padding: "0 20px 16px" }}>
      <div className="field">
        <label htmlFor="p-name">Company name</label>
        <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-country">Country</label>
        <select id="p-country" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">—</option>
          {REGIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field full">
        <label htmlFor="p-cats">What you supply</label>
        <select
          id="p-cats"
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
        >
          <option value="">—</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="p-web">Website</label>
        <input id="p-web" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-contact">Contact</label>
        <input
          id="p-contact"
          value={contact}
          placeholder="sales@… — published permanently"
          onChange={(e) => setContact(e.target.value)}
        />
      </div>
      <div className="field full">
        <label htmlFor="p-about">About</label>
        <textarea
          id="p-about"
          rows={3}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
        />
      </div>
      <div className="full note">
        Signing proves this wallet published these words, so nobody can write a profile in your
        name. It does <b>not</b> make them true, and this site does not check them — a buyer who
        needs proof of a certification should still ask you for the certificate. Your record above
        is counted from the chain and is not editable by anyone, including you.
      </div>
      <div className="full filter-row">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !name.trim()}
          onClick={save}
        >
          {busy ? "Signing…" : "Publish"}
        </button>
        <button type="button" className="chip" onClick={() => setOpen(false)}>
          cancel
        </button>
        <span className="hint">Signing is free; it does not send a transaction.</span>
      </div>
      {error && (
        <div className="full field-err" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
