/**
 * ed25519-signer.ts — Deterministic Ed25519 signing for W3C Verifiable Credentials
 *
 * Derives a stable Ed25519 keypair from PLATFORM_SIGNING_SECRET using Node's
 * built-in crypto module. The same secret always produces the same keypair,
 * so the public key in did.json matches across restarts.
 *
 * Uses the eddsa-jcs-2022 cryptosuite pattern:
 *   1. Canonicalize the VC (without proof) using JCS (RFC 8785)
 *   2. SHA-256 hash the canonical form
 *   3. Sign the hash with Ed25519
 *
 * No external dependencies — pure Node.js crypto.
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify, KeyObject } from 'crypto';
import { jcsCanonicalizeToBytes, base58btcEncode } from './jcs';
import { SOMA_HASH_ALGORITHM, signWithAlgorithm, SOMA_SIGNATURE_ALGORITHM } from './crypto-agility';

// ─── Ed25519 PKCS#8 DER header (RFC 8410) ─────────────────────────────────
// 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 + 32-byte seed
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// ─── Cached keypair ────────────────────────────────────────────────────────

let _privateKey: KeyObject | null = null;
let _publicKey: KeyObject | null = null;
let _publicKeyRaw: Buffer | null = null;

/**
 * Derive a deterministic Ed25519 keypair from the platform signing secret.
 * SHA-256(secret) -> 32-byte seed -> Ed25519 private key via PKCS#8 DER import.
 */
function ensureKeyPair(): void {
  if (_privateKey) return;

  const secret = process.env.PLATFORM_SIGNING_SECRET || 'clawnet-dev';
  const seed = createHash('sha256').update(secret).digest().subarray(0, 32);

  // Build PKCS#8 DER: fixed header + 32-byte Ed25519 seed
  const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);

  _privateKey = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  _publicKey = createPublicKey(_privateKey);

  // Extract raw 32-byte public key from SPKI DER (12-byte header + 32-byte key)
  const spki = _publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  _publicKeyRaw = Buffer.from(spki.subarray(12));
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Get the raw 32-byte Ed25519 public key.
 */
export function getEd25519PublicKeyRaw(): Buffer {
  ensureKeyPair();
  return _publicKeyRaw!;
}

/**
 * Get the public key as Multibase base58btc with the Multikey ed25519-pub prefix (0xed 0x01).
 * This is the format used in did.json verificationMethod.publicKeyMultibase.
 */
export function getEd25519PublicKeyMultibase(): string {
  const raw = getEd25519PublicKeyRaw();
  // Multikey prefix for Ed25519 public key: 0xed 0x01
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), raw]);
  return 'z' + base58btcEncode(prefixed);
}

/**
 * Sign a VC (without proof) using Ed25519. Returns the signature as base64url.
 *
 * Process (eddsa-jcs-2022 pattern, upgraded to SHA-256):
 *   1. JCS-canonicalize the VC object (RFC 8785 — deterministic JSON)
 *   2. SHA-256 hash the canonical bytes (quantum-resistant)
 *   3. Ed25519-sign the hash (algorithm-agile via crypto-agility module)
 */
export function signVC(vcWithoutProof: Record<string, unknown>): string {
  ensureKeyPair();
  const canonical = jcsCanonicalizeToBytes(vcWithoutProof);
  const hash = createHash(SOMA_HASH_ALGORITHM).update(canonical).digest();
  const signature = signWithAlgorithm(SOMA_SIGNATURE_ALGORITHM, hash, _privateKey!);
  return signature.toString('base64url');
}

/**
 * Verify an Ed25519 signature on a VC. Algorithm-agile — reads algorithm from doc.
 */
export function verifyVCSignature(vcWithoutProof: Record<string, unknown>, proofValue: string): boolean {
  ensureKeyPair();
  try {
    const canonical = jcsCanonicalizeToBytes(vcWithoutProof);
    const hash = createHash(SOMA_HASH_ALGORITHM).update(canonical).digest();
    return verify(null, hash, _publicKey!, Buffer.from(proofValue, 'base64url'));
  } catch {
    return false;
  }
}

/**
 * Reset cached keypair (for testing only).
 */
export function resetKeyPair(): void {
  _privateKey = null;
  _publicKey = null;
  _publicKeyRaw = null;
}
