import { createPublicClient, custom, encodeAbiParameters, getAddress, hashMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { arcTest } from "../src/chains.js";
import { verifyWalletSignature } from "../src/walletSignature.js";

const MSG = "Link this wallet to SealedRFQ. Nonce: abc123";
const SAFE = getAddress("0x00000000000000000000000000000000000050fe");
const CHAIN = arcTest.id;
const MAGIC = `0x1626ba7e${"0".repeat(56)}`;
const REVERT_DATA = `0x08c379a0${encodeAbiParameters([{ type: "string" }], ["no"]).slice(2)}`;

type Chain = {
  code: string;
  /** What the account's isValidSignature answers, or how the call fails. */
  answer?: string | "revert" | "outage";
  codeDown?: boolean;
};

/**
 * A client whose RPC is a script. This is a fake chain, not a Safe: it can show that the verifier
 * asks isValidSignature(hashMessage(message), signature) and maps the answer correctly, including
 * the 0x1626ba7e comparison. It cannot show that a real Safe answers that way. No test in this
 * repo exercises EIP-1271 against a real contract. Doing so needs a Safe deployed on Arc testnet
 * with a known owner and an owner signature over the Safe-wrapped message hash (see the task 8
 * report); safe.live.test.ts only proves the Safe handler has bytecode.
 */
function fakeClient(chain: Chain) {
  const calls: { data: string }[] = [];
  const client = createPublicClient({
    chain: arcTest,
    transport: custom({
      async request({ method, params }) {
        if (method === "eth_getCode") {
          if (chain.codeDown) throw new Error("connection refused");
          return chain.code;
        }
        if (method === "eth_call") {
          calls.push({ data: (params as [{ data: string }])[0].data });
          if (chain.answer === "revert") {
            throw Object.assign(new Error("execution reverted"), { code: 3, data: REVERT_DATA });
          }
          if (chain.answer === "outage") {
            throw Object.assign(new Error("503 upstream"), { code: -32603 });
          }
          return chain.answer ?? MAGIC;
        }
        throw new Error(`unexpected ${method}`);
      },
    }),
  });
  return { client, calls };
}

describe("verifyWalletSignature", () => {
  const eoa = privateKeyToAccount(generatePrivateKey());
  const base = { chainId: CHAIN, message: MSG };

  it("accepts an EOA's own signature without a contract call", async () => {
    const signature = await eoa.signMessage({ message: MSG });
    const { client, calls } = fakeClient({ code: "0x" });
    await expect(
      verifyWalletSignature({ ...base, client, address: eoa.address, signature }),
    ).resolves.toEqual({ ok: true, accountType: "eoa", chainId: CHAIN });
    expect(calls).toHaveLength(0);
  });

  it("rejects an EOA signature made by another key, and one over another message", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const { client } = fakeClient({ code: "0x" });
    for (const signature of [
      await other.signMessage({ message: MSG }),
      await eoa.signMessage({ message: "something else" }),
    ]) {
      const r = await verifyWalletSignature({ ...base, client, address: eoa.address, signature });
      expect(r.ok).toBe(false);
      expect(r.accountType).toBe("eoa");
    }
  });

  it("rejects a malformed signature rather than throwing", async () => {
    const { client } = fakeClient({ code: "0x" });
    const r = await verifyWalletSignature({
      ...base,
      client,
      address: eoa.address,
      signature: "0x1234",
    });
    expect(r).toMatchObject({ ok: false, accountType: "eoa", reason: "signature is malformed" });
  });

  it("says to deploy first when an address with no code fails, as an undeployed Safe would", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const signature = await owner.signMessage({ message: MSG });
    const { client } = fakeClient({ code: "0x" });
    const r = await verifyWalletSignature({ ...base, client, address: SAFE, signature });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/deploy it first/);
  });

  it("asks the contract with the message hash and the signature, and accepts the magic value", async () => {
    const signature = await eoa.signMessage({ message: MSG });
    const { client, calls } = fakeClient({ code: "0x608060" });
    await expect(
      verifyWalletSignature({ ...base, client, address: SAFE, signature }),
    ).resolves.toEqual({ ok: true, accountType: "contract", chainId: CHAIN });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data.startsWith("0x1626ba7e")).toBe(true);
    expect(calls[0]?.data).toContain(hashMessage(MSG).slice(2));
    expect(calls[0]?.data).toContain(signature.slice(2));
  });

  it("rejects a contract that answers anything but the magic value", async () => {
    const signature = await eoa.signMessage({ message: MSG });
    const { client } = fakeClient({ code: "0x608060", answer: `0xffffffff${"0".repeat(56)}` });
    const r = await verifyWalletSignature({ ...base, client, address: SAFE, signature });
    expect(r).toMatchObject({ ok: false, accountType: "contract" });
  });

  it("rejects a contract whose validation reverts, or that has no such function", async () => {
    const signature = await eoa.signMessage({ message: MSG });
    for (const answer of ["revert", "0x"]) {
      const { client } = fakeClient({ code: "0x608060", answer });
      const r = await verifyWalletSignature({ ...base, client, address: SAFE, signature });
      expect(r).toMatchObject({ ok: false, accountType: "contract" });
    }
  });

  it("throws when the chain is unreachable, on both paths, rather than reporting a bad signature", async () => {
    const signature = await eoa.signMessage({ message: MSG });
    const down = fakeClient({ code: "0x", codeDown: true }).client;
    await expect(
      verifyWalletSignature({ ...base, client: down, address: eoa.address, signature }),
    ).rejects.toThrow();
    const flaky = fakeClient({ code: "0x608060", answer: "outage" }).client;
    await expect(
      verifyWalletSignature({ ...base, client: flaky, address: SAFE, signature }),
    ).rejects.toThrow(/could not query the chain/);
  });

  it("refuses to verify on a client for a different chain than the one being linked", async () => {
    const { client } = fakeClient({ code: "0x" });
    await expect(
      verifyWalletSignature({
        client,
        chainId: 1,
        address: eoa.address,
        message: MSG,
        signature: await eoa.signMessage({ message: MSG }),
      }),
    ).rejects.toThrow(/chain/);
  });
});
