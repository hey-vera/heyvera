import { Hono } from 'hono';
import { getDb, logAudit } from '../db/connection';
import { hasSomaDelegation } from '../db/index';
import { logger } from '../utils/logger';

export const authRouter = new Hono();

/** Round to 6 decimal places to avoid float drift in credit arithmetic. */
const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

// ─── GET /v1/auth/me — validate API key and return account info ──────────────
// Called by Pulse (and Radar) on every authenticated request to check key validity.
// Response shape must satisfy pulse/hosted/auth.ts validateApiKey():
//   data.userId || data.id  → userId
//   data.email              → email
//   data.credits            → credits
//   data.plan || 'free'     → plan
//   data.active !== false   → active (true when field absent; we return it explicitly)

authRouter.get('/me', (c) => {
  const apiKey = c.req.header('X-API-Key') ?? '';

  if (!apiKey || !apiKey.startsWith('cn-')) {
    return c.json({ error: 'Invalid or missing API key', code: 'UNAUTHORIZED' }, 401);
  }

  type KeyRow = {
    key: string;
    email: string;
    credits: number;
    active: number;
    clerk_user_id: string | null;
  };

  const row = getDb()
    .prepare(
      'SELECT key, email, credits, active, clerk_user_id FROM api_keys WHERE key = ? AND active = 1',
    )
    .get(apiKey) as KeyRow | undefined;

  if (!row) {
    return c.json({ error: 'Invalid or inactive API key', code: 'UNAUTHORIZED' }, 401);
  }

  const masked = apiKey.slice(0, 11) + '...' + apiKey.slice(-4);

  return c.json({
    key: masked,
    userId: row.clerk_user_id ?? '',
    email: row.email,
    credits: row.credits,
    active: true,
    plan: 'free',
    has_soma_identity: hasSomaDelegation(apiKey),
  });
});

// ─── POST /v1/auth/deduct — deduct credits from an account ───────────────────
// Used by Pulse (and other first-party consumers) to bill actions.
//
// Two key paths:
//   Root key   (cn-xxx)     — deduct directly from api_keys row.
//   Delegation (cn-dlg-xxx) — validate delegation row, check spend cap, then
//                             deduct from the root account's api_keys row and
//                             increment spend_used_credits in the same transaction.
//
// Both paths execute a single SQLite transaction so the balance check and write
// are atomic — no concurrent request can deduct against the same balance window.

authRouter.post('/deduct', async (c) => {
  const apiKey = c.req.header('X-API-Key') ?? '';

  if (!apiKey) {
    return c.json({ error: 'X-API-Key header required', code: 'UNAUTHORIZED' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, 400);
  }

  if (typeof body.amount !== 'number' || body.amount <= 0) {
    return c.json({ error: 'amount must be a positive number', code: 'INVALID_INPUT' }, 400);
  }
  if (typeof body.reason !== 'string' || !body.reason.trim()) {
    return c.json({ error: 'reason is required', code: 'INVALID_INPUT' }, 400);
  }

  const amount = round6(body.amount as number);
  const reason = (body.reason as string).trim();
  const db = getDb();

  // ── Root key path ───────────────────────────────────────────────────────────
  if (apiKey.startsWith('cn-') && !apiKey.startsWith('cn-dlg-')) {
    type DeductResult =
      | { ok: true; remaining: number }
      | { ok: false; code: string };

    const result: DeductResult = db.transaction((): DeductResult => {
      const row = db
        .prepare('SELECT credits FROM api_keys WHERE key = ? AND active = 1')
        .get(apiKey) as { credits: number } | undefined;

      if (!row) return { ok: false, code: 'UNAUTHORIZED' };
      if (row.credits < amount) return { ok: false, code: 'INSUFFICIENT_CREDITS' };

      db.prepare(
        'UPDATE api_keys SET credits = credits - ?, credits_used = credits_used + ? WHERE key = ?',
      ).run(amount, amount, apiKey);

      return { ok: true, remaining: round6(row.credits - amount) };
    })();

    if (!result.ok) {
      if (result.code === 'UNAUTHORIZED') {
        return c.json({ error: 'Invalid or inactive API key', code: 'UNAUTHORIZED' }, 401);
      }
      return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
    }

    logger.debug({ key: apiKey.slice(0, 11) + '...', amount, reason }, 'auth: credits deducted (root)');
    return c.json({ ok: true, credits: result.remaining, remaining: result.remaining });
  }

  // ── Delegation key path ─────────────────────────────────────────────────────
  if (apiKey.startsWith('cn-dlg-')) {
    type DkRow = {
      account_key: string;
      revoked_at: string | null;
      expires_at: string | null;
      spend_cap_credits: number | null;
      spend_used_credits: number;
    };

    type DeductResult =
      | { ok: true; remaining: number }
      | { ok: false; code: string };

    const result: DeductResult = db.transaction((): DeductResult => {
      const dk = db
        .prepare(
          `SELECT account_key, revoked_at, expires_at, spend_cap_credits, spend_used_credits
           FROM delegated_keys WHERE key = ?`,
        )
        .get(apiKey) as DkRow | undefined;

      if (!dk) return { ok: false, code: 'UNAUTHORIZED' };
      if (dk.revoked_at) return { ok: false, code: 'REVOKED' };
      if (dk.expires_at && new Date(dk.expires_at) < new Date()) return { ok: false, code: 'EXPIRED' };

      // Spend cap check — performed inside the transaction to prevent race
      if (dk.spend_cap_credits !== null) {
        if (round6(dk.spend_used_credits + amount) > dk.spend_cap_credits) {
          return { ok: false, code: 'SPEND_CAP_EXCEEDED' };
        }
      }

      const ak = db
        .prepare('SELECT credits FROM api_keys WHERE key = ? AND active = 1')
        .get(dk.account_key) as { credits: number } | undefined;

      if (!ak) return { ok: false, code: 'ACCOUNT_INVALID' };
      if (ak.credits < amount) return { ok: false, code: 'INSUFFICIENT_CREDITS' };

      // Both writes in the same transaction — either both succeed or neither does.
      db.prepare(
        'UPDATE api_keys SET credits = credits - ?, credits_used = credits_used + ? WHERE key = ?',
      ).run(amount, amount, dk.account_key);

      db.prepare(
        'UPDATE delegated_keys SET spend_used_credits = spend_used_credits + ? WHERE key = ?',
      ).run(amount, apiKey);

      return { ok: true, remaining: round6(ak.credits - amount) };
    })();

    if (!result.ok) {
      const code = result.code;
      if (code === 'UNAUTHORIZED' || code === 'REVOKED' || code === 'EXPIRED' || code === 'ACCOUNT_INVALID') {
        return c.json({ error: 'Delegation key invalid, revoked, or expired', code }, 401);
      }
      if (code === 'SPEND_CAP_EXCEEDED') {
        return c.json({ error: 'Delegation spend cap exceeded', code: 'SPEND_CAP_EXCEEDED' }, 402);
      }
      return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
    }

    logger.debug({ key: apiKey.slice(0, 11) + '...', amount, reason }, 'auth: credits deducted (delegation)');
    return c.json({ ok: true, credits: result.remaining, remaining: result.remaining });
  }

  return c.json({ error: 'Invalid API key format', code: 'UNAUTHORIZED' }, 401);
});
