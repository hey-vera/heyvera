/**
 * aid-freeze.ts — Trust freeze management endpoints (Section 39.18)
 *
 * Endpoints:
 *   POST /aid/freeze/:did       — freeze an agent (admin/guardian)
 *   POST /aid/unfreeze/:did     — unfreeze (admin, with review)
 *   GET  /aid/freeze-status/:did — check freeze status
 *   POST /aid/challenge/:did    — challenge a freeze (agent self-service)
 *
 * Freeze states:
 *   ACTIVE       — normal operation
 *   SOFT_FREEZE  — existing counterparties only, reduced tx limits
 *   FROZEN       — fully frozen, no transactions
 *   CHALLENGE    — agent challenged the freeze, under review
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb, logAudit } from '../db/connection';
import { checkApiKey } from '../middleware/auth';
import { logger } from '../utils/logger';
import { emitFreezeEvent, emitAvoidFlagged } from './aid-stream';

const router = new Hono();

type FreezeState = 'active' | 'soft_freeze' | 'frozen' | 'challenge';

// ─── POST /freeze/:did — Freeze an agent ─────────────────────────────────────

router.post('/freeze/:did', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo') as any;
  const body = await c.req.json().catch(() => null);

  if (!body || !body.reason) {
    return c.json({ error: 'Missing required field: reason', code: 'AID_INVALID' }, 400);
  }

  const { reason, freezeType } = body;
  const type: FreezeState = freezeType === 'soft' ? 'soft_freeze' : 'frozen';

  // Verify the caller is admin or a guardian for this agent
  const isAdmin = keyInfo.is_admin;
  const isGuardian = getDb().prepare(`
    SELECT 1 FROM aid_guardian_assignments
    WHERE agent_did = ? AND guardian_did IN (
      SELECT guardian_did FROM aid_guardians WHERE guardian_owner_key = ?
    ) AND status = 'active' LIMIT 1
  `).get(did, keyInfo.api_key_hash);

  if (!isAdmin && !isGuardian) {
    return c.json({ error: 'Only admins or assigned guardians can freeze agents', code: 'AID_UNAUTHORIZED' }, 403);
  }

  try {
    // Update freeze status
    getDb().prepare(`
      UPDATE aid_keys SET frozen = 1, proof_of_life_status = ?
      WHERE did = ? AND key_status = 'active'
    `).run(type, did);

    // Record freeze event
    getDb().prepare(`
      INSERT INTO aid_trust_events (event_type, provider_did, data_json)
      VALUES ('freeze', ?, ?)
    `).run(did, JSON.stringify({ reason, freezeType: type, actor: keyInfo.api_key_hash }));

    logAudit({ entityType: 'aid_key', entityId: did, action: 'frozen', actorId: keyInfo.api_key_hash, data: { reason, type } });

    // Emit SSE event for real-time propagation
    emitFreezeEvent(did, reason, type);
    if (type === 'frozen') {
      emitAvoidFlagged(did, reason);
    }

    return c.json({
      did,
      freezeState: type,
      reason,
      frozenAt: new Date().toISOString(),
      message: type === 'soft_freeze'
        ? 'Soft freeze applied — agent can transact with existing counterparties only'
        : 'Agent fully frozen — no transactions allowed',
    });
  } catch (err: any) {
    logger.error({ err }, 'Freeze failed');
    return c.json({ error: 'Freeze operation failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

// ─── POST /unfreeze/:did — Unfreeze an agent (admin only) ────────────────────

router.post('/unfreeze/:did', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo') as any;

  if (!keyInfo.is_admin) {
    return c.json({ error: 'Only admins can unfreeze agents', code: 'AID_UNAUTHORIZED' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));

  try {
    getDb().prepare(`
      UPDATE aid_keys SET frozen = 0, proof_of_life_status = 'active'
      WHERE did = ? AND key_status = 'active'
    `).run(did);

    getDb().prepare(`
      INSERT INTO aid_trust_events (event_type, provider_did, data_json)
      VALUES ('unfreeze', ?, ?)
    `).run(did, JSON.stringify({ reason: body.reason || 'admin review', actor: keyInfo.api_key_hash }));

    logAudit({ entityType: 'aid_key', entityId: did, action: 'unfrozen', actorId: keyInfo.api_key_hash });

    return c.json({ did, freezeState: 'active', unfrozenAt: new Date().toISOString() });
  } catch (err: any) {
    logger.error({ err }, 'Unfreeze failed');
    return c.json({ error: 'Unfreeze failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

// ─── GET /freeze-status/:did — Check freeze status ──────────────────────────

router.get('/freeze-status/:did', async (c) => {
  const did = c.req.param('did');

  const key = getDb().prepare(`
    SELECT frozen, proof_of_life_status, last_heartbeat
    FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1
  `).get(did) as { frozen: number; proof_of_life_status: string; last_heartbeat: string | null } | undefined;

  if (!key) {
    return c.json({ error: 'Agent not found', code: 'AID_DID_NOT_FOUND' }, 404);
  }

  // Get recent freeze events
  const events = getDb().prepare(`
    SELECT event_type, data_json, created_at FROM aid_trust_events
    WHERE provider_did = ? AND event_type IN ('freeze', 'unfreeze', 'challenge')
    ORDER BY created_at DESC LIMIT 5
  `).all(did) as Array<{ event_type: string; data_json: string; created_at: string }>;

  // Check for active challenge
  const activeChallenge = getDb().prepare(`
    SELECT id, status, created_at FROM aid_appeals
    WHERE did = ? AND status = 'pending' LIMIT 1
  `).get(did) as { id: string; status: string; created_at: string } | undefined;

  return c.json({
    did,
    frozen: !!key.frozen,
    freezeState: key.proof_of_life_status || 'active',
    lastHeartbeat: key.last_heartbeat,
    activeChallenge: activeChallenge ? { id: activeChallenge.id, since: activeChallenge.created_at } : null,
    recentEvents: events.map(e => ({
      type: e.event_type,
      data: JSON.parse(e.data_json || '{}'),
      at: e.created_at,
    })),
  });
});

// ─── POST /challenge/:did — Challenge a freeze (agent self-service) ──────────

router.post('/challenge/:did', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo') as any;
  const body = await c.req.json().catch(() => null);

  if (!body || !body.reason) {
    return c.json({ error: 'Missing required field: reason', code: 'AID_INVALID' }, 400);
  }

  // Verify the caller owns this DID
  const aidKey = getDb().prepare(
    `SELECT 1 FROM aid_keys WHERE did = ? AND owner_key = ? LIMIT 1`
  ).get(did, keyInfo.api_key_hash);

  if (!aidKey) {
    return c.json({ error: 'You can only challenge freezes on your own DID', code: 'AID_UNAUTHORIZED' }, 403);
  }

  // Check for existing pending challenge
  const existing = getDb().prepare(
    `SELECT 1 FROM aid_appeals WHERE did = ? AND status = 'pending' LIMIT 1`
  ).get(did);

  if (existing) {
    return c.json({ error: 'A challenge is already pending for this DID', code: 'AID_DUPLICATE' }, 409);
  }

  const challengeId = `chal-${nanoid(16)}`;

  try {
    getDb().prepare(`
      INSERT INTO aid_appeals (id, did, reason, status)
      VALUES (?, ?, ?, 'pending')
    `).run(challengeId, did, body.reason.slice(0, 2000));

    // Update freeze state to 'challenge'
    getDb().prepare(`
      UPDATE aid_keys SET proof_of_life_status = 'challenge' WHERE did = ?
    `).run(did);

    getDb().prepare(`
      INSERT INTO aid_trust_events (event_type, provider_did, data_json)
      VALUES ('challenge', ?, ?)
    `).run(did, JSON.stringify({ challengeId, reason: body.reason.slice(0, 200) }));

    logAudit({ entityType: 'challenge', entityId: challengeId, action: 'filed', actorId: keyInfo.api_key_hash });

    return c.json({
      challengeId,
      did,
      status: 'pending',
      message: 'Challenge filed. Platform will review within 48 hours. Freeze state changed to CHALLENGE (limited operations allowed).',
    }, 201);
  } catch (err: any) {
    logger.error({ err }, 'Challenge filing failed');
    return c.json({ error: 'Challenge failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

export { router as aidFreezeRouter };
