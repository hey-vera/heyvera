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
      /** Spend limit info for delegated keys */
      delegation?: { parentKey: string; spendLimit: number; spent: number; permissions: string[] };
    };
  }
}

export const checkApiKey = createMiddleware(async (c, next) => {
  const key = c.req.header('X-API-Key');

  if (!key) {
    return c.json(
      { error: 'Missing X-API-Key header', code: 'INVALID_API_KEY', hint: 'Add X-API-Key header to your request' },
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
      { error: 'Invalid or inactive API key', code: 'INVALID_API_KEY', hint: 'Purchase a key at claw-net.org' },
      401
    );
  }

  // Check DB-based keys (purchased via Stripe)
  const keyRecord = getApiKey(key);

  if (!keyRecord) {
    logger.warn({ key: maskApiKey(key) }, 'Invalid API key attempt');
    return c.json(
      { error: 'Invalid or inactive API key', code: 'INVALID_API_KEY', hint: 'Purchase a key at claw-net.org' },
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