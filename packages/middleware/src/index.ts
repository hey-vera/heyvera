/**
 * @aidprotocol/middleware — AID trust verification for any Node.js HTTP server
 *
 * Framework-agnostic core with thin adapters for Express and Fastify.
 * Verifies Ed25519 signatures, resolves trust scores, enforces trust gates.
 *
 * @example Express
 * ```typescript
 * import express from 'express';
 * import { aidTrust } from '@aidprotocol/middleware/express';
 *
 * const app = express();
 * app.use(aidTrust({ minTrustScore: 40 }));
 *
 * app.get('/data', (req, res) => {
 *   console.log(req.aidInfo?.trustScore); // 87
 *   res.json({ ok: true });
 * });
 * ```
 *
 * @example Fastify
 * ```typescript
 * import Fastify from 'fastify';
 * import { aidTrustPlugin } from '@aidprotocol/middleware/fastify';
 *
 * const app = Fastify();
 * app.register(aidTrustPlugin, { minTrustScore: 40 });
 *
 * app.get('/data', (req, reply) => {
 *   console.log(req.aidInfo?.trustScore); // 87
 *   reply.send({ ok: true });
 * });
 * ```
 *
 * @license MIT
 */

import { createHash, verify as cryptoVerify, createPublicKey } from 'crypto';
import { getTrustVerdict } from '@aidprotocol/trust-compute';
import type { TrustVerdictResult } from '@aidprotocol/trust-compute';

export type { TrustVerdictResult };
export { getTrustVerdict };

// ─── Configuration ──────────────────────────────────────────────────────────

export interface AidMiddlewareConfig {
  /** Minimum trust score required (0-100, default: 0 = allow all with valid AID) */
  minTrustScore?: number;

  /** ClawNet API URL for trust resolution (default: https://api.claw-net.org) */
  apiUrl?: string;

  /** Behavior when trust API is unreachable: 'closed' rejects, 'open' allows at score 0 (default: 'closed') */
  failMode?: 'closed' | 'open';

  /** Trust score cache TTL in seconds (default: 300) */
  cacheTtlSeconds?: number;

  /** Timestamp tolerance in seconds (default: 300 = ±5 minutes) */
  timestampToleranceSeconds?: number;

  /** Hash algorithm for signing input (default: 'sha384') */
  hashAlgorithm?: string;

  /** Called when a caller is rejected */
  onRejected?: (did: string, score: number, minRequired: number) => void;

  /** Called when trust is successfully verified */
  onVerified?: (did: string, score: number, verdict: string) => void;
}

// ─── AID Info (attached to request) ─────────────────────────────────────────

export interface AidInfo {
  /** Caller's DID (did:key:z...) */
  did: string;
  /** Trust score (0-100) */
  trustScore: number;
  /** Trust verdict (new, building, caution, standard, trusted, proceed) */
  verdict: string;
  /** Pricing discount (0-0.30) */
  discount: number;
  /** Settlement mode (immediate, standard, batched, deferred) */
  settlementMode: string;
  /** Whether signature was cryptographically verified */
  signatureVerified: boolean;
  /** Whether the score came from cache */
  cached: boolean;
}

// ─── Verification Result ────────────────────────────────────────────────────

export interface VerifyResult {
  ok: true;
  aidInfo: AidInfo;
}

export interface VerifyError {
  ok: false;
  status: number;
  error: string;
  code: string;
}

export type VerifyOutcome = VerifyResult | VerifyError;

// ─── Trust Cache ────────────────────────────────────────────────────────────

interface CacheEntry {
  score: number;
  verdict: string;
  expiresAt: number;
}

const trustCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 10_000;

function getCachedTrust(did: string): CacheEntry | null {
  const entry = trustCache.get(did);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    trustCache.delete(did);
    return null;
  }
  return entry;
}

function setCachedTrust(did: string, score: number, verdict: string, ttlMs: number): void {
  trustCache.set(did, { score, verdict, expiresAt: Date.now() + ttlMs });
  if (trustCache.size > MAX_CACHE_SIZE) {
    const oldest = trustCache.keys().next().value;
    if (oldest) trustCache.delete(oldest);
  }
}

// ─── Nonce Tracking (in-memory, 5-minute window) ────────────────────────────

const seenNonces = new Map<string, number>();
const NONCE_TTL_MS = 300_000;

function checkNonce(nonce: string): boolean {
  // Prune expired nonces periodically
  if (seenNonces.size > 50_000) {
    const now = Date.now();
    for (const [k, v] of seenNonces) {
      if (now > v) seenNonces.delete(k);
    }
  }

  if (seenNonces.has(nonce)) {
    const exp = seenNonces.get(nonce)!;
    if (Date.now() < exp) return false; // duplicate
    seenNonces.delete(nonce);
  }
  seenNonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return true;
}

// ─── Base58btc Decoding ─────────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcDecode(s: string): Uint8Array {
  const bytes: number[] = [];
  for (const c of s) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error(`Invalid base58btc character: ${c}`);
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading zeros
  for (const c of s) {
    if (c !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// ─── Ed25519 Signature Verification ─────────────────────────────────────────

function verifyEd25519Proof(
  did: string,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  bodyBytes: Buffer,
  proof: string,
  hashAlgorithm: string,
): boolean {
  try {
    // Extract public key from did:key
    // did:key:z{base58btc-encoded multicodec+key}
    const prefix = 'did:key:z';
    if (!did.startsWith(prefix)) return false;
    const decoded = base58btcDecode(did.slice(prefix.length));
    if (decoded.length < 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) return false;
    const rawPub = decoded.subarray(2);

    // Build SPKI DER for Ed25519
    const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const spki = Buffer.concat([spkiHeader, Buffer.from(rawPub)]);
    const pubKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });

    // Canonical signing input per AID spec Section 4.4
    const bodyHash = createHash(hashAlgorithm).update(bodyBytes).digest('hex');
    const signingString = `${did}\n${timestamp}\n${nonce}\n${method} ${path}\n${bodyHash}`;
    const signatureInput = createHash(hashAlgorithm).update(signingString).digest();

    const sigBytes = Buffer.from(proof, 'base64url');
    return cryptoVerify(null, signatureInput, pubKey, sigBytes);
  } catch {
    return false;
  }
}

