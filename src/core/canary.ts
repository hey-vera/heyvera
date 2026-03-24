/**
 * canary.ts — Protocol-level liveness canary (Cherry 15)
 *
 * Publishes a signed "proof of liveness" every 6 hours. Third-party middleware
 * (@aidprotocol/mcp-trust) checks the canary to detect platform outages:
 *
 *   Canary >12h stale → degraded mode (cached trust, no new deferred settlements)
 *   Canary >48h stale → auto-fallback to ERC-8004 reputation data
 *
 * Turns the single-point-of-failure critique into a feature: "AID is the only
 * protocol that detects and gracefully handles its own outage."
 *
 * The canary is:
 *   1. Stored in SQLite (latest canary always queryable)
 *   2. Exposed via GET /aid/canary (public, no auth)
 *   3. Optionally anchored on-chain (Base L2, ~$0.001/tx)
 *
 * On-chain anchoring is OPTIONAL — the signed canary is self-verifiable
 * via the platform's Ed25519 key (published at /.well-known/aid-platform-key).
 */

import crypto from 'crypto';
import { getDb } from '../db/connection';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CanaryRecord {
  /** Monotonically increasing sequence number */
  sequence: number;
  /** ISO 8601 timestamp of canary generation */
  timestamp: string;
  /** SHA-256 hash of the previous canary (hash chain) */
  previousHash: string;
  /** SHA-256 hash of this canary */
  hash: string;
  /** Ed25519 signature over the canary hash (base64url) */
  signature: string;
  /** Platform DID that signed this canary */
  signerDid: string;
  /** Platform stats snapshot */
  stats: {
    activeAgents: number;
    totalAttestations: number;
    uptimeSeconds: number;
  };
  /** Merkle root of current trust snapshot (if available) */
  merkleRoot: string | null;
  /** On-chain tx hash (if anchored) */
  txHash: string | null;
}

export type CanaryStatus = 'live' | 'degraded' | 'stale' | 'dead';

// ─── Constants ──────────────────────────────────────────────────────────────

const CANARY_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEGRADED_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12 hours
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

const PLATFORM_DID = 'did:web:api.claw-net.org';
const startTime = Date.now();

// ─── Platform signing key (lazy init) ────────────────────────────────────────

let _privateKey: crypto.KeyObject | null = null;

function ensurePrivateKey(): crypto.KeyObject {
  if (_privateKey) return _privateKey;
  const secret = process.env.PLATFORM_SIGNING_SECRET || 'clawnet-dev';
  const seed = crypto.createHash('sha256').update(secret).digest().subarray(0, 32);
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, seed]);
  _privateKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  return _privateKey;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

function getLatestCanary(): CanaryRecord | null {
  try {
    const row = getDb().prepare(`
      SELECT sequence, timestamp, previous_hash, hash, signature,
             signer_did, stats_json, merkle_root, tx_hash
      FROM aid_canary
      ORDER BY sequence DESC LIMIT 1
    `).get() as any;

    if (!row) return null;

    return {
      sequence: row.sequence,
      timestamp: row.timestamp,
      previousHash: row.previous_hash,
      hash: row.hash,
      signature: row.signature,
      signerDid: row.signer_did,
      stats: JSON.parse(row.stats_json),
      merkleRoot: row.merkle_root,
      txHash: row.tx_hash,
    };
  } catch {
    return null;
  }
}

