/**
 * aid-verify.ts — AID Protocol middleware for Hono
 *
 * Verifies X-AID-DID, X-AID-PROOF, X-AID-TIMESTAMP, X-AID-NONCE headers
 * per the AID Protocol Specification (docs/aid-protocol-spec.md, Section 4).
 *
 * Sets c.set('aidInfo', { did, trustScore, verdict, ownerKey }) on success.
 * Returns 401/409/428 on verification failure.
 *
 * This middleware is OPTIONAL on routes — routes without it work as before.
 * When present, it enriches the request with AID identity + trust data.
 */

import { createMiddleware } from 'hono/factory';
import crypto from 'crypto';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { base58btcDecode } from '../utils/jcs';
import { getAidKey } from '../db/aid';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AidInfo {
  did: string;
  ownerKey: string;
  publicKeyMultibase: string;
  trustScore: number;
  verdict: string;
  verified: boolean;
}

// ─── Trust verdict from score ───────────────────────────────────────────────

function trustVerdict(score: number): string {
  if (score >= 90) return 'proceed';
  if (score >= 80) return 'trusted';
  if (score >= 60) return 'standard';
  if (score >= 40) return 'caution';
  if (score >= 20) return 'building';
  return 'new';
}

// ─── Ed25519 signature verification ─────────────────────────────────────────

function verifyEd25519Proof(
  did: string,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  bodyBytes: Buffer,
  proof: string,
  publicKeyMultibase: string,
): boolean {
  try {
    // Decode multibase public key (z prefix = base58btc, 0xed 0x01 = Ed25519)
    if (!publicKeyMultibase.startsWith('z')) return false;
    const decoded = base58btcDecode(publicKeyMultibase.slice(1));
    if (decoded.length < 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) return false;
    const rawPub = decoded.subarray(2);

    // Build SPKI DER for Ed25519 public key
    const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const spki = Buffer.concat([spkiHeader, rawPub]);
    const pubKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });

    // Reconstruct canonical signing input per spec Section 4.4:
    // SHA-384(did + "\n" + timestamp + "\n" + nonce + "\n" + method + " " + path + "\n" + SHA-384(body))
    const bodyHash = crypto.createHash(AID_HASH_ALGORITHM).update(bodyBytes).digest('hex');
    const signingString = `${did}\n${timestamp}\n${nonce}\n${method} ${path}\n${bodyHash}`;
    const signatureInput = crypto.createHash(AID_HASH_ALGORITHM).update(signingString).digest();

    // Verify Ed25519 signature
    const sigBytes = Buffer.from(proof, 'base64url');
    return crypto.verify(null, signatureInput, pubKey, sigBytes);
  } catch {
    return false;
  }
}

// ─── Nonce tracking (Redis-based, 5-minute window) ──────────────────────────

async function checkAndTrackNonce(nonce: string): Promise<boolean> {
  const key = `aid:nonce:${nonce}`;
  const existing = await cacheGet(key);
  if (existing !== null) return false; // duplicate
  await cacheSet(key, '1', 300); // 5-minute TTL
  return true;
}

// ─── Trust score lookup (cached) ────────────────────────────────────────────

