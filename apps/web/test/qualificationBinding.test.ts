/**
 * The two properties of the join that a wrong edit would silently lose: a proof obtained for one
 * address is refused for another, and the three outcomes after a verification stay distinct.
 *
 * The challenge store is replaced with the in-memory one from the concordium package, so the route
 * handlers run unmodified and the comparison under test is the real one.
 */
import { InMemoryChallengeStore } from "@sealedrfq/concordium";
import { afterEach, describe, expect, it, vi } from "vitest";

const store = new InMemoryChallengeStore();
vi.mock("@sealedrfq/db", () => ({ PostgresChallengeStore: class { constructor() { return store; } } }));

import { precheckChallenge } from "@sealedrfq/concordium/presentation";
import { recordQualification } from "../lib/agent";
import { purposeFor } from "../lib/v2/qualification";

const A = "0x52908400098527886E0F7030069857D2E4169EE7";
const B = "0x000000000000000000000000000000000000dEaD";
const post = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });

describe("a proof is bound to the address it was asked for", () => {
  it("is refused as wrong_purpose when submitted for another address, and the challenge survives", async () => {
    const { POST: challenge } = await import("../app/api/concordium/challenge/route");
    const { POST: verify } = await import("../app/api/concordium/verify/route");

    const issued = await (await challenge(post({ tenderId: 7, bidder: A }))).json();
    const presented = (bidder: string) =>
      verify(post({ tenderId: 7, bidder, challenge: issued.challenge, presentation: {} }));

    const wrong = await presented(B);
    expect(wrong.status).toBe(400);
    const body = await wrong.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("wrong_purpose");

    // Same address in another casing passes the purpose check. Asserted on the check itself, not
    // through the route, because the route's next step is a live Concordium node.
    expect(await precheckChallenge(store, issued.challenge, purposeFor(7, A.toLowerCase()))).toBeUndefined();
    // A refusal does not spend the challenge.
    expect(await store.peek(issued.challenge)).toBeDefined();
  });
});

describe("recording after an accepted proof", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });
  const input = { subject: "SUBJECT-SECRET", bidder: A, tenderId: 7 };
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("returns the transaction hash when the agent records it, with the token and synthetic:false", async () => {
    process.env.AGENT_API_TOKEN = "t0ken";
    const f = reply(200, { status: "recorded", tx: "0xabc" });
    vi.stubGlobal("fetch", f);
    expect(await recordQualification(input)).toEqual({ status: "recorded", tx: "0xabc" });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t0ken");
    expect(JSON.parse(init.body as string).synthetic).toBe(false);
  });

  it("reports an unreachable agent as not-recorded, without the error text", async () => {
    process.env.AGENT_API_TOKEN = "t0ken";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect ECONNREFUSED SUBJECT-SECRET"); }));
    const r = await recordQualification(input);
    expect(r).toMatchObject({ status: "not-recorded", reason: "agent-unreachable" });
    expect(JSON.stringify(r)).not.toContain("SUBJECT-SECRET");
  });

  it("names a lagging registry as ours to fix, pointing at update-committee", async () => {
    process.env.AGENT_API_TOKEN = "t0ken";
    vi.stubGlobal("fetch", reply(503, { status: "registry-behind", detail: "x" }));
    const r = await recordQualification(input);
    expect(r).toMatchObject({ status: "not-recorded", reason: "registry-behind" });
    expect((r as { detail: string }).detail).toContain("update-committee.mjs");
  });

  it("keeps a used nullifier apart from an operational failure", async () => {
    process.env.AGENT_API_TOKEN = "t0ken";
    vi.stubGlobal("fetch", reply(409, { status: "nullifier-used", claimedBy: "0x1", nullifier: "0x2" }));
    expect(await recordQualification(input)).toMatchObject({ reason: "nullifier-used" });
  });

  it("does not call the agent without a token", async () => {
    process.env.AGENT_API_TOKEN = "";
    const f = reply(200, {});
    vi.stubGlobal("fetch", f);
    expect(await recordQualification(input)).toMatchObject({ reason: "agent-not-configured" });
    expect(f).not.toHaveBeenCalled();
  });
});
