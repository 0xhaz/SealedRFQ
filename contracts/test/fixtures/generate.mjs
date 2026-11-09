// Regenerate the BLS fixtures:
//   node contracts/test/fixtures/generate.mjs > contracts/test/fixtures/bls-concordium.json
//
// The vectors are built with Concordium's own domain separation tag, taken from concordium-base
// (curve_arithmetic/bls12_381_arkworks.rs), and the pairing identity is checked here before the
// Solidity verifier is asked to check it. A fixture that is wrong in the same way as the code it
// tests proves nothing.
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

// Concordium's own domain separation tag, from concordium-base:
// curve_arithmetic/bls12_381_arkworks.rs -> DOMAIN_STRING for hash-to-G1.
const DST = "CONCORDIUM-hashtoG1-with-BLS12381G1_XMD:SHA-256_SSWU_RO";

const hex = (b) => Buffer.from(b).toString("hex");
// EIP-2537 field element: 64 bytes, 16 zero bytes then 48 bytes big-endian.
const fp = (x) => x.toString(16).padStart(96, "0").padStart(128, "0");

const sk = 0x263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3n;
const msg = new TextEncoder().encode("concordium finalization proof spike");

const H = bls.G1.hashToCurve(msg, { DST }).toAffine();
const sig = bls.G1.ProjectivePoint.fromAffine(H).multiply(sk).toAffine();
const pk = bls.G2.ProjectivePoint.BASE.multiply(sk).toAffine();
const g2 = bls.G2.ProjectivePoint.BASE.toAffine();

// Sanity: the pairing identity this is all built on, checked off-chain first.
const lhs = bls.pairing(bls.G1.ProjectivePoint.fromAffine(sig), bls.G2.ProjectivePoint.BASE);
const rhs = bls.pairing(bls.G1.ProjectivePoint.fromAffine(H), bls.G2.ProjectivePoint.fromAffine(pk));
const Fp12 = bls.fields.Fp12;
console.log("// off-chain pairing identity holds:", Fp12.eql(lhs, rhs));

const g1enc = (p) => fp(p.x) + fp(p.y);
// Fp2 is encoded (c0, c1) in EIP-2537.
const g2enc = (p) => fp(p.x.c0) + fp(p.x.c1) + fp(p.y.c0) + fp(p.y.c1);

console.log(JSON.stringify({
  dst: DST,
  message: hex(msg),
  hashToG1: "0x" + g1enc(H),
  signature: "0x" + g1enc(sig),
  publicKey: "0x" + g2enc(pk),
  g2Generator: "0x" + g2enc(g2),
  // Negated, because BLS12_PAIRING_CHECK tests a product against one: verifying
  // e(sig, g2) == e(H, pk) becomes e(sig, -g2) * e(H, pk) == 1, which is a single call.
  negG2Generator: "0x" + g2enc(bls.G2.ProjectivePoint.BASE.negate().toAffine()),
}, null, 2));
