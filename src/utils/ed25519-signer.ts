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

import { createHash, createPrivateKey, createPublicKey, sign, verify, KeyObject, hkdfSync } from 'crypto';
import { jcsCanonicalizeToBytes, base58btcEncode } from './jcs';
import {
  SOMA_HASH_ALGORITHM,
  signWithAlgorithm,
  SOMA_SIGNATURE_ALGORITHM,
  generateMlDsa65KeyPair,
  signMlDsa65,
  verifyMlDsa65,
  getCryptoAgilityMetadata,
} from './crypto-agility';

// ─── Ed25519 PKCS#8 DER header (RFC 8410) ─────────────────────────────────
// 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 + 32-byte seed
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// ─── HKDF Key Derivation (RFC 5869) ───────────────────────────────────────
// Replaces raw SHA-256(secret). Domain-separated, formally sound KDF.
// All files that need the platform signing secret import this function.

let _devWarned = false;

/**
 * Derive a 32-byte seed from PLATFORM_SIGNING_SECRET using HKDF-SHA256.
 * Domain separation ensures different key types produce independent keys.
 *
 * @param domain - Key purpose string (e.g., 'ed25519-platform', 'ml-dsa-65')
 * @returns 32-byte deterministic seed
 */
export function derivePlatformSeed(domain: string): Buffer {
  const secret = process.env.PLATFORM_SIGNING_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PLATFORM_SIGNING_SECRET is required in production — cannot derive signing keys');
    }
    if (!_devWarned) {
      console.warn('[WARN] PLATFORM_SIGNING_SECRET not set — using dev key. NOT FOR PRODUCTION.');
      _devWarned = true;
    }
    return Buffer.from(hkdfSync('sha256', 'clawnet-dev-only', '', `clawnet:${domain}:v1`, 32));
  }

  return Buffer.from(hkdfSync('sha256', secret, '', `clawnet:${domain}:v1`, 32));
}

// ─── Cached keypair ────────────────────────────────────────────────────────

let _privateKey: KeyObject | null = null;
let _publicKey: KeyObject | null = null;
let _publicKeyRaw: Buffer | null = null;

/**
 * Derive a deterministic Ed25519 keypair from the platform signing secret.
 * HKDF-SHA256(secret, 'clawnet:ed25519-platform:v1') -> 32-byte seed -> Ed25519 key.
 */
function ensureKeyPair(): void {
  if (_privateKey) return;

  const seed = derivePlatformSeed('ed25519-platform');

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
  _mlDsaKeys = null;
}

// ─── ML-DSA-65 Key Derivation (Post-Quantum) ────────────────────────────────
// Domain-separated seed: SHA-256(secret + ':ml-dsa-65') → 32-byte seed
// This ensures Ed25519 and ML-DSA keys are cryptographically independent.

let _mlDsaKeys: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;

/**
 * Derive a deterministic ML-DSA-65 keypair with domain separation.
 * Lazy-loaded — only initializes when PQ_SIGNATURES_ENABLED=true and first called.
 */
export async function ensureMlDsaKeyPair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  if (_mlDsaKeys) return _mlDsaKeys;

  const seed = derivePlatformSeed('ml-dsa-65');
  _mlDsaKeys = await generateMlDsa65KeyPair(seed);
  return _mlDsaKeys;
}

/**
 * Get the ML-DSA-65 public key (1952 bytes).
 */
export async function getMlDsa65PublicKey(): Promise<Uint8Array> {
  const keys = await ensureMlDsaKeyPair();
  return keys.publicKey;
}

// ─── Hybrid Signing (Ed25519 + ML-DSA-65) ───────────────────────────────────

export interface HybridSignature {
  version: '2.0';
  algorithms: ['Ed25519', 'ML-DSA-65'];
  ed25519: string;   // base64url
  mlDsa65: string;   // base64url
}

/**
 * Sign data with both Ed25519 and ML-DSA-65 (dual hybrid signature).
 * Both signatures are over the same SHA-256 hash of the canonicalized input.
 *
 * Verification rule: BOTH must pass (logical AND). Prevents downgrade attacks.
 */
export async function hybridSignVC(
  vcWithoutProof: Record<string, unknown>,
): Promise<HybridSignature> {
  ensureKeyPair();
  const canonical = jcsCanonicalizeToBytes(vcWithoutProof);
  const hash = createHash(SOMA_HASH_ALGORITHM).update(canonical).digest();

  // Ed25519 signature
  const edSig = signWithAlgorithm(SOMA_SIGNATURE_ALGORITHM, hash, _privateKey!);

  // ML-DSA-65 signature
  const mlDsaKeys = await ensureMlDsaKeyPair();
  const pqSig = await signMlDsa65(hash, mlDsaKeys.secretKey);

  return {
    version: '2.0',
    algorithms: ['Ed25519', 'ML-DSA-65'],
    ed25519: Buffer.from(edSig).toString('base64url'),
    mlDsa65: Buffer.from(pqSig).toString('base64url'),
  };
}

/**
 * Verify a hybrid signature. Both Ed25519 AND ML-DSA-65 must pass.
 */
export async function verifyHybridVCSignature(
  vcWithoutProof: Record<string, unknown>,
  hybrid: HybridSignature,
): Promise<boolean> {
  ensureKeyPair();
  try {
    const canonical = jcsCanonicalizeToBytes(vcWithoutProof);
    const hash = createHash(SOMA_HASH_ALGORITHM).update(canonical).digest();

    // Verify Ed25519
    const edValid = verify(null, hash, _publicKey!, Buffer.from(hybrid.ed25519, 'base64url'));
    if (!edValid) return false;

    // Verify ML-DSA-65
    const mlDsaKeys = await ensureMlDsaKeyPair();
    const pqValid = await verifyMlDsa65(
      Buffer.from(hybrid.mlDsa65, 'base64url'),
      hash,
      mlDsaKeys.publicKey,
    );
    return pqValid;
  } catch {
    return false;
  }
}

/**
 * Sign a VC using the current algorithm configuration.
 * If PQ_SIGNATURES_ENABLED, returns hybrid. Otherwise returns Ed25519-only.
 */
export async function signVCAdaptive(
  vcWithoutProof: Record<string, unknown>,
): Promise<{ signature: string; hybrid?: HybridSignature; algorithm: string }> {
  const pqEnabled = process.env.PQ_SIGNATURES_ENABLED === 'true' || process.env.PQ_SIGNATURES_ENABLED === '1';

  if (pqEnabled) {
    const hybrid = await hybridSignVC(vcWithoutProof);
    return {
      signature: hybrid.ed25519, // backward-compatible: Ed25519 sig is always available
      hybrid,
      algorithm: 'Ed25519+ML-DSA-65',
    };
  }

  return {
    signature: signVC(vcWithoutProof),
    algorithm: 'Ed25519',
  };
}
