/**
 * Governance — on-platform proposals and weighted voting.
 * Proposal: any key with 100+ credits balance can propose.
 * Vote weight: sqrt(total credits spent on platform) — Quadratic-lite.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import {
  createProposal, getProposals, getProposal, castVote, getProposalCount, getVoterWeight, getProposalVotes,
} from '../db/index';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';

export const governanceRouter = new Hono();

// ─── GET /v1/governance/proposals ─────────────────────────────────────────────

governanceRouter.get('/proposals', (c) => {
  const rawStatus = c.req.query('status');
  const status = rawStatus && ['OPEN', 'CLOSED', 'EXECUTED'].includes(rawStatus) ? rawStatus : undefined;
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const proposals = getProposals(status, limit, (page - 1) * limit);
  return c.json({ page, limit, total: getProposalCount(status), proposals });
});

// ─── GET /v1/governance/proposals/:id ─────────────────────────────────────────

governanceRouter.get('/proposals/:id', (c) => {
  const { id } = c.req.param();
  const proposal = getProposal(id);
  if (!proposal) return c.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, 404);

  const votes = getProposalVotes(id);

  return c.json({
    ...proposal,
    votes: votes.map(v => ({
      voter: maskApiKey(v.voter_key),
      direction: v.direction,
      weight: v.weight,
      createdAt: v.created_at,
    })),
  });
});

// ─── POST /v1/governance/propose ─────────────────────────────────────────────

const ProposeBody = z.object({
  title: z.string().min(5).max(120),
  description: z.string().min(20).max(2000),
  closeDays: z.number().int().min(1).max(30).default(7),
});

governanceRouter.post('/propose', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  const MIN_BALANCE = 100;
  if (keyInfo.credits < MIN_BALANCE) {
    return c.json({ error: `Need at least ${MIN_BALANCE} credits to propose`, code: 'INSUFFICIENT_CREDITS' }, 403);
  }

  const parsed = ProposeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }, 400);
  }
  const body = parsed.data;

  const id = createProposal({
    title: body.title,
    description: body.description,
    proposedBy: keyInfo.key,
    closeDays: body.closeDays,
  });

  logger.info({ id, proposer: maskApiKey(keyInfo.key), title: body.title }, 'Governance proposal created');

  return c.json({
    ok: true,
    proposalId: id,
    title: body.title,
    closesIn: `${body.closeDays} days`,
    message: 'Proposal created. Share the ID so others can vote.',
  }, 201);
});

// ─── POST /v1/governance/proposals/:id/vote ───────────────────────────────────

const VoteBody = z.object({
  direction: z.enum(['FOR', 'AGAINST']),
});

governanceRouter.post('/proposals/:id/vote', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  let body: z.infer<typeof VoteBody>;
  try { body = VoteBody.parse(await c.req.json()); } catch (err) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, 400);
  }

  const weight = getVoterWeight(keyInfo.key);

  const result = castVote({
    proposalId: id,
    voterKey: keyInfo.key,
    direction: body.direction,
    weight: +weight.toFixed(4),
  });

  if (!result.ok) return c.json({ error: result.error, code: 'VOTE_FAILED' }, 400);

  logger.info({ proposalId: id, voter: maskApiKey(keyInfo.key), direction: body.direction, weight }, 'Vote cast');

  return c.json({
    ok: true,
    proposalId: id,
    direction: body.direction,
    weight: +weight.toFixed(4),
    message: `Vote recorded (weight: ${weight.toFixed(2)})`,
  });
});
