"use client";

import { useState } from "react";

/**
 * Ask the Concordium wallet for a proof, then have the server check it.
 *
 * The challenge comes from the server, never from here: a proof whose challenge the holder chose
 * shows only that they once held a credential, not that they are answering this tender now. The
 * statement comes back with it, so what the wallet is asked and what the server checks are the
 * same question — and so the supplier can read it before approving rather than after.
 */
type Phase = "idle" | "requesting" | "connecting" | "proving" | "verifying" | "done" | "failed";

type ChallengeResponse = {
  challenge: string;
  expiresAt: string;
  // biome-ignore lint/suspicious/noExplicitAny: passed to the wallet unchanged.
  statement: any;
  description: string;
};

export function ProveQualification({ tenderId }: { tenderId: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [description, setDescription] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [subjects, setSubjects] = useState<string[]>([]);

  async function run() {
    setMessage(undefined);
    setSubjects([]);
    try {
      setPhase("requesting");
      const issued = await fetch("/api/concordium/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenderId }),
      });
      if (!issued.ok) throw new Error((await issued.json()).error ?? "could not get a challenge");
      const { challenge, statement, description }: ChallengeResponse = await issued.json();
      setDescription(description);

      setPhase("connecting");
      // Imported here rather than at the top: it touches `window` and must not run on the server.
      const { detectConcordiumProvider } = await import("@concordium/browser-wallet-api-helpers");
      const wallet = await detectConcordiumProvider(2000).catch(() => {
        throw new Error(
          "No Concordium wallet found. Install the Concordium Wallet for Web and switch it to Testnet.",
        );
      });

      /**
       * Connect before asking for anything. Detecting the extension is not permission to use it:
       * the wallet keeps a per-origin allow list and refuses an unconnected site with "Site is not
       * whitelisted", which reads like a configuration problem on our end and is actually a consent
       * step that was never offered. `requestAccounts` is the current call — `connect` is
       * deprecated in favour of it — and it resolves without prompting once a site is allowed, so
       * running it every time costs a returning supplier nothing.
       */
      let accounts: string[];
      try {
        accounts = await wallet.requestAccounts();
      } catch {
        throw new Error(
          "The wallet refused the connection. Open the Concordium extension and allow this site, then try again.",
        );
      }
      if (accounts.length === 0) {
        // Connected, but with no account selected. The wallet documents an empty list as possible,
        // and a presentation needs a credential to speak for.
        throw new Error(
          "The wallet connected but shared no account. Select an account in the extension and try again.",
        );
      }

      setPhase("proving");
      const presentation = await wallet.requestVerifiablePresentation(challenge, statement);

      setPhase("verifying");
      const checked = await fetch("/api/concordium/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenderId, challenge, presentation }),
      });
      const result = await checked.json();
      if (!checked.ok || !result.ok) {
        // The server's reason is worth showing: it tells a supplier whether to try again.
        throw new Error(result.detail ?? result.error ?? result.reason ?? "the proof was refused");
      }
      setSubjects(result.subjects ?? []);
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("failed");
    }
  }

  const busy =
    phase === "requesting" ||
    phase === "connecting" ||
    phase === "proving" ||
    phase === "verifying";

  return (
    <div className="panel">
      <div className="head">
        Prove you may bid<span className="hint">Concordium · testnet</span>
      </div>

      <div className="note">
        Your wallet will show exactly what is being asked and prove it without sending us the
        underlying details. We learn whether the answer is yes, not what the answer was made of.
      </div>

      {description && <div className="note">{description}</div>}

      <div className="note warn">
        <b>What this does not establish.</b> A verified Concordium identity means an identity
        provider checked documents and has not revoked the credential. It is not evidence that a
        company is trading or solvent, that the signer may contract on its behalf, of beneficial
        ownership, or of any sanctions or debarment check. On testnet the issuer attests without
        checking anything at all.
      </div>

      <button className="btn-primary" type="button" onClick={run} disabled={busy}>
        {phase === "requesting" && "Asking for a challenge…"}
        {phase === "connecting" && "Allow this site in your wallet…"}
        {phase === "proving" && "Waiting for your wallet…"}
        {phase === "verifying" && "Checking the proof…"}
        {(phase === "idle" || phase === "failed" || phase === "done") && "Prove with Concordium"}
      </button>

      {phase === "done" && (
        <div className="note">
          <b>Proof accepted.</b> The challenge it answered has been spent, so this proof cannot be
          presented again.
          {subjects.length > 0 && (
            <>
              <br />
              <span className="mono-sm">{subjects.join(", ")}</span>
            </>
          )}
        </div>
      )}

      {phase === "failed" && (
        <div className="note warn">
          <b>Not accepted.</b> {message}
        </div>
      )}
    </div>
  );
}
