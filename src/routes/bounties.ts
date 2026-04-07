import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import {
  createBounty,
  getBounty,
  listBounties,
  countBounties,
  claimBounty,
  submitBounty,
  completeBounty,
  cancelBounty,
} from '../db/bounties';
import { deductCredit, topUpCredits, getDb } from '../db/index';

const router = new Hono();

const createBountySchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  requirements: z.record(z.unknown()).optional(),
  rewardCredits: z.number().min(1),
  deadline: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
});

const submitSchema = z.object({
  submissionUrl: z.string().url(),
});

router.get('/', (c) => {
  const status = c.req.query('status');
  const category = c.req.query('category');
  const tag = c.req.query('tag');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;

  const bounties = listBounties({ status, category, tag, limit, offset });
  const total = countBounties({ status, category });

  return c.json({ bounties, total, limit, offset });
});

router.get('/:id', (c) => {
  const bounty = getBounty(c.req.param('id'));
  if (!bounty) return c.json({ error: 'Bounty not found', code: 'NOT_FOUND' }, 404);
  return c.json(bounty);
});

router.post('/', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const parsed = createBountySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' }, 400);
  }

  const { title, description, requirements, rewardCredits, deadline, tags, category } = parsed.data;

  // Escrow + create in one transaction so credits aren't lost if createBounty throws
  try {
    const bounty = getDb().transaction(() => {
      const deducted = deductCredit(keyInfo.key, rewardCredits);
      if (!deducted) return null;

      return createBounty({
        creatorKey: keyInfo.key,
        title,
        description,
        requirements,
        rewardCredits,
        deadline,
        tags,
        category,
      });
    })();

    if (!bounty) {
      return c.json({ error: 'Insufficient credits to fund bounty', code: 'INSUFFICIENT_CREDITS' }, 402);
    }

    return c.json({ ok: true, bounty }, 201);
  } catch {
    return c.json({ error: 'Failed to create bounty', code: 'CREATE_FAILED' }, 500);
  }
});

router.post('/:id/claim', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const id = c.req.param('id');

  const bounty = getBounty(id);
  if (!bounty) return c.json({ error: 'Bounty not found', code: 'NOT_FOUND' }, 404);

  if (bounty.creator_key === keyInfo.key) {
    return c.json({ error: 'Cannot claim your own bounty', code: 'SELF_CLAIM' }, 400);
  }

  const claimed = claimBounty(id, keyInfo.key);
  if (!claimed) {
    return c.json({ error: 'Bounty is not available for claiming', code: 'NOT_CLAIMABLE' }, 409);
  }

  return c.json({ ok: true, bountyId: id });
});

router.post('/:id/submit', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const id = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' }, 400);
  }

  const submitted = submitBounty(id, keyInfo.key, parsed.data.submissionUrl);
  if (!submitted) {
    return c.json({ error: 'Cannot submit — bounty is not claimed by you or not in claimed status', code: 'SUBMIT_FAILED' }, 400);
  }

  return c.json({ ok: true, bountyId: id });
});

router.post('/:id/complete', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const id = c.req.param('id');

  const bounty = getBounty(id);
  if (!bounty) return c.json({ error: 'Bounty not found', code: 'NOT_FOUND' }, 404);
  if (bounty.creator_key !== keyInfo.key) {
    return c.json({ error: 'Only the bounty creator can approve completion', code: 'FORBIDDEN' }, 403);
  }
  if (bounty.status !== 'submitted') {
    return c.json({ error: 'Bounty must be in submitted status to complete', code: 'INVALID_STATUS' }, 400);
  }

  const completed = completeBounty(id, keyInfo.key);
  if (!completed) {
    return c.json({ error: 'Failed to complete bounty', code: 'COMPLETE_FAILED' }, 500);
  }

  return c.json({ ok: true, bountyId: id, rewardCredits: bounty.reward_credits, paidTo: bounty.claimed_by });
});

router.delete('/:id', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const id = c.req.param('id');

  const bounty = getBounty(id);
  if (!bounty) return c.json({ error: 'Bounty not found', code: 'NOT_FOUND' }, 404);
  if (bounty.creator_key !== keyInfo.key) {
    return c.json({ error: 'Only the bounty creator can cancel', code: 'FORBIDDEN' }, 403);
  }

  const cancelled = cancelBounty(id, keyInfo.key);
  if (!cancelled) {
    return c.json({ error: 'Bounty can only be cancelled when open', code: 'NOT_CANCELLABLE' }, 400);
  }

  // Refund escrowed credits to creator
  topUpCredits(keyInfo.key, bounty.reward_credits);

  return c.json({ ok: true, bountyId: id, refundedCredits: bounty.reward_credits });
});

export { router as bountiesRouter };
