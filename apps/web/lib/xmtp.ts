/**
 * End-to-end encrypted messaging between a buyer and the supplier they awarded.
 *
 * Everything else in this project is deliberately public: bids are sealed until they are revealed
 * and then anyone can read them, clarifications go to every bidder, and the decision memo is
 * published so it can be re-hashed. Delivery is the one part that is nobody else's business. A
 * supplier sending a revised drawing, or asking why milestone two was rejected, is not
 * procurement transparency — it is two counterparties doing the work, and putting it on-chain or
 * through this project's own server would either publish it or ask everyone to trust the server.
 *
 * XMTP is used because it needs neither. Messages are encrypted to the two wallets (MLS), and the
 * wallet that already signs bids is the identity — so there is no account to create, no email to
 * collect, and no inbox for this project to hold, lose or be compelled to hand over.
 *
 * Two consequences are worth stating plainly rather than discovering later:
 *
 *  - **Both sides must have an XMTP identity before either can write.** A wallet that has never
 *    signed into XMTP cannot receive anything, so `canMessage` is false and there is nothing to
 *    send to. This is why enabling messaging is offered even when the counterparty is unreachable:
 *    it makes *you* reachable, which is the half of the problem you can actually solve.
 *  - **History lives in the browser that received it.** The message database is local (OPFS), so a
 *    different browser starts empty. That is a property of the protocol's storage, not a bug here,
 *    and the UI says so rather than implying a thread was lost.
 */

export type XmtpEnv = "local" | "dev" | "production";

/** Which XMTP network to use. Independent of Arc: XMTP is not a chain we settle on. */
export function xmtpEnv(raw: string | undefined): XmtpEnv {
  return raw === "local" || raw === "dev" || raw === "production" ? raw : "production";
}

export type Party = { role: "buyer" | "supplier"; counterparty: string };

/**
 * Who the connected wallet is in this engagement, and who they would be writing to.
 *
 * Null for everyone else, and null is the common case: a third party reading the tender has no
 * business in this thread and should not be shown a door they cannot open. The supplier is only
 * known once an award exists, which is the point at which a private channel starts being needed.
 */
export function counterpartyOf(input: {
  me: string | undefined;
  buyer: string;
  supplier: string | undefined;
}): Party | null {
  const me = input.me?.toLowerCase();
  if (!me || !input.supplier) return null;
  const buyer = input.buyer.toLowerCase();
  const supplier = input.supplier.toLowerCase();
  // An engagement with no winner carries the zero address; there is no one to write to.
  if (/^0x0+$/.test(supplier)) return null;
  if (me === buyer) return { role: "buyer", counterparty: supplier };
  if (me === supplier) return { role: "supplier", counterparty: buyer };
  return null;
}

/** Minimal shape of `localStorage`, so this is testable without a DOM. */
export type KeyStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const KEY_PREFIX = "sealedrfq.xmtp.dbkey.";

/**
 * The key that encrypts the local message database, kept per wallet.
 *
 * It has to be stable across reloads or the database cannot be reopened, and it must not be
 * derived from a signature — that would mean a wallet prompt on every page load for something the
 * user did not ask for. A random key in local storage is the honest trade: clearing site data
 * loses local history, which is already true of the database it protects.
 */
export function dbKeyFor(address: string, store: KeyStore): Uint8Array {
  const slot = KEY_PREFIX + address.toLowerCase();
  const saved = store.getItem(slot);
  if (saved && /^[0-9a-f]{64}$/.test(saved)) return hexToBytes(saved);

  const key = crypto.getRandomValues(new Uint8Array(32));
  store.setItem(slot, bytesToHex(key));
  return key;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Turn whatever the SDK threw into something a procurement officer can act on.
 *
 * The two that actually happen are worth separating from "something went wrong". The single-tab
 * limit is a hard constraint of the storage layer (the OPFS pool allows one connection), and it
 * looks exactly like a hang if it is not named. A declined signature is not an error at all.
 */
export function explainXmtpError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);

  if (/denied|rejected|User rejected/i.test(text)) {
    return "You declined the signature, so messaging was not enabled.";
  }
  if (/opfs|sahpool|already.*(open|locked)|storage/i.test(text)) {
    return "Messaging is already open in another tab. Close the other tab and try again — the local message store allows one connection at a time.";
  }
  if (/fetch|network|Failed to fetch/i.test(text)) {
    return "Could not reach the XMTP network. Check your connection and try again.";
  }
  return text || "Messaging could not be started.";
}
