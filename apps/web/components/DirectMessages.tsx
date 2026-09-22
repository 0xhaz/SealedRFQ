"use client";

import {
  type Party,
  counterpartyOf,
  dbKeyFor,
  explainXmtpError,
  xmtpEnv,
} from "@/lib/xmtp";
import type { ClientOptions } from "@xmtp/browser-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { toBytes } from "viem";
import { useAccount, useSignMessage } from "wagmi";

/**
 * The private channel between a buyer and the supplier they awarded.
 *
 * Rendered for exactly two wallets and nobody else — see `counterpartyOf`. The reason this is not
 * simply a table in the agent's database is in `lib/xmtp.ts`; the reason it is not an email field
 * is that an email address is a second identity to collect, verify and lose, when both parties
 * have already proved control of a wallet by signing everything else here.
 *
 * The SDK is imported inside the handler rather than at the top of the file, because it carries a
 * **12MB WebAssembly runtime** and most people reading a tender will never open a thread. What that
 * buys, measured against a production build rather than assumed: the bundler folds the ~42KB of JS
 * glue into this component's chunk, so that much is not deferred — but every chunk that touches the
 * WebAssembly binary stays out of the page's manifest, and the binary is fetched only when a client
 * is actually created. Reading a tender costs the 42KB; the 12MB is charged to whoever clicks.
 *
 * Keeping the import here also keeps it away from the server: this panel is mounted by a Server
 * Component, and `ssr: false` is not available there, so a module that expects `window` must never
 * be reachable from the module graph at render time.
 */

type Line = { id: string; mine: boolean; text: string; at: Date };

type State =
  | { tag: "idle" }
  | { tag: "starting"; note: string }
  | { tag: "unreachable" }
  | { tag: "ready" }
  | { tag: "error"; message: string };

