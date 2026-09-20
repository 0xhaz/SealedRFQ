"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { hashFile, hashText, sameHash, ZERO_HASH } from "@/lib/docHash";

type Props = {
  /** What the chain recorded: a milestone deliverable or a revealed proposal. */
  expected: Hex;
  label: string;
  hint?: string;
};

/**
 * Check a received document against the hash on-chain.
 *
 * This answers "is this the file they committed to?" — not "is the work any good". A match means the
 * bytes are identical to what was submitted; judging whether the contents meet the spec is the
 * buyer's job, and no hash can do it for them.
 */
export function DocumentCheck({ expected, label, hint }: Props) {
  const [result, setResult] = useState<{ ok: boolean; computed: Hex } | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");

  if (!expected || expected === ZERO_HASH) return null;

  async function check(file: File) {
    setBusy(true);
    try {
      const computed = await hashFile(file);
      setResult({ ok: sameHash(computed, expected), computed });
    } finally {
      setBusy(false);
    }
  }

  function checkText() {
    if (!text.trim()) return;
    const computed = hashText(text.trim());
    setResult({ ok: sameHash(computed, expected), computed });
  }

  return (
    <div className="doccheck">
      <div className="doccheck-head">
        {label}
        <span className="hint">{hint ?? "hashed in your browser; nothing is uploaded"}</span>
      </div>

      <div className="kv">
        <span>On-chain hash</span>
        <b className="mono" style={{ fontSize: 11 }}>
          {expected.slice(0, 26)}…
        </b>
      </div>

      <div className="doccheck-inputs">
        <label className="btn-nav" htmlFor="doccheck-file">
          {busy ? "Hashing…" : "Choose the file you received"}
        </label>
        <input
          id="doccheck-file"
          type="file"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && check(e.target.files[0])}
        />
        <span className="muted" style={{ fontSize: 11 }}>
          or paste the reference that was submitted
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            aria-label="submitted reference"
            value={text}
            placeholder="https://… or a commit id"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="btn-nav" onClick={checkText} disabled={!text.trim()}>
            Check
          </button>
        </div>
      </div>

      {result && (
        <div className={`doccheck-result ${result.ok ? "ok" : "bad"}`}>
          {result.ok ? (
            <>
              <b>✓ Matches the chain.</b> These bytes are exactly what was submitted, so the document
              has not been swapped or edited since. Whether the work itself is acceptable is still
              your call.
            </>
          ) : (
            <>
              <b>✕ Does not match.</b> This file hashes to{" "}
              <span className="mono">{result.computed.slice(0, 18)}…</span>, not the value recorded
              on-chain. Either it is a different version, or it is not the document that was
              submitted — worth resolving before you accept the milestone.
            </>
          )}
        </div>
      )}
    </div>
  );
}
