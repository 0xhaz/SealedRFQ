import { USDC_ADDRESS } from "@sealedrfq/shared";
import type { Config } from "wagmi";
import { readContract, signTypedData } from "wagmi/actions";
import { erc20Abi, parseSignature } from "viem";

const NONCES_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type PermitSignature = { deadline: bigint; v: number; r: `0x${string}`; s: `0x${string}` };

/**
 * ERC-2612 permit for Arc USDC, verified on both Arc networks: EIP-712 domain name "USDC",
 * version "2". One signature replaces the separate approve transaction, so funding an RFQ or
 * posting a deposit is a single on-chain action.
 */
export async function signUsdcPermit(
  config: Config,
  args: { owner: `0x${string}`; spender: `0x${string}`; value: bigint; chainId: number },
): Promise<PermitSignature> {
  const nonce = await readContract(config, {
    abi: NONCES_ABI,
    address: USDC_ADDRESS,
    functionName: "nonces",
    args: [args.owner],
    chainId: args.chainId as never,
  });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signature = await signTypedData(config, {
    domain: { name: "USDC", version: "2", chainId: args.chainId, verifyingContract: USDC_ADDRESS },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner: args.owner,
      spender: args.spender,
      value: args.value,
      nonce: nonce as bigint,
      deadline,
    },
  });

  const { v, r, s } = parseSignature(signature);
  return { deadline, v: Number(v ?? 27n), r, s };
}

/** Fallback for wallets that refuse typed-data signing: plain allowance check. */
export async function currentAllowance(
  config: Config,
  owner: `0x${string}`,
  spender: `0x${string}`,
  chainId: number,
) {
  return readContract(config, {
    abi: erc20Abi,
    address: USDC_ADDRESS,
    functionName: "allowance",
    args: [owner, spender],
    chainId: chainId as never,
  });
}
