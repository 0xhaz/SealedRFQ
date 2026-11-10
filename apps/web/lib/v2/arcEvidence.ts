/**
 * What the Arc half of the V2 stack says about itself, read live.
 *
 * Read live rather than rendered from the deployment file, because a deployment file is a record of
 * an intention and the chain is a record of what happened. The two diverge in exactly the cases
 * worth showing: a committee that has not been re-registered, a role that was never granted, a
 * registry pointed at the wrong qualifier.
 *
 * Three things here are checks rather than readings, and they are the reason this is not just a
 * table of addresses:
 *
 *   - `periodsBehind` is reported as a failure when non-zero. The epoch registry is fail-closed, so
 *     a period with no committee refuses every certificate. That is the intended behaviour and it
 *     still means the system is currently refusing everything, which should be loud.
 *   - The three contracts are asked what they point at. The deployment file claims the registry
 *     uses this qualifier and the qualifier uses this epoch registry; the contracts are asked
 *     directly, so a stale file reads as a mismatch instead of as the truth.
 *   - The evaluator role is read from the attestation log. The badge's claim is that the agent
 *     controls the key Arc accepts recommendations from, and until that role is actually held the
 *     claim is about a mechanism rather than about anything.
 */
import { createPublicClient, fallback, http, keccak256, toHex } from "viem";
import { CHAIN_ID, chain, rpcUrls } from "../chain";
import v2Deployment from "../deployments/5042002-v2.json";

export type V2Deployment = {
  chainId: number;
  ConcordiumEpochRegistry: `0x${string}`;
  ConcordiumQualifier: `0x${string}`;
  QualifiedRFQRegistryV2: `0x${string}`;
  reused: {
    ProcurementPolicy: `0x${string}`;
    AttestationLog: `0x${string}`;
    SealedRFQAdapter: `0x${string}`;
    usdc: `0x${string}`;
  };
  admin: `0x${string}`;
  evaluator: { address: `0x${string}`; note: string };
  concordium: {
    network: string;
    eraGenesis: `0x${string}`;
    rewardPeriodEpochs: number;
    maxCertificateAgeEpochs: number;
    agentRegistry: string;
    keyRegistry: string;
    agentId: number;
  };
  committee: { period: number; membersHash: `0x${string}`; totalStake: string; tx: string };
};

/**
 * Only testnet, deliberately. V2 is not on mainnet, and a build pointed at mainnet must say there
 * is no V2 deployment rather than borrow testnet's addresses — the same rule `chain.ts` enforces
 * for V1 and for the same reason: the hashes only resolve on the explorer they were recorded
 * against.
 */
const BY_CHAIN: Record<number, V2Deployment> = {
  5042002: v2Deployment as V2Deployment,
};

export const v2Contracts: V2Deployment | null = BY_CHAIN[CHAIN_ID] ?? null;

/** `Roles.EVALUATOR` in `contracts/src/lib/Roles.sol`, recomputed rather than copied as a literal. */
export const EVALUATOR_ROLE = keccak256(toHex("sealedrfq.role.EVALUATOR"));

const EPOCH_REGISTRY_ABI = [
  { type: "function", name: "currentEpoch", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "currentPeriod", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "periodsBehind", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "latestPeriod", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "isFresh", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "eraGenesis", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "rewardPeriodEpochs", inputs: [], outputs: [{ type: "uint32" }], stateMutability: "view" },
  { type: "function", name: "maxCertificateAgeEpochs", inputs: [], outputs: [{ type: "uint32" }], stateMutability: "view" },
  {
    type: "function",
    name: "committees",
    inputs: [{ type: "uint64" }],
    outputs: [
      { name: "membersHash", type: "bytes32" },
      { name: "totalStake", type: "uint128" },
      { name: "registeredAt", type: "uint64" },
      { name: "present", type: "bool" },
    ],
    stateMutability: "view",
  },
] as const;

