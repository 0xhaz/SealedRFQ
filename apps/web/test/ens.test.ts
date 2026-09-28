import { describe, expect, it } from "vitest";
import { ensNameOf, ensNames } from "../lib/ens.js";

/**
 * ENS is not configured in tests, and that is the case worth pinning: the default deployment has
 * no Ethereum endpoint, so every lookup must return nothing and every caller must keep working.
 * A resolver that threw here would take down a server-rendered page for want of an optional label.
 */
describe("ens, with no endpoint configured", () => {
  it("returns no name rather than throwing", async () => {
    await expect(ensNameOf("0x597577573654D0b4cA085BDBE5474fe38e126984")).resolves.toBeNull();
  });

  it("returns an entry for every address asked about", async () => {
    const out = await ensNames([
      "0x597577573654D0b4cA085BDBE5474fe38e126984",
      "0xD63Be85613D24701678978AF208d72E38025d34c",
    ]);
    expect(Object.keys(out)).toHaveLength(2);
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it("keys results in lower case, so a checksummed address still finds its name", async () => {
    const out = await ensNames(["0x597577573654D0b4cA085BDBE5474fe38e126984"]);
    expect(out).toHaveProperty("0x597577573654d0b4ca085bdbe5474fe38e126984");
  });
});
