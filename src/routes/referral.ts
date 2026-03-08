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

  // Generate a short, readable code: CN-XXXXXX
  const code = 'CN-' + crypto.randomBytes(3).toString('hex').toUpperCase();
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

  // Check not already used by this key (stored in a simple join table)
  const db = getDb();
  const alreadyUsed = db
    .prepare('SELECT 1 FROM referral_uses WHERE referree_key = ?')
    .get(keyInfo.key);
  if (alreadyUsed) return c.json({ error: 'You have already used a referral code' }, 409);

  // Ensure referral_uses table exists (idempotent)
  db.exec(`CREATE TABLE IF NOT EXISTS referral_uses (
    referree_key TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Bonus = 5% of current credits (min 50, max 5000)
  const bonus = Math.min(5000, Math.max(50, Math.floor(keyInfo.credits * 0.05)));

  // Give bonus to referree
  topUpCredits(keyInfo.key, bonus);

  // Give same bonus to referrer
  topUpCredits(ref.owner_key, bonus);

  // Record usage
  db.prepare('INSERT OR IGNORE INTO referral_uses (referree_key, code) VALUES (?, ?)').run(keyInfo.key, code);
  incrementReferralUse(code);

  logger.info({ referree: keyInfo.key.slice(0, 8), referrer: ref.owner_key.slice(0, 8), bonus, code }, 'Referral applied');

  return c.json({
    ok: true,
    bonusCredits: bonus,
    message: `${bonus.toLocaleString()} bonus credits added to your account — and the same to your referrer.`,
  });
});
