import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import {
  createSponsorship,
  getSponsorship,
  listSponsorships,
  deactivateSponsorship,
  topUpSponsorship,
} from '../db/sponsorship';
import { deductCredit } from '../db/index';

const router = new Hono();

const CreateSponsorshipSchema = z.object({
  skillId: z.string().min(1),
  totalCredits: z.number().min(1).max(100000),
  dailyLimitPerUser: z.number().min(0.1).max(1000).optional().default(10),
  maxUsesPerUser: z.number().int().min(1).max(10000).optional().default(100),
  expiresAt: z.string().optional(),
});

const TopUpSchema = z.object({
  credits: z.number().min(1).max(100000),
});

// POST / — create sponsorship
router.post('/', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const parsed = CreateSponsorshipSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' }, 400);
  }

  const { skillId, totalCredits, dailyLimitPerUser, maxUsesPerUser, expiresAt } = parsed.data;

  // Deduct credits from sponsor as escrow
  const deducted = deductCredit(keyInfo.key, totalCredits);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits to fund sponsorship', code: 'INSUFFICIENT_CREDITS' }, 402);
  }

  try {
    const sponsorship = createSponsorship({
      sponsorKey: keyInfo.key,
      skillId,
      totalCredits,
      dailyLimitPerUser,
      maxUsesPerUser,
      expiresAt,
    });

    return c.json({ ok: true, sponsorship }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create sponsorship', code: 'CREATE_FAILED' }, 500);
  }
});

// GET / — list my sponsorships
router.get('/', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const sponsorships = listSponsorships(keyInfo.key);
  return c.json({ sponsorships });
});

// GET /:id — get sponsorship details (public)
router.get('/:id', (c) => {
  const sponsorship = getSponsorship(c.req.param('id'));
  if (!sponsorship) {
    return c.json({ error: 'Sponsorship not found', code: 'NOT_FOUND' }, 404);
  }
  return c.json({ sponsorship });
});

// POST /:id/top-up — add more credits
router.post('/:id/top-up', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const id = c.req.param('id');

  const sponsorship = getSponsorship(id);
  if (!sponsorship) {
    return c.json({ error: 'Sponsorship not found', code: 'NOT_FOUND' }, 404);
  }
  if (sponsorship.sponsor_key !== keyInfo.key) {
    return c.json({ error: 'Only the sponsor can top up', code: 'FORBIDDEN' }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const parsed = TopUpSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' }, 400);
  }

  const { credits } = parsed.data;

  const deducted = deductCredit(keyInfo.key, credits);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits for top-up', code: 'INSUFFICIENT_CREDITS' }, 402);
  }

  const success = topUpSponsorship(id, keyInfo.key, credits);
  if (!success) {
    return c.json({ error: 'Failed to top up sponsorship', code: 'TOPUP_FAILED' }, 500);
  }

  const updated = getSponsorship(id);
  return c.json({ ok: true, sponsorship: updated });
});

// DELETE /:id — deactivate sponsorship
router.delete('/:id', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const id = c.req.param('id');

  const success = deactivateSponsorship(id, keyInfo.key);
  if (!success) {
    return c.json({ error: 'Sponsorship not found or not yours', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ ok: true, message: 'Sponsorship deactivated' });
});

export { router as sponsorshipRouter };
