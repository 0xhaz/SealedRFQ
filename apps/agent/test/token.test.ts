import { describe, expect, it } from "vitest";
import { checkToken } from "../src/modules/auth/token.guard.js";

const SECRET = "s3cret-token-value";

describe("checkToken", () => {
  it("reports an unconfigured service rather than letting the call through", () => {
    // The endpoint is disabled when no token is set, never open. Forgetting to configure it must
    // not be the same as choosing to expose it.
    expect(checkToken(`Bearer ${SECRET}`, undefined)).toBe("not-configured");
    expect(checkToken(undefined, undefined)).toBe("not-configured");
    expect(checkToken(`Bearer ${SECRET}`, "")).toBe("not-configured");
  });

  it("accepts the configured token", () => {
    expect(checkToken(`Bearer ${SECRET}`, SECRET)).toBe("ok");
    expect(checkToken(`bearer ${SECRET}`, SECRET)).toBe("ok");
    expect(checkToken(`Bearer   ${SECRET}`, SECRET)).toBe("ok");
  });

  it("rejects a wrong token, including one that is a prefix of the real one", () => {
    expect(checkToken(`Bearer ${SECRET}x`, SECRET)).toBe("bad");
    expect(checkToken(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe("bad");
    expect(checkToken("Bearer ", SECRET)).toBe("missing");
  });

  it("rejects a missing or malformed header", () => {
    expect(checkToken(undefined, SECRET)).toBe("missing");
    expect(checkToken("", SECRET)).toBe("missing");
    expect(checkToken(SECRET, SECRET)).toBe("missing"); // no Bearer scheme
    expect(checkToken(`Basic ${SECRET}`, SECRET)).toBe("missing");
  });

  it("does not throw on a length mismatch", () => {
    // timingSafeEqual throws when the buffers differ in length; hashing both sides avoids that,
    // and avoids leaking the token's length through the difference between a 500 and a 401.
    expect(() => checkToken("Bearer a", "a-much-longer-configured-token")).not.toThrow();
    expect(checkToken("Bearer a", "a-much-longer-configured-token")).toBe("bad");
  });
});
