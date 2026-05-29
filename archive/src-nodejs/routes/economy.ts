import { Hono } from 'hono';
import type { Context } from 'hono';
import { nanoid } from 'nanoid';
import { getDb, logAudit } from '../db/index';
import { logger } from '../utils/logger';

export const economyRouter = new Hono();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Round to 6 decimal places to avoid float drift in credit arithmetic. */
const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

/** Mask a key for safe logging/display — never expose the full string. */
const maskKey = (key: string): string => key.slice(0, 11) + '...' + key.slice(-4);

type ApiKeyRow = {
  key: string;
  email: string;
  credits: number;
  active: number;
  clerk_user_id: string | null;
};

/**
 * Validate an X-API-Key root cn- key and return the account row.
 * Delegation keys (cn-dlg-) are explicitly rejected — write operations
 * on the economy resource require direct account ownership.
 */
function resolveRootKey(c: Context): ApiKeyRow | null {
  const apiKey = c.req.header('X-API-Key') ?? '';
  if (!apiKey || !apiKey.startsWith('cn-') || apiKey.startsWith('cn-dlg-')) return null;
  return (
    getDb()
      .prepare(
        'SELECT key, email, credits, active, clerk_user_id FROM api_keys WHERE key = ? AND active = 1',
      )
      .get(apiKey) as ApiKeyRow | null
  );
}

// ─── POST /v1/economy/keys/delegate ──────────────────────────────────────────
// Issue a new delegation key under the caller's root account.

