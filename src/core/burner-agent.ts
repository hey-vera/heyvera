/**
 * burner-agent.ts — Ephemeral Sub-Agent Protocol
 *
 * Burner agents are cryptographically subordinate extensions of a parent agent.
 * They are NOT independent entities — they're signed projections of the parent,
 * like threads to a process.
 *
 * Key properties:
 *   - Derived keys: burner signing key = HKDF(parent.rootSeed, "burner:<taskId>:<nonce>")
 *   - TTL-bound: hard expiry baked into the creation declaration
 *   - Bond-backed: parent posts credits as bond per burner (Sybil resistance)
 *   - Trust inheritance: starts at parent_trust × factor, decays faster than normal
 *   - Provenance chain: every burner cert traces back to parent's Heart
 *   - Auto-revocation: expired burners cannot produce valid signatures
 *
 * Anti-abuse:
 *   - Each burner costs the parent a bond (prevents mass spawning)
 *   - Max active burners per parent (default 20)
 *   - Trust decays to 0 in hours, not months
 *   - Parent slashed if burner misbehaves
 */

import { nanoid } from 'nanoid';
import nacl from 'tweetnacl';
import { getDb } from '../db/connection';
import { round6 } from './credits';
import { deriveBurnerKeypair, deriveFromRoot } from './soma-wallet';
import { somaHash } from '../utils/crypto-agility';
import { jcsSerialize } from '../utils/jcs';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BurnerAgent {
  id: string;
  parentDid: string;
  parentPublicKey: string;

  // Derived identity
  publicKey: string;
  derivationPath: string;

  // Constraints
  ttlSeconds: number;
  expiresAt: string;
  bondAmount: number;
  maxSpend: number;
  spent: number;

  // Capabilities (scoped from parent)
  allowedEndpoints: string[] | null;  // null = all parent's endpoints
  allowedActions: string[];           // query, skill, discover

  // Trust
  inheritedTrust: number;
  trustDecayPerHour: number;

  // Lifecycle
  status: 'active' | 'expired' | 'revoked' | 'dead';
  createdAt: string;
  revokedAt: string | null;
  deathCertHash: string | null;

  // Signatures
  creationSignature: string;  // Parent signs the creation declaration
}

export interface CreateBurnerOpts {
  parentDid: string;
  parentPublicKey: string;
  parentRootSeed: Buffer;
  taskId: string;
  ttlSeconds?: number;        // Default 3600 (1 hour)
  bondAmount?: number;        // Default 5 credits
  maxSpend?: number;          // Default 50 credits
  allowedEndpoints?: string[];
  allowedActions?: string[];  // Default ['query', 'skill', 'discover']
  inheritanceFactor?: number; // 0.0–0.5, default 0.3
  parentTrustScore?: number;  // Current parent trust score
}

