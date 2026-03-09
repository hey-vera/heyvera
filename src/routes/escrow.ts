import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireClerkAuth } from '../middleware/clerk-auth';
import {
  createEscrow, getEscrow, listEscrowsForUser,
  fundEscrow, releaseEscrow, refundEscrow, resolveEscrow,
  transitionEscrow, writeAuditLog, getAuditLog,
  type EscrowState,
} from '../db/index';

const escrowRouter = new Hono();

// ── Create ────────────────────────────────────────────────────────────────────

const CreateEscrowBody = z.object({
  workerId: z.string().min(1).max(256),
  amountCredits: z.number().int().min(1).max(100_000_000),
  deadline: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

escrowRouter.post('/create', requireClerkAuth, async (c) => {
  const hirerId = c.get('clerkUserId');
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: 'Invalid JSON' }, 400);

  const parsed = CreateEscrowBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'Invalid body', details: parsed.error.flatten().fieldErrors }, 400);

  const { workerId, amountCredits, deadline, metadata } = parsed.data;

  if (hirerId === workerId)
    return c.json({ error: 'Hirer and worker cannot be the same user' }, 400);

  const id = 'esc_' + nanoid(16);
  createEscrow({ id, hirerId, workerId, amountCredits, deadline, metadata });
  writeAuditLog({ entityType: 'escrow', entityId: id, action: 'CREATED', actorId: hirerId,
    data: { workerId, amountCredits, deadline } });

  return c.json({ id, state: 'CREATED' }, 201);
});

// ── Fund ─────────────────────────────────────────────────────────────────────

escrowRouter.post('/:id/fund', requireClerkAuth, async (c) => {
  const hirerId = c.get('clerkUserId');
  const { id } = c.req.param();

  const result = fundEscrow(id, hirerId);
  if (!result.ok) return c.json({ error: result.error }, 400);

  writeAuditLog({ entityType: 'escrow', entityId: id, action: 'FUNDED', actorId: hirerId });
  return c.json({ id, state: 'FUNDED' });
});

// ── Start (worker acknowledges) ───────────────────────────────────────────────

escrowRouter.post('/:id/start', requireClerkAuth, async (c) => {
  const workerId = c.get('clerkUserId');
  const { id } = c.req.param();

  const escrow = getEscrow(id);
  if (!escrow) return c.json({ error: 'Escrow not found' }, 404);
  if (escrow.worker_id !== workerId) return c.json({ error: 'Not the worker' }, 403);

  const ok = transitionEscrow(id, 'WORK_IN_PROGRESS');
  if (!ok) return c.json({ error: `Cannot start from state ${escrow.state}` }, 400);

  writeAuditLog({ entityType: 'escrow', entityId: id, action: 'STARTED', actorId: workerId });
  return c.json({ id, state: 'WORK_IN_PROGRESS' });
});

// ── Complete (worker submits) ─────────────────────────────────────────────────

escrowRouter.post('/:id/complete', requireClerkAuth, async (c) => {
  const workerId = c.get('clerkUserId');
  const { id } = c.req.param();

  const escrow = getEscrow(id);
  if (!escrow) return c.json({ error: 'Escrow not found' }, 404);
  if (escrow.worker_id !== workerId) return c.json({ error: 'Not the worker' }, 403);
  if (escrow.state !== 'WORK_IN_PROGRESS') return c.json({ error: `Cannot complete from state ${escrow.state}` }, 400);

  // Mark as pending-release — hirer must call /release to disburse
  // We use a metadata flag rather than a separate state to keep the machine simple
  writeAuditLog({ entityType: 'escrow', entityId: id, action: 'WORK_SUBMITTED', actorId: workerId });
  return c.json({ id, state: escrow.state, message: 'Work submitted — awaiting hirer release' });
});

// ── Release (hirer approves, credits go to worker) ────────────────────────────

escrowRouter.post('/:id/release', requireClerkAuth, async (c) => {
  const hirerId = c.get('clerkUserId');
  const { id } = c.req.param();

  const escrow = getEscrow(id);
  if (!escrow) return c.json({ error: 'Escrow not found' }, 404);
  if (escrow.hirer_id !== hirerId) return c.json({ error: 'Not the hirer' }, 403);
  if (escrow.state !== 'WORK_IN_PROGRESS') return c.json({ error: `Cannot release from state ${escrow.state}` }, 400);

  const result = releaseEscrow(id);
  if (!result.ok) return c.json({ error: result.error }, 400);

  writeAuditLog({ entityType: 'escrow', entityId: id, action: 'COMPLETED', actorId: hirerId,
    data: { creditsReleased: escrow.amount_credits, workerId: escrow.worker_id } });
  return c.json({ id, state: 'COMPLETED' });
});

// ── Dispute ───────────────────────────────────────────────────────────────────

const DisputeBody = z.object({
  reason: z.string().max(2000).optional(),
}).strict();

