import { Hono } from 'hono';
import crypto from 'crypto';
import { requireClerkAuth } from '../middleware/clerk-auth';
import { logger } from '../utils/logger';
import { sendApiKeyEmail } from '../utils/email';
import {
  getApiKeyByEmail,
  getApiKeyBalance,
  getApiKeyByStripeSession,
  topUpCredits,
  createApiKey,
  getDb,
} from '../db/index';

export const dashboardRouter = new Hono();

// ─── GET /v1/dashboard/me ──────────────────────────────────────────────────
// Returns the logged-in user's API key + balance
dashboardRouter.get('/me', requireClerkAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');
  const clerkEmail = c.get('clerkEmail');

  // First try to find by clerk_user_id (linked account)
  let keyRow = getApiKeyByClerkId(clerkUserId);

  // Fallback: find by email if not yet linked
  if (!keyRow && clerkEmail) {
    const emailRow = getApiKeyByEmail(clerkEmail.toLowerCase().trim());
    if (emailRow) {
      // Auto-link this key to their Clerk account
      linkKeyToClerkUser(emailRow.key, clerkUserId);
      keyRow = { key: emailRow.key, email: emailRow.email };
    }
  }

  if (!keyRow) {
    return c.json({ hasKey: false });
  }

  const balance = getApiKeyBalance(keyRow.key);
  if (!balance) {
    return c.json({ hasKey: false });
  }

  // Get usage stats
  const stats = getKeyStats(keyRow.key);

  return c.json({
    hasKey: true,
    apiKey: keyRow.key,
    email: balance.email,
    credits: balance.credits,
    creditsUsed: balance.credits_used,
    memberSince: balance.created_at,
    stats,
  });
});

// ─── POST /v1/dashboard/claim-session ─────────────────────────────────────
// Claim a key by Stripe session ID (from success page)
dashboardRouter.post('/claim-session', requireClerkAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');

  let body: { sessionId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { sessionId } = body;
  if (!sessionId || sessionId.length < 20) {
    return c.json({ error: 'Invalid session ID' }, 400);
  }

  const row = getApiKeyByStripeSession(sessionId);
  if (!row) {
    return c.json({ error: 'Session not found or already claimed' }, 404);
  }

  // Check if already claimed by someone else
  const existingLink = getClerkIdForKey(row.key);
  if (existingLink && existingLink !== clerkUserId) {
    return c.json({ error: 'This session has already been claimed' }, 409);
  }

  // Link to this Clerk user
  linkKeyToClerkUser(row.key, clerkUserId);

  const balance = getApiKeyBalance(row.key);
  logger.info({ clerkUserId, key: row.key }, 'Key claimed via session ID');

  return c.json({
    success: true,
    apiKey: row.key,
    credits: balance?.credits ?? 0,
  });
});

// ─── POST /v1/dashboard/send-claim-email ──────────────────────────────────
// Send magic link to purchase email so user can claim credits
const recentClaimEmails = new Map<string, number>();

dashboardRouter.post('/send-claim-email', requireClerkAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');

  let body: { purchaseEmail?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const purchaseEmail = (body.purchaseEmail ?? '').trim().toLowerCase();
  if (!purchaseEmail || !purchaseEmail.includes('@')) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  // Rate limit: 1 claim email per address per 10 minutes
  const lastSent = recentClaimEmails.get(purchaseEmail) ?? 0;
  if (Date.now() - lastSent < 10 * 60 * 1000) {
    return c.json({ message: 'If a purchase exists for this email, a claim link has been sent.' });
  }
  recentClaimEmails.set(purchaseEmail, Date.now());

  // Check if key exists for this email
  const keyRow = getApiKeyByEmail(purchaseEmail);
  if (!keyRow) {
    // Don't reveal if email exists
    return c.json({ message: 'If a purchase exists for this email, a claim link has been sent.' });
  }

  // Check not already claimed by someone else
  const existingClerkId = getClerkIdForKey(keyRow.key);
  if (existingClerkId && existingClerkId !== clerkUserId) {
    return c.json({ message: 'If a purchase exists for this email, a claim link has been sent.' });
  }

  // Generate magic link token (expires 1 hour)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  storeClaimToken({
    token,
    clerkUserId,
    purchaseEmail,
    apiKey: keyRow.key,
    expiresAt,
  });

  // Send claim email
  try {
    await sendClaimEmail({
      to: purchaseEmail,
      token,
      clerkUserId,
    });
    logger.info({ purchaseEmail, clerkUserId }, 'Claim email sent');
  } catch (err) {
    logger.error({ err }, 'Failed to send claim email');
  }

  return c.json({ message: 'If a purchase exists for this email, a claim link has been sent.' });
});

