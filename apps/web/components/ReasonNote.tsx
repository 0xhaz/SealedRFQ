"use client";

import { documentUrl } from "@/lib/agent";
import { ZERO_HASH, hashText, sameHash } from "@/lib/docHash";
import { useEffect, useState } from "react";
import type { Hex } from "viem";

/**
 * The words behind a decision hash.
 *
 * Accepting or rejecting a milestone records `bytes32 reason` — enough to commit the buyer to one
 * specific sentence and to prove later that it never changed, but not something the supplier can
 * read. Thirty-two bytes is a commitment, not an explanation, and a rejection nobody can read is
 * indistinguishable from no reason at all.
 *
 * The text is fetched from the document store by that same hash and re-hashed here before being
 * shown. So the store is not trusted to tell the truth: a note that does not hash back to the value
 * on-chain is reported as unverified rather than displayed as the buyer's words.
 */
export function ReasonNote({ hash, label }: { hash?: string | null; label: string }) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "text"; text: string } | { kind: "missing" } | { kind: "bad" }
  >({ kind: "loading" });

  useEffect(() => {
    if (!hash || hash === ZERO_HASH) return;
    const url = documentUrl(hash);
    if (!url) return setState({ kind: "missing" });

    let live = true;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        if (!live) return;
        setState(sameHash(hashText(text), hash as Hex) ? { kind: "text", text } : { kind: "bad" });
      })
      .catch(() => live && setState({ kind: "missing" }));
    return () => {
      live = false;
    };
  }, [hash]);

  if (!hash || hash === ZERO_HASH) return null;

  return (
    <div className="note">
      <b>{label}</b>{" "}
      {state.kind === "text" ? (
        <>
          “{state.text}” <span className="hint">— matches the hash recorded on-chain</span>
        </>
      ) : state.kind === "bad" ? (
        <span className="warn-text">
          A note was published for this decision but it does not hash to the value on-chain, so it
          is not what was recorded. Ask for the original.
        </span>
      ) : state.kind === "missing" ? (
        <span className="hint">
          recorded as <span className="mono">{hash.slice(0, 14)}…</span> — the text was not
          published, so ask the buyer for it and check it against this hash
        </span>
      ) : (
        <span className="hint">loading…</span>
      )}
    </div>
  );
}
