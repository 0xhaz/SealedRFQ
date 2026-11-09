import { beforeAll, describe, expect, it } from "vitest";

/**
 * The session cookie is the only thing standing between a request and a tenant identity, so what it
 * refuses matters more than what it accepts.
 */
let session: typeof import("../lib/v2/session");

beforeAll(async () => {
  process.env.SESSION_SECRET = "a-test-secret-long-enough-to-be-accepted-xxxx";
  session = await import("../lib/v2/session");
});

const USER = "11111111-1111-1111-1111-111111111111";

describe("a session cookie", () => {
  it("round-trips the user it was issued for", () => {
    expect(session.parse(session.serialise(USER))).toBe(USER);
  });

  it("refuses a user id with no signature", () => {
    expect(session.parse(USER)).toBeNull();
  });

  it("refuses a forged signature", () => {
    expect(session.parse(`${USER}.notarealsignature`)).toBeNull();
  });

  it("refuses someone else's id carrying a valid signature for mine", () => {
    // The attack a bare identifier invites: take a legitimate cookie, change the id.
    const mine = session.serialise(USER);
    const theirs = mine.replace(USER, "22222222-2222-2222-2222-222222222222");
    expect(session.parse(theirs)).toBeNull();
  });

  it("treats an absent or empty cookie as no session rather than an error", () => {
    expect(session.parse(undefined)).toBeNull();
    expect(session.parse("")).toBeNull();
    expect(session.parse(".")).toBeNull();
  });

  it("is http-only and same-site, so script cannot read it and a cross-site form cannot send it", () => {
    const c = session.sessionCookie(USER);
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("lax");
  });

  it("clears by expiring rather than by leaving a stale value behind", () => {
    const c = session.clearedCookie();
    expect(c.maxAge).toBe(0);
    expect(c.value).toBe("");
  });
});

describe("the signing secret", () => {
  it("is required, and a short one is refused rather than accepted quietly", async () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "";
    const fresh = await import(`../lib/v2/session?blank=${Date.now()}`);
    expect(() => fresh.serialise(USER)).toThrow(/SESSION_SECRET/);
    process.env.SESSION_SECRET = "short";
    const short = await import(`../lib/v2/session?short=${Date.now()}`);
    expect(() => short.serialise(USER)).toThrow(/at least 32/);
    process.env.SESSION_SECRET = saved;
  });
});