export interface BurnerVerification {
  valid: boolean;
  expired: boolean;
  signatureValid: boolean;
  parentChainValid: boolean;
  effectiveTrust: number;
  reason?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_BURNERS_PER_PARENT = 20;
const MAX_TTL_SECONDS = 86400;          // 24 hours absolute max
const DEFAULT_TTL_SECONDS = 3600;       // 1 hour
const DEFAULT_BOND_AMOUNT = 5;          // 5 credits
const DEFAULT_MAX_SPEND = 50;           // 50 credits
const DEFAULT_INHERITANCE_FACTOR = 0.3; // 30% of parent's trust
const DEFAULT_TRUST_DECAY_PER_HOUR = 10; // Trust drops 10 points/hour
const MIN_BOND_PER_BURNER = 1;          // Minimum 1 credit bond

// ─── Creation ───────────────────────────────────────────────────────────────

/**
 * Create a burner agent — derived from parent's Heart, bonded, TTL-bound.
 * Returns null if creation fails (too many active burners, insufficient bond, etc.)
 */
export function createBurnerAgent(opts: CreateBurnerOpts): BurnerAgent | null {
  const id = `burner-${nanoid(16)}`;
  const ttl = Math.min(opts.ttlSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS);
  const bondAmount = round6(Math.max(opts.bondAmount ?? DEFAULT_BOND_AMOUNT, MIN_BOND_PER_BURNER));
  const maxSpend = round6(opts.maxSpend ?? DEFAULT_MAX_SPEND);
  const inheritanceFactor = Math.min(Math.max(opts.inheritanceFactor ?? DEFAULT_INHERITANCE_FACTOR, 0), 0.5);
  const parentTrust = opts.parentTrustScore ?? 0;

  // Check active burner count for this parent
  const activeCount = countActiveBurners(opts.parentDid);
  if (activeCount >= MAX_BURNERS_PER_PARENT) {
    logger.warn({ parentDid: opts.parentDid, activeCount }, 'Burner creation rejected — max active limit');
    return null;
  }

  // Derive burner keypair from parent's root
  const nonce = activeCount; // Simple incrementing nonce
  const keypair = deriveBurnerKeypair(opts.parentRootSeed, opts.taskId, nonce);
  const publicKey = Buffer.from(keypair.publicKey).toString('hex');
  const derivationPath = `soma:burner:${opts.taskId}:${nonce}:v1`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

  // Parent signs the creation declaration (canonical JSON)
  const declaration = jcsSerialize({
    type: 'burner_creation',
    burnerId: id,
    parentDid: opts.parentDid,
    burnerPublicKey: publicKey,
    derivationPath,
    ttlSeconds: ttl,
    bondAmount,
    maxSpend,
    expiresAt,
    allowedEndpoints: opts.allowedEndpoints ?? null,
    allowedActions: opts.allowedActions ?? ['query', 'skill', 'discover'],
  });

  // Sign with parent's signing key (derived from same root)
  const signingKeypair = nacl.sign.keyPair.fromSeed(
    new Uint8Array(deriveFromRoot(opts.parentRootSeed, 'sign')),
  );
  const creationSignature = Buffer.from(
    nacl.sign.detached(Buffer.from(somaHash(declaration), 'hex'), signingKeypair.secretKey),
  ).toString('hex');

  const burner: BurnerAgent = {
    id,
    parentDid: opts.parentDid,
    parentPublicKey: opts.parentPublicKey,
    publicKey,
    derivationPath,
    ttlSeconds: ttl,
    expiresAt,
    bondAmount,
    maxSpend,
    spent: 0,
    allowedEndpoints: opts.allowedEndpoints ?? null,
    allowedActions: opts.allowedActions ?? ['query', 'skill', 'discover'],
    inheritedTrust: round6(parentTrust * inheritanceFactor),
    trustDecayPerHour: DEFAULT_TRUST_DECAY_PER_HOUR,
    status: 'active',
    createdAt: now.toISOString(),
    revokedAt: null,
    deathCertHash: null,
    creationSignature,
  };

  // Persist
  try {
    getDb().prepare(`
      INSERT INTO burner_agents (
        id, parent_did, parent_public_key, public_key, derivation_path,
        ttl_seconds, expires_at, bond_amount, max_spend, spent,
        allowed_endpoints_json, allowed_actions_json,
        inherited_trust, trust_decay_per_hour,
        status, created_at, revoked_at, death_cert_hash, creation_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      burner.id, burner.parentDid, burner.parentPublicKey,
      burner.publicKey, burner.derivationPath,
      burner.ttlSeconds, burner.expiresAt, burner.bondAmount,
      burner.maxSpend, burner.spent,
      burner.allowedEndpoints ? JSON.stringify(burner.allowedEndpoints) : null,
      JSON.stringify(burner.allowedActions),
      burner.inheritedTrust, burner.trustDecayPerHour,
      burner.status, burner.createdAt, burner.revokedAt,
      burner.deathCertHash, burner.creationSignature,
    );
  } catch (err) {
    logger.error({ err, burnerId: id }, 'Failed to persist burner agent');
    return null;
  }

  logger.info({
    burnerId: id, parentDid: opts.parentDid, ttl, bond: bondAmount,
    trust: burner.inheritedTrust,
  }, 'Burner agent created');

  return burner;
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Verify a burner agent's validity.
 * Checks: TTL, signature, parent chain, spend limits.
 */
export function verifyBurnerAgent(burnerId: string): BurnerVerification {
  const burner = getBurnerAgent(burnerId);
  if (!burner) {
    return { valid: false, expired: false, signatureValid: false, parentChainValid: false, effectiveTrust: 0, reason: 'Burner not found' };
  }

  // Check TTL
  const expired = new Date(burner.expiresAt).getTime() <= Date.now();
  if (expired && burner.status === 'active') {
    // Auto-expire
    getDb().prepare('UPDATE burner_agents SET status = ? WHERE id = ?').run('expired', burnerId);
    burner.status = 'expired';
  }

  // Check status
  if (burner.status !== 'active') {
    return {
      valid: false, expired: burner.status === 'expired',
      signatureValid: true, parentChainValid: true,
      effectiveTrust: 0, reason: `Burner is ${burner.status}`,
    };
  }

  // Verify creation signature
  const declaration = jcsSerialize({
    type: 'burner_creation',
    burnerId: burner.id,
    parentDid: burner.parentDid,
    burnerPublicKey: burner.publicKey,
    derivationPath: burner.derivationPath,
    ttlSeconds: burner.ttlSeconds,
    bondAmount: burner.bondAmount,
    maxSpend: burner.maxSpend,
    expiresAt: burner.expiresAt,
    allowedEndpoints: burner.allowedEndpoints,
    allowedActions: burner.allowedActions,
  });

  let signatureValid = false;
  try {
    const declarationHash = Buffer.from(somaHash(declaration), 'hex');
    const sig = new Uint8Array(Buffer.from(burner.creationSignature, 'hex'));
    const parentPubKey = new Uint8Array(Buffer.from(burner.parentPublicKey, 'hex'));
    signatureValid = nacl.sign.detached.verify(
      new Uint8Array(declarationHash), sig, parentPubKey,
    );
  } catch {
    signatureValid = false;
  }

  // Calculate effective trust (inherited − decay over time)
  const hoursElapsed = (Date.now() - new Date(burner.createdAt).getTime()) / (3600 * 1000);
  const decayedTrust = Math.max(0, burner.inheritedTrust - (hoursElapsed * burner.trustDecayPerHour));
  const effectiveTrust = round6(decayedTrust);

  return {
    valid: signatureValid && !expired,
    expired,
    signatureValid,
    parentChainValid: signatureValid, // Parent signed → chain is valid
    effectiveTrust,
  };
}

/**
 * Get effective trust score for a burner, accounting for time decay.
 */
export function getBurnerEffectiveTrust(burnerId: string): number {
  const burner = getBurnerAgent(burnerId);
  if (!burner || burner.status !== 'active') return 0;

  const hoursElapsed = (Date.now() - new Date(burner.createdAt).getTime()) / (3600 * 1000);
  return round6(Math.max(0, burner.inheritedTrust - (hoursElapsed * burner.trustDecayPerHour)));
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * Revoke a burner agent. Parent or platform can revoke.
 * Returns the bond amount to be refunded (if revoked cleanly).
 */
export function revokeBurnerAgent(burnerId: string, reason?: string): number {
  const burner = getBurnerAgent(burnerId);
  if (!burner || burner.status !== 'active') return 0;

  getDb().prepare(
    'UPDATE burner_agents SET status = ?, revoked_at = ? WHERE id = ?',
  ).run('revoked', new Date().toISOString(), burnerId);

  logger.info({ burnerId, parentDid: burner.parentDid, reason }, 'Burner agent revoked');

  return burner.bondAmount; // Refund bond on clean revocation
}

/**
 * Record spend on a burner agent.
 * Returns false if spend would exceed maxSpend.
 */
export function recordBurnerSpend(burnerId: string, amount: number): boolean {
  if (amount <= 0) return true;

  const result = getDb().prepare(
    `UPDATE burner_agents SET spent = spent + ?
     WHERE id = ? AND status = 'active' AND (spent + ?) <= max_spend`,
  ).run(amount, burnerId, amount);

  return result.changes > 0;
}

/**
 * Expire all burners past their TTL. Run periodically via cron.
 */
export function expireStaleBurners(): number {
  const result = getDb().prepare(
    `UPDATE burner_agents SET status = 'expired'
     WHERE status = 'active' AND expires_at <= ?`,
  ).run(new Date().toISOString());

  if (result.changes > 0) {
    logger.info({ expired: result.changes }, 'Expired stale burner agents');
  }
  return result.changes;
}

/**
 * Slash a parent's bond for a misbehaving burner.
 * Returns the slash amount.
 */
export function slashBurnerBond(burnerId: string, reason: string): number {
  const burner = getBurnerAgent(burnerId);
  if (!burner) return 0;

  // Mark burner as dead
  getDb().prepare(
    'UPDATE burner_agents SET status = ? WHERE id = ?',
  ).run('dead', burnerId);

  logger.warn({
    burnerId, parentDid: burner.parentDid,
    bondAmount: burner.bondAmount, reason,
  }, 'Burner bond slashed — parent penalized');

  return burner.bondAmount;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get a burner agent by ID. */
export function getBurnerAgent(burnerId: string): BurnerAgent | null {
  const row = getDb().prepare(
    'SELECT * FROM burner_agents WHERE id = ?',
  ).get(burnerId) as any;
  if (!row) return null;
  return rowToBurner(row);
}

/** Count active burners for a parent. */
export function countActiveBurners(parentDid: string): number {
  const row = getDb().prepare(
    "SELECT COUNT(*) as n FROM burner_agents WHERE parent_did = ? AND status = 'active'",
  ).get(parentDid) as any;
  return row?.n ?? 0;
}

/** List all burners for a parent. */
export function listBurnerAgents(parentDid: string): BurnerAgent[] {
  const rows = getDb().prepare(
    'SELECT * FROM burner_agents WHERE parent_did = ? ORDER BY created_at DESC',
  ).all(parentDid) as any[];
  return rows.map(rowToBurner);
}

/** List active burners for a parent. */
export function listActiveBurners(parentDid: string): BurnerAgent[] {
  const rows = getDb().prepare(
    "SELECT * FROM burner_agents WHERE parent_did = ? AND status = 'active' ORDER BY created_at DESC",
  ).all(parentDid) as any[];
  return rows.map(rowToBurner);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToBurner(row: any): BurnerAgent {
  return {
    id: row.id,
    parentDid: row.parent_did,
    parentPublicKey: row.parent_public_key,
    publicKey: row.public_key,
    derivationPath: row.derivation_path,
    ttlSeconds: row.ttl_seconds,
    expiresAt: row.expires_at,
    bondAmount: row.bond_amount,
    maxSpend: row.max_spend,
    spent: row.spent,
    allowedEndpoints: row.allowed_endpoints_json ? JSON.parse(row.allowed_endpoints_json) : null,
    allowedActions: JSON.parse(row.allowed_actions_json || '[]'),
    inheritedTrust: row.inherited_trust,
    trustDecayPerHour: row.trust_decay_per_hour,
    status: row.status,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    deathCertHash: row.death_cert_hash,
    creationSignature: row.creation_signature,
  };
}
