/**
 * zktls.ts — zkTLS Verification Layer via Reclaim Protocol
 *
 * Proves at the TLS layer that upstream API data actually came from the
 * claimed server — without revealing API keys or session details.
 *
 * This is Layer 1 of the five-layer trust stack:
 *   1. zkTLS (Reclaim) — proves data came from the server's TLS certificate
 *   2. Provider Soma cert — proves provider processed it authentically
 *   3. Platform Soma cert — proves platform relayed without tampering
 *   4. PQ hybrid signature — quantum-resistant durability
 *   5. EAS on-chain anchor — immutable public record on Base
 *
 * Opt-in per call: { "zktls": true } in request body, or per endpoint
 * via registry flag. Adds ~200-500ms latency due to attestor round-trip.
 *
 * Requires:
 *   - npm install @reclaimprotocol/zk-fetch @reclaimprotocol/js-sdk
 *   - node node_modules/@reclaimprotocol/zk-fetch/scripts/download-files
 *   - RECLAIM_APP_ID + RECLAIM_APP_SECRET from dev.reclaimprotocol.org
 *   - ZKTLS_ENABLED=true in .env
 */

import { logger } from '../utils/logger';
import { env } from '../config/index';
import { somaHash } from '../utils/crypto-agility';
import { getDb, logAudit } from '../db/connection';
import { nanoid } from 'nanoid';

// ─── Lazy-loaded Reclaim SDK (optional dependency) ──────────────────────────

let _reclaimClient: any = null;
let _verifyProof: any = null;
let _sdkAvailable: boolean | null = null;

async function getReclaimClient(): Promise<any | null> {
  if (_reclaimClient) return _reclaimClient;
  if (_sdkAvailable === false) return null;

  try {
    const { ReclaimClient } = await import('@reclaimprotocol/zk-fetch');
    _reclaimClient = new ReclaimClient(
      env.RECLAIM_APP_ID!,
      env.RECLAIM_APP_SECRET!,
    );
    _sdkAvailable = true;
    logger.info('zkTLS: Reclaim client initialized');
    return _reclaimClient;
  } catch (err: any) {
    _sdkAvailable = false;
    logger.warn({ err: err.message }, 'zkTLS: @reclaimprotocol/zk-fetch not installed — zkTLS disabled');
    return null;
  }
}

