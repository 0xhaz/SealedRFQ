import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { Injectable, Logger } from "@nestjs/common";
import { fetchFinalityProof } from "@sealedrfq/concordium/finality";
import type { Hex } from "viem";
import { ChainService } from "../chain/chain.service.js";
import { QUALIFIER_ABI, type QualifyResult, qualify } from "./qualifier.core.js";

/**
 * Joins a verified subject to an on-chain qualification, signed by the CCD_QUALIFIER key.
 *
 * The caller vouches for the subject; this service does not and cannot re-verify a presentation.
 * What it adds is the part a caller must not control: the nullifier (from a secret only this
 * process holds) and the finality proof (fetched here, checked again by the contract).
 */
@Injectable()
export class QualifierService {
  private readonly log = new Logger(QualifierService.name);

  constructor(private readonly chain: ChainService) {}

  private get address(): Hex {
    const a = process.env.V2_QUALIFIER;
    if (!a) throw new Error("V2_QUALIFIER is not set");
    return a as Hex;
  }

  private secret(): Uint8Array {
    const s = process.env.QUALIFICATION_NULLIFIER_SECRET;
    if (!s) throw new Error("QUALIFICATION_NULLIFIER_SECRET is not set");
    // Hex when it looks like hex, so `openssl rand -hex 32` gives 32 bytes rather than 64.
    return /^(0x)?[0-9a-fA-F]{64,}$/.test(s)
      ? Buffer.from(s.replace(/^0x/, ""), "hex")
      : Buffer.from(s, "utf8");
  }

  qualify(input: {
    subject: string;
    bidder: Hex;
    tenderId: number | bigint;
    synthetic: boolean;
  }): Promise<QualifyResult> {
    const ccd = new ConcordiumGRPCNodeClient(
      process.env.CCD_GRPC_HOST ?? "grpc.testnet.concordium.com",
      Number(process.env.CCD_GRPC_PORT ?? 20000),
      credentials.createSsl(),
    );
    const wallet = this.chain.wallet("CCD_QUALIFIER");
    const base = { address: this.address, abi: QUALIFIER_ABI } as const;
    return qualify(input, {
      fetchProof: () => fetchFinalityProof(ccd),
      nullifierSecret: this.secret(),
      qualifier: this.address,
      read: (c) =>
        this.chain.publicClient.readContract({ ...base, ...c } as never) as Promise<unknown>,
      simulate: async (args) => {
        await this.chain.publicClient.simulateContract({
          ...base,
          functionName: "recordQualification",
          args,
          account: wallet.account,
        } as never);
      },
      send: (args) =>
        this.chain.send("CCD_QUALIFIER", {
          ...base,
          functionName: "recordQualification",
          args,
        }),
      log: (m) => this.log.log(m),
    });
  }
}