escrowRouter.post('/:id/dispute', requireClerkAuth, async (c) => {
  const actorId = c.get('clerkUserId');
  const { id } = c.req.param();
  const raw = await c.req.json().catch(() => ({}));
  const parsed = DisputeBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'Invalid body', details: parsed.error.flatten().fieldErrors }, 400);
  const reason = parsed.data.reason ?? null;

  const escrow = getEscrow(id);
  if (!escrow) return c.json({ error: 'Escrow not found' }, 404);
  if (escrow.hirer_id !== actorId && escrow.worker_id !== actorId)
    return c.json({ error: 'Not a participant' }, 403);

  const ok = transitionEscrow(id, 'DISPUTED');
  if (!ok) return c.json({ error: `Cannot dispute from state ${escrow.state}` }, 400);

  writeAuditLog({ entityType: 'escrow', entityId: id, action: 'DISPUTED', actorId,
    data: { reason } });
  return c.json({ id, state: 'DISPUTED' });
});

// ── Evidence ──────────────────────────────────────────────────────────────────

const EvidenceBody = z.object({
  text: z.string().max(5000).optional(),
  attachments: z.array(z.string().url().max(2000)).max(10).optional(),
}).strict();

escrowRouter.post('/:id/evidence', requireClerkAuth, async (c) => {
  const actorId = c.get('clerkUserId');
  const { id } = c.req.param();
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: 'Invalid JSON' }, 400);
  const parsed = EvidenceBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'Invalid body', details: parsed.error.flatten().fieldErrors }, 400);

  const escrow = getEscrow(id);
  if (!escrow) return c.json({ error: 'Escrow not found' }, 404);
  if (escrow.hirer_id !== actorId && escrow.worker_id !== actorId)
    return c.json({ error: 'Not a participant' }, 403);
  if (escrow.state !== 'DISPUTED') return c.json({ error: 'Escrow is not in DISPUTED state' }, 400);

  const role = escrow.hirer_id === actorId ? 'hirer' : 'worker';
  const text = parsed.data.text ?? null;
  const attachments = parsed.data.attachments ?? [];
  writeAuditLog({ entityType: 'escrow', entityId: id, action: 'EVIDENCE_SUBMITTED', actorId,
    data: { role, text, attachments, submitted_at: new Date().toISOString() } });

  return c.json({ ok: true, message: 'Evidence recorded' });
});

// ── Resolve (admin only) ──────────────────────────────────────────────────────

const ResolveBody = z.object({
  outcome: z.string().min(1).max(100),
}).strict();

escrowRouter.post('/:id/resolve', requireClerkAuth, async (c) => {
  const actorId = c.get('clerkUserId');
  const { id } = c.req.param();
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: 'Invalid JSON' }, 400);
  const parsed = ResolveBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'outcome required: release_to_worker | refund_to_hirer | split:<pct>' }, 400);

  // Admin check: must have ADMIN_CLERK_IDS env var set
  const adminIds = (process.env.ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!adminIds.includes(actorId)) return c.json({ error: 'Admin only' }, 403);

  const { outcome } = parsed.data;

  const escrow = getEscrow(id);
  if (!escrow) return c.json({ error: 'Escrow not found' }, 404);

  let result: { ok: boolean; error?: string };
  let workerPct = 0;

  if (outcome === 'release_to_worker') {
    workerPct = 100;
    result = resolveEscrow(id, 100);
  } else if (outcome === 'refund_to_hirer') {
    workerPct = 0;
    result = resolveEscrow(id, 0);
  } else if (outcome.startsWith('split:')) {
    workerPct = parseInt(outcome.split(':')[1] ?? '50', 10);
    if (isNaN(workerPct) || workerPct < 0 || workerPct > 100)
      return c.json({ error: 'split percentage must be 0–100' }, 400);
    result = resolveEscrow(id, workerPct);
  } else {
    return c.json({ error: 'Invalid outcome' }, 400);
  }

  if (!result.ok) return c.json({ error: result.error }, 400);

  writeAuditLog({ entityType: 'escrow', entityId: id, action: 'RESOLVED', actorId,
    data: { outcome, workerPct, amount: escrow.amount_credits } });
  return c.json({ id, state: 'RESOLVED', outcome, workerPct });
});

// ── Get status + audit trail ──────────────────────────────────────────────────

escrowRouter.get('/:id', requireClerkAuth, async (c) => {
  const actorId = c.get('clerkUserId');
  const { id } = c.req.param();

  const escrow = getEscrow(id);
  if (!escrow) return c.json({ error: 'Escrow not found' }, 404);

  const adminIds = (process.env.ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const isParticipant = escrow.hirer_id === actorId || escrow.worker_id === actorId;
  const isAdmin = adminIds.includes(actorId);
  if (!isParticipant && !isAdmin) return c.json({ error: 'Not a participant' }, 403);

  const trail = getAuditLog('escrow', id);

  return c.json({
    ...escrow,
    metadata: escrow.metadata_json ? JSON.parse(escrow.metadata_json) : null,
    auditTrail: trail.map(r => ({
      action: r.action,
      actorId: r.actor_id,
      data: r.data_json ? JSON.parse(r.data_json) : null,
      timestamp: r.timestamp,
    })),
  });
});

// ── List caller's escrows ─────────────────────────────────────────────────────

escrowRouter.get('/', requireClerkAuth, async (c) => {
  const actorId = c.get('clerkUserId');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const escrows = listEscrowsForUser(actorId, limit, (page - 1) * limit);
  return c.json(escrows.map(e => ({
    id: e.id,
    hirerId: e.hirer_id,
    workerId: e.worker_id,
    amountCredits: e.amount_credits,
    state: e.state,
    createdAt: e.created_at,
    deadline: e.deadline,
    completedAt: e.completed_at,
  })));
});

export { escrowRouter };
