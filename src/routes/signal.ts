// src/routes/signal.ts — Founding Protocol: Signal leaderboard, Vault, milestones
import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  getSignalBalance,
  getSignalLeaderboard,
  getSignalStats,
  getSignalHistory,
  createVaultLock,
  getVaultLocks,
  requestVaultUnlock,
  extendVaultLock,
  getMilestones,
} from '../db/signal';
import { deductCredit } from '../db/credits';

export const signalRouter = new Hono();

// ── GET /v1/signal/leaderboard — public Pulse Board ───────────────────────────
signalRouter.get('/leaderboard', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const entries = getSignalLeaderboard(limit, offset);
  const stats = getSignalStats();

  return c.json({
    leaderboard: entries.map((e, i) => ({
      rank: offset + i + 1,
      providerId: e.providerId,
      totalSignal: e.totalSignal,
      // Never expose full API keys
      keyHint: e.apiKey.startsWith('provider:') ? null : e.apiKey.slice(0, 7) + '...',
    })),
    network: {
      totalSignal: stats.totalSignal,
      participants: stats.participants,
      topAction: stats.topAction,
    },
  });
});

// ── GET /v1/signal/me — caller's Signal balance + history ─────────────────────
signalRouter.get('/me', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const balance = getSignalBalance(keyInfo.key);
  const history = getSignalHistory(keyInfo.key, 25);

  return c.json({
    signal: balance,
    recentActivity: history,
  });
});

// ── GET /v1/signal/milestones — network milestones ────────────────────────────
signalRouter.get('/milestones', (c) => {
  return c.json({ milestones: getMilestones() });
});

// ── POST /v1/signal/vault/lock — lock credits in Founding Vault ───────────────
signalRouter.post('/vault/lock', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let body: { credits?: number; lockDays?: number };
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const credits = body.credits;
  const lockDays = body.lockDays;

  if (typeof credits !== 'number' || credits <= 0) {
    return c.json({ error: 'credits must be a positive number', code: 'INVALID_CREDITS' }, 400);
  }
  if (typeof lockDays !== 'number' || ![30, 90, 180].includes(lockDays)) {
    return c.json({ error: 'lockDays must be 30, 90, or 180', code: 'INVALID_LOCK_DAYS' }, 400);
  }

  // Check sufficient credits
  if (keyInfo.credits < credits) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', available: keyInfo.credits }, 402);
  }

  // Deduct credits (they're locked, not spent)
  const deducted = deductCredit(keyInfo.key, credits);
  if (!deducted) {
    return c.json({ error: 'Failed to deduct credits', code: 'DEDUCT_FAILED' }, 500);
  }

  try {
    const providerId = keyInfo.providerId ?? undefined;
    const lock = createVaultLock({ apiKey: keyInfo.key, providerId, credits, lockDays });

    logger.info({ apiKey: keyInfo.key.slice(0, 7), credits, lockDays, multiplier: lock.multiplier }, 'Founding Vault: credits locked');

    return c.json({
      ok: true,
      vault: {
        id: lock.id,
        creditsLocked: credits,
        lockDays,
        multiplier: lock.multiplier,
        unlocksAt: lock.unlocksAt,
      },
      message: `Locked ${credits.toLocaleString()} credits for ${lockDays} days. Token conversion bonus: ${lock.multiplier}x.`,
    });
  } catch (err: any) {
    // Refund credits on failure
    const db = (await import('../db/connection')).getDb();
    db.prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?').run(credits, keyInfo.key);
    return c.json({ error: err.message, code: 'VAULT_ERROR' }, 400);
  }
});

// ── GET /v1/signal/vault — list caller's vault locks ──────────────────────────
signalRouter.get('/vault', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const locks = getVaultLocks(keyInfo.key);
  const totalLocked = locks.filter(l => l.status === 'locked').reduce((s, l) => s + l.creditsLocked, 0);

  return c.json({
    totalLocked,
    locks,
  });
});

// ── POST /v1/signal/vault/:id/unlock — request early unlock (7-day cooldown) ─
signalRouter.post('/vault/:id/unlock', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const lockId = c.req.param('id');

  try {
    const result = requestVaultUnlock(lockId, keyInfo.key);
    logger.info({ lockId, apiKey: keyInfo.key.slice(0, 7) }, 'Founding Vault: early unlock requested');
    return c.json({
      ok: true,
      message: 'Early unlock initiated. 7-day cooldown. Token conversion bonus forfeited.',
      unlocksAt: result.unlocksAt,
    });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'UNLOCK_ERROR' }, 400);
  }
});

// ── POST /v1/signal/vault/:id/extend — extend lock for better multiplier ──────
signalRouter.post('/vault/:id/extend', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const lockId = c.req.param('id');

  let body: { lockDays?: number };
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (typeof body.lockDays !== 'number' || ![30, 90, 180].includes(body.lockDays)) {
    return c.json({ error: 'lockDays must be 30, 90, or 180', code: 'INVALID_LOCK_DAYS' }, 400);
  }

  try {
    const result = extendVaultLock(lockId, keyInfo.key, body.lockDays);
    return c.json({
      ok: true,
      multiplier: result.multiplier,
      unlocksAt: result.unlocksAt,
      message: `Lock extended to ${body.lockDays} days. New multiplier: ${result.multiplier}x.`,
    });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'EXTEND_ERROR' }, 400);
  }
});