async function getTrustScore(did: string): Promise<number> {
  const cacheKey = `aid:trust:${did}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== null) return Number(cached);

  // Look up from attestation stats
  try {
    const { getDb } = await import('../db/connection');
    const stats = getDb().prepare(`
      SELECT success_count, total_attestations, manifest_aligned, manifest_unaligned
      FROM attestation_stats WHERE owner_key = (
        SELECT owner_key FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1
      ) LIMIT 1
    `).get(did) as { success_count: number; total_attestations: number; manifest_aligned: number; manifest_unaligned: number } | undefined;

    if (!stats || stats.total_attestations === 0) {
      await cacheSet(cacheKey, '0', 300);
      return 0;
    }

    const successRate = stats.success_count / stats.total_attestations;
    const volume = Math.min(stats.total_attestations / 1000, 1);
    const manifestTotal = stats.manifest_aligned + stats.manifest_unaligned;
    const manifestAdherence = manifestTotal > 0 ? stats.manifest_aligned / manifestTotal : 0.5;

    // Simplified scoring (chainCoverage defaults to 0.5 for cached lookups)
    const score = Math.min(100, Math.round(
      successRate * 40 + 0.5 * 25 + volume * 20 + manifestAdherence * 15
    ));

    await cacheSet(cacheKey, String(score), 300);
    return score;
  } catch {
    return 0;
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * AID Protocol verification middleware.
 *
 * When X-AID-DID is present, verifies the full AID proof chain:
 * 1. Parse required headers (DID, PROOF, TIMESTAMP, NONCE)
 * 2. Validate timestamp within ±5 minutes
 * 3. Check nonce for replay (Redis, 5-minute TTL)
 * 4. Look up agent's public key from aid_keys table
 * 5. Verify Ed25519 signature over canonical signing input
 * 6. Resolve trust score and verdict
 * 7. Set c.set('aidInfo', ...) for downstream handlers
 *
 * When X-AID-DID is absent, passes through (AID is optional).
 */
export const checkAidProof = createMiddleware(async (c, next) => {
  const did = c.req.header('X-AID-DID');

  // AID headers are optional — pass through if absent
  if (!did) {
    await next();
    return;
  }

  // ── Validate required companion headers ──────────────────────────────────

  const proof = c.req.header('X-AID-PROOF');
  const timestamp = c.req.header('X-AID-TIMESTAMP');
  const nonce = c.req.header('X-AID-NONCE');

  if (!proof || !timestamp || !nonce) {
    return c.json({
      error: 'X-AID-DID present but missing required headers (X-AID-PROOF, X-AID-TIMESTAMP, X-AID-NONCE)',
      code: 'AID_PROOF_MISSING',
    }, 428);
  }

  // ── Validate timestamp (±5 minutes) ──────────────────────────────────────

  const now = Date.now();
  const ts = new Date(timestamp).getTime();
  if (isNaN(ts) || !timestamp.endsWith('Z')) {
    return c.json({ error: 'Invalid timestamp format (must be UTC with Z suffix)', code: 'AID_SIGNATURE_INVALID' }, 401);
  }
  if (Math.abs(now - ts) > 300_000) {
    return c.json({ error: 'Timestamp outside ±5 minute window', code: 'AID_SIGNATURE_INVALID' }, 401);
  }

  // ── Check nonce for replay ───────────────────────────────────────────────

  if (nonce.length !== 32 || !/^[0-9a-f]+$/i.test(nonce)) {
    return c.json({ error: 'Invalid nonce (must be 32 hex chars)', code: 'AID_SIGNATURE_INVALID' }, 401);
  }

  const nonceOk = await checkAndTrackNonce(nonce);
  if (!nonceOk) {
    return c.json({ error: 'Nonce already used', code: 'AID_NONCE_REPLAY' }, 409);
  }

  // ── Look up agent's public key ───────────────────────────────────────────

  const aidKey = getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'Unknown DID', code: 'AID_SIGNATURE_INVALID' }, 401);
  }

  // ── Verify Ed25519 signature ─────────────────────────────────────────────

  const method = c.req.method;
  const url = new URL(c.req.url);
  const path = url.pathname;
  const bodyBytes = Buffer.from(await c.req.text());

  const valid = verifyEd25519Proof(
    did, timestamp, nonce, method, path, bodyBytes,
    proof, aidKey.public_key_multibase,
  );

  if (!valid) {
    return c.json({ error: 'Ed25519 signature verification failed', code: 'AID_SIGNATURE_INVALID' }, 401);
  }

  // ── Resolve trust score ──────────────────────────────────────────────────

  const trustScore = await getTrustScore(did);
  const verdict = trustVerdict(trustScore);

  // ── Set AID info for downstream handlers ─────────────────────────────────

  const aidInfo: AidInfo = {
    did,
    ownerKey: aidKey.owner_key,
    publicKeyMultibase: aidKey.public_key_multibase,
    trustScore,
    verdict,
    verified: true,
  };

  c.set('aidInfo', aidInfo);

  logger.debug(`AID verified: ${did} score=${trustScore} verdict=${verdict}`);

  await next();
});
