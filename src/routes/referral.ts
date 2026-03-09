import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import { getDb, createReferralCode, getReferralCode, getReferralCodeByOwner, incrementReferralUse, topUpCredits } from '../db/index';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export const referralRouter = new Hono();

// POST /v1/referral/generate — create a referral code for the authenticated user
referralRouter.post('/generate', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');

  // Check if they already have one
  const existing = getReferralCodeByOwner(keyInfo.key);
  if (existing) {
    return c.json({ code: existing.code, uses: existing.uses });
  }

  // Generate a code with strong entropy: CN-XXXXXXXXXXXXXXXX (8 bytes = 2^64 combinations)
  const code = 'CN-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  createReferralCode(code, keyInfo.key);
  logger.info({ key: keyInfo.key.slice(0, 8), code }, 'Referral code created');

  return c.json({ code, uses: 0 });
});

// GET /v1/referral/:code — validate a referral code
referralRouter.get('/:code', (c) => {
  const code = c.req.param('code').toUpperCase();
  const ref = getReferralCode(code);
  if (!ref) return c.json({ valid: false }, 404);
  return c.json({ valid: true, code: ref.code, uses: ref.uses });
});

// POST /v1/referral/apply — apply a referral code after purchase
// Awards 5% of current credit balance to new user, 5% to referrer
referralRouter.post('/apply', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let body: { code?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const code = (body.code ?? '').trim().toUpperCase();
  if (!code) return c.json({ error: 'Referral code required' }, 400);

  const ref = getReferralCode(code);
  if (!ref) return c.json({ error: 'Invalid referral code' }, 404);

  // Can't use your own code
  if (ref.owner_key === keyInfo.key) {
    return c.json({ error: 'Cannot apply your own referral code' }, 400);
  }

  // Bonus = 5% of current credits (min 50, max 5000)
  const bonus = Math.min(5000, Math.max(50, Math.floor(keyInfo.credits * 0.05)));

  // Atomic: INSERT referral_uses first — PRIMARY KEY constraint prevents double-spend
  // If changes === 0, this key already used a referral code
  const db = getDb();
  const applyReferral = db.transaction(() => {
    const result = db
      .prepare('INSERT OR IGNORE INTO referral_uses (referree_key, code) VALUES (?, ?)')
      .run(keyInfo.key, code);
    if (result.changes === 0) return false;

    const referreeResult = topUpCredits(keyInfo.key, bonus);
    if (!referreeResult.ok) throw new Error('Referree API key inactive');
    const referrerResult = topUpCredits(ref.owner_key, bonus);
    if (!referrerResult.ok) throw new Error('Referrer API key inactive');
    incrementReferralUse(code);
    return true;
  });

  const applied = applyReferral();
  if (!applied) return c.json({ error: 'You have already used a referral code' }, 409);

  logger.info({ referree: keyInfo.key.slice(0, 8), referrer: ref.owner_key.slice(0, 8), bonus, code }, 'Referral applied');

  return c.json({
    ok: true,
    bonusCredits: bonus,
    message: `${bonus.toLocaleString()} bonus credits added to your account — and the same to your referrer.`,
  });
});
