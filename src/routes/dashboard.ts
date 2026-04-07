import { Hono } from 'hono';
import crypto from 'crypto';
import Stripe from 'stripe';
import { requireClerkAuth } from '../middleware/clerk-auth';
import { logger } from '../utils/logger';
import {
  getApiKeyByEmail,
  getApiKeyBalance,
  getApiKeyByStripeSession,
  getApiKeyByClerkId,
  wasEmailSentRecently,
  logEmailSend,
  regenerateApiKey,
  getClerkIdForKey,
  linkKeyToClerkUser,
  createApiKeyForClerk,
  getKeyStats,
  storeClaimToken,
  getClaimToken,
  deleteClaimToken,
  markClaimTokenUsed,
  getAdminDashboardStats,
  getCallsOverTime,
  getRecentCallLogs,
  getSkillInvocationLogs,
  getRevenueBreakdown,
  getReconciliation,
  getTreasuryStatus,
  getCreatorStats,
  getSkillsByAuthor,
  getPayoutRequests,
  getUserCacheStats,
  getAdminCacheStats,
} from '../db/index';
import { env } from '../config/index';
import { cacheIncr } from '../cache/index';
import { maskApiKey } from '../utils/mask';
import { getSignalBalance, getSignalHistory, getVaultLocks, createVaultLock, requestVaultUnlock, getSignalLeaderboard, getSignalStats } from '../db/signal';
import { deductCredit } from '../db/credits';
import { listTasks, countTasks } from '../db/index';

function generateApiKey(): string {
  return 'cn-' + crypto.randomBytes(24).toString('hex');
}

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
      keyRow = emailRow;
    }
  }

  // Auto-provision API key for new Clerk users (0 credits, free to start)
  if (!keyRow && clerkEmail) {
    const newKey = 'cn-' + crypto.randomBytes(24).toString('hex');
    const email = clerkEmail.toLowerCase().trim();
    try {
      createApiKeyForClerk({
        key: newKey,
        clerkUserId,
        email,
        credits: 0,
        solanaSignature: 'auto-provision',
        amountPaid: 0,
      });
      keyRow = getApiKeyByClerkId(clerkUserId);
    } catch (e) {
      // Key creation failed (e.g. duplicate email) — fall through to hasKey: false
    }
  }

  if (!keyRow) {
    return c.json({ hasKey: false });
  }

  const balance = getApiKeyBalance(keyRow.key);
  if (!balance) {
    return c.json({ hasKey: false });
  }

  // Get usage stats + cache savings
  const stats = getKeyStats(keyRow.key);
  const cacheStats = getUserCacheStats(keyRow.key);

  // Signal / Founding Protocol
  const signalBalance = getSignalBalance(keyRow.key);
  const signalHistory = getSignalHistory(keyRow.key, 10);
  const vaultLocks = getVaultLocks(keyRow.key);
  const vaultTotalLocked = vaultLocks.filter(l => l.status === 'locked').reduce((s, l) => s + l.creditsLocked, 0);

  return c.json({
    hasKey: true,
    maskedKey: maskApiKey(keyRow.key),
    email: balance.email,
    credits: balance.credits,
    creditsUsed: balance.credits_used,
    memberSince: balance.created_at,
    stats,
    cacheStats,
    signal: {
      balance: signalBalance,
      history: signalHistory,
      vault: { totalLocked: vaultTotalLocked, locks: vaultLocks },
    },
  });
});

// ─── POST /v1/dashboard/reveal-key ────────────────────────────────────────────
// Returns the full API key — called once when user clicks "Show Key" in dashboard.
// Auth-gated: only the linked Clerk user can retrieve their own key.
dashboardRouter.post('/reveal-key', requireClerkAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const keyRow = getApiKeyByClerkId(clerkUserId);
  if (!keyRow) return c.json({ error: 'No API key found', code: 'KEY_NOT_FOUND' }, 404);
  logger.info({ clerkUserId }, 'API key revealed');
  return c.json({ apiKey: keyRow.key });
});

