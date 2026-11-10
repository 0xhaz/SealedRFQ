import { createHmac, timingSafeEqual } from "node:crypto";
import { myOrganizations } from "@sealedrfq/db/workspace";
import { cookies } from "next/headers";

/**
 * Who is signed in, for the V2 workspace.
 *
 * The session is the user id with an HMAC over it, so the server can recognise its own cookie
 * without storing anything. That is enough here because the id is not a capability: every query
 * runs through `withTenant`, where row-level security decides what that user may see. A forged id
 * would have to be a real user's, and the signature is what stops that.
 *
 * Deliberately not a JWT. There are no claims to carry, nothing to encode, and no third party to
 * convince; a signed identifier is the whole requirement, and the parts of JWT that are not needed
 * here are the parts that are usually got wrong.
 */
const COOKIE = "sealedrfq_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function secret(): Buffer {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 32) {
    // A short or missing secret makes every signature forgeable, so it fails rather than warns.
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return Buffer.from(raw, "utf8");
}

const sign = (userId: string) => createHmac("sha256", secret()).update(userId).digest("base64url");

export function serialise(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

/** Returns the user id, or null. Never throws on a bad cookie: an invalid session is no session. */
export function parse(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(userId));
  // Constant time, so a wrong signature cannot be found a byte at a time.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}

/** The signed-in user for a server component or route handler, or null. */
export async function currentUserId(): Promise<string | null> {
  const store = await cookies();
  return parse(store.get(COOKIE)?.value);
}

export const sessionCookie = (userId: string) => ({
  name: COOKIE,
  value: serialise(userId),
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
});

export const clearedCookie = () => ({ ...sessionCookie(""), value: "", maxAge: 0 });

/**
 * The organization this user is acting for, until a session carries one.
 *
 * Returns the id only when the user belongs to exactly one organization. With several there is no
 * honest answer to "which?", and picking the first would show one organization's work to someone
 * who may be acting as another; null makes every policy match nothing instead. A session that
 * names its organization replaces this.
 */
export async function activeOrgId(userId: string): Promise<string | null> {
  const orgs = await myOrganizations(userId);
  return orgs.length === 1 ? (orgs[0]?.id ?? null) : null;
}
