"use client";

import { WalletChip } from "@/components/WalletChip";
import {
  type SavedBid,
  computeCommitment,
  downloadBid,
  loadBid,
  saltFromSignature,
  saltMessage,
  saveBid,
} from "@/lib/bidStore";
import { chain, contracts, explorerTx } from "@/lib/chain";
import { useIsContract } from "@/components/TeamAccount";
import { DURATION_UNITS, type DurationUnit, toSeconds } from "@/lib/duration";
import { hashFile } from "@/lib/docHash";
import { signUsdcPermit } from "@/lib/permit";
import { describeTxError } from "@/lib/txError";
import {
  RFQRegistryAbi,
  USDC_ADDRESS,
  describeWindow,
  formatUsdc,
  parseUsdc,
} from "@sealedrfq/shared";
import Link from "next/link";
import { useState } from "react";
import { sha256, stringToBytes } from "viem";
import { erc20Abi } from "viem";
import { useAccount, useConfig, useReadContract, useWriteContract } from "wagmi";
import { readContract, signMessage, waitForTransactionReceipt } from "wagmi/actions";

const ZERO_HASH = `0x${"0".repeat(64)}` as const;

type Props = {
  rfqId: number;
  phase: string;
  deposit: string; // 6-decimal units as string
  budget: string;
  /** Seconds each milestone allows for delivery. The bid has to fit inside it. */
  deliveryWindow: number;
  /** Sealed takes a commitment now and a reveal later; open publishes the price immediately. */
  bidMode: "sealed" | "open";
  /** RFP mode: the bid must carry a proposal, not just a price. */
  requiresProposal: boolean;
};

