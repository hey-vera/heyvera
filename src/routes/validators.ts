/**
 * Validator Routes — platform-native result verification.
 * Validators are promoted by admin and can verify transaction results.
 * Earns 0.5 credits per useful verification.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import {
  submitValidation, getValidationsForTransaction, getValidationsForSkill,
  getValidatorStats, getValidatorLeaderboard,
} from '../db/index';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';

export const validatorsRouter = new Hono();

validatorsRouter.use('*', checkApiKey);

// ─── POST /v1/validators/verify ─────────────────────────────────────────────

const VerifyBody = z.object({
  transactionId: z.string().min(1),
  verdict: z.enum(['VALID', 'INVALID', 'INCONCLUSIVE']),
  notes: z.string().max(500).optional(),
});

validatorsRouter.post('/verify', async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  const parsed = VerifyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }, 400);
  }

  try {
    const result = submitValidation({
      validatorKey: keyInfo.key,
      transactionId: parsed.data.transactionId,
      verdict: parsed.data.verdict,
      notes: parsed.data.notes,
    });

    logger.info({ validator: maskApiKey(keyInfo.key), txId: parsed.data.transactionId, verdict: parsed.data.verdict }, 'Validation submitted');

    return c.json({
      ok: true,
      validationId: result.id,
      verdict: result.verdict,
      rewardCredits: result.rewardCredits,
      message: `Verification recorded. ${result.rewardCredits} credits earned.`,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation failed';
    return c.json({ error: process.env.NODE_ENV === 'production' ? 'Validation failed' : msg, code: 'VALIDATION_FAILED' }, 400);
  }
});

// ─── GET /v1/validators/history ──────────────────────────────────────────────

validatorsRouter.get('/history', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const stats = getValidatorStats(keyInfo.key);
  return c.json(stats);
});

// ─── GET /v1/validators/leaderboard ──────────────────────────────────────────

validatorsRouter.get('/leaderboard', (c) => {
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  return c.json({ validators: getValidatorLeaderboard(limit) });
});

// ─── GET /v1/validators/transaction/:txId ────────────────────────────────────

validatorsRouter.get('/transaction/:txId', (c) => {
  const { txId } = c.req.param();
  return c.json({ validations: getValidationsForTransaction(txId) });
});

// ─── GET /v1/validators/skill/:skillId ───────────────────────────────────────

validatorsRouter.get('/skill/:skillId', (c) => {
  const { skillId } = c.req.param();
  return c.json(getValidationsForSkill(skillId));
});
