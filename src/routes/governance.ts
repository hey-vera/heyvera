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
  checkQuorum, executeProposal, safeJsonParse,
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

  const quorum = checkQuorum(id);

  return c.json({
    ...proposal,
    quorum: {
      required: proposal.quorum_pct > 0,
      pct: proposal.quorum_pct,
      met: quorum.met,
      voterCount: quorum.voterCount,
      requiredCount: quorum.requiredCount,
      activeKeys: quorum.activeKeys,
    },
    execution: proposal.executed_at ? {
      executedAt: proposal.executed_at,
      result: safeJsonParse(proposal.execution_result_json, null),
    } : null,
    votes: votes.map(v => ({
      voter: maskApiKey(v.voter_key),
      direction: v.direction,
      weight: v.weight,
      createdAt: v.created_at,
    })),
  });
});

// ─── POST /v1/governance/propose ─────────────────────────────────────────────

const BOND_CREDITS = 100; // locked on proposal, released on close

const ProposeBody = z.object({
  title: z.string().min(5).max(120),
  description: z.string().min(20).max(2000),
  closeDays: z.number().int().min(1).max(30).default(7),
  bond: z.boolean().default(true),
  quorumPct: z.number().min(0).max(51).default(0).optional(),
  actionType: z.enum(['SKILL_DELIST', 'SKILL_VERIFY', 'PARAMETER_CHANGE']).optional(),
  actionPayload: z.record(z.unknown()).optional(),
});

governanceRouter.post('/propose', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  const parsed = ProposeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }, 400);
  }
  const body = parsed.data;

  const bondAmount = body.bond ? BOND_CREDITS : 0;
  const minRequired = bondAmount > 0 ? bondAmount : 100;

  if (keyInfo.credits < minRequired) {
    return c.json({ error: `Need at least ${minRequired} credits${bondAmount > 0 ? ' (bond will be locked and released when proposal closes)' : ''}`, code: 'INSUFFICIENT_CREDITS' }, 403);
  }

  let id: string;
  try {
    id = createProposal({
      title: body.title,
      description: body.description,
      proposedBy: keyInfo.key,
      closeDays: body.closeDays,
      bondCredits: bondAmount,
      quorumPct: body.quorumPct,
      actionType: body.actionType,
      actionPayload: body.actionPayload,
    });
  } catch (err) {
    return c.json({ error: 'Failed to create proposal', code: 'PROPOSAL_FAILED' }, 500);
  }

  logger.info({ id, proposer: maskApiKey(keyInfo.key), title: body.title, bond: bondAmount }, 'Governance proposal created');

  return c.json({
    ok: true,
    proposalId: id,
    title: body.title,
    closesIn: `${body.closeDays} days`,
    bondLocked: bondAmount,
    message: bondAmount > 0
      ? `Proposal created. ${bondAmount} credits locked as bond — returned when proposal closes.`
      : 'Proposal created. Share the ID so others can vote.',
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
