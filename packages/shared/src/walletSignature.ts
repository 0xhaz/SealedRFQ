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
 * signature)`, and accept the magic value 0x1626ba7e.
 *
 * Beware that viem's root export `verifyMessage` is the client-less, ECDSA-only util and rejects
 * contract accounts; the client action in "viem/actions" is the one that does not.
 *
 * The EIP-1271 call is made directly (readContract) rather than through viem's `verifyMessage`
 * action, for one reason: that action folds every failed `eth_call`, a timeout or a 5xx included,
 * into plain `false`. "We could not ask" and "the account said no" lead the user to opposite
 * actions (retry versus sign again), so an unreachable chain must throw, on this path exactly as
 * it does on the EOA path's code lookup. Only a revert, or an account with no answer to the
 * question, is a rejection.
 *
 * An address with no code is only ever verified by recovery. A counterfactual (undeployed) account
 * cannot be a signer yet, and accepting ERC-6492 wrapped signatures would let one in.
 */
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type Hex,
  type PublicClient,
  hashMessage,
  isAddressEqual,
  parseAbi,
  recoverMessageAddress,
} from "viem";

export type WalletAccountType = "eoa" | "contract";

export type WalletSignatureResult = {
  ok: boolean;
  /** What the address was when it was checked; only meaningful to store when `ok` is true. */
  accountType: WalletAccountType;
  /**
   * The chain the check ran on. A contract account's identity and owners are per chain, so a
   * caller must store this, not a chain id it holds separately.
   */
  chainId: number;
  reason?: string;
};

const EIP1271_MAGIC = "0x1626ba7e";
const erc1271Abi = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);

export async function verifyWalletSignature(input: {
  client: PublicClient;
  /** The chain the caller intends to link under; must be the client's chain. */
  chainId: number;
  address: Address;
  message: string;
  signature: Hex;
}): Promise<WalletSignatureResult> {
  const { client, chainId, address, message, signature } = input;
  if (client.chain?.id !== chainId) {
    throw new Error(
      `verifyWalletSignature: client is on chain ${client.chain?.id}, asked to verify for ${chainId}`,
    );
  }

  const code = await client.getCode({ address });
  const hasCode = code !== undefined && code !== "0x";
  // An EIP-7702 delegated EOA carries code (0xef0100 + target) yet signs with its own key.
  const delegated = hasCode && code.toLowerCase().startsWith("0xef0100");

  if (!hasCode || delegated) {
    let recovered: Address | undefined;
    try {
      recovered = await recoverMessageAddress({ message, signature });
    } catch {
      return { ok: false, accountType: "eoa", chainId, reason: "signature is malformed" };
    }
    if (isAddressEqual(recovered, address)) return { ok: true, accountType: "eoa", chainId };
    if (delegated) {
      return {
        ok: false,
        accountType: "eoa",
        chainId,
        reason: "signature was made by a different key",
      };
    }
    return {
      ok: false,
      accountType: "eoa",
      chainId,
      reason:
        "no code at this address and the signature is not from its key; if this is a contract account that is not deployed yet, deploy it first",
    };
  }

  let magic: Hex;
  try {
    magic = await client.readContract({
      address,
      abi: erc1271Abi,
      functionName: "isValidSignature",
      args: [hashMessage(message), signature],
    });
  } catch (e) {
    // viem also files a bare -32603 "internal error" under ContractFunctionRevertedError, so a
    // revert only counts when the node returned revert data to decode (even an empty "0x").
    const rejected =
      e instanceof BaseError &&
      e.walk(
        (x) =>
          (x instanceof ContractFunctionRevertedError && x.raw !== undefined) ||
          x instanceof ContractFunctionZeroDataError,
      );
    if (rejected) {
      return {
        ok: false,
        accountType: "contract",
        chainId,
        reason: "contract account reverted or does not implement EIP-1271",
      };
    }
    throw new Error(`verifyWalletSignature: could not query the chain: ${(e as Error).message}`);
  }
  return magic.toLowerCase() === EIP1271_MAGIC
    ? { ok: true, accountType: "contract", chainId }
    : {
        ok: false,
        accountType: "contract",
        chainId,
        reason: "contract account did not return the EIP-1271 magic value",
      };
}
