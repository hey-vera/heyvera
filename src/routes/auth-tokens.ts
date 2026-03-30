import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import { getSkill, getUsageStats, deductCredit, getClerkIdForKey } from '../db/index';
import { maskApiKey } from '../utils/mask';
import { logAudit, getDb } from '../db/connection';
import { env } from '../config/index';

export const authRouter = new Hono();

// ─── GET /v1/auth/me — current key info ───────────────────────────────────────

authRouter.get('/me', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  // Check if user has TOTP/MFA enabled via Clerk
  let totpEnabled = false;
  try {
    const clerkId = getClerkIdForKey(keyInfo.key);
    if (clerkId && env.CLERK_SECRET_KEY) {
      const { createClerkClient } = await import('@clerk/backend');
      const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
      const user = await clerk.users.getUser(clerkId);
      totpEnabled = user.totpEnabled ?? false;
    }
  } catch {}

  return c.json({
    key: maskApiKey(keyInfo.key),
    email: keyInfo.email,
    credits: keyInfo.credits === Infinity ? null : keyInfo.credits,
    creditsUsed: keyInfo.creditsUsed,
    amountPaid: keyInfo.amountPaid,
    isEnvKey: keyInfo.isEnvKey,
    totpEnabled,
  });
});

// ─── GET /v1/auth/estimate?skillId= — estimate cost for a skill invocation ────

authRouter.get('/estimate', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const skillId = c.req.query('skillId');
  if (!skillId) return c.json({ error: 'skillId query param required', code: 'MISSING_FIELD' }, 400);

  const skill = getSkill(skillId);
  if (!skill) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
  if (!skill.public && skill.author_key !== keyInfo.key) {
    return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
  }

  const minCost = Math.max(0.001, skill.credit_cost);

  return c.json({
    skillId,
    skillName: skill.display_name ?? skill.name,
    estimatedCredits: minCost,
    note: skill.skill_type === 'prompt_template'
      ? 'Prompt template skills may cost more depending on API usage'
      : 'Fixed cost per invocation',
    creditCost: skill.credit_cost,
    canAfford: keyInfo.isEnvKey || keyInfo.credits >= minCost,
  });
});

// ─── GET /v1/auth/usage — usage summary for current key ──────────────────────

authRouter.get('/usage', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const stats = getUsageStats(keyInfo.key);
  return c.json({
    credits: keyInfo.credits === Infinity ? null : keyInfo.credits,
    creditsUsed: keyInfo.creditsUsed,
    ...stats,
  });
});

// ─── POST /v1/credits/deduct — deduct credits (for Pulse/Radar hosted) ───────

authRouter.post('/deduct', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { amount, reason } = c.req.query() as any;
  const idempotencyKey = c.req.header('Idempotency-Key') || '';
  const body = c.req.raw.clone();

  // Parse from body if not in query
  return body.json().then((data: any) => {
    const deductAmount = Number(data.amount || amount);
    const deductReason = String(data.reason || reason || 'pulse');

    if (!deductAmount || deductAmount <= 0 || deductAmount > 1000) {
      return c.json({ error: 'Invalid amount (0-1000)', code: 'INVALID_AMOUNT' }, 400);
    }

    // Idempotency: if this key was already processed, return the original result
    if (idempotencyKey) {
      const existing = getDb()
        .prepare('SELECT amount, reason FROM deduction_idempotency WHERE idempotency_key = ?')
        .get(idempotencyKey) as { amount: number; reason: string } | undefined;
      if (existing) {
        return c.json({
          ok: true,
          deducted: existing.amount,
          reason: existing.reason,
          remaining: keyInfo.credits,
          idempotent: true,
        });
      }
    }

    const deducted = deductCredit(keyInfo.key, deductAmount);
    if (!deducted) {
      return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', credits: keyInfo.credits }, 402);
    }

    // Record idempotency key (best-effort, INSERT OR IGNORE prevents duplicates)
    if (idempotencyKey) {
      try {
        const db = getDb();
        db.prepare('INSERT OR IGNORE INTO deduction_idempotency (idempotency_key, api_key, amount, reason) VALUES (?, ?, ?, ?)')
          .run(idempotencyKey, keyInfo.key, deductAmount, deductReason);
        // Purge records older than 24h (self-cleaning, prevents unbounded growth)
        db.prepare("DELETE FROM deduction_idempotency WHERE created_at < datetime('now', '-1 day')").run();
      } catch { /* best-effort */ }
    }

    logAudit({
      entityType: 'credit',
      entityId: keyInfo.key,
      action: 'pulse_deduct',
      data: { amount: deductAmount, reason: deductReason },
    });

    return c.json({
      ok: true,
      deducted: deductAmount,
      reason: deductReason,
      remaining: keyInfo.credits - deductAmount,
    });
  }).catch(() => {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  });
});
