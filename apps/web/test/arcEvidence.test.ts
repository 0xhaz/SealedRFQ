import { describe, expect, it } from "vitest";
import {
  EVALUATOR_ROLE,
  committeeIsRegistered,
  formatCcd,
  registryHealth,
} from "@/lib/v2/arcEvidence";

const EMPTY = `0x${"00".repeat(32)}` as const;

describe("formatCcd", () => {
  it("keeps the low digits of a stake past Number.MAX_SAFE_INTEGER", () => {
    // The actual committee stake on Concordium testnet, which is about 2.7e16 microCCD. Converting
    // via a double loses precision in the number this page exists to let someone compare against a
    // node, so the conversion is integer arithmetic and this is the test that pins it.
    const stake = 26_992_086_996_748_425n;
    expect(stake > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(formatCcd(stake)).toBe("26,992,086,996.748");
    expect(formatCcd(stake, 6)).toBe("26,992,086,996.748425");
    // What the lossy version would have produced, so a regression to it is visible.
    expect(formatCcd(stake, 6)).not.toBe((Number(stake) / 1e6).toFixed(6));
  });

  it("groups thousands and pads the fraction", () => {
    expect(formatCcd(1_000_000n)).toBe("1.000");
    expect(formatCcd(1_234_567_890n)).toBe("1,234.567");
    expect(formatCcd(1n, 6)).toBe("0.000001");
    expect(formatCcd(0n)).toBe("0.000");
  });

  it("omits the point when asked for no decimals", () => {
    expect(formatCcd(26_992_086_996_748_425n, 0)).toBe("26,992,086,996");
  });
});

describe("registryHealth", () => {
  it("is current only at zero", () => {
    expect(registryHealth(0n).state).toBe("current");
    expect(registryHealth(1n).state).toBe("refusing");
    expect(registryHealth(9n).state).toBe("refusing");
  });

  it("says plainly that qualifications are being refused, and what to run", () => {
    // The registry is fail-closed, so being behind is the design working — and it is still an
    // outage of the feature. It must not read as a tick.
    const behind = registryHealth(2n);
    expect(behind.summary).toMatch(/every qualification is being refused/);
    expect(behind.summary).toMatch(/update-committee\.mjs/);
    expect(behind.summary).toMatch(/2 periods behind/);
    expect(registryHealth(1n).summary).toMatch(/1 period behind/);
  });
});

describe("committeeIsRegistered", () => {
  const committee = {
    period: 271n,
    membersHash: `0x${"a".repeat(64)}` as `0x${string}`,
    totalStake: 1n,
    registeredAt: 1n,
    present: true,
  };

  it("requires both the present flag and a non-zero hash", () => {
    expect(committeeIsRegistered(committee)).toBe(true);
    expect(committeeIsRegistered({ ...committee, present: false })).toBe(false);
    // A present flag over a zero hash would verify nothing while looking registered.
    expect(committeeIsRegistered({ ...committee, membersHash: EMPTY })).toBe(false);
  });
});

describe("EVALUATOR_ROLE", () => {
  it("is keccak256 of the role string the Solidity library uses", () => {
    // Recomputed rather than copied, so a rename in Roles.sol cannot leave a stale literal here
    // that reads a role nobody holds and reports the badge's central claim as false.
    // Confirmed against the chain, not just against viem: the live attestation log answers
    // hasRole(this, 0x82D0…6774) with true, which it could not do if the hash were wrong.
    expect(EVALUATOR_ROLE).toBe(
      "0x83e06c882d5514ecab434d2519af3f0f0570c512b59962e81bead270c7ee4514",
    );
  });
});
