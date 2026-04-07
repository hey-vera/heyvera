/**
 * delegated-keys.ts — Parent→child API key delegation
 *
 * Agents can create scoped child keys with constraints:
 *   - maxCredits: budget cap (deducted from parent's delegated pool)
 *   - allowedEndpoints: restrict to specific endpoint IDs
 *   - expiresAt: auto-expire
 *   - rateLimitRpm: per-minute rate limit
 *
 * Rules:
 *   - Children can only narrow parent constraints, never widen
 *   - Max delegation depth: 3
 *   - Revoking a parent cascades to all descendants
 *   - credits_delegated tracks how much budget has been allocated to children
 */

import crypto from 'crypto';
import { getDb } from './connection';
import { logAudit } from './connection';
import { maskApiKey } from '../utils/mask';

const MAX_DEPTH = 3;

export interface DelegatedKeyRow {
  key: string;
  maskedKey: string;
  label: string | null;
  parentKey: string | null;
  email: string;
  credits: number;
  maxCredits: number | null;
  creditsDelegated: number;
  allowedEndpoints: string[] | null;
  expiresAt: string | null;
  rateLimitRpm: number | null;
  delegationDepth: number;
  active: boolean;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function rowToDelegatedKey(row: any): DelegatedKeyRow {
  return {
    key: row.key,
    maskedKey: maskApiKey(row.key),
    label: row.label,
    parentKey: row.parent_key,
    email: row.email,
    credits: row.credits ?? 0,
    maxCredits: row.max_credits,
    creditsDelegated: row.credits_delegated ?? 0,
    allowedEndpoints: row.allowed_endpoints_json ? JSON.parse(row.allowed_endpoints_json) : null,
    expiresAt: row.expires_at,
    rateLimitRpm: row.rate_limit_rpm,
    delegationDepth: row.delegation_depth ?? 0,
    active: !!row.active && !row.revoked_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** Get all child keys for a parent key */
export function getChildKeys(parentKey: string): DelegatedKeyRow[] {
  const rows = getDb().prepare(
    'SELECT * FROM api_keys WHERE parent_key = ? ORDER BY created_at DESC'
  ).all(parentKey) as any[];
  return rows.map(rowToDelegatedKey);
}

/** Get full delegation chain for a key (all ancestors) */
export function getDelegationChain(key: string): DelegatedKeyRow[] {
  const chain: DelegatedKeyRow[] = [];
  let current = getDb().prepare('SELECT * FROM api_keys WHERE key = ?').get(key) as any;
  while (current) {
    chain.push(rowToDelegatedKey(current));
    if (!current.parent_key) break;
    current = getDb().prepare('SELECT * FROM api_keys WHERE key = ?').get(current.parent_key) as any;
  }
  return chain;
}

/** Create a delegated child key */
export function createDelegatedKey(opts: {
  parentKey: string;
  label?: string;
  maxCredits?: number;
  allowedEndpoints?: string[];
  expiresAt?: string;
  rateLimitRpm?: number;
}): { key: string; delegatedKey: DelegatedKeyRow } {
  const parent = getDb().prepare('SELECT * FROM api_keys WHERE key = ?').get(opts.parentKey) as any;
  if (!parent) throw new Error('Parent key not found');
  if (parent.revoked_at) throw new Error('Parent key is revoked');
  if (!parent.active) throw new Error('Parent key is inactive');

  // Check depth limit
  const parentDepth = parent.delegation_depth ?? 0;
  if (parentDepth >= MAX_DEPTH) {
    throw new Error(`Max delegation depth (${MAX_DEPTH}) reached`);
  }

  // Validate constraints can only narrow, never widen
  if (opts.maxCredits !== undefined) {
    if (parent.max_credits !== null && opts.maxCredits > parent.max_credits) {
      throw new Error('Child maxCredits cannot exceed parent maxCredits');
    }
  }

  if (opts.allowedEndpoints?.length) {
    const parentEndpoints = parent.allowed_endpoints_json ? JSON.parse(parent.allowed_endpoints_json) as string[] : null;
    if (parentEndpoints) {
      const parentSet = new Set(parentEndpoints);
      for (const ep of opts.allowedEndpoints) {
        if (!parentSet.has(ep)) {
          throw new Error(`Child cannot access endpoint ${ep} — not in parent's allowed list`);
        }
      }
    }
  }

  if (opts.rateLimitRpm !== undefined) {
    if (parent.rate_limit_rpm !== null && opts.rateLimitRpm > parent.rate_limit_rpm) {
      throw new Error('Child rateLimitRpm cannot exceed parent rateLimitRpm');
    }
  }

  // Budget check: if child has maxCredits, ensure parent has enough undelegated budget
  const childBudget = opts.maxCredits ?? 0;
  if (childBudget > 0) {
    const parentAvailable = parent.max_credits !== null
      ? parent.max_credits - (parent.credits_delegated ?? 0)
      : parent.credits - (parent.credits_delegated ?? 0);
    if (childBudget > parentAvailable) {
      throw new Error(`Insufficient budget. Parent has ${parentAvailable.toFixed(2)} cr available for delegation.`);
    }
  }

  const newKey = 'cn-' + crypto.randomBytes(24).toString('hex');

  getDb().transaction(() => {
    // Create child key
    getDb().prepare(`
      INSERT INTO api_keys (key, email, credits, credits_used, active, clerk_user_id, provider_id,
        parent_key, label, max_credits, allowed_endpoints_json, expires_at, rate_limit_rpm, delegation_depth)
      VALUES (?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newKey,
      parent.email,
      childBudget, // start with allocated budget as credits
      parent.clerk_user_id,
      parent.provider_id,
      opts.parentKey,
      opts.label ?? null,
      opts.maxCredits ?? null,
      opts.allowedEndpoints?.length ? JSON.stringify(opts.allowedEndpoints) : null,
      opts.expiresAt ?? null,
      opts.rateLimitRpm ?? null,
      parentDepth + 1,
    );

    // Track delegated credits on parent
    if (childBudget > 0) {
      getDb().prepare(
        'UPDATE api_keys SET credits_delegated = credits_delegated + ? WHERE key = ?'
      ).run(childBudget, opts.parentKey);
    }
  })();

  const created = getDb().prepare('SELECT * FROM api_keys WHERE key = ?').get(newKey) as any;

  logAudit({
    entityType: 'api_key',
    entityId: maskApiKey(newKey),
    action: 'DELEGATED_KEY_CREATED',
    actorId: maskApiKey(opts.parentKey),
    data: {
      label: opts.label,
      maxCredits: opts.maxCredits,
      depth: parentDepth + 1,
      allowedEndpoints: opts.allowedEndpoints,
    },
  });

  return { key: newKey, delegatedKey: rowToDelegatedKey(created) };
}

/** Revoke a delegated key and all its descendants */
export function revokeDelegatedKey(key: string, actorKey: string): number {
  const now = new Date().toISOString();
  let revoked = 0;

  getDb().transaction(() => {
    // Revoke the key itself
    const result = getDb().prepare(
      'UPDATE api_keys SET revoked_at = ?, active = 0 WHERE key = ? AND revoked_at IS NULL'
    ).run(now, key);
    if (result.changes > 0) revoked++;

    // Cascade: revoke all descendants
    const descendants = getAllDescendants(key);
    for (const desc of descendants) {
      const r = getDb().prepare(
        'UPDATE api_keys SET revoked_at = ?, active = 0 WHERE key = ? AND revoked_at IS NULL'
      ).run(now, desc);
      if (r.changes > 0) revoked++;
    }

    // Return delegated credits to parent
    const row = getDb().prepare('SELECT parent_key, max_credits FROM api_keys WHERE key = ?').get(key) as any;
    if (row?.parent_key && row.max_credits) {
      getDb().prepare(
        'UPDATE api_keys SET credits_delegated = MAX(0, credits_delegated - ?) WHERE key = ?'
      ).run(row.max_credits, row.parent_key);
    }
  })();

  logAudit({
    entityType: 'api_key',
    entityId: maskApiKey(key),
    action: 'DELEGATED_KEY_REVOKED',
    actorId: maskApiKey(actorKey),
    data: { cascadeRevoked: revoked },
  });

  return revoked;
}

/** Get all descendant keys recursively */
function getAllDescendants(parentKey: string): string[] {
  const children = getDb().prepare(
    'SELECT key FROM api_keys WHERE parent_key = ?'
  ).all(parentKey) as { key: string }[];

  const all: string[] = [];
  for (const child of children) {
    all.push(child.key);
    all.push(...getAllDescendants(child.key));
  }
  return all;
}

/** Check if a delegated key is valid (not expired, not revoked, within budget) */
export function isDelegatedKeyValid(key: string): { valid: boolean; reason?: string } {
  const row = getDb().prepare('SELECT * FROM api_keys WHERE key = ?').get(key) as any;
  if (!row) return { valid: false, reason: 'Key not found' };
  if (!row.active) return { valid: false, reason: 'Key is inactive' };
  if (row.revoked_at) return { valid: false, reason: 'Key has been revoked' };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { valid: false, reason: 'Key has expired' };
  }
  if (row.max_credits !== null && row.credits_used >= row.max_credits) {
    return { valid: false, reason: 'Credit limit reached' };
  }
  return { valid: true };
}