function insertCanary(canary: CanaryRecord): void {
  getDb().prepare(`
    INSERT INTO aid_canary (sequence, timestamp, previous_hash, hash, signature,
                           signer_did, stats_json, merkle_root, tx_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    canary.sequence,
    canary.timestamp,
    canary.previousHash,
    canary.hash,
    canary.signature,
    canary.signerDid,
    JSON.stringify(canary.stats),
    canary.merkleRoot,
    canary.txHash,
  );
}

// ─── Canary Generation ──────────────────────────────────────────────────────

/**
 * Generate a new canary record, sign it, and store it.
 * Called by the canary cron every 6 hours.
 */
export function generateCanary(): CanaryRecord {
  const previous = getLatestCanary();
  const sequence = previous ? previous.sequence + 1 : 1;
  const previousHash = previous ? previous.hash : '0'.repeat(64); // 64 hex chars for SHA-256
  const timestamp = new Date().toISOString();

  // Gather platform stats
  let activeAgents = 0;
  let totalAttestations = 0;
  try {
    const agentRow = getDb().prepare(`SELECT COUNT(*) as c FROM aid_keys WHERE key_status = 'active'`).get() as any;
    activeAgents = agentRow?.c ?? 0;
    const attestRow = getDb().prepare(`SELECT COUNT(*) as c FROM attestations`).get() as any;
    totalAttestations = attestRow?.c ?? 0;
  } catch { /* non-critical */ }

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  // Get latest Merkle root if available
  let merkleRoot: string | null = null;
  try {
    const snapRow = getDb().prepare(
      `SELECT merkle_root FROM aid_trust_snapshots ORDER BY snapshot_id DESC LIMIT 1`
    ).get() as any;
    merkleRoot = snapRow?.merkle_root ?? null;
  } catch { /* non-critical */ }

  const stats = { activeAgents, totalAttestations, uptimeSeconds };

  // Compute canary hash (hash chain)
  const canaryData = `${sequence}:${timestamp}:${previousHash}:${JSON.stringify(stats)}:${merkleRoot || 'null'}`;
  const hash = crypto.createHash(AID_HASH_ALGORITHM).update(canaryData).digest('hex');

  // Sign with platform key
  const signatureInput = crypto.createHash(AID_HASH_ALGORITHM).update(hash).digest();
  const signature = crypto.sign(null, signatureInput, ensurePrivateKey()).toString('base64url');

  const canary: CanaryRecord = {
    sequence,
    timestamp,
    previousHash,
    hash,
    signature,
    signerDid: PLATFORM_DID,
    stats,
    merkleRoot,
    txHash: null, // On-chain anchoring is optional (Phase 3)
  };

  insertCanary(canary);
  logger.info({ sequence, hash: hash.slice(0, 16) }, 'Canary published');

  return canary;
}

// ─── Status Check ───────────────────────────────────────────────────────────

/**
 * Get the current canary status.
 * Used by GET /aid/canary endpoint and by middleware for health checks.
 */
export function getCanaryStatus(): {
  status: CanaryStatus;
  canary: CanaryRecord | null;
  ageMs: number;
  nextExpectedMs: number;
} {
  const canary = getLatestCanary();

  if (!canary) {
    return { status: 'dead', canary: null, ageMs: Infinity, nextExpectedMs: 0 };
  }

  const ageMs = Date.now() - new Date(canary.timestamp).getTime();

  let status: CanaryStatus;
  if (ageMs <= DEGRADED_THRESHOLD_MS) {
    status = 'live';
  } else if (ageMs <= STALE_THRESHOLD_MS) {
    status = 'degraded';
  } else {
    status = 'stale';
  }

  const nextExpectedMs = Math.max(0, CANARY_INTERVAL_MS - ageMs);

  return { status, canary, ageMs, nextExpectedMs };
}

/**
 * Verify a canary record's signature using the platform's public key.
 * This is the function third-party middleware calls for offline verification.
 */
export function verifyCanarySignature(canary: CanaryRecord, platformPublicKeyJwk: any): boolean {
  try {
    const pubKey = crypto.createPublicKey({ key: platformPublicKeyJwk, format: 'jwk' });
    const signatureInput = crypto.createHash(AID_HASH_ALGORITHM).update(canary.hash).digest();
    const sigBytes = Buffer.from(canary.signature, 'base64url');
    return crypto.verify(null, signatureInput, pubKey, sigBytes);
  } catch {
    return false;
  }
}

// ─── Cron Setup ─────────────────────────────────────────────────────────────

let canaryTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the canary cron (every 6 hours).
 * Also generates an initial canary on startup.
 */
export function startCanaryCron(): void {
  // Generate initial canary
  try {
    generateCanary();
  } catch (err) {
    logger.error({ err }, 'Failed to generate initial canary');
  }

  // Schedule every 6 hours
  canaryTimer = setInterval(() => {
    try {
      generateCanary();
    } catch (err) {
      logger.error({ err }, 'Canary cron failed');
    }
  }, CANARY_INTERVAL_MS);

  logger.info('Canary cron started (every 6h)');
}

/**
 * Stop the canary cron (called on shutdown).
 */
export function stopCanaryCron(): void {
  if (canaryTimer) {
    clearInterval(canaryTimer);
    canaryTimer = null;
  }
}
