/**
 * cache-certificate.ts — Certified Cache Layer (CCL)
 *
 * Every cache entry gets a Soma certificate that chains to the original
 * birth certificate. This makes cached data MORE trustworthy than direct
 * calls — triple provenance (provider → platform → cache).
 *
 * Cache Certificate structure:
 *   originalCert:  provider's birth certificate (from live fetch)
 *   cacheCert:     platform-signed attestation of cache integrity
 *   chainHash:     cryptographic binding of both certs
 *
 * Nobody else has this. CDNs don't do cryptographic provenance.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/connection';
import { somaHashJson } from '../utils/crypto-agility';
import { signVC, getEd25519PublicKeyRaw } from '../utils/ed25519-signer';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BirthCertData {
  dataHash: string;
  signature?: string;
  publicKey?: string;
  heartbeatIndex?: number;
}

export interface CacheCertificate {
  id: string;
  cacheKey: string;
  endpointId: string;
  originalCert: {
    dataHash: string;
    signature: string | null;
    publicKey: string | null;
    heartbeatIndex: number | null;
    timestamp: string;
  };
  cacheCert: {
    dataHash: string;
    cachedAt: string;
    freshUntil: string;
    servedCount: number;
    signature: string;
    publicKey: string;
    algorithm: string;
  };
  chainHash: string;
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * Create a cache certificate when data is cached after a live fetch.
 * Binds the original birth certificate to the cache entry with a platform co-signature.
 */
export function createCacheCertificate(opts: {
  cacheKey: string;
  endpointId: string;
  dataHash: string;
  ttlSeconds: number;
  birthCert?: BirthCertData | null;
}): CacheCertificate | null {
  try {
    const id = `cc-${nanoid(16)}`;
    const now = new Date();
    const freshUntil = new Date(now.getTime() + opts.ttlSeconds * 1000);
    const cachedAt = now.toISOString();
    const freshUntilStr = freshUntil.toISOString();

    // Build the payload that the platform signs — full context prevents replay
    const platformPublicKey = Buffer.from(getEd25519PublicKeyRaw()).toString('base64');
    const certPayload = {
      id,
      cacheKey: opts.cacheKey,
      endpointId: opts.endpointId,
      originalDataHash: opts.birthCert?.dataHash ?? opts.dataHash,
      cacheDataHash: opts.dataHash,
      cachedAt,
      freshUntil: freshUntilStr,
      signer: platformPublicKey,
    };

    // Platform signs the cert payload
    const platformSignature = signVC(certPayload);

    // Chain hash binds original + cache certs together (JCS-canonical for stability)
    const chainHash = somaHashJson({
      original: opts.birthCert?.dataHash ?? opts.dataHash,
      originalSig: opts.birthCert?.signature ?? null,
      cache: opts.dataHash,
      cacheSig: platformSignature,
      timestamp: cachedAt,
    });

    // Persist to DB
    getDb().prepare(`
      INSERT INTO cache_certificates (
        id, cache_key, endpoint_id,
        original_data_hash, original_signature, original_public_key, original_heartbeat_index, original_timestamp,
        cache_data_hash, cached_at, fresh_until, served_count,
        platform_signature, platform_public_key, chain_hash, algorithm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'Ed25519')
    `).run(
      id, opts.cacheKey, opts.endpointId,
      opts.birthCert?.dataHash ?? opts.dataHash,
      opts.birthCert?.signature ?? null,
      opts.birthCert?.publicKey ?? null,
      opts.birthCert?.heartbeatIndex ?? null,
      cachedAt,
      opts.dataHash, cachedAt, freshUntilStr,
      platformSignature, platformPublicKey, chainHash,
    );

    return {
      id,
      cacheKey: opts.cacheKey,
      endpointId: opts.endpointId,
      originalCert: {
        dataHash: opts.birthCert?.dataHash ?? opts.dataHash,
        signature: opts.birthCert?.signature ?? null,
        publicKey: opts.birthCert?.publicKey ?? null,
        heartbeatIndex: opts.birthCert?.heartbeatIndex ?? null,
        timestamp: cachedAt,
      },
      cacheCert: {
        dataHash: opts.dataHash,
        cachedAt,
        freshUntil: freshUntilStr,
        servedCount: 0,
        signature: platformSignature,
        publicKey: platformPublicKey,
        algorithm: 'Ed25519',
      },
      chainHash,
    };
  } catch (err) {
    logger.warn({ err, endpointId: opts.endpointId }, 'Failed to create cache certificate');
    return null;
  }
}

// ─── Lookup & Serve ─────────────────────────────────────────────────────────

/**
 * Get the active cache certificate for a cache key.
 * Increments served_count on each access.
 */
export function getCacheCertificate(cacheKey: string): CacheCertificate | null {
  const row = getDb().prepare(`
    SELECT * FROM cache_certificates
    WHERE cache_key = ? AND fresh_until > datetime('now')
    ORDER BY cached_at DESC LIMIT 1
  `).get(cacheKey) as any;

  if (!row) return null;

  // Increment served count (fire-and-forget)
  getDb().prepare('UPDATE cache_certificates SET served_count = served_count + 1 WHERE id = ?').run(row.id);

  return {
    id: row.id,
    cacheKey: row.cache_key,
    endpointId: row.endpoint_id,
    originalCert: {
      dataHash: row.original_data_hash,
      signature: row.original_signature,
      publicKey: row.original_public_key,
      heartbeatIndex: row.original_heartbeat_index,
      timestamp: row.original_timestamp,
    },
    cacheCert: {
      dataHash: row.cache_data_hash,
      cachedAt: row.cached_at,
      freshUntil: row.fresh_until,
      servedCount: row.served_count + 1,
      signature: row.platform_signature,
      publicKey: row.platform_public_key,
      algorithm: row.algorithm,
    },
    chainHash: row.chain_hash,
  };
}

/**
 * Lightweight hash lookup for Soma Check conditional checks.
 * Returns hash + freshness info without incrementing served_count.
 * Includes stale certs — the hash is still useful for comparison.
 */
export function getCacheHashInfo(cacheKey: string): {
  dataHash: string;
  cachedAt: string;
  freshUntil: string;
  fresh: boolean;
  age: number;
  certId: string;
  chainHash: string;
  endpointId: string;
} | null {
  const row = getDb().prepare(`
    SELECT id, endpoint_id, cache_data_hash, cached_at, fresh_until, chain_hash
    FROM cache_certificates
    WHERE cache_key = ?
    ORDER BY cached_at DESC LIMIT 1
  `).get(cacheKey) as any;

  if (!row) return null;

  const cachedAtMs = new Date(row.cached_at).getTime();
  const freshUntilMs = new Date(row.fresh_until).getTime();

  return {
    dataHash: row.cache_data_hash,
    cachedAt: row.cached_at,
    freshUntil: row.fresh_until,
    fresh: freshUntilMs > Date.now(),
    age: Math.round((Date.now() - cachedAtMs) / 1000),
    certId: row.id,
    chainHash: row.chain_hash,
    endpointId: row.endpoint_id,
  };
}

/**
 * Clean up expired cache certificates. Call periodically.
 */
export function pruneExpiredCacheCerts(): number {
  const result = getDb().prepare(
    "DELETE FROM cache_certificates WHERE fresh_until < datetime('now', '-1 hour')"
  ).run();
  return result.changes;
}
