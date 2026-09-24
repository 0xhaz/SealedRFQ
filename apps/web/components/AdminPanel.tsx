"use client";

import { chain, contracts, explorerAddress } from "@/lib/chain";
import {
  ADMIN_ROLE,
  CONFIRM_PHRASES,
  ROLE_IDS,
  ROLE_POWER,
  type RoleName,
  looksLikeAddress,
  phraseMatches,
} from "@/lib/admin";
import { describeTxError } from "@/lib/txError";
import {
  AgenticCommerceAbi,
  ProcurementPolicyAbi,
  SealedRFQAdapterAbi,
  formatUsdc,
} from "@sealedrfq/shared";
import { useState } from "react";
import { useAccount, useConfig, useReadContracts, useWriteContract } from "wagmi";
import { simulateContract, waitForTransactionReceipt } from "wagmi/actions";

/**
 * What the operator holds, and how to give it up.
 *
 * The README publishes a table of what this deployment's keys can do, and §6d of the work plan
 * commits to renouncing most of them before mainnet carries a real tender. Neither is actionable
 * without somewhere to see the current state and act on it, so this is that page — written to make
 * *giving up* power the easy path rather than an afterthought below the interesting buttons.
 *
 * There is no revenue figure here because there is no revenue balance. A platform fee transfers
 * straight to the treasury wallet when a milestone releases, so nothing accrues in the contracts
 * and there is nothing to withdraw. What can be shown honestly is the rate, where it would go, and
 * whether it has ever been anything but zero.
 */

const ADAPTER_ROLES: RoleName[] = ["ADMIN", "VERIFIER", "ARBITER", "REGISTRY"];