// ─── GET /v1/dashboard/verify-claim/:token ────────────────────────────────
// User clicks magic link in email — transfers key to their account
dashboardRouter.get('/verify-claim/:token', async (c) => {
  const { token } = c.req.param();

  const claim = getClaimToken(token);

  if (!claim) {
    return c.redirect('https://claw-net.org/dashboard.html?claim=invalid');
  }

  if (new Date(claim.expires_at) < new Date()) {
    deleteClaimToken(token);
    return c.redirect('https://claw-net.org/dashboard.html?claim=expired');
  }

  if (claim.used) {
    return c.redirect('https://claw-net.org/dashboard.html?claim=used');
  }

  // Transfer key to the claiming Clerk user
  linkKeyToClerkUser(claim.api_key, claim.clerk_user_id);

  // Update the key's email to the Clerk user's email (optional — keeps data consistent)
  markClaimTokenUsed(token);

  logger.info({ clerkUserId: claim.clerk_user_id, apiKey: claim.api_key }, 'Key claimed via magic link');

  return c.redirect('https://claw-net.org/dashboard.html?claim=success');
});

// ─── DB helpers (inline — these operate on the existing DB) ───────────────

function getApiKeyByClerkId(clerkUserId: string): { key: string; email: string } | undefined {
  return getDb()
    .prepare('SELECT key, email FROM api_keys WHERE clerk_user_id = ? AND active = 1 LIMIT 1')
    .get(clerkUserId) as { key: string; email: string } | undefined;
}

function getClerkIdForKey(key: string): string | undefined {
  const row = getDb()
    .prepare('SELECT clerk_user_id FROM api_keys WHERE key = ?')
    .get(key) as { clerk_user_id: string | null } | undefined;
  return row?.clerk_user_id ?? undefined;
}

function linkKeyToClerkUser(key: string, clerkUserId: string): void {
  getDb()
    .prepare('UPDATE api_keys SET clerk_user_id = ? WHERE key = ?')
    .run(clerkUserId, key);
}

function getKeyStats(key: string): {
  queriesToday: number;
  queriesTotal: number;
  lastUsed: string | null;
} {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const total = db
    .prepare('SELECT COUNT(*) as count FROM orchestrations')
    .get() as { count: number };

  const todayCount = db
    .prepare('SELECT COUNT(*) as count FROM orchestrations WHERE timestamp LIKE ?')
    .get(`${today}%`) as { count: number };

  const lastUsed = db
    .prepare('SELECT last_used_at FROM api_keys WHERE key = ?')
    .get(key) as { last_used_at: string | null } | undefined;

  return {
    queriesToday: todayCount.count,
    queriesTotal: total.count,
    lastUsed: lastUsed?.last_used_at ?? null,
  };
}

function storeClaimToken(params: {
  token: string;
  clerkUserId: string;
  purchaseEmail: string;
  apiKey: string;
  expiresAt: string;
}): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO claim_tokens
      (token, clerk_user_id, purchase_email, api_key, expires_at, used)
      VALUES (@token, @clerkUserId, @purchaseEmail, @apiKey, @expiresAt, 0)`)
    .run(params);
}

function getClaimToken(token: string): {
  token: string;
  clerk_user_id: string;
  purchase_email: string;
  api_key: string;
  expires_at: string;
  used: number;
} | undefined {
  return getDb()
    .prepare('SELECT * FROM claim_tokens WHERE token = ?')
    .get(token) as ReturnType<typeof getClaimToken>;
}

function markClaimTokenUsed(token: string): void {
  getDb()
    .prepare('UPDATE claim_tokens SET used = 1 WHERE token = ?')
    .run(token);
}

function deleteClaimToken(token: string): void {
  getDb()
    .prepare('DELETE FROM claim_tokens WHERE token = ?')
    .run(token);
}

async function sendClaimEmail(params: {
  to: string;
  token: string;
  clerkUserId: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? 'noreply@claw-net.org';

  if (!resendKey) return;

  const claimUrl = `https://api.claw-net.org/v1/dashboard/verify-claim/${params.token}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Courier New', monospace; background: #080808; color: #e0e0e0; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; padding: 40px; border: 1px solid #1e1e1e; background: #111; }
    .logo { color: #00ff88; font-size: 20px; font-weight: bold; margin-bottom: 32px; }
    h1 { font-size: 22px; color: #fff; margin: 0 0 8px; }
    p { color: #888; font-size: 13px; line-height: 1.6; }
    .btn { display: inline-block; background: #00ff88; color: #000; padding: 14px 32px; font-family: 'Courier New', monospace; font-weight: bold; font-size: 14px; text-decoration: none; margin: 24px 0; }
    .warning { background: #0a0a0a; border: 1px solid #1e1e1e; padding: 16px; font-size: 11px; color: #555; margin-top: 24px; }
    .footer { margin-top: 32px; padding-top: 24px; border-top: 1px solid #1e1e1e; color: #444; font-size: 11px; }
    a { color: #00ff88; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🦀 ClawNet</div>
    <h1>Transfer your credits.</h1>
    <p>Someone requested to transfer the ClawNet credits associated with this email to their account.</p>
    <p>If this was you, click the button below to confirm the transfer. Your credits will move to the requesting account immediately.</p>
    <a href="${claimUrl}" class="btn">Confirm Transfer →</a>
    <div class="warning">
      ⚠️ If you did not request this transfer, ignore this email. Your credits are safe and will not be moved.
      This link expires in 1 hour.
    </div>
    <div class="footer">
      © 2026 ClawNet · <a href="mailto:hello@claw-net.org">hello@claw-net.org</a>
    </div>
  </div>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: '🦀 Someone wants to transfer your ClawNet credits — confirm or ignore',
      html,
    }),
  });
}