async function getVerifyProof(): Promise<any | null> {
  if (_verifyProof) return _verifyProof;
  try {
    const sdk = await import('@reclaimprotocol/js-sdk');
    _verifyProof = sdk.verifyProof;
    return _verifyProof;
  } catch {
    return null;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ZkTlsProof {
  id: string;
  /** The URL that was fetched */
  url: string;
  /** SHA-256 hash of the response data */
  responseHash: string;
  /** Reclaim proof identifier */
  proofIdentifier: string;
  /** Full proof JSON (for independent verification) */
  proofJson: string;
  /** Attestor witness URLs */
  witnesses: string[];
  /** Whether the proof passed verification */
  verified: boolean;
  /** Epoch from the claim */
  epoch: number;
  /** Timestamp from the claim */
  claimTimestamp: number;
  /** Creation time */
  createdAt: string;
}

export interface ZkTlsFetchResult {
  /** The response data */
  data: string;
  /** The zkTLS proof (null if proof generation failed but data was retrieved) */
  proof: ZkTlsProof | null;
  /** Response headers from upstream */
  headers: Record<string, string>;
}

// ─── Status check ───────────────────────────────────────────────────────────

/** Check whether zkTLS is configured and available */
export function isZkTlsEnabled(): boolean {
  return !!(env.ZKTLS_ENABLED && env.RECLAIM_APP_ID && env.RECLAIM_APP_SECRET);
}

/** Get zkTLS status for health checks */
export function getZkTlsStatus(): {
  enabled: boolean;
  configured: boolean;
  sdkInstalled: boolean | null;
} {
  return {
    enabled: !!env.ZKTLS_ENABLED,
    configured: !!(env.RECLAIM_APP_ID && env.RECLAIM_APP_SECRET),
    sdkInstalled: _sdkAvailable,
  };
}

// ─── Core: zkTLS-verified fetch ─────────────────────────────────────────────

/**
 * Fetch a URL with zkTLS proof of origin.
 *
 * The response comes with a cryptographic proof that the data originated
 * from the target server's TLS certificate. The proof is independently
 * verifiable by anyone using Reclaim's verifyProof().
 *
 * Secret headers (API keys, auth tokens) are hidden from the attestor
 * via ZK circuits — only the response data is attested.
 */
export async function zkTlsFetch(
  url: string,
  opts?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** Headers containing secrets (API keys) — hidden from attestor */
    secretHeaders?: Record<string, string>;
    /** Regex to extract specific data from response */
    responseMatch?: string;
    /** Max retries for proof generation */
    retries?: number;
  },
): Promise<ZkTlsFetchResult | null> {
  if (!isZkTlsEnabled()) {
    logger.debug('zkTLS: not enabled, skipping');
    return null;
  }

  const client = await getReclaimClient();
  if (!client) return null;

  const start = Date.now();

  try {
    // Split headers into public (visible to attestor) and secret (hidden via ZK)
    const publicHeaders: Record<string, string> = {
      'Accept': 'application/json',
      ...(opts?.headers ?? {}),
    };

    const secretOptions: Record<string, unknown> = {};
    if (opts?.secretHeaders) {
      secretOptions.headers = opts.secretHeaders;
    }
    if (opts?.responseMatch) {
      secretOptions.responseMatches = [{ type: 'regex', value: opts.responseMatch }];
    }

    // Call through Reclaim's zkFetch — routes through attestor node
    const proof = await client.zkFetch(
      url,
      {
        method: opts?.method ?? 'GET',
        headers: publicHeaders,
        body: opts?.body,
      },
      Object.keys(secretOptions).length > 0 ? secretOptions : undefined,
      opts?.retries ?? 2,
      2000,
    );

    if (!proof) {
      logger.warn({ url, durationMs: Date.now() - start }, 'zkTLS: proof generation returned null');
      return null;
    }

    // Extract response data from the proof
    const responseData = proof.extractedParameterValues?.data
      ?? proof.claimData?.context
      ?? JSON.stringify(proof.extractedParameterValues ?? {});

    const responseHash = somaHash(responseData);

    // Verify the proof
    const verify = await getVerifyProof();
    let verified = false;
    if (verify) {
      try {
        const result = await verify(proof);
        verified = result?.isVerified ?? false;
      } catch (verifyErr) {
        logger.warn({ err: verifyErr }, 'zkTLS: proof verification failed');
      }
    }

    // Build the proof record
    const zkProof: ZkTlsProof = {
      id: `zkp-${nanoid(16)}`,
      url,
      responseHash,
      proofIdentifier: proof.identifier ?? proof.claimData?.identifier ?? nanoid(12),
      proofJson: JSON.stringify(proof),
      witnesses: (proof.witnesses ?? []).map((w: any) => w.url ?? w.id ?? String(w)),
      verified,
      epoch: proof.claimData?.epoch ?? 0,
      claimTimestamp: proof.claimData?.timestampS ?? Math.floor(Date.now() / 1000),
      createdAt: new Date().toISOString(),
    };

    // Store in DB
    storeZkTlsProof(zkProof);

    const durationMs = Date.now() - start;
    logger.info({
      url: url.replace(/\?.*/, '?...'),
      verified,
      durationMs,
      proofId: zkProof.id,
    }, 'zkTLS: proof generated');

    return {
      data: responseData,
      proof: zkProof,
      headers: {},
    };
  } catch (err: any) {
    logger.error({ err: err.message, url, durationMs: Date.now() - start }, 'zkTLS: fetch failed');
    return null;
  }
}

// ─── Proof verification (for consumers) ─────────────────────────────────────

/**
 * Verify a stored zkTLS proof. Returns true if the proof is valid.
 * Can be called by anyone with the proof JSON.
 */
export async function verifyZkTlsProof(proofJson: string): Promise<{
  verified: boolean;
  error?: string;
}> {
  const verify = await getVerifyProof();
  if (!verify) {
    return { verified: false, error: 'Reclaim SDK not installed' };
  }

  try {
    const proof = JSON.parse(proofJson);
    const result = await verify(proof);
    return { verified: result?.isVerified ?? false };
  } catch (err: any) {
    return { verified: false, error: err.message };
  }
}

// ─── DB storage ─────────────────────────────────────────────────────────────

function storeZkTlsProof(proof: ZkTlsProof): void {
  try {
    getDb().prepare(`
      INSERT INTO zktls_proofs (id, url, response_hash, proof_identifier, proof_json,
        witnesses_json, verified, epoch, claim_timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proof.id,
      proof.url,
      proof.responseHash,
      proof.proofIdentifier,
      proof.proofJson,
      JSON.stringify(proof.witnesses),
      proof.verified ? 1 : 0,
      proof.epoch,
      proof.claimTimestamp,
      proof.createdAt,
    );
  } catch (err) {
    logger.warn({ err, proofId: proof.id }, 'zkTLS: failed to store proof');
  }
}

/** Look up a zkTLS proof by ID */
export function getZkTlsProof(proofId: string): ZkTlsProof | null {
  const row = getDb().prepare('SELECT * FROM zktls_proofs WHERE id = ?').get(proofId) as any;
  if (!row) return null;

  return {
    id: row.id,
    url: row.url,
    responseHash: row.response_hash,
    proofIdentifier: row.proof_identifier,
    proofJson: row.proof_json,
    witnesses: JSON.parse(row.witnesses_json || '[]'),
    verified: !!row.verified,
    epoch: row.epoch,
    claimTimestamp: row.claim_timestamp,
    createdAt: row.created_at,
  };
}

/** Get proof by response hash (for linking to soma receipts) */
export function getZkTlsProofByHash(responseHash: string): ZkTlsProof | null {
  const row = getDb().prepare('SELECT * FROM zktls_proofs WHERE response_hash = ? ORDER BY created_at DESC LIMIT 1')
    .get(responseHash) as any;
  if (!row) return null;

  return {
    id: row.id,
    url: row.url,
    responseHash: row.response_hash,
    proofIdentifier: row.proof_identifier,
    proofJson: row.proof_json,
    witnesses: JSON.parse(row.witnesses_json || '[]'),
    verified: !!row.verified,
    epoch: row.epoch,
    claimTimestamp: row.claim_timestamp,
    createdAt: row.created_at,
  };
}

/** Get recent proofs for admin/stats */
export function getRecentZkTlsProofs(limit = 50): ZkTlsProof[] {
  const rows = getDb().prepare('SELECT * FROM zktls_proofs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    url: row.url,
    responseHash: row.response_hash,
    proofIdentifier: row.proof_identifier,
    proofJson: row.proof_json,
    witnesses: JSON.parse(row.witnesses_json || '[]'),
    verified: !!row.verified,
    epoch: row.epoch,
    claimTimestamp: row.claim_timestamp,
    createdAt: row.created_at,
  }));
}

/** Get proof count stats */
export function getZkTlsStats(): { total: number; verified: number; unverified: number } {
  const total = (getDb().prepare('SELECT COUNT(*) as c FROM zktls_proofs').get() as any)?.c ?? 0;
  const verified = (getDb().prepare('SELECT COUNT(*) as c FROM zktls_proofs WHERE verified = 1').get() as any)?.c ?? 0;
  return { total, verified, unverified: total - verified };
}