export function DirectMessages({
  buyer,
  supplier,
}: {
  buyer: string;
  supplier: string | undefined;
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [state, setState] = useState<State>({ tag: "idle" });
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // Held outside React state: these are not rendered, and a conversation handle must survive a
  // re-render without restarting the stream it owns.
  const dmRef = useRef<{ sendText(t: string): Promise<string> } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const myInboxRef = useRef<string>("");

  const party: Party | null = counterpartyOf({ me: address, buyer, supplier });

  // A stream holds a worker and a network subscription; leaving it running after the panel goes
  // away leaks both.
  useEffect(() => () => stopRef.current?.(), []);

  const start = useCallback(async () => {
    if (!party || !address) return;
    setState({ tag: "starting", note: "Loading the messaging runtime…" });

    try {
      const { Client, ConsentState, IdentifierKind, isText, createBackend } = await import(
        "@xmtp/browser-sdk"
      );
      const ethereum = IdentifierKind.Ethereum;
      const env = xmtpEnv(process.env.NEXT_PUBLIC_XMTP_ENV);
      // `canMessage` is static, so the network has to be handed to it separately. It takes a
      // `Backend`, which is the non-deprecated form of that argument in v7.
      const backend = await createBackend({ env });

      setState({ tag: "starting", note: "Waiting for your signature…" });
      const options: ClientOptions = {
        env,
        dbEncryptionKey: dbKeyFor(address, window.localStorage),
      };
      const client = await Client.create(
        {
          type: "EOA",
          getIdentifier: () => ({ identifier: address.toLowerCase(), identifierKind: ethereum }),
          // XMTP wants the raw signature bytes; wagmi hands back a hex string.
          signMessage: async (message: string) => toBytes(await signMessageAsync({ message })),
        },
        // Cast around a typing defect in @xmtp/browser-sdk@7.1.0: it declares this parameter as
        // `Omit<ClientOptions, "codecs">`, and because `ClientOptions` is an intersection whose
        // first member is the union `NetworkOptions | { backend }`, `keyof` keeps only the keys
        // those two share — none. So `Omit` silently discards *both* `env` and `backend`, and the
        // options type cannot name a network at all, while `dbPath` and the rest survive. The
        // runtime reads `env` normally; only the declaration is wrong.
        options as Parameters<typeof Client.create>[1],
      );
      myInboxRef.current = client.inboxId ?? "";

      // Only now is it worth asking, and asking first would have been worse: a wallet that has
      // never used XMTP cannot receive anything, so the useful thing this signature just did was
      // make *this* wallet reachable, whatever the answer turns out to be.
      setState({ tag: "starting", note: "Checking whether they can receive messages…" });
      const reachable = await Client.canMessage(
        [{ identifier: party.counterparty, identifierKind: ethereum }],
        backend,
      );
      if (!reachable.get(party.counterparty)) {
        setState({ tag: "unreachable" });
        return;
      }

      // Pull the conversation list down before asking for the thread. A client that has just been
      // created — or one opened in a browser that has been idle — knows only what its local
      // database holds, and `createDmWithIdentifier` reuses an existing DM only if it can see one.
      // Skipping this is how the two sides end up in two different threads, each looking at an
      // empty panel while the other wonders why nobody replied.
      setState({ tag: "starting", note: "Opening the thread…" });
      await client.conversations.sync();

      const dm = await client.conversations.createDmWithIdentifier({
        identifier: party.counterparty,
        identifierKind: ethereum,
      });
      dmRef.current = dm;

      // This thread was asked for, so it is consented to. Left at the default the counterparty's
      // first message arrives as a request from an unknown sender, which is the right default for
      // a social app and the wrong one for a contract both parties signed.
      await dm.updateConsentState(ConsentState.Allowed);

      const history = await dm.messages();
      const mine = (senderInboxId: string) => senderInboxId === myInboxRef.current;
      setLines(
        history.filter(isText).map((m) => ({
          id: m.id,
          mine: mine(m.senderInboxId),
          text: String(m.content ?? ""),
          at: m.sentAt,
        })),
      );

      const stream = await dm.stream({
        onValue: (m) => {
          if (!isText(m)) return;
          setLines((prev) =>
            // The stream replays what we just sent, and a message already on screen must not
            // appear twice.
            prev.some((l) => l.id === m.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: m.id,
                    mine: mine(m.senderInboxId),
                    text: String(m.content ?? ""),
                    at: m.sentAt,
                  },
                ],
          );
        },
      });
      stopRef.current = () => void stream.end();

      setState({ tag: "ready" });
    } catch (e) {
      setState({ tag: "error", message: explainXmtpError(e) });
    }
  }, [address, party, signMessageAsync]);

  async function send() {
    const text = draft.trim();
    if (!text || !dmRef.current) return;
    setSending(true);
    try {
      await dmRef.current.sendText(text);
      setDraft("");
    } catch (e) {
      setState({ tag: "error", message: explainXmtpError(e) });
    } finally {
      setSending(false);
    }
  }

  // Nothing to show a bystander, and nothing to show before there is an awarded supplier.
  if (!party) return null;

  const them = `${party.counterparty.slice(0, 6)}…${party.counterparty.slice(-4)}`;
  const theirRole = party.role === "buyer" ? "the supplier" : "the buyer";

  return (
    <div className="panel">
      <div className="head">
        Private messages
        <span className="hint">end-to-end encrypted · {them}</span>
      </div>

      {!isConnected && <div className="note">Connect your wallet to open this thread.</div>}

      {isConnected && state.tag === "idle" && (
        <>
          <div className="note">
            Everything else on this page is public on purpose. Delivery is not: questions about a
            rejected milestone, a revised drawing, a date that slipped. Messages here are encrypted
            to your two wallets — this site never holds them and cannot read them.
          </div>
          <div style={{ padding: "0 20px 14px" }}>
            <button type="button" className="btn-primary" onClick={start}>
              Enable messaging
            </button>
            <span className="hint" style={{ marginLeft: 10 }}>
              One signature. No gas, no transaction.
            </span>
          </div>
        </>
      )}

      {state.tag === "starting" && <div className="note">{state.note}</div>}

      {state.tag === "unreachable" && (
        <div className="note">
          <b>You can now receive messages.</b> {them} has not enabled messaging yet, so there is
          nowhere to deliver to. Ask {theirRole} to open this tender and do the same — once they
          have, this thread opens for both of you.
        </div>
      )}

      {state.tag === "error" && (
        <>
          <div className="field-err" role="alert">
            {state.message}
          </div>
          <div style={{ padding: "0 20px 14px" }}>
            <button type="button" className="chip" onClick={start}>
              try again
            </button>
          </div>
        </>
      )}

      {state.tag === "ready" && (
        <div style={{ padding: "4px 20px 16px" }}>
          {lines.length === 0 ? (
            <p className="hint">
              No messages yet. History is stored in this browser, so a thread started elsewhere will
              not appear here.
            </p>
          ) : (
            <div className="dm-thread">
              {lines.map((l) => (
                <div key={l.id} className={l.mine ? "dm-line mine" : "dm-line"}>
                  <div className="dm-who">
                    {l.mine ? "You" : them} · {l.at.toISOString().replace("T", " ").slice(0, 16)}
                  </div>
                  <div className="dm-text">{l.text}</div>
                </div>
              ))}
            </div>
          )}

          <div className="qa-form">
            <textarea
              rows={2}
              placeholder={`Message ${theirRole} about this engagement`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="filter-row">
              <button
                type="button"
                className="btn-primary"
                disabled={sending || !draft.trim()}
                onClick={send}
              >
                {sending ? "Sending…" : "Send"}
              </button>
              <span className="hint">Encrypted to {them}. Not visible to other bidders.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