// ─── POST /v1/dashboard/regenerate-key ───────────────────────────────────────
// Deactivates the current key and creates a new one with the same credit balance.
// The new key is returned once — store it immediately.
dashboardRouter.post('/regenerate-key', requireClerkAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');

  // Rate limit: max 3 regenerations per hour per user
  const rlCount = await cacheIncr(`rl:regen:${clerkUserId}`, 3600);
  if (rlCount > 3) {
    return c.json({ error: 'Too many key regenerations. Try again in 1 hour.', code: 'RATE_LIMITED' }, 429);
  }

  const newKey = generateApiKey();
  const result = regenerateApiKey(clerkUserId, newKey);
  if (!result) return c.json({ error: 'No active API key found', code: 'KEY_NOT_FOUND' }, 404);
  logger.info({ clerkUserId }, 'API key regenerated');
  return c.json({ apiKey: newKey, credits: result.credits });
});

// ─── POST /v1/dashboard/billing-portal ────────────────────────────────────
// Returns a Stripe Customer Portal URL for subscription management.
// The user is redirected back to the dashboard after managing their subscription.
dashboardRouter.post('/billing-portal', requireClerkAuth, async (c) => {
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return c.json({ error: 'Stripe not configured', code: 'STRIPE_NOT_CONFIGURED' }, 503);
  }

  const clerkEmail = c.get('clerkEmail');
  if (!clerkEmail) {
    return c.json({ error: 'Could not determine account email', code: 'EMAIL_NOT_FOUND' }, 400);
  }

  const stripe = new Stripe(stripeSecretKey);

  // Search Stripe for the customer by email (escape quotes to prevent search syntax injection)
  const safeEmail = clerkEmail.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const customers = await stripe.customers.search({
    query: `email:"${safeEmail}"`,
    limit: 1,
  }).catch(() => null);

  if (!customers?.data.length) {
    return c.json({ error: 'No Stripe customer found for this account. Make a purchase first to manage billing.', code: 'CUSTOMER_NOT_FOUND' }, 404);
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customers.data[0].id,
    return_url: 'https://app.claw-net.org/dashboard',
  });

  logger.info({ clerkEmail }, 'Billing portal session created');
  return c.json({ url: session.url });
});

// ─── POST /v1/dashboard/claim-session ─────────────────────────────────────
// Claim a key by Stripe session ID (from success page)
dashboardRouter.post('/claim-session', requireClerkAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');

  let body: { sessionId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const { sessionId } = body;
  if (!sessionId || !/^cs_(test_|live_)?[A-Za-z0-9]{20,}$/.test(sessionId)) {
    return c.json({ error: 'Invalid session ID format', code: 'INVALID_SESSION_FORMAT' }, 400);
  }

  const row = getApiKeyByStripeSession(sessionId);
  if (!row) {
    return c.json({ error: 'Session not found or already claimed', code: 'SESSION_NOT_FOUND' }, 404);
  }

  // Check if already claimed by someone else
  const existingLink = getClerkIdForKey(row.key);
  if (existingLink && existingLink !== clerkUserId) {
    return c.json({ error: 'This session has already been claimed', code: 'SESSION_CLAIMED' }, 409);
  }

  // Link to this Clerk user
  linkKeyToClerkUser(row.key, clerkUserId);

  const balance = getApiKeyBalance(row.key);
  logger.info({ clerkUserId, key: maskApiKey(row.key) }, 'Key claimed via session ID');

  // Never return the full API key via session claim — use reveal-key endpoint instead
  return c.json({
    success: true,
    maskedKey: maskApiKey(row.key),
    credits: balance?.credits ?? 0,
    message: 'Key linked successfully. Use the dashboard to reveal your full API key.',
  });
});

