import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import crypto from 'crypto';
import { getApiKey, getDelegationInfo, resetBudgetCountersIfNeeded, checkBudgetLimits, safeJsonParse, getHardBudgetLock, getMonthlySpend } from '../db/index';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';

/**
 * Check whether the current request has a specific permission.
 * Non-delegated keys implicitly have all permissions (returns true).
 * Delegated keys must have the permission listed in their permissions_json.
 * Empty permissions array = unrestricted.
 */
export function checkPermission(c: Context, permission: string): boolean {
  const keyInfo = c.get('apiKeyInfo');
  if (!keyInfo?.delegation?.permissions) return true;
  if (keyInfo.delegation.permissions.length === 0) return true;
  return keyInfo.delegation.permissions.includes(permission);
}

/**
 * Check granular policy constraints on a delegated key.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 *
 * Policy fields (from v108 migration):
 *   max_per_transaction: max credits per single deduction
 *   allowed_skills_json: array of skill IDs this key can invoke (null = all)
 *   allowed_providers_json: array of provider DIDs this key can pay (null = all)
 *   active_hours_json: { startUtc: number, endUtc: number } window (null = always)
 */
export function checkPolicy(c: Context, opts?: {
  amount?: number;
  skillId?: string;
  providerDid?: string;
}): { allowed: boolean; reason?: string } {
  const keyInfo = c.get('apiKeyInfo');
  if (!keyInfo?.delegation) return { allowed: true }; // non-delegated keys have no policy

  const delegation = keyInfo.delegation as Record<string, unknown>;

  // Per-transaction cap
  if (opts?.amount && delegation.maxPerTransaction) {
    const maxPer = delegation.maxPerTransaction as number;
    if (opts.amount > maxPer) {
      return { allowed: false, reason: `Transaction amount ${opts.amount} exceeds per-transaction cap of ${maxPer} credits` };
    }
  }

  // Allowed skills whitelist
  if (opts?.skillId && delegation.allowedSkills) {
    const allowed = delegation.allowedSkills as string[];
    if (allowed.length > 0 && !allowed.includes(opts.skillId)) {
      return { allowed: false, reason: `Skill ${opts.skillId} is not in the allowed skills list for this key` };
    }
  }

  // Allowed providers whitelist
  if (opts?.providerDid && delegation.allowedProviders) {
    const providers = delegation.allowedProviders as string[];
    if (providers.length > 0 && !providers.includes(opts.providerDid)) {
      return { allowed: false, reason: `Provider ${opts.providerDid} is not in the allowed providers list for this key` };
    }
  }

  // Active hours window (UTC)
  if (delegation.activeHours) {
    const hours = delegation.activeHours as { startUtc: number; endUtc: number };
    const currentHour = new Date().getUTCHours();
    const inWindow = hours.startUtc < hours.endUtc
      ? currentHour >= hours.startUtc && currentHour < hours.endUtc
      : currentHour >= hours.startUtc || currentHour < hours.endUtc;
    if (!inWindow) {
      return { allowed: false, reason: `Key is only active during UTC hours ${hours.startUtc}-${hours.endUtc} (current: ${currentHour})` };
    }
  }

  return { allowed: true };
}

// Attaches validated key info to context for use in route handlers
declare module 'hono' {
  interface ContextVariableMap {
    apiKeyInfo: {
      key: string;
      email: string;
      credits: number;
      creditsUsed: number;
      amountPaid: number;
      isEnvKey: boolean;
      /** Set when request uses a delegated sub-key — billing deducts from parent */
      delegatedFrom?: string;
      /** Spend limit + policy info for delegated keys */
      delegation?: {
        parentKey: string; spendLimit: number; spent: number; permissions: string[];
        maxPerTransaction?: number | null;
        allowedSkills?: string[] | null;
        allowedProviders?: string[] | null;
        activeHours?: { startUtc: number; endUtc: number } | null;
      };
    };
  }
}

