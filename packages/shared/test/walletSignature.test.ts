import { createPublicClient, custom, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { verifyWalletSignature } from "../src/walletSignature.js";

const MSG = "Link this wallet to SealedRFQ. Nonce: abc123";
const SAFE = getAddress("0x00000000000000000000000000000000000050fe".toLowerCase());

/**
 * A client that answers only what the verifier asks. `eth_call` is the ERC-6492 validator that
 * viem deploys for the call; its answer is a bool, so what is faked here is the account's verdict,
 * not the EIP-1271 magic-value comparison, which lives inside viem's validator and is covered by
 * the live test against a real Safe.
 */
function fakeClient(chain: {
  code: string;
  call?: "valid" | "invalid" | "revert";
  codeDown?: boolean;
}) {
  const calls: string[] = [];
  const client = createPublicClient({
    transport: custom({
      async request({ method }) {
        calls.push(method);
        if (method === "eth_getCode") {
          if (chain.codeDown) throw new Error("connection refused");
          return chain.code;
        }
        if (method === "eth_call") {
          if (chain.call === "valid") return `0x${"0".repeat(63)}1`;
          if (chain.call === "invalid") return `0x${"0".repeat(64)}`;
          const err = new Error("execution reverted") as Error & { code: number };
          err.code = 3;
          throw err;
        }
        throw new Error(`unexpected ${method}`);
      },
    }),
  });
  return { client, calls };
}

describe("verifyWalletSignature", () => {
  const eoa = privateKeyToAccount(generatePrivateKey());

  it("accepts an EOA's own signature without a contract call", async () => {
    const signature = await eoa.signMessage({ message: MSG });
    const { client, calls } = fakeClient({ code: "0x" });
    await expect(
      verifyWalletSignature({ client, address: eoa.address, message: MSG, signature }),
    ).resolves.toEqual({ ok: true, accountType: "eoa" });
    expect(calls).not.toContain("eth_call");
  });

  it("rejects an EOA signature made by another key", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message: MSG });
    const { client } = fakeClient({ code: "0x" });
    const r = await verifyWalletSignature({
      client,
      address: eoa.address,
      message: MSG,
      signature,
    });
    expect(r.ok).toBe(false);
    expect(r.accountType).toBe("eoa");
    expect(r.reason).toBeTruthy();
  });

  it("rejects a signature over a different message", async () => {
    const signature = await eoa.signMessage({ message: "something else" });
    const { client } = fakeClient({ code: "0x" });
    expect(
      (await verifyWalletSignature({ client, address: eoa.address, message: MSG, signature })).ok,
    ).toBe(false);
  });

  it("rejects a malformed signature rather than throwing", async () => {
    const { client } = fakeClient({ code: "0x" });
    const r = await verifyWalletSignature({
      client,
      address: eoa.address,
      message: MSG,
      signature: "0x1234",
    });
    expect(r).toMatchObject({ ok: false, accountType: "eoa" });
  });

  it("accepts a contract account that validates the signature", async () => {
    // An owner's ECDSA signature stands in for a Safe's signature bytes; the fake decides.
    const signature = await eoa.signMessage({ message: MSG });
    const { client } = fakeClient({ code: "0x608060", call: "valid" });
    await expect(
      verifyWalletSignature({ client, address: SAFE, message: MSG, signature }),
    ).resolves.toEqual({ ok: true, accountType: "contract" });
  });

  it("does not accept a contract account on the strength of an owner's ECDSA signature alone", async () => {
    // The point of the module: the recovered signer is not the Safe, so only the contract's verdict counts.
    const signature = await eoa.signMessage({ message: MSG });
    const { client } = fakeClient({ code: "0x608060", call: "invalid" });
    const r = await verifyWalletSignature({ client, address: SAFE, message: MSG, signature });
    expect(r).toMatchObject({ ok: false, accountType: "contract" });
  });

  it("rejects a contract account whose validation reverts", async () => {
    const signature = await eoa.signMessage({ message: MSG });
    const { client } = fakeClient({ code: "0x608060", call: "revert" });
    const r = await verifyWalletSignature({ client, address: SAFE, message: MSG, signature });
    expect(r).toMatchObject({ ok: false, accountType: "contract" });
  });

  it("throws when the chain cannot be reached, rather than reporting a bad signature", async () => {
    // viem folds a failed eth_call into "invalid", so the only outage this can distinguish is the
    // code lookup that precedes it; that one must not read as a wrong signature.
    const signature = await eoa.signMessage({ message: MSG });
    const { client } = fakeClient({ code: "0x", codeDown: true });
    await expect(
      verifyWalletSignature({ client, address: eoa.address, message: MSG, signature }),
    ).rejects.toThrow();
  });
});
