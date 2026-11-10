/**
 * Needs no database or Clerk: the session and the identity upserts are mocked. What is under test
 * is which facts requireOrg trusts, and that its refusals leak nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const signIn = vi.hoisted(() => vi.fn());
const upsertUser = vi.hoisted(() => vi.fn());
const upsertOrganization = vi.hoisted(() => vi.fn());
const myOrganizations = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@sealedrfq/db/identity", () => ({ upsertUser, upsertOrganization }));
// The projection must never be consulted for the organization; a call here fails the test below.
vi.mock("@sealedrfq/db/workspace", () => ({ myOrganizations }));
vi.mock("react", () => ({ cache: <T,>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { requireOrg, sessionTenant } from "@/lib/v2/tenant";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

/** The redirect target, or "returned" if requireOrg did not redirect. */
async function capture(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "returned";
  } catch (e) {
    return (e as Error).message.replace("REDIRECT:", "");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn.mockImplementation(() => {
    throw new Error("REDIRECT:/clerk-sign-in");
  });
  upsertUser.mockResolvedValue(USER);
  upsertOrganization.mockResolvedValue(ORG);
});

describe("requireOrg", () => {
  it("redirects identically for an organization that exists and one that does not", async () => {
    // A difference here enumerates other tenants' slugs.
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1", orgSlug: "acme" });
    const foreign = await capture(() => requireOrg("someone-elses-org"));
    const missing = await capture(() => requireOrg("no-such-org-at-all"));
    expect(foreign).toBe(missing);
    expect(foreign).toBe("/app/acme/inbox");
    // Neither slug was looked up, and nothing was written on their behalf.
    expect(upsertUser).not.toHaveBeenCalled();
    expect(upsertOrganization).not.toHaveBeenCalled();
  });

  it("redirects a signed-in user with no active organization to the choose task", async () => {
    authMock.mockResolvedValue({ userId: "user_1", orgId: null, orgSlug: null });
    await expect(capture(() => requireOrg("anything"))).resolves.toBe("/app/choose-organization");
  });

  it("redirects a signed-out visitor to sign-in", async () => {
    // Via Clerk's own helper, so the target follows the instance's configured sign-in URL.
    authMock.mockResolvedValue({
      userId: null,
      orgId: null,
      orgSlug: null,
      redirectToSignIn: signIn,
    });
    await expect(capture(() => requireOrg("acme"))).resolves.toBe("/clerk-sign-in");
    expect(signIn).toHaveBeenCalled();
  });

  it("redirects when the url slug and the session slug disagree", async () => {
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1", orgSlug: "acme" });
    await expect(capture(() => requireOrg("other"))).resolves.toBe("/app/acme/inbox");
  });

  it("returns Postgres uuids and a role without the org: prefix", async () => {
    authMock.mockResolvedValue({
      userId: "user_1",
      orgId: "org_1",
      orgSlug: "acme",
      orgRole: "org:admin",
    });
    await expect(requireOrg("acme")).resolves.toEqual({
      userId: USER,
      orgId: ORG,
      orgSlug: "acme",
      role: "admin",
    });
    expect(upsertUser).toHaveBeenCalledWith("user_1");
    expect(upsertOrganization).toHaveBeenCalledWith("org_1");
  });

  it("takes the organization from the session and never from the membership projection", async () => {
    // The second gate is only a gate if it is not fed by the first.
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1", orgSlug: "acme" });
    await requireOrg("acme");
    expect(myOrganizations).not.toHaveBeenCalled();
  });
});

describe("an organization without a slug", () => {
  it("is addressed by its id rather than dead-ending", async () => {
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1", orgSlug: null });
    await expect(capture(() => requireOrg("anything"))).resolves.toBe("/app/org_1/inbox");
    await expect(requireOrg("org_1")).resolves.toMatchObject({ orgId: ORG, orgSlug: "org_1" });
  });
});

describe("sessionTenant", () => {
  it("resolves uuids from the session without consulting the projection", async () => {
    authMock.mockResolvedValue({
      userId: "user_1",
      orgId: "org_1",
      orgSlug: "acme",
      orgRole: "org:member",
    });
    await expect(sessionTenant()).resolves.toEqual({
      userId: USER,
      orgId: ORG,
      orgSlug: "acme",
      role: "member",
    });
    expect(myOrganizations).not.toHaveBeenCalled();
  });

  it("is null without an organization, so an action can refuse in its own way", async () => {
    authMock.mockResolvedValue({ userId: "user_1", orgId: null, orgSlug: null });
    await expect(sessionTenant()).resolves.toBeNull();
  });
});