export const checkApiKey = createMiddleware(async (c, next) => {
  const key = c.req.header('X-API-Key');

  if (!key) {
    return c.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      401
    );
  }

  // Check env-based keys first (test-key-123, admin keys etc.)
  const envKeys = env.API_KEYS ? env.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean) : [];
  const isEnvKeyMatch = envKeys.some((ek) => {
    if (ek.length !== key.length) return false;
    return crypto.timingSafeEqual(Buffer.from(ek), Buffer.from(key));
  });
  if (isEnvKeyMatch) {
    c.set('apiKeyInfo', { key, email: 'env-key', credits: Infinity, creditsUsed: 0, amountPaid: 0, isEnvKey: true });
    return next();
  }

  // Reject malformed keys before hitting the DB (cn- prefix + 48 hex chars)
  if (!/^cn-[a-f0-9]{48}$/.test(key)) {
    return c.json(
      { error: 'Invalid credentials', code: 'AUTH_INVALID' },
      401
    );
  }

  // Check DB-based keys (purchased via Stripe)
  const keyRecord = getApiKey(key);

  if (!keyRecord) {
    logger.warn({ key: maskApiKey(key) }, 'Invalid API key attempt');
    return c.json(
      { error: 'Invalid credentials', code: 'AUTH_INVALID' },
      401
    );
  }

  // Check if this is a delegated sub-key
  const delegation = getDelegationInfo(key);
  if (delegation) {
    // Check expiry
    if (delegation.expires_at && new Date(delegation.expires_at) < new Date()) {
      return c.json({ error: 'Delegated key expired', code: 'KEY_EXPIRED' }, 401);
    }
    // Check spend limit
    if (delegation.spent >= delegation.spend_limit) {
      return c.json({ error: 'Delegated key spend limit reached', code: 'SPEND_LIMIT_REACHED' }, 402);
    }
    // Reset daily/weekly counters for budget accounts and enforce limits
    if (delegation.account_type === 'budget') {
      resetBudgetCountersIfNeeded(key);
      const budgetCheck = checkBudgetLimits(key, 1);
      if (budgetCheck && !budgetCheck.allowed) {
        return c.json({ error: budgetCheck.reason, code: 'BUDGET_LIMIT_EXCEEDED' }, 429);
      }
    }
    // Resolve parent key for billing
    const parentRecord = getApiKey(delegation.parent_key);
    if (!parentRecord) {
      return c.json({ error: 'Parent key inactive', code: 'PARENT_KEY_INACTIVE' }, 401);
    }
    const perms: string[] = safeJsonParse<string[]>(delegation.permissions_json, []);
    const allowedSkills: string[] | null = delegation.allowed_skills_json ? safeJsonParse<string[]>(delegation.allowed_skills_json, []) : null;
    const allowedProviders: string[] | null = delegation.allowed_providers_json ? safeJsonParse<string[]>(delegation.allowed_providers_json, []) : null;
    const activeHours: { startUtc: number; endUtc: number } | null = delegation.active_hours_json ? safeJsonParse(delegation.active_hours_json, null) : null;
    c.set('apiKeyInfo', {
      key: delegation.parent_key,
      email: parentRecord.email,
      credits: parentRecord.credits,
      creditsUsed: parentRecord.credits_used ?? 0,
      amountPaid: parentRecord.amount_paid ?? 0,
      isEnvKey: false,
      delegatedFrom: key,
      delegation: {
        parentKey: delegation.parent_key,
        spendLimit: delegation.spend_limit,
        spent: delegation.spent,
        permissions: perms,
        maxPerTransaction: delegation.max_per_transaction ?? null,
        allowedSkills,
        allowedProviders,
        activeHours,
      },
    });
    // Fall through to shared hard budget lock check below
  } else {
    // Direct (non-delegated) key
    c.set('apiKeyInfo', {
      key,
      email: keyRecord.email,
      credits: keyRecord.credits,
      creditsUsed: keyRecord.credits_used ?? 0,
      amountPaid: keyRecord.amount_paid ?? 0,
      isEnvKey: false,
    });
  }

  // Check hard budget lock for the BILLING key (parent for delegated, direct otherwise)
  const billingKey = c.get('apiKeyInfo').key;
  const lock = getHardBudgetLock(billingKey);
  if (lock && lock.enabled) {
    const monthlySpent = getMonthlySpend(billingKey);
    if (monthlySpent >= lock.limitCredits) {
      const nextMonth = new Date();
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
      nextMonth.setUTCHours(0, 0, 0, 0);
      return c.json({
        error: 'Monthly budget lock reached. Spending is frozen until next month.',
        code: 'BUDGET_LOCKED',
        limit: lock.limitCredits,
        spent: monthlySpent,
        resetsAt: nextMonth.toISOString(),
        hint: 'Increase your budget lock at POST /v1/account/budget/lock or remove it with DELETE /v1/account/budget/lock',
      }, 402);
    }
  }

  return next();
});