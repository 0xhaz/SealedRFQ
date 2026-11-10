/**
 * Proving control of a wallet by a signed message, for both kinds of account.
 *
 * Do not reduce this to ECDSA recovery (`recoverMessageAddress` and compare). That is correct for
 * an externally owned account and can never be satisfied by a smart-contract account such as a
 * Safe: a Safe has no private key, its address is the address of a proxy contract, and "who signed"
 * is decided by its owners and threshold inside the contract. Recovering an address from a Safe's
 * signature yields an owner's key (or garbage), never the Safe, so a recovery-only check rejects
 * every Safe, and any workaround that accepts the recovered owner instead would let one owner
 * claim the whole Safe. The standard answer is EIP-1271: ask the account, `isValidSignature(hash,
 * signature)`, and accept the magic value 0x1626ba7e. viem's `verifyMessage` does that dispatch
 * (through its ERC-6492 validator, a deployless call that also covers EIP-1271), so we use it
 * rather than hand-rolling it.
 *
 * The EOA case is still ECDSA, and deliberately taken without an RPC call when the address has no
 * code. That ordering matters for one reason: `verifyMessage` also accepts ERC-6492 signatures
 * for contracts that are not deployed yet. A counterfactual account is not yet something that can
 * be a signer, so an address with no code is only ever verified by recovery, and a wrapped 6492
 * signature for it simply fails to recover.
 */
import {
  type Address,
  type Hex,
  type PublicClient,
  isAddressEqual,
  recoverMessageAddress,
} from "viem";
// The root export of `verifyMessage` is the client-less ECDSA-only util; the client action is the
// one with the contract fallback.
import { verifyMessage } from "viem/actions";

export type WalletAccountType = "eoa" | "contract";

export type WalletSignatureResult = {
  ok: boolean;
  /**
   * What the address was when it was checked. Reported even when `ok` is false so a caller can say
   * why, but only meaningful to store when `ok` is true.
   */
  accountType: WalletAccountType;
  reason?: string;
};

export async function verifyWalletSignature(input: {
  client: PublicClient;
  address: Address;
  message: string;
  signature: Hex;
}): Promise<WalletSignatureResult> {
  const { client, address, message, signature } = input;

  const code = await client.getCode({ address });
  // EIP-7702 delegated EOAs carry code too (0xef0100 + target). They are treated as contract
  // accounts, which is safe: verifyMessage accepts their ordinary ECDSA signatures as well.
  const isContract = code !== undefined && code !== "0x";

  if (!isContract) {
    try {
      const recovered = await recoverMessageAddress({ message, signature });
      return isAddressEqual(recovered, address)
        ? { ok: true, accountType: "eoa" }
        : { ok: false, accountType: "eoa", reason: "signature was made by a different key" };
    } catch {
      return { ok: false, accountType: "eoa", reason: "signature is malformed" };
    }
  }

  try {
    const ok = await verifyMessage(client, { address, message, signature });
    return ok
      ? { ok: true, accountType: "contract" }
      : {
          ok: false,
          accountType: "contract",
          reason: "contract account did not accept the signature (EIP-1271)",
        };
  } catch (e) {
    // viem reports a reverted or failed validation call as plain "invalid", so an outage during
    // this call is indistinguishable from a rejection; only the code lookup above surfaces one.
    throw new Error(`verifyWalletSignature: could not query the chain: ${(e as Error).message}`);
  }
}