economyRouter.post('/keys/delegate', async (c) => {
  const keyRow = resolveRootKey(c);
  if (!keyRow) {
    return c.json({ error: 'Valid root API key required (X-API-Key: cn-xxx)', code: 'UNAUTHORIZED' }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* empty body is valid — all fields optional */ }

  const label = typeof body.label === 'string' ? body.label.trim() || null : null;
  const spendCapCredits = typeof body.spendCapCredits === 'number' && body.spendCapCredits > 0
    ? round6(body.spendCapCredits)
    : null;
  const maxDepth = typeof body.maxDepth === 'number' ? Math.max(0, Math.floor(body.maxDepth)) : 0;
  const expiresInHours = typeof body.expiresInHours === 'number' && body.expiresInHours > 0
    ? body.expiresInHours
    : null;
  const scopeEndpoints: string[] | null = Array.isArray(body.scopeEndpoints)
    ? (body.scopeEndpoints as unknown[]).filter((e): e is string => typeof e === 'string')
    : null;
  const intentDeclaration = typeof body.intentDeclaration === 'string'
    ? body.intentDeclaration.trim() || null
    : null;

  const key = 'cn-dlg-' + nanoid(32);
  const expiresAt = expiresInHours != null
    ? new Date(Date.now() + expiresInHours * 3_600_000).toISOString()
    : null;
  const scopeJson = scopeEndpoints ? JSON.stringify(scopeEndpoints) : null;

  getDb()
    .prepare(
      `INSERT INTO delegated_keys
         (key, account_key, parent_key, label, depth, max_depth,
          scope_endpoints, spend_cap_credits, spend_used_credits,
          intent_declaration, expires_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?)`,
    )
    .run(key, keyRow.key, keyRow.key, label, maxDepth, scopeJson, spendCapCredits, intentDeclaration, expiresAt);

  logAudit({
    entityType: 'delegated_key',
    entityId: key,
    action: 'DELEGATE_ISSUED',
    actorId: keyRow.clerk_user_id ?? undefined,
    data: { label, expiresAt, scopeEndpoints, spendCapCredits },
  });

  logger.info({ key: maskKey(key), label }, 'economy: delegation key issued');

  return c.json({
    ok: true,
    key,
    label,
    expiresAt,
    scope: scopeEndpoints ? { endpoints: scopeEndpoints } : null,
  });
});

// ─── GET /v1/economy/keys/delegated ──────────────────────────────────────────
// List non-revoked delegation keys issued by the caller's root account.

economyRouter.get('/keys/delegated', (c) => {
  const keyRow = resolveRootKey(c);
  if (!keyRow) {
    return c.json({ error: 'Valid root API key required (X-API-Key: cn-xxx)', code: 'UNAUTHORIZED' }, 401);
  }

  type DkListRow = {
    key: string;
    label: string | null;
    depth: number;
    max_depth: number;
    scope_endpoints: string | null;
    spend_cap_credits: number | null;
    spend_used_credits: number;
    expires_at: string | null;
    created_at: string;
  };

  const rows = getDb()
    .prepare(
      `SELECT key, label, depth, max_depth, scope_endpoints,
              spend_cap_credits, spend_used_credits, expires_at, created_at
       FROM delegated_keys
       WHERE account_key = ? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all(keyRow.key) as DkListRow[];

  return c.json({
    keys: rows.map((row) => ({
      key: maskKey(row.key),
      label: row.label,
      depth: row.depth,
      maxDepth: row.max_depth,
      scope: row.scope_endpoints ? { endpoints: JSON.parse(row.scope_endpoints) as string[] } : null,
      spendCapCredits: row.spend_cap_credits,
      spendUsedCredits: row.spend_used_credits,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
  });
});

// ─── GET /v1/economy/keys/delegated/:key/chain ───────────────────────────────
// Public validation endpoint — no auth required.
// Never returns the root API key, account key, or owner identity.

economyRouter.get('/keys/delegated/:key/chain', (c) => {
  const key = c.req.param('key');

  type DkChainRow = {
    revoked_at: string | null;
    expires_at: string | null;
    scope_endpoints: string | null;
    spend_cap_credits: number | null;
    spend_used_credits: number;
    intent_declaration: string | null;
    depth: number;
    max_depth: number;
  };

  const row = getDb()
    .prepare(
      `SELECT revoked_at, expires_at, scope_endpoints, spend_cap_credits,
              spend_used_credits, intent_declaration, depth, max_depth
       FROM delegated_keys WHERE key = ?`,
    )
    .get(key) as DkChainRow | undefined;

  if (!row) {
    return c.json({ error: 'Delegation key not found', code: 'NOT_FOUND' }, 404);
  }

  if (row.revoked_at) {
    return c.json({ valid: false, revoked: true, expired: false });
  }

  const expired = row.expires_at ? new Date(row.expires_at) < new Date() : false;
  if (expired) {
    return c.json({ valid: false, revoked: false, expired: true });
  }

  return c.json({
    valid: true,
    revoked: false,
    expired: false,
    scope: row.scope_endpoints ? { endpoints: JSON.parse(row.scope_endpoints) as string[] } : null,
    spend_cap_credits: row.spend_cap_credits,
    spend_used_credits: row.spend_used_credits,
    expires_at: row.expires_at,
    intent_declaration: row.intent_declaration,
    depth: row.depth,
    max_depth: row.max_depth,
  });
});

// ─── DELETE /v1/economy/keys/delegated/:key ───────────────────────────────────
// Revoke a delegation key. Caller must own the key (account_key must match).

economyRouter.delete('/keys/delegated/:key', (c) => {
  const keyRow = resolveRootKey(c);
  if (!keyRow) {
    return c.json({ error: 'Valid root API key required (X-API-Key: cn-xxx)', code: 'UNAUTHORIZED' }, 401);
  }

  const targetKey = c.req.param('key');

  const existing = getDb()
    .prepare('SELECT account_key, revoked_at FROM delegated_keys WHERE key = ?')
    .get(targetKey) as { account_key: string; revoked_at: string | null } | undefined;

  if (!existing) {
    return c.json({ error: 'Delegation key not found', code: 'NOT_FOUND' }, 404);
  }

  if (existing.account_key !== keyRow.key) {
    return c.json({ error: 'You do not own this delegation key', code: 'FORBIDDEN' }, 403);
  }

  if (existing.revoked_at) {
    return c.json({ ok: true, revokedKey: targetKey, alreadyRevoked: true });
  }

  getDb()
    .prepare("UPDATE delegated_keys SET revoked_at = datetime('now') WHERE key = ?")
    .run(targetKey);

  logAudit({
    entityType: 'delegated_key',
    entityId: targetKey,
    action: 'DELEGATE_REVOKED',
    actorId: keyRow.clerk_user_id ?? undefined,
    data: { revokedBy: maskKey(keyRow.key) },
  });

  logger.info({ key: maskKey(targetKey) }, 'economy: delegation key revoked');

  return c.json({ ok: true, revokedKey: targetKey });
});
