import { deriveNullifier } from "@sealedrfq/concordium";
import { type Hex, encodeErrorResult } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  QUALIFIER_ABI,
  type QualifierDeps,
  qualify,
  refusalFromRevert,
} from "../src/modules/qualifier/qualifier.core.js";

const SECRET = new Uint8Array(32).fill(7);
const A = "0x00000000000000000000000000000000000000a1" as Hex;
const B = "0x00000000000000000000000000000000000000b2" as Hex;
const none = {
  nullifier: `0x${"0".repeat(64)}` as Hex,
  checkedAtEpoch: 0n,
  expiresAt: 0n,
  present: false,
};
const proof = {
  blockHash: `0x${"11".repeat(32)}` as Hex,
  round: 1n,
  epoch: 2n,
  members: "0x" as Hex,
  signerBits: "0x" as Hex,
  signature: "0x" as Hex,
  signedStakeBps: 9000,
};

/** A revert as viem nests it: the selector data sits on a cause, not the top-level error. */
const revert = (errorName: string, args: unknown[] = []) => {
  const data = encodeErrorResult({ abi: QUALIFIER_ABI, errorName, args } as never);
  return Object.assign(new Error("reverted"), { cause: { data } });
};

function deps(
  over: Partial<QualifierDeps> = {},
): QualifierDeps & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => `0x${"ab".repeat(32)}` as Hex);
  return {
    fetchProof: async () => proof,
    nullifierSecret: SECRET,
    qualifier: A,
    read: async ({ functionName }) => (functionName === "isQualified" ? false : none),
    simulate: async () => {},
    send,
    ...over,
  } as never;
}

describe("qualify", () => {
  it("derives the nullifier from the subject and the agent's secret, never from the caller", async () => {
    const d = deps();
    const r = await qualify({ subject: "s", bidder: A, tenderId: 5, synthetic: true }, d);
    const expected = await deriveNullifier({ subject: "s", tenderId: "5", secret: SECRET });
    expect(r.status).toBe("recorded");
    expect((d.send.mock.calls[0][0] as unknown[])[2]).toBe(expected);
  });

  it("gives two wallets of one subject the same nullifier, which is what the contract refuses on", async () => {
    const sent: unknown[][] = [];
    const mk = () =>
      deps({
        send: vi.fn(async (a) => {
          sent.push([...a]);
          return "0x01" as Hex;
        }),
      });
    await qualify({ subject: "same", bidder: A, tenderId: 9, synthetic: true }, mk());
    await qualify({ subject: "same", bidder: B, tenderId: 9, synthetic: true }, mk());
    expect(sent[0][2]).toBe(sent[1][2]);
  });

  it("sends nothing when already qualified with the same nullifier", async () => {
    const nullifier = await deriveNullifier({ subject: "s", tenderId: "5", secret: SECRET });
    const d = deps({
      read: async ({ functionName }) =>
        functionName === "isQualified"
          ? true
          : { nullifier, checkedAtEpoch: 1n, expiresAt: 99n, present: true },
    });
    const r = await qualify({ subject: "s", bidder: A, tenderId: 5, synthetic: false }, d);
    expect(r.status).toBe("already-qualified");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("reports a taken nullifier as its own refusal", async () => {
    const d = deps({
      simulate: async () => {
        throw revert("NullifierAlreadyUsed", [5n, `0x${"cd".repeat(32)}`, A]);
      },
    });
    const r = await qualify({ subject: "s", bidder: B, tenderId: 5, synthetic: true }, d);
    expect(r.status).toBe("nullifier-used");
    expect((r as { claimedBy: string }).claimedBy.toLowerCase()).toBe(A);
    expect(d.send).not.toHaveBeenCalled();
  });

  it("reports a lagging registry as operational, not as a bad proof", async () => {
    const d = deps({
      simulate: async () => {
        throw revert("StaleRegistry", [273n, 272n]);
      },
    });
    const r = await qualify({ subject: "s", bidder: A, tenderId: 5, synthetic: true }, d);
    expect(r.status).toBe("registry-behind");
  });

  it("reports a below-quorum certificate without spending anything", async () => {
    const d = deps({
      fetchProof: async () => {
        throw new Error("only 6000 bps of stake signed; quorum needs 6667");
      },
    });
    const r = await qualify({ subject: "s", bidder: A, tenderId: 5, synthetic: true }, d);
    expect(r.status).toBe("below-quorum");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("does not swallow a revert it has no name for", async () => {
    const d = deps({
      simulate: async () => {
        throw revert("AccessControlUnauthorizedAccount", [A, `0x${"00".repeat(32)}`]);
      },
    });
    await expect(
      qualify({ subject: "s", bidder: A, tenderId: 5, synthetic: true }, d),
    ).rejects.toThrow();
  });

  it("echoes the synthetic flag on every outcome", async () => {
    const r = await qualify({ subject: "s", bidder: A, tenderId: 5, synthetic: true }, deps());
    expect(r.synthetic).toBe(true);
  });
});

describe("refusalFromRevert", () => {
  it("returns null for a revert it cannot decode", () => {
    expect(refusalFromRevert(new Error("boom"), `0x${"00".repeat(32)}`)).toBeNull();
  });
});
