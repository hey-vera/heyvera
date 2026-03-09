/**
 * Governance — on-platform proposals and weighted voting.
 * Proposal: any key with 100+ credits balance can propose.
 * Vote weight: sqrt(total credits spent on platform) — Quadratic-lite.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import {
  createProposal, getProposals, getProposal, castVote, getDb,
} from '../db/index';
import { logger } from '../utils/logger';

export const governanceRouter = new Hono();

// ─── GET /v1/governance/proposals ─────────────────────────────────────────────

governanceRouter.get('/proposals', (c) => {
  const rawStatus = c.req.query('status');
  const status = rawStatus && ['OPEN', 'CLOSED', 'EXECUTED'].includes(rawStatus) ? rawStatus : undefined;
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const proposals = getProposals(status, limit, (page - 1) * limit);
  const where = status ? `WHERE status = ?` : ``;
  const countRow = getDb().prepare(`SELECT COUNT(*) as total FROM proposals ${where}`).get(...(status ? [status] : [])) as { total: number };
  return c.json({ page, limit, total: countRow.total, proposals });
});

// ─── GET /v1/governance/proposals/:id ─────────────────────────────────────────

governanceRouter.get('/proposals/:id', (c) => {
  const { id } = c.req.param();
  const proposal = getProposal(id);
  if (!proposal) return c.json({ error: 'Proposal not found' }, 404);

  // Include votes
  const votes = getDb()
    .prepare(`SELECT voter_key, direction, weight, created_at FROM votes WHERE proposal_id = ? ORDER BY created_at DESC`)
    .all(id) as { voter_key: string; direction: string; weight: number; created_at: string }[];

  return c.json({
    ...proposal,
    votes: votes.map(v => ({
      voter: v.voter_key.slice(0, 8) + '...',
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
    return c.json({ error: `Need at least ${MIN_BALANCE} credits to propose` }, 403);
  }

  let body: z.infer<typeof ProposeBody>;
  try { body = ProposeBody.parse(await c.req.json()); } catch (err) {
    return c.json({ error: 'Invalid body', details: (err as Error).message }, 400);
  }

  const id = createProposal({
    title: body.title,
    description: body.description,
    proposedBy: keyInfo.key,
    closeDays: body.closeDays,
  });

  logger.info({ id, proposer: keyInfo.key.slice(0, 8), title: body.title }, 'Governance proposal created');

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
    return c.json({ error: 'Invalid body' }, 400);
  }

  // Vote weight = sqrt(total credits ever spent on platform), min 1
  // Exclude self-transfers and only count outgoing spend to prevent gaming
  const spent = (getDb()
    .prepare(`SELECT COALESCE(SUM(amount_credits),0) as total FROM transactions WHERE from_agent = ? AND (to_agent IS NULL OR to_agent != ?)`)
    .get(keyInfo.key, keyInfo.key) as { total: number }).total;
  const weight = Math.max(1, Math.sqrt(spent));

  const result = castVote({
    proposalId: id,
    voterKey: keyInfo.key,
    direction: body.direction,
    weight: +weight.toFixed(4),
  });

  if (!result.ok) return c.json({ error: result.error }, 400);

  logger.info({ proposalId: id, voter: keyInfo.key.slice(0, 8), direction: body.direction, weight }, 'Vote cast');

  return c.json({
    ok: true,
    proposalId: id,
    direction: body.direction,
    weight: +weight.toFixed(4),
    message: `Vote recorded (weight: ${weight.toFixed(2)})`,
  });
});
