import { Hono } from 'hono';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { requireClerkAuth } from '../middleware/clerk-auth';
import { getApiKeyByClerkId, createApiKeyForClerk } from '../db/index';
import { getDb, logAudit } from '../db/connection';
import { logger } from '../utils/logger';

export const oauthRouter = new Hono();

// Whitelisted apps that can use "Sign in with ClawNet"
const ALLOWED_APPS: Record<string, { name: string; redirectPrefixes: string[] }> = {
  pulse: {
    name: 'Pulse',
    redirectPrefixes: [
      'https://pulse.claw-net.org/',
      'http://localhost:',
    ],
  },
  radar: {
    name: 'Radar',
    redirectPrefixes: [
      'https://radar.claw-net.org/',
      'http://localhost:',
    ],
  },
};

function isValidRedirect(app: string, redirect: string): boolean {
  const config = ALLOWED_APPS[app];
  if (!config) return false;
  return config.redirectPrefixes.some((prefix) => redirect.startsWith(prefix));
}

// ─── GET /v1/oauth/authorize — Show authorization page ──────────────────────

oauthRouter.get('/authorize', requireClerkAuth, async (c) => {
  const app = c.req.query('app');
  const redirect = c.req.query('redirect');

  if (!app || !ALLOWED_APPS[app]) {
    return c.json({ error: 'Unknown or missing app parameter', code: 'INVALID_APP' }, 400);
  }
  if (!redirect || !isValidRedirect(app, redirect)) {
    return c.json({ error: 'Invalid or missing redirect URL', code: 'INVALID_REDIRECT' }, 400);
  }

  const appConfig = ALLOWED_APPS[app];

  // Return HTML authorization page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize ${appConfig.name} — ClawNet</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 32px; max-width: 420px; width: 100%; }
    h1 { font-size: 1.4em; margin-bottom: 12px; color: #f0f6fc; }
    p { margin-bottom: 12px; line-height: 1.5; color: #8b949e; }
    ul { margin: 0 0 20px 20px; color: #8b949e; }
    li { margin-bottom: 6px; }
    .actions { display: flex; gap: 12px; margin-top: 20px; }
    .btn { display: inline-block; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; text-decoration: none; border: none; cursor: pointer; text-align: center; }
    .btn-primary { background: #238636; color: #fff; flex: 1; }
    .btn-primary:hover { background: #2ea043; }
    .btn-cancel { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; }
    .btn-cancel:hover { background: #30363d; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize ${appConfig.name}</h1>
    <p><strong>${appConfig.name}</strong> wants to access your ClawNet account.</p>
    <p>This will allow ${appConfig.name} to:</p>
    <ul>
      <li>Read your account info</li>
      <li>Use credits for AI actions</li>
    </ul>
    <form method="POST" action="/v1/oauth/authorize">
      <input type="hidden" name="app" value="${app}">
      <input type="hidden" name="redirect" value="${redirect.replace(/"/g, '&quot;')}">
      <div class="actions">
        <button type="submit" class="btn btn-primary">Authorize</button>
        <a href="/" class="btn btn-cancel">Cancel</a>
      </div>
    </form>
  </div>
</body>
</html>`;

  return c.html(html);
});

// ─── POST /v1/oauth/authorize — Generate auth code and redirect ─────────────
// Accepts both Clerk session cookie AND Bearer token (from oauth.html page)

oauthRouter.post('/authorize', async (c) => {
  // Try JSON body first (from oauth.html fetch), then form body (from HTML form)
  let app = '';
  let redirect = '';
  let clerkUserId = '';
  let clerkEmail = '';

  const contentType = c.req.header('Content-Type') || '';

  if (contentType.includes('application/json')) {
    // Called from oauth.html with Bearer token
    const authHeader = c.req.header('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing Bearer token', code: 'UNAUTHORIZED' }, 401);
    }
    const token = authHeader.slice(7);

    // Verify Clerk token
    try {
      const { verifyToken } = await import('@clerk/backend');
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      clerkUserId = payload.sub;
      clerkEmail = (payload as any).email || '';
    } catch {
      // Fallback: decode JWT payload
      try {
        const parts = token.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        clerkUserId = payload.sub || '';
        clerkEmail = payload.email || '';
      } catch {
        return c.json({ error: 'Invalid token', code: 'INVALID_TOKEN' }, 401);
      }
    }

    if (!clerkUserId) {
      return c.json({ error: 'Could not resolve user from token', code: 'INVALID_TOKEN' }, 401);
    }

    const jsonBody = await c.req.json();
    app = String(jsonBody.app ?? '');
    redirect = String(jsonBody.redirect ?? '');
  } else {
    // Called from HTML form with Clerk session cookie
    try {
      const next = await requireClerkAuth(c, async () => {});
    } catch {
      return c.json({ error: 'Not authenticated', code: 'UNAUTHORIZED' }, 401);
    }
    clerkUserId = c.get('clerkUserId');
    clerkEmail = c.get('clerkEmail') ?? '';
    const formBody = await c.req.parseBody();
    app = String(formBody.app ?? '');
    redirect = String(formBody.redirect ?? '');
  }

  if (!app || !ALLOWED_APPS[app]) {
    return c.json({ error: 'Unknown or missing app parameter', code: 'INVALID_APP' }, 400);
  }
  if (!redirect || !isValidRedirect(app, redirect)) {
    return c.json({ error: 'Invalid or missing redirect URL', code: 'INVALID_REDIRECT' }, 400);
  }

  // Find API key — try by Clerk ID first, then by email (for keys created via Stripe/Solana)
  let keyRecord = getApiKeyByClerkId(clerkUserId);
  if (!keyRecord && clerkEmail) {
    // Look up by email — user may have a key from Stripe/Solana that isn't linked to Clerk yet
    const byEmail = getDb().prepare(
      'SELECT key, email, credits, amount_paid FROM api_keys WHERE email = ? AND active = 1 ORDER BY credits DESC LIMIT 1'
    ).get(clerkEmail) as { key: string; email: string; credits: number; amount_paid: number } | undefined;
    if (byEmail) {
      // Link this key to the Clerk user for future lookups
      getDb().prepare('UPDATE api_keys SET clerk_user_id = ? WHERE key = ?').run(clerkUserId, byEmail.key);
      keyRecord = byEmail;
      logger.info({ clerkUserId, email: clerkEmail, key: byEmail.key.slice(0, 8) }, 'OAuth: linked existing key to Clerk user');
    }
  }
  if (!keyRecord) {
    // No existing key found — auto-create with 0 credits
    const newKey = `cn-${crypto.randomBytes(24).toString('hex')}`;
    createApiKeyForClerk({
      key: newKey,
      clerkUserId,
      email: clerkEmail,
      credits: 0,
      solanaSignature: 'oauth-auto-create',
      amountPaid: 0,
    });
    keyRecord = { key: newKey, email: clerkEmail, credits: 0, amount_paid: 0 };
    logger.info({ clerkUserId, app }, 'OAuth: auto-created API key for user');
  }

  // Generate one-time auth code
  const code = crypto.randomBytes(16).toString('hex'); // 32-char hex
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

  getDb().prepare(`
    INSERT INTO oauth_codes (code, user_id, api_key, app, email, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, clerkUserId, keyRecord.key, app, keyRecord.email, expiresAt);

  logAudit({
    entityType: 'oauth',
    entityId: code,
    action: 'OAUTH_AUTHORIZE',
    actorId: clerkUserId,
    data: { app, email: keyRecord.email },
  });

  // Redirect back to the app with the auth code
  const separator = redirect.includes('?') ? '&' : '?';
  const redirectUrl = `${redirect}${separator}code=${code}`;

  // If JSON request (from oauth.html), return JSON. Otherwise redirect.
  if (contentType.includes('application/json')) {
    return c.json({ code, redirect: redirectUrl });
  }
  return c.redirect(redirectUrl);
});

// ─── POST /v1/oauth/token — Exchange code for session info ──────────────────

oauthRouter.post('/token', async (c) => {
  let body: { code?: string; app?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const { code, app } = body;

  if (!code || !app) {
    return c.json({ error: 'Missing code or app', code: 'MISSING_FIELD' }, 400);
  }

  if (!ALLOWED_APPS[app]) {
    return c.json({ error: 'Unknown app', code: 'INVALID_APP' }, 400);
  }

  // Look up the code
  const row = getDb().prepare(`
    SELECT code, user_id, api_key, app, email, expires_at
    FROM oauth_codes WHERE code = ? AND app = ?
  `).get(code, app) as {
    code: string; user_id: string; api_key: string; app: string; email: string; expires_at: string;
  } | undefined;

  if (!row) {
    return c.json({ error: 'Invalid or expired auth code', code: 'INVALID_CODE' }, 401);
  }

  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    // Clean up expired code
    getDb().prepare('DELETE FROM oauth_codes WHERE code = ?').run(code);
    return c.json({ error: 'Auth code expired', code: 'CODE_EXPIRED' }, 401);
  }

  // Delete code immediately (one-time use)
  getDb().prepare('DELETE FROM oauth_codes WHERE code = ?').run(code);

  // Fetch current credit balance
  const keyRow = getDb().prepare(
    'SELECT credits FROM api_keys WHERE key = ? AND active = 1'
  ).get(row.api_key) as { credits: number } | undefined;

  logAudit({
    entityType: 'oauth',
    entityId: row.code,
    action: 'OAUTH_TOKEN_EXCHANGE',
    actorId: row.user_id,
    data: { app },
  });

  return c.json({
    userId: row.user_id,
    email: row.email,
    apiKey: row.api_key,
    credits: keyRow?.credits ?? 0,
  });
});
