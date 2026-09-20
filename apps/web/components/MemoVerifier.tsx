"use client";

import { hashCanonical } from "@sealedrfq/shared";
import { useState } from "react";
import type { Hex } from "viem";

/**
 * Verify a memo you were given against the hash the chain holds.
 *
 * This is the part that makes the anchor worth anything: you do not have to trust this site, or the
 * agent that produced the decision. Paste the memo you received, and it is canonicalised (RFC 8785)
 * and hashed in your browser. If it does not match, the document was altered after the decision.
 */
export function MemoVerifier({ expected }: { expected: Hex }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; computed: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function check() {
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(text);
      const computed = hashCanonical(parsed);
      setResult({ ok: computed.toLowerCase() === expected.toLowerCase(), computed });
    } catch {
      setError("That is not valid JSON — paste the memo exactly as you received it.");
    }
  }

  return (
    <div className="doccheck">
      <div className="doccheck-head">
        Verify your own copy
        <span className="hint">hashed in your browser; nothing is sent anywhere</span>
      </div>
      <div className="kv">
        <span>Anchored hash</span>
        <b className="mono" style={{ fontSize: 11 }}>
          {expected.slice(0, 26)}…
        </b>
      </div>
      <div className="doccheck-inputs">
        <textarea
          aria-label="decision memo JSON"
          rows={6}
          placeholder='{"schema":"sealedrfq.decision.v1", …}'
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}
        />
        <div>
          <button type="button" className="btn-nav" onClick={check} disabled={!text.trim()}>
            Re-hash and compare
          </button>
        </div>
      </div>
      {error && (
        <div className="doccheck-result bad">
          <b>Could not read that.</b> {error}
        </div>
      )}
      {result && (
        <div className={`doccheck-result ${result.ok ? "ok" : "bad"}`}>
          {result.ok ? (
            <>
              <b>✓ Matches the anchor.</b> This memo is exactly the one recorded on-chain when the
              decision was made, so the reasoning you are reading is the reasoning that was used.
            </>
          ) : (
            <>
              <b>✕ Does not match.</b> This copy hashes to{" "}
              <span className="mono">{result.computed.slice(0, 18)}…</span>. Either it is not the
              memo for this decision, or it was altered after the fact.
            </>
          )}
        </div>
      )}
    </div>
  );
}
