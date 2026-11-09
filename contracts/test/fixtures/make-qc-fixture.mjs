import { readFileSync, writeFileSync } from "node:fs";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const b64 = (s) => Buffer.from(s, "base64");
const fp = (x) => x.toString(16).padStart(96, "0").padStart(128, "0");
const g1enc = (p) => fp(p.x) + fp(p.y);
const g2enc = (p) => fp(p.x.c0) + fp(p.x.c1) + fp(p.y.c0) + fp(p.y.c1);

const qc = JSON.parse(readFileSync("/tmp/qc_pinned.json", "utf8")).quorumCertificate;
const consensus = JSON.parse(readFileSync("/tmp/consensus.json", "utf8"));

// Concordium serialises BLS points compressed. EIP-2537 takes them uncompressed, so the
// conversion happens here, off-chain, exactly as the design says it should.
const sig = bls.G1.ProjectivePoint.fromHex(b64(qc.aggregateSignature.value).toString("hex")).toAffine();

// The committee, from the same block the certificate came from.
const raw = readFileSync("/tmp/bakers_pinned.jsonl", "utf8");
const objs = raw.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/gs) ?? [];
const committee = [];
for (const o of objs) {
  let d; try { d = JSON.parse(o); } catch { continue; }
  if (!d.baker || !d.isFinalizer) continue;
  committee.push({
    id: Number(d.baker.bakerId?.value ?? 0),
    key: b64(d.baker.aggregationKey.value).toString("hex"),
    stake: BigInt(d.effectiveStake.value),
  });
}
committee.sort((a, b) => a.id - b.id);

const signerIds = new Set(qc.signatories.map((s) => Number(s.value ?? 0)));
const signers = committee.filter((c) => signerIds.has(c.id));
const absent = committee.filter((c) => !signerIds.has(c.id));

// Aggregate the signers' public keys: BLS aggregation is addition in G2.
let agg = null;
for (const c of signers) {
  const p = bls.G2.ProjectivePoint.fromHex(c.key);
  agg = agg ? agg.add(p) : p;
}

const total = committee.reduce((n, c) => n + c.stake, 0n);
const signed = signers.reduce((n, c) => n + c.stake, 0n);

// "QUORUM." || genesis || block || round(u64 BE) || epoch(u64 BE), from the node's
// quorumSignatureMessageBytes in KonsensusV1/Types.hs.
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); return b; };
const mkMsg = (genesisHex) => Buffer.concat([
  Buffer.from("QUORUM."),
  Buffer.from(genesisHex, "hex"),
  b64(qc.blockHash.value),
  u64(qc.round.value),
  u64(qc.epoch.value),
]);

const genesis = b64(consensus.genesisBlock.value).toString("hex");
const eraGenesis = b64(consensus.currentEraGenesisBlock.value).toString("hex");

// Which genesis the message commits to is settled by trying both, not by guessing.
const DST = "CONCORDIUM-hashtoG1-with-BLS12381G1_XMD:SHA-256_SSWU_RO";
const check = (m) => {
  const H = bls.G1.hashToCurve(m, { DST });
  const lhs = bls.pairing(bls.G1.ProjectivePoint.fromAffine(sig), bls.G2.ProjectivePoint.BASE);
  const rhs = bls.pairing(H, agg);
  return bls.fields.Fp12.eql(lhs, rhs);
};
const useEra = check(mkMsg(eraGenesis));
const useOrig = check(mkMsg(genesis));
console.log("// verifies against current-era genesis:", useEra);
console.log("// verifies against original genesis   :", useOrig);
if (!useEra && !useOrig) { console.log("// NEITHER verified"); }

const chosen = useEra ? eraGenesis : genesis;
// The committee as the contract takes it: every member in ascending baker id, 256 bytes of
// uncompressed G2 key then a 32-byte stake, with a bitmap saying who signed. Supplying the whole
// committee costs less calldata than Merkle paths for the signers alone, and leaves no tree to
// build or get wrong.
const u256 = (v) => v.toString(16).padStart(64, "0");
let membersHex = "";
for (const c of committee) {
  membersHex += g2enc(bls.G2.ProjectivePoint.fromHex(c.key).toAffine()) + u256(c.stake);
}
const bits = new Uint8Array(Math.ceil(committee.length / 8));
committee.forEach((c, i) => { if (signerIds.has(c.id)) bits[i >> 3] |= 1 << (i % 8); });
const membersHash = Buffer.from(keccak_256(Buffer.from(membersHex, "hex"))).toString("hex");

writeFileSync("/tmp/qc-fixture.json", JSON.stringify({
  members: "0x" + membersHex,
  signerBits: "0x" + Buffer.from(bits).toString("hex"),
  membersHash: "0x" + membersHash,
  eraGenesisMs: String(JSON.parse(readFileSync("/tmp/consensus.json","utf8")).currentEraGenesisTime.value),
  note: "Real Concordium mainnet quorum certificate",
  genesis: "0x" + chosen,
  blockHash: "0x" + b64(qc.blockHash.value).toString("hex"),
  round: qc.round.value,
  epoch: qc.epoch.value,
  committeeSize: committee.length,
  signerCount: signers.length,
  absentCount: absent.length,
  totalStake: total.toString(),
  signedStake: signed.toString(),
  message: "0x" + mkMsg(chosen).toString("hex"),
  signature: "0x" + g1enc(sig),
  aggregatePublicKey: "0x" + g2enc(agg.toAffine()),
}, null, 2));
console.log("// committee", committee.length, "signers", signers.length,
            "stake", (Number(signed) / Number(total) * 100).toFixed(1) + "%");
