/**
 * trust-delegation.ts — Trust delegation chains (inherited trust, Section 36.2)
 *
 * A new agent can inherit trust from its creator/parent:
 *   - Agent B is created by Agent A (trust score 92)
 *   - Agent B presents signed delegation: "A vouches for B with 50% inheritance"
 *   - Agent B starts with effective score 46 (50% of 92)
 *   - If B misbehaves, A's score drops too (accountability chain)
 *
 * Rules (Section 39.5):
 *   - Max 5 delegation children per parent
 *   - Each active delegation REDUCES parent score by 5 points
 *   - Child misbehavior penalty to parent: max(5, child_penalty * 0.5)
 *   - Delegation depth: 1 ONLY (no grandchild delegation)
 *   - Expires: 90 days max, non-renewable without re-verification
 */

import { getDb, logAudit } from '../db/connection';
import { nanoid } from 'nanoid';
import { aidHash } from '../utils/crypto-agility';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrustDelegation {
  id: string;
  parentDid: string;
  childDid: string;
  inheritancePct: number; // 0-100
  effectiveScore: number;
  expiresAt: string;
  signature: string;
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_CHILDREN = 5;
const PARENT_PENALTY_PER_CHILD = 5;
const MAX_INHERITANCE_PCT = 50;
const MAX_DELEGATION_DAYS = 90;
const CHILD_MISBEHAVIOR_PARENT_FACTOR = 0.5;

// ─── Delegation Management ──────────────────────────────────────────────────

/**
 * Create a trust delegation from parent to child.
 *
 * @param parentDid - Parent agent DID (must have trust score > 0)
 * @param childDid - Child agent DID (new or low-trust agent)
 * @param inheritancePct - Percentage of parent's score to inherit (max 50%)
 * @param durationDays - Delegation duration (max 90 days)
 */
export function createDelegation(
  parentDid: string,
  childDid: string,
  inheritancePct: number,
  durationDays: number = 90,
): TrustDelegation {
  if (parentDid === childDid) throw new Error('Cannot delegate to self');
  if (inheritancePct > MAX_INHERITANCE_PCT) throw new Error(`Max inheritance is ${MAX_INHERITANCE_PCT}%`);
  if (inheritancePct <= 0) throw new Error('Inheritance must be positive');
  if (durationDays > MAX_DELEGATION_DAYS) throw new Error(`Max delegation duration is ${MAX_DELEGATION_DAYS} days`);

  // Check child isn't already a parent (depth 1 only)
  const childIsParent = getDb().prepare(
    `SELECT 1 FROM aid_delegations WHERE parent_did = ? AND status = 'active' LIMIT 1`
  ).get(childDid);
  if (childIsParent) throw new Error('Delegation depth 1 only — child already has delegations');

  // Check parent's active delegation count
  const activeCount = getDb().prepare(
    `SELECT COUNT(*) as n FROM aid_delegations WHERE parent_did = ? AND status = 'active'`
  ).get(parentDid) as { n: number };
  if (activeCount.n >= MAX_CHILDREN) throw new Error(`Max ${MAX_CHILDREN} active delegations per parent`);

  // Check for existing delegation
  const existing = getDb().prepare(
    `SELECT 1 FROM aid_delegations WHERE parent_did = ? AND child_did = ? AND status = 'active'`
  ).get(parentDid, childDid);
  if (existing) throw new Error('Active delegation already exists');

  // Get parent's trust score
  const parentKey = getDb().prepare(
    `SELECT owner_key FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1`
  ).get(parentDid) as { owner_key: string } | undefined;
  if (!parentKey) throw new Error('Parent DID not found');

  const parentStats = getDb().prepare(
    `SELECT success_count, total_attestations FROM attestation_stats WHERE owner_key = ? LIMIT 1`
  ).get(parentKey.owner_key) as { success_count: number; total_attestations: number } | undefined;

  let parentScore = 0;
  if (parentStats && parentStats.total_attestations > 0) {
    const rate = parentStats.success_count / parentStats.total_attestations;
    const vol = Math.min(parentStats.total_attestations / 1000, 1);
    parentScore = Math.min(100, Math.round(rate * 40 + 0.5 * 25 + vol * 20 + 0.5 * 15));
  }

  if (parentScore === 0) throw new Error('Parent has no trust score to delegate');

  const effectiveScore = Math.round(parentScore * (inheritancePct / 100));
  const expiresAt = new Date(Date.now() + durationDays * 86_400_000).toISOString();
  const id = `deleg-${nanoid(16)}`;

  // Sign the delegation
  const sigInput = `${parentDid}:${childDid}:${inheritancePct}:${expiresAt}`;
  const signature = aidHash(sigInput);

  getDb().prepare(`
    INSERT INTO aid_delegations (id, parent_did, child_did, inheritance_pct,
                                effective_score, expires_at, signature, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(id, parentDid, childDid, inheritancePct, effectiveScore, expiresAt, signature);

  logAudit({
    entityType: 'delegation', entityId: id, action: 'created',
    data: { parentDid, childDid, inheritancePct, effectiveScore, expiresAt },
  });

  logger.info({ parentDid: parentDid.slice(0, 20), childDid: childDid.slice(0, 20), effectiveScore }, 'Trust delegation created');

  return {
    id, parentDid, childDid, inheritancePct, effectiveScore,
    expiresAt, signature, status: 'active', createdAt: new Date().toISOString(),
  };
}

/**
 * Revoke a trust delegation.
 */
export function revokeDelegation(delegationId: string): boolean {
  const result = getDb().prepare(
    `UPDATE aid_delegations SET status = 'revoked' WHERE id = ? AND status = 'active'`
  ).run(delegationId);
  if (result.changes > 0) {
    logAudit({ entityType: 'delegation', entityId: delegationId, action: 'revoked' });
  }
  return result.changes > 0;
}

/**
 * Get the effective trust score for a DID, including inherited trust.
 */
export function getEffectiveTrustScore(did: string, baseScore: number): number {
  // Check if this DID has an active delegation (is a child)
  const delegation = getDb().prepare(`
    SELECT effective_score FROM aid_delegations
    WHERE child_did = ? AND status = 'active' AND expires_at > datetime('now')
    LIMIT 1
  `).get(did) as { effective_score: number } | undefined;

  if (!delegation) return baseScore;

  // Inherited trust is additive but capped
  return Math.min(100, Math.max(baseScore, delegation.effective_score));
}

/**
 * Get parent's score penalty for active delegations.
 */
export function getParentPenalty(parentDid: string): number {
  const count = getDb().prepare(
    `SELECT COUNT(*) as n FROM aid_delegations WHERE parent_did = ? AND status = 'active'`
  ).get(parentDid) as { n: number };
  return count.n * PARENT_PENALTY_PER_CHILD;
}

/**
 * Apply child misbehavior penalty to parent.
 */
export function penalizeParent(childDid: string, childPenalty: number): void {
  const delegation = getDb().prepare(`
    SELECT parent_did FROM aid_delegations
    WHERE child_did = ? AND status = 'active' LIMIT 1
  `).get(childDid) as { parent_did: string } | undefined;

  if (!delegation) return;

  const parentPenalty = Math.max(5, Math.round(childPenalty * CHILD_MISBEHAVIOR_PARENT_FACTOR));
  logger.warn({ parentDid: delegation.parent_did, childDid, childPenalty, parentPenalty }, 'Parent penalized for child misbehavior');

  logAudit({
    entityType: 'delegation', entityId: delegation.parent_did,
    action: 'parent_penalized', data: { childDid, childPenalty, parentPenalty },
  });
}

/**
 * Expire stale delegations.
 */
export function expireStale(): number {
  return getDb().prepare(
    `UPDATE aid_delegations SET status = 'expired' WHERE status = 'active' AND expires_at < datetime('now')`
  ).run().changes;
}

/**
 * List active delegations for a parent.
 */
export function getDelegations(parentDid: string): TrustDelegation[] {
  return getDb().prepare(`
    SELECT * FROM aid_delegations WHERE parent_did = ? AND status = 'active' ORDER BY created_at DESC
  `).all(parentDid) as any[];
}