const QUALIFIER_ABI = [
  { type: "function", name: "finality", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "validitySeconds", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
] as const;

const REGISTRY_V2_ABI = [
  { type: "function", name: "qualifierV2", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

const ACCESS_CONTROL_ABI = [
  {
    type: "function",
    name: "hasRole",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
] as const;

export type Committee = {
  period: bigint;
  membersHash: `0x${string}`;
  totalStake: bigint;
  registeredAt: bigint;
  present: boolean;
};

export type ArcEvidence =
  | { reachable: false; reason: string; checkedAt: string }
  | {
      reachable: true;
      checkedAt: string;
      epoch: bigint;
      period: bigint;
      periodsBehind: bigint;
      latestPeriod: bigint;
      isFresh: boolean;
      eraGenesis: `0x${string}`;
      rewardPeriodEpochs: number;
      maxCertificateAgeEpochs: number;
      committee: Committee;
      /** What each contract says it points at, so the deployment record can be checked not trusted. */
      wiring: {
        registryQualifier: `0x${string}`;
        qualifierFinality: `0x${string}`;
        validitySeconds: bigint;
      };
      /** Whether the key bound in CIS-8 actually holds EVALUATOR on the attestation log. */
      evaluatorHasRole: boolean;
    };

const EMPTY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Whether a committee is registered for the period the registry currently considers current. */
export const committeeIsRegistered = (c: Committee) => c.present && c.membersHash !== EMPTY_HASH;

/**
 * microCCD as CCD, in integer arithmetic.
 *
 * Not `Number(micro) / 1e6`. Concordium's committee stake is around 2.7e16 microCCD, which is past
 * `Number.MAX_SAFE_INTEGER` (9.0e15), so the conversion to a double silently loses the low digits
 * of the very number being displayed as evidence. The whole point of this page is that its figures
 * can be compared against a node, and a figure that is quietly approximate cannot be.
 */
export function formatCcd(microCcd: bigint, decimals = 3): string {
  const whole = microCcd / 1_000_000n;
  const frac = (microCcd % 1_000_000n).toString().padStart(6, "0").slice(0, decimals);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimals > 0 ? `${grouped}.${frac}` : grouped;
}

/**
 * How badly the registry is behind, as something the UI can switch on.
 *
 * `current` is the only state in which a qualification can succeed. `refusing` is not an error in
 * the contract — it is the fail-closed design working — but it is an outage of the feature, so it
 * must not be rendered as a tick.
 */
export function registryHealth(periodsBehind: bigint): {
  state: "current" | "refusing";
  summary: string;
} {
  if (periodsBehind === 0n) {
    return { state: "current", summary: "A committee is registered for the current reward period." };
  }
  return {
    state: "refusing",
    summary:
      `No committee is registered for the current reward period — the registry is ${periodsBehind} ` +
      `period${periodsBehind === 1n ? "" : "s"} behind, so every qualification is being refused. ` +
      `This is the fail-closed design behaving correctly, and it still needs someone to run ` +
      `scripts/concordium/update-committee.mjs.`,
  };
}

export async function readArcEvidence(): Promise<ArcEvidence> {
  const checkedAt = new Date().toISOString();
  if (!v2Contracts) {
    return {
      reachable: false,
      reason: `No V2 deployment is recorded for chain ${CHAIN_ID}. V2 is on Arc testnet (5042002) only.`,
      checkedAt,
    };
  }

  const client = createPublicClient({
    chain,
    transport: fallback(rpcUrls.map((url) => http(url))),
  });
  const registry = { address: v2Contracts.ConcordiumEpochRegistry, abi: EPOCH_REGISTRY_ABI } as const;

  try {
    const [
      epoch,
      period,
      periodsBehind,
      latestPeriod,
      isFresh,
      eraGenesis,
      rewardPeriodEpochs,
      maxCertificateAgeEpochs,
    ] = await Promise.all([
      client.readContract({ ...registry, functionName: "currentEpoch" }),
      client.readContract({ ...registry, functionName: "currentPeriod" }),
      client.readContract({ ...registry, functionName: "periodsBehind" }),
      client.readContract({ ...registry, functionName: "latestPeriod" }),
      client.readContract({ ...registry, functionName: "isFresh" }),
      client.readContract({ ...registry, functionName: "eraGenesis" }),
      client.readContract({ ...registry, functionName: "rewardPeriodEpochs" }),
      client.readContract({ ...registry, functionName: "maxCertificateAgeEpochs" }),
    ]);

    // The committee for the period the registry itself considers current, not the one the
    // deployment file happened to record.
    const [committeeRow, registryQualifier, qualifierFinality, validitySeconds, evaluatorHasRole] =
      await Promise.all([
        client.readContract({ ...registry, functionName: "committees", args: [period] }),
        client.readContract({
          address: v2Contracts.QualifiedRFQRegistryV2,
          abi: REGISTRY_V2_ABI,
          functionName: "qualifierV2",
        }),
        client.readContract({
          address: v2Contracts.ConcordiumQualifier,
          abi: QUALIFIER_ABI,
          functionName: "finality",
        }),
        client.readContract({
          address: v2Contracts.ConcordiumQualifier,
          abi: QUALIFIER_ABI,
          functionName: "validitySeconds",
        }),
        client.readContract({
          address: v2Contracts.reused.AttestationLog,
          abi: ACCESS_CONTROL_ABI,
          functionName: "hasRole",
          args: [EVALUATOR_ROLE, v2Contracts.evaluator.address],
        }),
      ]);

    return {
      reachable: true,
      checkedAt,
      epoch,
      period,
      periodsBehind,
      latestPeriod,
      isFresh,
      eraGenesis,
      rewardPeriodEpochs: Number(rewardPeriodEpochs),
      maxCertificateAgeEpochs: Number(maxCertificateAgeEpochs),
      committee: {
        period,
        membersHash: committeeRow[0],
        totalStake: committeeRow[1],
        registeredAt: committeeRow[2],
        present: committeeRow[3],
      },
      wiring: { registryQualifier, qualifierFinality, validitySeconds },
      evaluatorHasRole,
    };
  } catch (e) {
    // An unreachable RPC is an outage, not a finding. Returning zeroes here would render as a
    // registry that is behind and a role that was never granted, which is a different and much
    // more alarming claim than "we could not ask".
    return {
      reachable: false,
      reason: e instanceof Error ? e.message : String(e),
      checkedAt,
    };
  }
}
