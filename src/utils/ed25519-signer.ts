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

// ─── Ed25519 PKCS#8 DER header (RFC 8410) ─────────────────────────────────
// 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 + 32-byte seed
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// ─── Cached keypair ────────────────────────────────────────────────────────

let _privateKey: KeyObject | null = null;
let _publicKey: KeyObject | null = null;
let _publicKeyRaw: Buffer | null = null;

/**
 * Derive a deterministic Ed25519 keypair from the platform signing secret.
 * SHA-256(secret) → 32-byte seed → Ed25519 private key via PKCS#8 DER import.
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
 * Process (eddsa-jcs-2022 pattern):
 *   1. JCS-canonicalize the VC object (RFC 8785 — deterministic JSON)
 *   2. SHA-256 hash the canonical bytes
 *   3. Ed25519-sign the hash
 */
export function signVC(vcWithoutProof: Record<string, unknown>): string {
  ensureKeyPair();
  const canonical = jcsCanonicalizeToBytes(vcWithoutProof);
  const hash = createHash('sha256').update(canonical).digest();
  const signature = sign(null, hash, _privateKey!);
  return Buffer.from(signature).toString('base64url');
}

/**
 * Verify an Ed25519 signature on a VC.
 */
export function verifyVCSignature(vcWithoutProof: Record<string, unknown>, proofValue: string): boolean {
  ensureKeyPair();
  try {
    const canonical = jcsCanonicalizeToBytes(vcWithoutProof);
    const hash = createHash('sha256').update(canonical).digest();
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

// ─── JCS (RFC 8785) ───────────────────────────────────────────────────────
//
// JSON Canonicalization Scheme: deterministic JSON serialization.
// - Object keys sorted lexicographically (Unicode code point order)
// - No whitespace
// - Numbers serialized per ES2015 Number.toString()
// - Recursive for nested objects/arrays
// - null, boolean, string serialized normally

function jcsSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('JCS: non-finite numbers not supported');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(jcsSerialize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter(k => obj[k] !== undefined) // skip undefined (per JSON.stringify)
      .sort(); // lexicographic (Unicode code point order)
    const entries = keys.map(k => JSON.stringify(k) + ':' + jcsSerialize(obj[k]));
    return '{' + entries.join(',') + '}';
  }
  // undefined at top level → empty string (shouldn't happen in practice)
  return '';
}

function jcsCanonicalizeToBytes(obj: Record<string, unknown>): Buffer {
  return Buffer.from(jcsSerialize(obj), 'utf8');
}

// ─── Base58btc encoding ──────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(buf: Buffer): string {
  let num = BigInt('0x' + buf.toString('hex'));
  let encoded = '';
  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  // Preserve leading zero bytes
  for (const byte of buf) {
    if (byte === 0) encoded = '1' + encoded;
    else break;
  }
  return encoded;
}