// ─── Trust Resolution via API ───────────────────────────────────────────────

async function fetchTrust(
  did: string,
  apiUrl: string,
): Promise<{ score: number; verdict: string } | null> {
  try {
    const url = `${apiUrl}/v1/aid/${encodeURIComponent(did)}/trust`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return {
      score: data.trustScore ?? data.score ?? 0,
      verdict: data.verdict ?? 'new',
    };
  } catch {
    return null;
  }
}

// ─── Core Verification Function (Framework-Agnostic) ─────────────────────

/**
 * Verify an AID request. Call this from any HTTP framework.
 *
 * @param headers - Function to read a request header by name
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - URL pathname
 * @param bodyBytes - Raw request body as Buffer
 * @param config - Middleware configuration
 * @returns VerifyOutcome — either { ok: true, aidInfo } or { ok: false, status, error, code }
 */
export async function verifyAidRequest(
  headers: (name: string) => string | undefined,
  method: string,
  path: string,
  bodyBytes: Buffer,
  config: AidMiddlewareConfig = {},
): Promise<VerifyOutcome> {
  const {
    minTrustScore = 0,
    apiUrl = 'https://api.claw-net.org',
    failMode = 'closed',
    cacheTtlSeconds = 300,
    timestampToleranceSeconds = 300,
    hashAlgorithm = 'sha384',
    onRejected,
    onVerified,
  } = config;

  const did = headers('x-aid-did');

  // No AID headers = pass through (AID is optional)
  if (!did) {
    return { ok: false, status: 0, error: '', code: 'AID_NOT_PRESENT' };
  }

  const proof = headers('x-aid-proof');
  const timestamp = headers('x-aid-timestamp');
  const nonce = headers('x-aid-nonce');

  if (!proof || !timestamp || !nonce) {
    return {
      ok: false,
      status: 428,
      error: 'X-AID-DID present but missing required headers (X-AID-PROOF, X-AID-TIMESTAMP, X-AID-NONCE)',
      code: 'AID_PROOF_MISSING',
    };
  }

  // Validate timestamp
  const ts = new Date(timestamp).getTime();
  if (isNaN(ts) || !timestamp.endsWith('Z')) {
    return { ok: false, status: 401, error: 'Invalid timestamp format (must be UTC with Z suffix)', code: 'AID_SIGNATURE_INVALID' };
  }
  if (Math.abs(Date.now() - ts) > timestampToleranceSeconds * 1000) {
    return { ok: false, status: 401, error: `Timestamp outside ±${timestampToleranceSeconds}s window`, code: 'AID_SIGNATURE_INVALID' };
  }

  // Validate nonce format
  if (nonce.length !== 32 || !/^[0-9a-f]+$/i.test(nonce)) {
    return { ok: false, status: 401, error: 'Invalid nonce (must be 32 hex chars)', code: 'AID_SIGNATURE_INVALID' };
  }

  // Check nonce replay
  if (!checkNonce(nonce)) {
    return { ok: false, status: 409, error: 'Nonce already used', code: 'AID_NONCE_REPLAY' };
  }

  // Verify Ed25519 signature (self-certifying — public key extracted from DID)
  const signatureValid = verifyEd25519Proof(
    did, timestamp, nonce, method, path, bodyBytes, proof, hashAlgorithm,
  );

  if (!signatureValid) {
    return { ok: false, status: 401, error: 'Ed25519 signature verification failed', code: 'AID_SIGNATURE_INVALID' };
  }

  // Resolve trust score (cache → API)
  let score = 0;
  let verdict = 'new';
  let cached = false;

  const cachedEntry = getCachedTrust(did);
  if (cachedEntry) {
    score = cachedEntry.score;
    verdict = cachedEntry.verdict;
    cached = true;
  } else {
    const apiResult = await fetchTrust(did, apiUrl);
    if (apiResult) {
      score = apiResult.score;
      verdict = apiResult.verdict;
      setCachedTrust(did, score, verdict, cacheTtlSeconds * 1000);
    } else if (failMode === 'closed') {
      return { ok: false, status: 503, error: 'Trust API unreachable', code: 'AID_TRUST_UNAVAILABLE' };
    }
    // failMode 'open': proceed with score 0
  }

  // Check trust gate
  if (score < minTrustScore) {
    if (onRejected) onRejected(did, score, minTrustScore);
    return {
      ok: false,
      status: 403,
      error: `Trust score ${score} below minimum ${minTrustScore}`,
      code: 'AID_TRUST_GATE_BLOCKED',
    };
  }

  const verdictResult = getTrustVerdict(score);
  if (onVerified) onVerified(did, score, verdictResult.verdict);

  return {
    ok: true,
    aidInfo: {
      did,
      trustScore: score,
      verdict: verdictResult.verdict,
      discount: verdictResult.discount,
      settlementMode: verdictResult.settlementMode,
      signatureVerified: true,
      cached,
    },
  };
}

/**
 * Clear the in-memory trust cache and nonce tracker.
 */
export function clearAidCache(): void {
  trustCache.clear();
  seenNonces.clear();
}