export function BidForm({
  rfqId,
  phase,
  deposit,
  budget,
  deliveryWindow,
  bidMode,
  requiresProposal,
}: Props) {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [price, setPrice] = useState("");
  /**
   * Delivery as an amount and a unit, matching the buyer's own field.
   *
   * A bid used to be a whole number of days while the buyer's window was seconds, so a window
   * shorter than a day could not be met by any bid at all and the tender simply refused every
   * award. Both are seconds now, and a supplier can answer a two-hour window with ninety minutes.
   */
  const [deliveryAmount, setDeliveryAmount] = useState("21");
  const [deliveryUnit, setDeliveryUnit] = useState<DurationUnit>("days");
  const deliverySeconds = toSeconds(deliveryAmount, deliveryUnit);

  /**
   * Whether the quoted delivery fits the window the buyer published.
   *
   * The award now refuses a bid that overruns, but the deposit is taken at commit — long before
   * anyone tries to award. So catching it here is still the only place it costs the supplier
   * nothing, and the warning stays.
   */
  const overWindow = deliveryWindow > 0 && deliverySeconds > deliveryWindow;
  const [proposal, setProposal] = useState("");
  /**
   * A priced quotation as a file. A classic RFQ is answered with a document, not a paragraph, and
   * hashing the bytes binds the breakdown to the sealed total exactly as typed text does.
   */
  const [quoteFile, setQuoteFile] = useState<{ name: string; hash: `0x${string}` } | null>(null);
  /**
   * Acceptance of the published terms. The real binding is cryptographic — the commitment is for an
   * RFQ whose metadataHash covers the terms — but a supplier should be asked before they are bound,
   * not told afterwards that bidding counted as agreement.
   */
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [saved, setSaved] = useState<SavedBid | null>(
    address ? loadBid(chain.id, rfqId, address) : null,
  );
  const [revealFile, setRevealFile] = useState<SavedBid | null>(null);

  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: USDC_ADDRESS,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });
  // Arc pays gas in USDC, so a deposit you cannot cover shows up as an unpriceable fee.
  const shortBy = balance !== undefined ? BigInt(deposit) - balance : 0n;

  // On an invited tender the contract rejects a stranger's commit. Ask before letting them sign:
  // the revert is recoverable but it still costs gas to discover. Returns true for open RFQs.
  const { data: invited } = useReadContract({
    abi: RFQRegistryAbi,
    address: contracts.RFQRegistry,
    functionName: "isInvited",
    args: address ? [BigInt(rfqId), address] : undefined,
    query: { enabled: Boolean(address) },
  });
  const notInvited = invited === false;

  const wrongChain = isConnected && chainId !== chain.id;
  const { isContract: bidderIsContract } = useIsContract(address);
  const isOpen = bidMode === "open";
  const bidding = phase === "Bidding";
  // An open tender has nothing to reveal: the price went public when it was placed. Offering a
  // reveal step would invite a supplier to look for a second action that does not exist.
  const revealing = phase === "Reveal" && !isOpen;
  const fail = (e: unknown) => {
    setBusy(null);
    setError(describeTxError(e));
  };

  /** Salt = signature over a bid-scoped message, so the wallet alone can regenerate it later. */
  async function deriveSalt(bidder: `0x${string}`) {
    const signature = await signMessage(config, {
      message: saltMessage({ registry: contracts.RFQRegistry, chainId: chain.id, rfqId, bidder }),
    });
    return saltFromSignature(signature);
  }

  /** A file wins when one is attached: it is the document the buyer will receive and check. */
  function proposalHashOf(text: string): `0x${string}` {
    if (quoteFile) return quoteFile.hash;
    return text.trim() ? sha256(stringToBytes(text)) : ZERO_HASH;
  }

  function commitmentFor(
    bidder: `0x${string}`,
    price: bigint,
    deliverySeconds: number,
    proposalHash: `0x${string}`,
    salt: `0x${string}`,
  ) {
    return computeCommitment({
      registry: contracts.RFQRegistry,
      chainId: chain.id,
      rfqId,
      bidder,
      price,
      deliverySeconds,
      proposalHash,
      salt,
    });
  }

  async function onChainCommitment(bidder: `0x${string}`) {
    const bid = await readContract(config, {
      abi: RFQRegistryAbi,
      address: contracts.RFQRegistry,
      functionName: "getBid",
      args: [BigInt(rfqId), bidder],
      chainId: chain.id as never,
    });
    return bid.commitHash;
  }

  async function commit(reseal = false) {
    setError(null);
    setNotice(null);
    if (!address) return;
    try {
      const priceUnits = parseUsdc(price);
      if (priceUnits <= 0n) throw new Error("Enter a price above zero");
      if (deliverySeconds <= 0) throw new Error("Enter how long delivery will take");

      if (!accepted) {
        throw new Error(
          "Confirm you have read the tender pack and accept the terms before bidding",
        );
      }
      if (requiresProposal && !proposal.trim() && !quoteFile) {
        throw new Error("This RFQ is an RFP: attach a proposal document or write one");
      }
      const proposalHash = proposalHashOf(proposal);

      /*
       * An open tender takes the price in the clear, so everything below this — the salt, the
       * commitment, the reveal file — has nothing to do. There is no secret to derive because
       * there is no secret: the whole point of the mode is that rivals can read the bid and
       * respond to it while bidding is still open.
       */
      if (isOpen) {
        setBusy("Placing your bid…");
        const hash = await writeContractAsync({
          abi: RFQRegistryAbi,
          address: contracts.RFQRegistry,
          functionName: "placeOpenBid",
          args: [BigInt(rfqId), priceUnits, deliverySeconds, proposalHash],
          chainId: chain.id,
        });
        setTxHash(hash);
        setBusy("Waiting for the transaction…");
        const receipt = await waitForTransactionReceipt(config, { hash });
        setBusy(null);
        if (receipt.status === "reverted") {
          setError("The transaction was mined but the contract rejected it, so nothing changed.");
          return;
        }
        setNotice(
          "Your bid is placed and public. You can improve it while bidding is open — a better price replaces this one and costs no second deposit.",
        );
        return;
      }

      setBusy("Deriving your bid secret (signature, not a transaction)…");
      const salt = await deriveSalt(address);
      const commitHash = commitmentFor(address, priceUnits, deliverySeconds, proposalHash, salt);

      // Save and hand over the reveal file before signing anything that costs money.
      const record: SavedBid = {
        chainId: chain.id,
        rfqId,
        bidder: address,
        price: priceUnits.toString(),
        deliverySeconds,
        proposalHash,
        salt,
        commitHash,
        savedAt: Date.now(),
      };
      saveBid(record);
      downloadBid(record);
      setSaved(record);

      let args: readonly [bigint, `0x${string}`] | null = null;
      if (reseal) {
        // Re-sealing reuses the deposit already held: commitBid replaces the stored hash.
        setBusy("Re-sealing the bid…");
        args = [BigInt(rfqId), commitHash];
      } else {
        setBusy("Signing the USDC permit for the deposit…");
      }

      const hash = args
        ? await writeContractAsync({
            abi: RFQRegistryAbi,
            address: contracts.RFQRegistry,
            functionName: "commitBid",
            args,
          })
        : await (async () => {
            const permit = await signUsdcPermit(config, {
              owner: address,
              spender: contracts.RFQRegistry,
              value: BigInt(deposit),
              chainId: chain.id,
            });
            setBusy("Sending the sealed bid…");
            return writeContractAsync({
              abi: RFQRegistryAbi,
              address: contracts.RFQRegistry,
              functionName: "commitBidWithPermit",
              args: [BigInt(rfqId), commitHash, permit.deadline, permit.v, permit.r, permit.s],
            });
          })();

      setTxHash(hash);
      setBusy("Waiting for the transaction…");
      await waitForTransactionReceipt(config, { hash });
      setBusy(null);
      setNotice(reseal ? "Bid re-sealed with a fresh secret. No extra deposit was taken." : null);
    } catch (e) {
      fail(e);
    }
  }

  /** Try the saved bid, then an uploaded file, then re-derive from the wallet. */
  async function reveal() {
    setError(null);
    setNotice(null);
    if (!address) return;
    try {
      setBusy("Checking your bid against the chain…");
      const target = await onChainCommitment(address);
      const candidates: SavedBid[] = [revealFile, saved].filter(Boolean) as SavedBid[];
      let match = candidates.find(
        (c) =>
          commitmentFor(
            address,
            BigInt(c.price),
            c.deliverySeconds,
            c.proposalHash ?? ZERO_HASH,
            c.salt,
          ).toLowerCase() === target.toLowerCase(),
      );

      if (!match) {
        const priceUnits = price
          ? parseUsdc(price)
          : candidates[0]
            ? BigInt(candidates[0].price)
            : 0n;
        const secs = deliverySeconds || candidates[0]?.deliverySeconds || 0;
        if (priceUnits > 0n && secs > 0) {
          setBusy("Re-deriving your bid secret from your wallet…");
          const salt = await deriveSalt(address);
          const proposalHash =
            quoteFile || proposal.trim()
              ? proposalHashOf(proposal)
              : (candidates[0]?.proposalHash ?? ZERO_HASH);
          if (
            commitmentFor(address, priceUnits, deliverySeconds, proposalHash, salt).toLowerCase() ===
            target.toLowerCase()
          ) {
            match = {
              chainId: chain.id,
              rfqId,
              bidder: address,
              price: priceUnits.toString(),
              deliverySeconds,
              proposalHash,
              salt,
              commitHash: target,
              savedAt: Date.now(),
            };
            saveBid(match);
            setSaved(match);
          }
        }
      }

      if (!match) {
        throw new Error(
          "Could not reproduce your sealed bid. Load the reveal file, or enter the exact price and delivery days you bid and try again.",
        );
      }

      setBusy("Revealing the bid…");
      const hash = await writeContractAsync({
        abi: RFQRegistryAbi,
        address: contracts.RFQRegistry,
        functionName: "revealBid",
        args: [
          BigInt(rfqId),
          BigInt(match.price),
          match.deliverySeconds,
          match.proposalHash ?? ZERO_HASH,
          match.salt,
        ],
      });
      setTxHash(hash);
      await waitForTransactionReceipt(config, { hash });
      setBusy(null);
      setNotice("Bid revealed.");
    } catch (e) {
      fail(e);
    }
  }

  function onRevealFile(file: File) {
    file
      .text()
      .then((t) => setRevealFile(JSON.parse(t) as SavedBid))
      .catch(() => setError("That file is not a SealedRFQ reveal file"));
  }

  if (!isConnected) {
    return (
      <div className="panel">
        <div className="head">Connect to bid</div>
        <div className="note">
          Bidding posts a {formatUsdc(BigInt(deposit))} USDC deposit. It is refunded when you reveal
          and do not win, and forfeited if you never reveal.
        </div>
        <div style={{ padding: 14 }}>
          <WalletChip />
        </div>
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div className="panel">
        <div className="head">Wrong network</div>
        <div className="note">Switch your wallet to {chain.name} to bid.</div>
        <div style={{ padding: 14 }}>
          <WalletChip />
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="head">
        {bidding
          ? isOpen
            ? "Place an open bid"
            : "Submit a sealed bid"
          : revealing
            ? "Reveal your bid"
            : "Bidding closed"}
        <span className="hint">
          budget {formatUsdc(BigInt(budget))} · deposit {formatUsdc(BigInt(deposit))} USDC
          {deliveryWindow > 0 && ` · delivery within ${describeWindow(deliveryWindow)}`}
        </span>
      </div>

      {(bidding || revealing) && (
        <div className="form">
          <div className="field">
            <label htmlFor="bid-price">
              {revealing ? "Price you bid (USDC)" : "Your price (USDC)"}
            </label>
            <input
              id="bid-price"
              inputMode="decimal"
              placeholder="2.80"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="bid-delivery">Delivery</label>
            <div className="duration-input">
              <input
                id="bid-delivery"
                inputMode="numeric"
                value={deliveryAmount}
                onChange={(e) => setDeliveryAmount(e.target.value)}
              />
              <select
                aria-label="delivery unit"
                value={deliveryUnit}
                onChange={(e) => setDeliveryUnit(e.target.value as DurationUnit)}
              >
                {DURATION_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            {overWindow && (
              <div className="field-err" role="alert">
                This tender gives each milestone {describeWindow(deliveryWindow)} to deliver, so a{" "}
                {describeWindow(deliverySeconds)} quote cannot be met. Bid it and the award will be
                refused — and if the buyer awards anyway, the first milestone's deadline passes
                before you can deliver, forfeiting the escrow and your performance stake.
              </div>
            )}
          </div>

          {bidding && (
            <div className="field full">
              <label htmlFor="bid-quote">
                {requiresProposal ? "Proposal document (required)" : "Priced quotation (optional)"}
              </label>
              <input
                id="bid-quote"
                type="file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  setQuoteFile(f ? { name: f.name, hash: await hashFile(f) } : null);
                }}
              />
              <span className="hint">
                {quoteFile
                  ? `${quoteFile.name} — ${quoteFile.hash.slice(0, 14)}…`
                  : "Your line-by-line pricing, hashed and sealed with the total. The file is not uploaded; send it to the buyer however you normally would and they can check it against this hash."}
              </span>
            </div>
          )}

          {bidding && !quoteFile && (
            <div className="field full">
              <label htmlFor="bid-proposal">
                {requiresProposal ? "…or write it here" : "…or a note instead (optional)"}
              </label>
              <textarea
                id="bid-proposal"
                rows={3}
                placeholder="Method, team, timeline — whatever the buyer asked for."
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
              />
            </div>
          )}

          {bidding ? (
            <>
              {isOpen ? (
                <div className="full note warn">
                  <b>This is an open tender: your price is public the moment you place it.</b>{" "}
                  Rivals can read it and undercut you, and you can read theirs and improve yours —
                  as often as you like while bidding is open, with no second deposit. There is no
                  reveal step and no secret to keep, so nothing here can be forfeited for failing
                  to reveal. If you would rather not have competitors see your number, this is not
                  a tender to bid on.
                </div>
              ) : (
              <div className="full note">
                <b>Your secret is derived from your wallet.</b> The price
                {requiresProposal ? " and proposal are" : " is"} hidden on-chain behind a hash, so
                neither can be rewritten after seeing rival bids. The secret that unlocks it comes
                from a signature, so the same wallet can regenerate it — and the reveal file
                downloads as a backup. Keep at least one: after bidding closes, a bid that cannot be
                revealed forfeits its deposit.
              </div>
              )}
              {/*
                The paragraph above is true of an ordinary wallet and false of a team account. The
                salt is the hash of a signature, and a multisig's signature bytes depend on which
                owners signed and in what order — so a colleague revealing derives a different salt,
                the commitment does not match, and the deposit is forfeited. Until the derivation
                changes, the honest thing is to say the file is the only route.
              */}
              {bidderIsContract && bidding && (
                <div className="full note warn">
                  <b>This address is a contract account.</b> The reveal file below is your only way
                  to reveal this bid — do not rely on regenerating the secret from a signature. A
                  team account signs with whichever owners are available, and different signers
                  produce a different secret, which would not match what you sealed. Download the
                  file and keep it somewhere the person who reveals can reach.
                </div>
              )}
              {notInvited && (
                <div className="full note warn">
                  <b>This tender is invite-only.</b> The buyer listed the suppliers who may bid and
                  this address is not among them, so the contract would reject the bid. Ask the
                  buyer to add you — they can invite more suppliers while bidding is still open.
                </div>
              )}
              {shortBy > 0n && (
                <div className="full note warn">
                  <b>Not enough USDC.</b> This bid posts a {formatUsdc(BigInt(deposit))} deposit and
                  this account holds {formatUsdc(balance ?? 0n)}. Gas is USDC on Arc as well, so an
                  empty account cannot even estimate a fee.
                </div>
              )}
              <div className="full accept-terms">
                <label htmlFor="accept-terms">
                  <input
                    id="accept-terms"
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  <span>
                    I have read the{" "}
                    <Link href={`/rfqs/${rfqId}/pack`} className="linklike">
                      tender pack
                    </Link>{" "}
                    and accept the terms published with this RFQ.
                  </span>
                </label>
                <span className="hint">
                  Your bid is sealed against those exact terms: the commitment covers the RFQ&apos;s
                  metadata hash, so they cannot be changed afterwards without every bidder seeing
                  it.
                </span>
              </div>
              <div className="full button-row">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!!busy || shortBy > 0n || notInvited || !accepted}
                  onClick={() => commit(false)}
                >
                  {busy ?? "Seal and submit bid"}
                </button>
                {saved && (
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={!!busy}
                    onClick={() => commit(true)}
                    title="Replaces the stored hash with a fresh secret; the deposit you already posted is reused"
                  >
                    Lost your file? Re-seal (no new deposit)
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="full note">
                {saved ? (
                  <>
                    Found your sealed bid in this browser:{" "}
                    <b>{formatUsdc(BigInt(saved.price))} USDC</b> over{" "}
                    {describeWindow(saved.deliverySeconds)}.
                  </>
                ) : (
                  <>
                    No saved bid in this browser. Load the reveal file, or type the price and
                    delivery days you bid — the secret is re-derived from your wallet.
                  </>
                )}
              </div>
              <div className="field full">
                <label htmlFor="reveal-file">Reveal file (optional)</label>
                <input
                  id="reveal-file"
                  type="file"
                  accept="application/json"
                  onChange={(e) => e.target.files?.[0] && onRevealFile(e.target.files[0])}
                />
              </div>
              <div className="full">
                <button type="button" className="btn-primary" disabled={!!busy} onClick={reveal}>
                  {busy ?? "Reveal bid"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!bidding && !revealing && (
        <div className="note">
          This RFQ is in its {phase.toLowerCase()} phase — no new bids or reveals.
        </div>
      )}

      {saved && bidding && (
        <div className="note">
          Sealed bid saved.{" "}
          <button type="button" className="linklike" onClick={() => downloadBid(saved)}>
            Download the reveal file again
          </button>
        </div>
      )}

      {notice && <div className="note">{notice}</div>}

      {error && (
        <div className="field-err" role="alert">
          {error}
        </div>
      )}

      {txHash && (
        <div className="note">
          <a href={explorerTx(txHash)} target="_blank" rel="noreferrer">
            View transaction ↗
          </a>{" "}
          ·{" "}
          <Link href={`/rfqs/${rfqId}`} className="linklike">
            back to the RFQ
          </Link>
        </div>
      )}
    </div>
  );
}
