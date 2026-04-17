import { Hono } from 'hono';
import { getDb } from '../db/connection';

export const authRouter = new Hono();

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
  });
});