// ─── POST /v1/dashboard/send-claim-email ──────────────────────────────────
// Send magic link to purchase email so user can claim credits
dashboardRouter.post('/send-claim-email', requireClerkAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');

  // Per-user rate limit: max 3 claim emails per hour
  const claimRlCount = await cacheIncr(`rl:claim-email:${clerkUserId}`, 3600);
  if (claimRlCount > 3) {
    return c.json({ error: 'Too many claim emails — try again in 1 hour', code: 'RATE_LIMITED' }, 429);
  }

  let body: { purchaseEmail?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const purchaseEmail = (body.purchaseEmail ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(purchaseEmail)) {
    return c.json({ error: 'Valid email required', code: 'INVALID_EMAIL' }, 400);
  }

  // Rate limit: 1 claim email per address per 10 minutes — persisted to DB
  if (wasEmailSentRecently(purchaseEmail, 'claim_email', 10 * 60 * 1000)) {
    return c.json({ message: 'If a purchase exists for this email, a claim link has been sent.' });
  }
  logEmailSend(purchaseEmail, 'claim_email');

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

  // Read claim data first (needed for api_key + clerk_user_id)
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

  // Atomically mark as used — only one concurrent request wins
  if (!markClaimTokenUsed(token)) {
    return c.redirect('https://claw-net.org/dashboard.html?claim=used');
  }

  // Transfer key to the claiming Clerk user
  linkKeyToClerkUser(claim.api_key, claim.clerk_user_id);
  deleteClaimToken(token);

  logger.info({ clerkUserId: claim.clerk_user_id, apiKey: maskApiKey(claim.api_key) }, 'Key claimed via magic link');

  return c.redirect('https://claw-net.org/dashboard.html?claim=success');
});

// ─── Admin Dashboard ────────────────────────────────────────────────────────

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email || !env.ADMIN_EMAILS) return false;
  const allowed = env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase());
  return allowed.includes(email.toLowerCase());
}

function parsePeriod(raw: unknown): 'week' | 'month' {
  return raw === 'month' ? 'month' : 'week';
}

// Check if current Clerk user is admin (no data leaked — just a boolean)
dashboardRouter.get('/admin-check', requireClerkAuth, (c) => {
  const email = c.get('clerkEmail');
  return c.json({ isAdmin: isAdminEmail(email) });
});

// Full admin stats + chart data + revenue
dashboardRouter.get('/admin-stats', requireClerkAuth, (c) => {
  if (!isAdminEmail(c.get('clerkEmail'))) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const period = parsePeriod(c.req.query('period'));
  const stats = getAdminDashboardStats(period);
  const chart = getCallsOverTime(period);
  const revenue = getRevenueBreakdown();
  const reconciliation = getReconciliation();
  const treasury = getTreasuryStatus();
  const cacheStats = getAdminCacheStats(period);
  return c.json({ period, stats, chart, revenue, reconciliation, treasury, cacheStats });
});

// Call logs + skill invocation logs (all keys masked server-side)
dashboardRouter.get('/admin-logs', requireClerkAuth, (c) => {
  if (!isAdminEmail(c.get('clerkEmail'))) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const period = parsePeriod(c.req.query('period'));
  const callLogs = getRecentCallLogs(period);
  const skillLogs = getSkillInvocationLogs(period);
  return c.json({ period, callLogs, skillLogs });
});

// ─── GET /v1/dashboard/creator-stats — Clerk-auth'd creator earnings ──────────

dashboardRouter.get('/creator-stats', requireClerkAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const clerkEmail = c.get('clerkEmail');
  let keyRow = getApiKeyByClerkId(clerkUserId);
  if (!keyRow && clerkEmail) keyRow = getApiKeyByEmail(clerkEmail);
  if (!keyRow) return c.json({ isCreator: false, skills: [], withdrawals: [] });

  const stats = getCreatorStats(keyRow.key);
  const mySkills = getSkillsByAuthor(keyRow.key);
  const payouts = getPayoutRequests(keyRow.key);

  return c.json({
    isCreator: mySkills.length > 0,
    totalEarned: stats.totalEarned,
    totalSales: stats.totalSales,
    publishedSkills: mySkills.length,
    skills: mySkills.map(s => {
      const breakdown = stats.skillBreakdown.find((b: { skillId: string }) => b.skillId === s.id);
      return {
        id: s.id,
        name: s.name,
        creditCost: s.credit_cost,
        uses: s.uses,
        public: !!s.public,
        earned: breakdown?.earned ?? 0,
        sales: breakdown?.sales ?? 0,
        publishedAt: s.published_at,
      };
    }),
    withdrawals: payouts.map(p => ({
      id: p.id,
      amountCredits: p.amount_credits,
      usdcEquivalent: (p.amount_credits * 0.00075).toFixed(4),
      status: p.status,
      createdAt: p.created_at,
      processedAt: p.processed_at,
    })),
  });
});

