/**
 * aid-enrich.ts — Optional AID trust enrichment for ClawNet product routes
 *
 * When a caller sends X-AID-DID + X-AID-PROOF alongside their X-API-Key,
 * this middleware verifies the AID identity and sets trust data on the context.
 * Product route handlers can then apply trust-gated pricing discounts.
 *
 * CRITICAL: This middleware is OPTIONAL and FAIL-THROUGH. If AID verification
 * fails for any reason (missing headers, invalid sig, Redis down, trust API error),
 * the request continues with aidInfo = undefined (base pricing). A paying customer
 * with a valid API key is NEVER blocked because the AID layer had a hiccup.
 *
 * This is the "progressive enhancement" pattern:
 * - API key auth = REQUIRED (blocks if fails) — handled by checkApiKey
 * - AID enrichment = OPTIONAL (falls through if fails) — handled here
 *
 * Do NOT use this on /aid/* protocol routes — those use checkAidProof (required).
 * Do NOT put credit checks here — this only resolves trust, never bills.
 */

import { createMiddleware } from 'hono/factory';
import crypto from 'crypto';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { base58btcDecode } from '../utils/jcs';
import { getAidKey } from '../db/aid';
import { cacheGet, cacheSet } from '../cache/index';
import { logger } from '../utils/logger';
import type { AidInfo } from './aid-verify';

const PLATFORM_DID = 'did:web:api.claw-net.org';

// ─── Trust verdict from score ───────────────────────────────────────────────

function trustVerdict(score: number): string {
  if (score >= 90) return 'proceed';
  if (score >= 80) return 'trusted';
  if (score >= 60) return 'standard';
  if (score >= 40) return 'caution';
  if (score >= 20) return 'building';
  return 'new';
}

// ─── Trust score lookup (cached) ────────────────────────────────────────────

async function getTrustScore(did: string): Promise<number> {
  const cacheKey = `aid:trust:${did}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== null) return Number(cached);

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
 * Optional AID enrichment for product routes.
 *
 * If X-AID-DID is present and verification succeeds → sets c.set('aidInfo', {...})
 * If X-AID-DID is absent or verification fails → continues with aidInfo = undefined
 *
 * NEVER returns an error response. NEVER blocks a request. Always falls through.
 */
export const aidEnrich = createMiddleware(async (c, next) => {
  const did = c.req.header('X-AID-DID');

  // No AID headers → continue with base pricing (existing behavior)
  if (!did) {
    await next();
    return;
  }

  try {
    const proof = c.req.header('X-AID-PROOF');
    const timestamp = c.req.header('X-AID-TIMESTAMP');
    const nonce = c.req.header('X-AID-NONCE');

    // Missing companion headers → skip enrichment silently
    if (!proof || !timestamp || !nonce) {
      logger.debug(`AID enrich: ${did} missing companion headers, skipping`);
      await next();
      return;
    }

    // Validate timestamp (±5 minutes)
    const now = Date.now();
    const ts = new Date(timestamp).getTime();
    if (isNaN(ts) || !timestamp.endsWith('Z') || Math.abs(now - ts) > 300_000) {
      logger.debug(`AID enrich: ${did} invalid timestamp, skipping`);
      await next();
      return;
    }

    // Validate nonce format
    if (nonce.length !== 32 || !/^[0-9a-f]+$/i.test(nonce)) {
      logger.debug(`AID enrich: ${did} invalid nonce, skipping`);
      await next();
      return;
    }

    // Look up agent's public key
    const aidKey = getAidKey(did);
    if (!aidKey) {
      logger.debug(`AID enrich: ${did} unknown DID, skipping`);
      await next();
      return;
    }

    // Verify Ed25519 signature
    const method = c.req.method;
    const url = new URL(c.req.url);
    const path = url.pathname;
    const bodyBytes = Buffer.from(await c.req.text());

    // Build canonical signing input (must match aid-verify.ts)
    const bodyHash = crypto.createHash(AID_HASH_ALGORITHM).update(bodyBytes).digest('hex');
    const signingString = `${did}\n${PLATFORM_DID}\n${timestamp}\n${nonce}\n${method} ${path}\n${bodyHash}`;
    const signatureInput = crypto.createHash(AID_HASH_ALGORITHM).update(signingString).digest();

    // Decode multibase public key
    if (!aidKey.public_key_multibase.startsWith('z')) {
      await next();
      return;
    }
    const decoded = base58btcDecode(aidKey.public_key_multibase.slice(1));
    if (decoded.length < 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
      await next();
      return;
    }
    const rawPub = decoded.subarray(2);

    const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const spki = Buffer.concat([spkiHeader, rawPub]);
    const pubKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });

    const sigBytes = Buffer.from(proof, 'base64url');
    const valid = crypto.verify(null, signatureInput, pubKey, sigBytes);

    if (!valid) {
      logger.debug(`AID enrich: ${did} signature invalid, skipping`);
      await next();
      return;
    }

    // Signature verified — resolve trust score and set context
    const trustScore = await getTrustScore(did);
    const verdict = trustVerdict(trustScore);

    const aidInfo: AidInfo = {
      did,
      ownerKey: aidKey.owner_key,
      publicKeyMultibase: aidKey.public_key_multibase,
      trustScore,
      verdict,
      verified: true,
    };

    c.set('aidInfo', aidInfo);
    logger.debug(`AID enrich: ${did} score=${trustScore} verdict=${verdict}`);
  } catch (err) {
    // ANY error → fall through silently. AID enrichment must never break product routes.
    logger.warn(`AID enrich failed for ${did}, continuing without trust data: ${err}`);
  }

  await next();
});
