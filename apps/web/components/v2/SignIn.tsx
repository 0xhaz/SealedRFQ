"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

/**
 * Sign in by proving control of a wallet.
 *
 * Three steps, in this order for a reason: the server issues a nonce, the wallet signs the message
 * containing it, and the server checks the signature against the nonce it issued. A signature over
 * something the client chose would prove a key exists somewhere, not that its holder is here now.
 */
export function SignIn({ onSignedIn }: { onSignedIn?: () => void }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      }).then((r) => r.json());
      if (challenge.error) throw new Error(challenge.error);

      const signature = await signMessageAsync({ message: challenge.message });

      const verified = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce: challenge.nonce, signature }),
      }).then((r) => r.json());
      if (verified.error) throw new Error(verified.error);

      onSignedIn?.();
      // A full reload, so every server component re-renders against the new session rather than
      // some reading it and some not.
      window.location.reload();
    } catch (e) {
      // A wallet rejection is the user saying no, not a failure to report as one.
      const message = e instanceof Error ? e.message : "sign-in failed";
      setError(/rejected|denied|User denied/i.test(message) ? null : message);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="note">
        Connect a wallet to sign in. Signing proves you control the address and moves no funds.
      </div>
    );
  }

  return (
    <div>
      <button type="button" className="btn-primary" disabled={busy} onClick={run}>
        {busy ? "Waiting for your wallet…" : "Sign in with this wallet"}
      </button>
      <span className="under-button">
        You will be asked to sign a short message. It is not a transaction and costs nothing.
      </span>
      {error && (
        <div className="note warn" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