async function sendClaimEmail(params: {
  to: string;
  token: string;
  clerkUserId: string;
}): Promise<void> {
  const resendKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM ?? 'noreply@claw-net.org';

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

// ─── Vault operations (Clerk auth proxy) ────────────────────────────────────

function getKeyForClerk(c: any): { key: string; credits: number } | null {
  const clerkUserId = c.get('clerkUserId');
  const clerkEmail = c.get('clerkEmail');
  let keyRow = getApiKeyByClerkId(clerkUserId);
  if (!keyRow && clerkEmail) keyRow = getApiKeyByEmail(clerkEmail.toLowerCase().trim());
  if (!keyRow) return null;
  const balance = getApiKeyBalance(keyRow.key);
  return balance ? { key: keyRow.key, credits: balance.credits } : null;
}

// POST /v1/dashboard/vault/lock — lock credits in Founding Vault via Clerk auth
dashboardRouter.post('/vault/lock', requireClerkAuth, async (c) => {
  const info = getKeyForClerk(c);
  if (!info) return c.json({ error: 'No API key found', code: 'KEY_NOT_FOUND' }, 404);

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
  if (info.credits < credits) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', available: info.credits }, 402);
  }

  const deducted = deductCredit(info.key, credits);
  if (!deducted) return c.json({ error: 'Failed to deduct credits', code: 'DEDUCT_FAILED' }, 500);

  try {
    const lock = createVaultLock({ apiKey: info.key, providerId: undefined, credits, lockDays });
    return c.json({
      ok: true,
      vault: { id: lock.id, creditsLocked: credits, lockDays, multiplier: lock.multiplier, unlocksAt: lock.unlocksAt },
      message: `Locked ${credits.toLocaleString()} credits for ${lockDays} days. Token conversion bonus: ${lock.multiplier}x.`,
    });
  } catch (err: any) {
    const { getDb } = await import('../db/connection');
    getDb().prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?').run(credits, info.key);
    return c.json({ error: err.message, code: 'VAULT_ERROR' }, 400);
  }
});

// POST /v1/dashboard/vault/:id/unlock — early unlock via Clerk auth
dashboardRouter.post('/vault/:id/unlock', requireClerkAuth, async (c) => {
  const info = getKeyForClerk(c);
  if (!info) return c.json({ error: 'No API key found', code: 'KEY_NOT_FOUND' }, 404);

  const lockId = c.req.param('id');
  try {
    const result = requestVaultUnlock(lockId, info.key);
    return c.json({ ok: true, ...result });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'VAULT_ERROR' }, 400);
  }
});

// GET /v1/dashboard/tasks — Clerk-auth'd task history proxy
dashboardRouter.get('/tasks', requireClerkAuth, (c) => {
  const info = getKeyForClerk(c);
  if (!info) return c.json({ error: 'No API key found', code: 'KEY_NOT_FOUND' }, 404);

  const limit = Math.min(parseInt(c.req.query('limit') ?? '10') || 10, 100);
  const offset = parseInt(c.req.query('offset') ?? '0') || 0;

  const tasks = listTasks(info.key, limit, offset);
  const total = countTasks(info.key);

  return c.json({ tasks, total });
});

// GET /v1/dashboard/signal — detailed signal data for leaderboard context
dashboardRouter.get('/signal', requireClerkAuth, (c) => {
  const info = getKeyForClerk(c);
  if (!info) return c.json({ error: 'No API key found', code: 'KEY_NOT_FOUND' }, 404);

  const balance = getSignalBalance(info.key);
  const history = getSignalHistory(info.key, 25);
  const locks = getVaultLocks(info.key);
  const leaderboard = getSignalLeaderboard(10, 0);
  const stats = getSignalStats();

  // Find user's rank
  const allEntries = getSignalLeaderboard(1000, 0);
  const rank = allEntries.findIndex(e => e.apiKey === info.key) + 1;

  return c.json({
    signal: balance,
    rank: rank || null,
    recentActivity: history,
    vault: {
      totalLocked: locks.filter(l => l.status === 'locked').reduce((s, l) => s + l.creditsLocked, 0),
      locks,
    },
    leaderboard: leaderboard.map((e, i) => ({
      rank: i + 1,
      totalSignal: e.totalSignal,
      keyHint: e.apiKey.slice(0, 7) + '...',
      isYou: e.apiKey === info.key,
    })),
    network: { totalSignal: stats.totalSignal, participants: stats.participants },
  });
});