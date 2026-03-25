/**
 * AID-native authentication middleware for Hono.
 *
 * Verifies X-AID-DID + X-AID-PROOF + X-AID-TIMESTAMP + X-AID-NONCE
 * using Ed25519 signatures per AID-Trust spec Section 5.3.
 *
 * This is PROTOCOL-LEVEL auth — independent of ClawNet's API key system.
 * Implements the same logic as @aidprotocol/middleware's verifyAidRequest().
 */

import { createMiddleware } from 'hono/factory';
import crypto from 'crypto';
import { base58btcDecode } from '../utils/jcs';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { logger } from '../utils/logger';

// ─── Constants ──────────────────────────────────────────────────────────────

const TIMESTAMP_TOLERANCE_MS = 300_000; // ±5 minutes
const NONCE_TTL_SECONDS = 300; // 5-minute replay window
const HASH_ALGORITHM = 'sha256';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AidProofInfo {
  /** Caller's DID (did:key:z...) */
  did: string;
  /** Whether Ed25519 signature was verified */
  signatureVerified: boolean;
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
): boolean {
  try {
    // Extract raw public key from did:key
    const prefix = 'did:key:z';
    if (!did.startsWith(prefix)) return false;
    const decoded = base58btcDecode(did.slice(prefix.length));
    if (decoded.length < 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) return false;
    const rawPub = decoded.subarray(2);

    // Build SPKI DER for Ed25519
    const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const spki = Buffer.concat([spkiHeader, Buffer.from(rawPub)]);
    const pubKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });

    // Canonical signing input per spec Section 5.3
    const bodyHash = crypto.createHash(HASH_ALGORITHM).update(bodyBytes).digest('hex');
    const signingString = `${did}\n${timestamp}\n${nonce}\n${method} ${path}\n${bodyHash}`;
    const signatureInput = crypto.createHash(HASH_ALGORITHM).update(signingString).digest();

    const sigBytes = Buffer.from(proof, 'base64url');
    return crypto.verify(null, signatureInput, pubKey, sigBytes);
  } catch {
    return false;
  }
}

// ─── Middleware: checkAidProof ───────────────────────────────────────────────

/**
 * Verify AID-native authentication headers.
 * Sets c.set('aidProofInfo', { did, signatureVerified }) on success.
 *
 * Returns AID-spec error codes:
 *   428 AID_PROOF_MISSING — X-AID-DID present but proof headers missing
 *   401 AID_SIGNATURE_INVALID — signature verification failed
 *   409 AID_NONCE_REPLAY — nonce already seen
 */
export const checkAidProof = createMiddleware(async (c, next) => {
  const did = c.req.header('x-aid-did');

  if (!did) {
    return c.json({
      error: 'X-AID-DID header required',
      code: 'AID_PROOF_MISSING',
    }, 428);
  }

  const proof = c.req.header('x-aid-proof');
  const timestamp = c.req.header('x-aid-timestamp');
  const nonce = c.req.header('x-aid-nonce');

  if (!proof || !timestamp || !nonce) {
    return c.json({
      error: 'Missing required AID headers (X-AID-PROOF, X-AID-TIMESTAMP, X-AID-NONCE)',
      code: 'AID_PROOF_MISSING',
    }, 428);
  }

  // Validate timestamp format (must be UTC with Z suffix)
  if (!timestamp.endsWith('Z')) {
    return c.json({
      error: 'Timestamp must be UTC with Z suffix',
      code: 'AID_SIGNATURE_INVALID',
    }, 401);
  }

  const ts = new Date(timestamp).getTime();
  if (isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
    return c.json({
      error: `Timestamp outside ±${TIMESTAMP_TOLERANCE_MS / 1000}s window`,
      code: 'AID_SIGNATURE_INVALID',
    }, 401);
  }

  // Validate nonce format (32 hex chars = 16 bytes)
  if (nonce.length !== 32 || !/^[0-9a-f]+$/i.test(nonce)) {
    return c.json({
      error: 'Nonce must be 32 hex characters (16 random bytes)',
      code: 'AID_SIGNATURE_INVALID',
    }, 401);
  }

  // Check nonce replay via Redis cache
  const nonceKey = `aid:nonce:${nonce}`;
  const existing = await cacheGet(nonceKey);
  if (existing) {
    return c.json({
      error: 'Nonce already used',
      code: 'AID_NONCE_REPLAY',
    }, 409);
  }
  await cacheSet(nonceKey, '1', NONCE_TTL_SECONDS);

  // Verify Ed25519 signature
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const bodyBytes = Buffer.from(await c.req.text());

  const valid = verifyEd25519Proof(did, timestamp, nonce, method, path, bodyBytes, proof);
  if (!valid) {
    return c.json({
      error: 'Ed25519 signature verification failed',
      code: 'AID_SIGNATURE_INVALID',
    }, 401);
  }

  // Attach AID info to context
  c.set('aidProofInfo', { did, signatureVerified: true } as AidProofInfo);

  logger.debug({ did }, 'AID proof verified');
  await next();
});

// ─── Middleware: checkAidNew ─────────────────────────────────────────────────

/**
 * Allow unauthenticated registration via X-AID-NEW header.
 * Rate limited by IP: 3 per 24h per spec Section 3.5.
 */
export const checkAidNew = createMiddleware(async (c, next) => {
  const aidNew = c.req.header('x-aid-new');

  if (!aidNew) {
    return c.json({
      error: 'X-AID-NEW header required for public registration',
      code: 'AID_PROOF_MISSING',
    }, 428);
  }

  // Validate agent name format (1-63 chars, alphanumeric + hyphen + underscore)
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(aidNew)) {
    return c.json({
      error: 'Agent name must be 1-63 characters (alphanumeric, hyphen, underscore)',
      code: 'INVALID_BODY',
    }, 400);
  }

  // Rate limit by IP: 3 per 24h
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';
  const rateLimitKey = `aid:new:${ip}`;
  const count = await cacheIncr(rateLimitKey, 86400); // 24h window
  if (count > 3) {
    return c.json({
      error: 'Rate limit exceeded: 3 AIDs per IP per 24 hours',
      code: 'AID_RATE_LIMITED',
    }, 429);
  }

  // Attach the agent name for the route handler
  c.set('aidNewName', aidNew);

  await next();
});

// ─── Middleware: checkAidProofOrApiKey ────────────────────────────────────────

/**
 * Accept EITHER AID-native auth (X-AID-DID + X-AID-PROOF) OR ClawNet API key.
 * This allows ClawNet customers to use their existing API keys while
 * external AID implementations use protocol-native auth.
 */
export const checkAidProofOrApiKey = createMiddleware(async (c, next) => {
  const hasDid = !!c.req.header('x-aid-did');
  const hasApiKey = !!c.req.header('x-api-key');

  if (hasDid) {
    // Use AID-native auth
    return checkAidProof(c, next);
  } else if (hasApiKey) {
    // Fall through to ClawNet's checkApiKey — caller must chain this middleware
    await next();
  } else {
    return c.json({
      error: 'Authentication required: provide X-AID-DID + X-AID-PROOF or X-API-Key',
      code: 'AID_PROOF_MISSING',
    }, 428);
  }
});