export function AdminPanel() {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [heir, setHeir] = useState("");
  const [phrase, setPhrase] = useState("");
  const [mode, setMode] = useState<"transfer" | "renounce" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const onChain = chainId === chain.id;

  const { data, refetch } = useReadContracts({
    contracts: [
      ...ADAPTER_ROLES.map((r) => ({
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "hasRole" as const,
        args: [ROLE_IDS[r], address as `0x${string}`],
      })),
      {
        abi: AgenticCommerceAbi,
        address: contracts.AgenticCommerce,
        functionName: "platformFeeBP" as const,
      },
      {
        abi: AgenticCommerceAbi,
        address: contracts.AgenticCommerce,
        functionName: "evaluatorFeeBP" as const,
      },
      {
        abi: AgenticCommerceAbi,
        address: contracts.AgenticCommerce,
        functionName: "platformTreasury" as const,
      },
      {
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "totalHeld" as const,
      },
      {
        abi: SealedRFQAdapterAbi,
        address: contracts.SealedRFQAdapter,
        functionName: "totalWithdrawable" as const,
      },
      {
        abi: ProcurementPolicyAbi,
        address: contracts.ProcurementPolicy,
        functionName: "policy" as const,
      },
    ],
    query: { enabled: Boolean(address) && onChain, refetchInterval: 30_000 },
  });

  const held = (i: number) => data?.[i]?.result === true;
  const at = (i: number) => data?.[ADAPTER_ROLES.length + i]?.result;
  const platformFeeBP = Number(at(0) ?? 0);
  const evaluatorFeeBP = Number(at(1) ?? 0);
  const treasury = at(2) as string | undefined;
  const totalHeld = at(3) as bigint | undefined;
  const totalWithdrawable = at(4) as bigint | undefined;
  const agentCap = (at(5) as { agentAwardCap?: bigint } | undefined)?.agentAwardCap;
  const isAdmin = held(0);

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    setError(null);
    setTxHash(null);
    setBusy(label);
    try {
      const hash = await fn();
      setTxHash(hash);
      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status === "reverted") {
        setError("The transaction was mined but the contract rejected it, so nothing changed.");
        return;
      }
      setMode(null);
      setPhrase("");
      setHeir("");
      await refetch();
    } catch (e) {
      setError(describeTxError(e));
    } finally {
      setBusy(null);
    }
  }

  const write = async (fn: "grantRole" | "renounceRole", args: readonly unknown[]) => {
    const params = {
      abi: SealedRFQAdapterAbi,
      address: contracts.SealedRFQAdapter,
      functionName: fn,
      args,
    } as const;
    // biome-ignore lint/suspicious/noExplicitAny: the request shape is the caller's, not ours
    await simulateContract(config, { ...(params as any), account: address });
    // biome-ignore lint/suspicious/noExplicitAny: same
    return writeContractAsync(params as any);
  };

  if (!isConnected) {
    return (
      <div className="panel">
        <div className="head">Operator</div>
        <div className="note">Connect the wallet that deployed these contracts.</div>
      </div>
    );
  }

  if (!onChain) {
    return (
      <div className="panel">
        <div className="head">Operator</div>
        <div className="note">Switch to {chain.name} to read the roles on these contracts.</div>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <div className="head">
          What this wallet holds
          <span className="hint">on the adapter · {chain.name}</span>
        </div>
        {ADAPTER_ROLES.map((r, i) => (
          <div className="kv" key={r}>
            <span>
              {r} <span className="hint">{ROLE_POWER[r]}</span>
            </span>
            <b className={held(i) ? "warn-text" : "muted"}>{held(i) ? "HELD" : "not held"}</b>
          </div>
        ))}
        <div className="note">
          Roles are per contract. This reads the adapter, which carries the two that decide where
          money goes — VERIFIER accepts or rejects a milestone on any engagement, ARBITER splits a
          disputed one. The registry, AgenticCommerce, AttestationLog and policy each keep their
          own set.
        </div>
      </div>

      <div className="panel">
        <div className="head">
          Fees
          <span className="hint">nothing accrues in the contract</span>
        </div>
        <div className="kv">
          <span>Platform fee</span>
          <b className={platformFeeBP > 0 ? "warn-text" : ""}>
            {(platformFeeBP / 100).toFixed(2)}% of each milestone
          </b>
        </div>
        <div className="kv">
          <span>Evaluator fee</span>
          <b className={evaluatorFeeBP > 0 ? "warn-text" : ""}>
            {(evaluatorFeeBP / 100).toFixed(2)}%
          </b>
        </div>
        <div className="kv">
          <span>Treasury</span>
          <a className="mono" href={explorerAddress(treasury ?? "")} target="_blank" rel="noreferrer">
            {treasury ? `${treasury.slice(0, 6)}…${treasury.slice(-4)}` : "—"} ↗
          </a>
        </div>
        <div className="note">
          <b>There is nothing to withdraw here.</b> A platform fee is transferred straight to the
          treasury wallet at the moment a milestone releases, so no balance builds up in the
          contracts. It is also taken <i>out of</i> the supplier's milestone payment rather than
          added on top, so raising it quietly reduces what a supplier receives against the price
          they were awarded.
        </div>
        {evaluatorFeeBP > 0 && (
          <div className="field-err" role="alert">
            <b>Set the evaluator fee back to zero.</b> Jobs are created with the adapter as their
            own evaluator, so this fee transfers USDC to the adapter, which never credits it to
            anyone. Those funds cannot be withdrawn by you or by anybody else.
          </div>
        )}
      </div>

      <div className="panel">
        <div className="head">
          What the agent may decide alone
          <span className="hint">policy · applies to the AWARDER, never to a buyer</span>
        </div>
        <div className="kv">
          <span>Agent award cap</span>
          <b className={agentCap === 0n ? "warn-text" : ""}>
            {agentCap === undefined
              ? "—"
              : agentCap === 0n
                ? "0 — agent awards disabled"
                : `${formatUsdc(agentCap)} USDC`}
          </b>
        </div>
        <div className="note">
          Above this figure an award has to be sent by the buyer themselves. It is the line between
          a machine recommending and a machine committing: without it, an evaluation the buyer never
          read could bind a supplier to any sum at all. A buyer is never capped by it — this bounds
          what is decided unattended, not what may be spent. Zero disables agent awards entirely,
          which is the safe reading rather than a misconfiguration.
        </div>
      </div>

      <div className="panel">
        <div className="head">
          Escrow held
          <span className="hint">not revenue — other people's money</span>
        </div>
        <div className="kv">
          <span>Held against live engagements</span>
          <b>{totalHeld === undefined ? "—" : `${formatUsdc(totalHeld)} USDC`}</b>
        </div>
        <div className="kv">
          <span>Credited, waiting to be claimed</span>
          <b>{totalWithdrawable === undefined ? "—" : `${formatUsdc(totalWithdrawable)} USDC`}</b>
        </div>
        <div className="note">
          Both figures belong to buyers and suppliers. No key on this page can move either — the
          second is claimable only by the address it was credited to.
        </div>
      </div>

      {isAdmin && (
        <div className="panel">
          <div className="head">
            Hand over or give up the root role
            <span className="hint">one way · no undo</span>
          </div>
          <div className="note">
            ADMIN is OpenZeppelin's default admin: it can grant itself every other role on this
            contract. The contracts use plain AccessControl, so a handover is <b>not</b> two-step —
            granting to a mistyped address cannot be reversed, and renouncing afterwards would
            leave the contract permanently ungoverned.
          </div>

          <div style={{ padding: "0 20px 14px" }}>
            <div className="filter-row">
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setMode(mode === "transfer" ? null : "transfer");
                  setPhrase("");
                }}
              >
                nominate a new admin
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setMode(mode === "renounce" ? null : "renounce");
                  setPhrase("");
                }}
              >
                renounce admin
              </button>
            </div>
          </div>

          {mode === "transfer" && (
            <div className="form" style={{ padding: "0 20px 16px" }}>
              <div className="field full">
                <label htmlFor="heir">New admin address</label>
                <input
                  id="heir"
                  value={heir}
                  placeholder="0x…"
                  onChange={(e) => setHeir(e.target.value)}
                />
                {heir.trim() && !looksLikeAddress(heir) && (
                  <span className="field-hint warn">That is not a 20-byte address.</span>
                )}
              </div>
              <div className="full note">
                This <b>grants</b> ADMIN to that address. It does not remove it from you — do that
                separately, and only once the new admin has confirmed they can use it. A multisig or
                timelock is the better recipient than a single key.
              </div>
              <div className="field full">
                <label htmlFor="phrase-t">
                  Type <b>{CONFIRM_PHRASES.transfer}</b> to enable
                </label>
                <input id="phrase-t" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
              </div>
              <div className="full">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    !!busy ||
                    !looksLikeAddress(heir) ||
                    !phraseMatches(phrase, CONFIRM_PHRASES.transfer)
                  }
                  onClick={() =>
                    run("Granting…", () =>
                      write("grantRole", [ADMIN_ROLE, heir.trim() as `0x${string}`]),
                    )
                  }
                >
                  {busy ?? "Grant ADMIN"}
                </button>
              </div>
            </div>
          )}

          {mode === "renounce" && (
            <div className="form" style={{ padding: "0 20px 16px" }}>
              <div className="full note warn">
                This gives up ADMIN on the adapter <b>permanently</b>. Afterwards nobody can change
                the role set, and <code>setPolicy</code>, <code>setQualifier</code> and{" "}
                <code>setKindRole</code> freeze as they are — a policy mistake becomes unfixable.
                That is the price of the guarantee, and §6d of the work plan is where the decision
                belongs. Make sure another admin exists first if you do not intend the contract to
                be ungoverned.
              </div>
              <div className="field full">
                <label htmlFor="phrase-r">
                  Type <b>{CONFIRM_PHRASES.renounce}</b> to enable
                </label>
                <input id="phrase-r" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
              </div>
              <div className="full">
                <button
                  type="button"
                  className="btn-outline"
                  disabled={!!busy || !phraseMatches(phrase, CONFIRM_PHRASES.renounce)}
                  onClick={() =>
                    run("Renouncing…", () =>
                      write("renounceRole", [ADMIN_ROLE, address as `0x${string}`]),
                    )
                  }
                >
                  {busy ?? "Renounce ADMIN forever"}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="field-err" role="alert">
              {error}
            </div>
          )}
          {txHash && (
            <div style={{ padding: "0 20px 14px" }}>
              <a
                className="mono"
                href={`${chain.blockExplorers.default.url}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            </div>
          )}
        </div>
      )}
    </>
  );
}
