import { Hono } from 'hono';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import { requireClerkAuth } from '../middleware/clerk-auth';
import { createReferralCode, getReferralCode, getReferralCodeByOwner, applyReferralCode, getApiKeyByClerkId } from '../db/index';
import { maskApiKey } from '../utils/mask';
import { env } from '../config/index';
import { logger } from '../utils/logger';

export const referralRouter = new Hono();

// Referral codes use a human-readable alphabet: no O/0 or I/1 confusion
const makeCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

// GET /v1/referral/my-code — get or auto-create your referral code
referralRouter.get('/my-code', requireClerkAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const keyRow = getApiKeyByClerkId(clerkUserId);
  if (!keyRow) return c.json({ error: 'No API key found for this account', code: 'NOT_FOUND' }, 404);
  const key = keyRow.key;

  let referral = getReferralCodeByOwner(key);

  if (!referral) {
    // Generate a unique code — retry on (extremely unlikely) collision
    let code: string;
    let attempts = 0;
    do {
      code = makeCode();
      attempts++;
    } while (getReferralCode(code) && attempts < 10);

    createReferralCode(code!, key);
    referral = { code: code!, uses: 0 };
    logger.info({ key: maskApiKey(key), code: code! }, 'Referral code created');
  }

  return c.json({
    code: referral.code,
    uses: referral.uses,
    shareUrl: `https://claw-net.org/?ref=${referral.code}`,
    bonusCreditsForFriend: env.REFERRAL_BONUS_RECEIVER,
    bonusCreditsForYou: env.REFERRAL_BONUS_OWNER,
    hint: `Share your code. When a friend applies it, you both earn credits.`,
  });
});

const ApplySchema = z.object({
  code: z.string().min(4).max(20),
});

// POST /v1/referral/apply — apply a friend's referral code (one-time, idempotent)
referralRouter.post('/apply', requireClerkAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');
  const keyRow = getApiKeyByClerkId(clerkUserId);
  if (!keyRow) return c.json({ error: 'No API key found for this account', code: 'NOT_FOUND' }, 404);
  const referreeKey = keyRow.key;

  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const parsed = ApplySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const code = parsed.data.code.toUpperCase();
  const referralRecord = getReferralCode(code);

  if (!referralRecord) {
    return c.json({ error: 'Referral code not found', code: 'NOT_FOUND' }, 404);
  }

  const result = applyReferralCode(
    referreeKey,
    code,
    referralRecord.owner_key,
    env.REFERRAL_BONUS_RECEIVER,
    env.REFERRAL_BONUS_OWNER,
  );

  if (result === 'self_referral') {
    return c.json({ error: 'You cannot apply your own referral code', code: 'SELF_REFERRAL' }, 400);
  }
  if (result === 'already_used') {
    return c.json({ error: 'You have already applied a referral code', code: 'ALREADY_USED' }, 409);
  }

  logger.info({
    referreeKey: maskApiKey(referreeKey),
    code,
    bonusReceiver: env.REFERRAL_BONUS_RECEIVER,
    bonusOwner: env.REFERRAL_BONUS_OWNER,
  }, 'Referral applied');

  return c.json({
    ok: true,
    creditsAdded: env.REFERRAL_BONUS_RECEIVER,
    message: `${env.REFERRAL_BONUS_RECEIVER.toLocaleString()} credits added to your account. Your friend also received ${env.REFERRAL_BONUS_OWNER.toLocaleString()} credits.`,
  });
});
