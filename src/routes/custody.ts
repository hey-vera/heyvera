/**
 * Data Custody Routes — Soma Protocol primitive
 *
 * Cryptographic proof of honest data handling:
 *   POST /v1/soma/custody/accept    — Agent commits to custodying user data
 *   POST /v1/soma/custody/access    — Log a data access event
 *   POST /v1/soma/custody/release   — Crypto-shred: destroy DEK, publish proof
 *   GET  /v1/soma/custody/:did/:subjectId — Get custody chain (verifiable audit trail)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { resolveAgentDid } from '../core/soma-heartbeat';
import {
  acceptCustody,
  logCustodyAccess,
  releaseCustody,
  getCustodyStatus,
} from '../core/soma-custody';
import { somaHash } from '../utils/crypto-agility';
import { logger } from '../utils/logger';

export const custodyRouter = new Hono();

// ─── Accept Custody ─────────────────────────────────────────────────────────

const acceptSchema = z.object({
  subjectId: z.string().min(1).max(256),
  dekFingerprint: z.string().min(16).max(128),
  fieldsManifest: z.array(z.string()).optional(),
});

custodyRouter.post('/accept', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const body = await c.req.json().catch(() => null);
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', code: 'INVALID_CUSTODY_ACCEPT', details: parsed.error.issues }, 400);
  }

  const agentDid = resolveAgentDid(keyInfo.key);
  const { subjectId, dekFingerprint, fieldsManifest } = parsed.data;

  try {
    const result = acceptCustody(agentDid, subjectId, dekFingerprint, fieldsManifest);
    return c.json({
      ok: true,
      custody: {
        custodyId: result.custodyId,
        agentDid: result.agentDid,
        subjectId: somaHash(subjectId), // return hashed for privacy
        dekFingerprint: result.dekFingerprint,
        heartbeatIndex: result.heartbeatIndex,
        pulseRoot: result.pulseRoot,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'CUSTODY_ACCEPT_FAILED' }, 409);
  }
});

// ─── Log Access ─────────────────────────────────────────────────────────────

const accessSchema = z.object({
  subjectId: z.string().min(1).max(256),
  reason: z.string().min(1).max(256),
  fieldsAccessed: z.array(z.string()).optional(),
});

custodyRouter.post('/access', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const body = await c.req.json().catch(() => null);
  const parsed = accessSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', code: 'INVALID_CUSTODY_ACCESS', details: parsed.error.issues }, 400);
  }

  const agentDid = resolveAgentDid(keyInfo.key);
  const { subjectId, reason, fieldsAccessed } = parsed.data;

  const result = logCustodyAccess(agentDid, subjectId, reason, fieldsAccessed);
  return c.json({
    ok: true,
    access: {
      eventId: result.eventId,
      agentDid: result.agentDid,
      heartbeatIndex: result.heartbeatIndex,
    },
  });
});

// ─── Release Custody (Crypto-Shred) ────────────────────────────────────────

const releaseSchema = z.object({
  subjectId: z.string().min(1).max(256),
  destructionProof: z.string().min(16).max(512),
});

custodyRouter.post('/release', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const body = await c.req.json().catch(() => null);
  const parsed = releaseSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', code: 'INVALID_CUSTODY_RELEASE', details: parsed.error.issues }, 400);
  }

  const agentDid = resolveAgentDid(keyInfo.key);
  const { subjectId, destructionProof } = parsed.data;

  try {
    const result = releaseCustody(agentDid, subjectId, destructionProof);
    return c.json({
      ok: true,
      release: {
        agentDid: result.agentDid,
        subjectId: somaHash(subjectId),
        destructionProof: result.destructionProof,
        heartbeatIndex: result.heartbeatIndex,
        pulseRoot: result.pulseRoot,
        totalAccesses: result.totalAccesses,
        custodyDurationHours: result.custodyDurationHours,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'CUSTODY_RELEASE_FAILED' }, 400);
  }
});

// ─── Query Custody Chain ────────────────────────────────────────────────────

custodyRouter.get('/:did/:subjectId', async (c) => {
  const { did, subjectId } = c.req.param();

  const status = getCustodyStatus(did, subjectId);
  if (status.status === 'none') {
    return c.json({ error: 'No custody record found', code: 'NO_CUSTODY_RECORD' }, 404);
  }

  return c.json({
    ok: true,
    custody: {
      agentDid: status.agentDid,
      subjectId: somaHash(status.subjectId),
      status: status.status,
      dekFingerprint: status.dekFingerprint,
      acceptedAt: status.acceptedAt,
      releasedAt: status.releasedAt,
      totalAccesses: status.totalAccesses,
      lastAccessAt: status.lastAccessAt,
      destructionProof: status.destructionProof,
      chainLength: status.chain.length,
      chain: status.chain.map(e => ({
        id: e.id,
        eventType: e.eventType,
        pulseLeafIndex: e.pulseLeafIndex,
        createdAt: e.createdAt,
        // Only include non-null fields
        ...(e.dekFingerprint ? { dekFingerprint: e.dekFingerprint } : {}),
        ...(e.destructionProof ? { destructionProof: e.destructionProof } : {}),
        ...(e.fieldsAccessed ? { fieldsAccessed: e.fieldsAccessed } : {}),
        ...(e.accessReason ? { reason: e.accessReason } : {}),
      })),
    },
  });
});
