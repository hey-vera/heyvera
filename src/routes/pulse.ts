import { Hono } from 'hono';
import { requireSocialAuth } from '../middleware/clerk-auth';
import {
  findSocialProfileByClerkId,
  createPulseDraft,
  listPulseDrafts,
  getPulseDraft,
  approvePulseDraft,
  rejectPulseDraft,
  publishPulseDraft,
  getPulseDraftAuditLog,
  type PulseDraftRow,
  type PulseAuditLogRow,
} from '../db/index';

export const pulseRouter = new Hono();

// ─── Transformers (DB snake_case -> API camelCase) ──────────────────────────

function draftToApi(d: PulseDraftRow) {
  return {
    id: d.id,
    profileId: d.profile_id,
    body: d.body,
    visibility: d.visibility,
    authorMode: d.author_mode,
    linkedAgentId: d.linked_agent_id,
    status: d.status,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

function auditEntryToApi(a: PulseAuditLogRow) {
  return {
    id: a.id,
    draftId: a.draft_id,
    action: a.action,
    actorProfileId: a.actor_profile_id,
    details: a.details ? JSON.parse(a.details) : null,
    createdAt: a.created_at,
  };
}

// ─── Helper: resolve profile or 404 ────────────────────────────────────────

function getProfileOrFail(c: { get: (key: string) => string; json: Function }) {
  const clerkUserId = c.get('clerkUserId');
  const profile = findSocialProfileByClerkId(clerkUserId);
  if (!profile) {
    return { error: true as const, response: c.json({ error: 'No profile found', code: 'NOT_FOUND' }, 404) };
  }
  return { error: false as const, profile };
}

// ─── POST /drafts — Create a draft ─────────────────────────────────────────

pulseRouter.post('/drafts', requireSocialAuth, async (c) => {
  const result = getProfileOrFail(c);
  if (result.error) return result.response;
  const { profile } = result;

  const body = await c.req.json<{
    body?: string;
    visibility?: string;
    authorMode?: string;
    linkedAgentId?: string;
  }>();

  const text = (body.body ?? '').trim();
  if (!text) {
    return c.json({ error: 'Draft body is required', code: 'INVALID_INPUT' }, 400);
  }
  if (text.length > 5000) {
    return c.json({ error: 'Draft body exceeds 5000 characters', code: 'INVALID_INPUT' }, 400);
  }

  const draft = createPulseDraft({
    profileId: profile.id,
    body: text,
    visibility: body.visibility,
    authorMode: body.authorMode,
    linkedAgentId: body.linkedAgentId ?? null,
  });

  return c.json({ ok: true, draft: draftToApi(draft) }, 201);
});

// ─── GET /drafts — List user's drafts ──────────────────────────────────────

pulseRouter.get('/drafts', requireSocialAuth, (c) => {
  const result = getProfileOrFail(c);
  if (result.error) return result.response;
  const { profile } = result;

  const status = c.req.query('status');
  const validStatuses = ['pending', 'approved', 'rejected', 'published'];
  if (status && !validStatuses.includes(status)) {
    return c.json({ error: `Invalid status filter. Must be one of: ${validStatuses.join(', ')}`, code: 'INVALID_INPUT' }, 400);
  }

  const drafts = listPulseDrafts(profile.id, status);
  return c.json({ drafts: drafts.map(draftToApi) });
});

// ─── GET /drafts/:id — Get single draft ────────────────────────────────────

pulseRouter.get('/drafts/:id', requireSocialAuth, (c) => {
  const result = getProfileOrFail(c);
  if (result.error) return result.response;
  const { profile } = result;

  const draftId = c.req.param('id');
  const draft = getPulseDraft(draftId);
  if (!draft || draft.profile_id !== profile.id) {
    return c.json({ error: 'Draft not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ draft: draftToApi(draft) });
});

// ─── POST /drafts/:id/approve — Approve draft ─────────────────────────────

pulseRouter.post('/drafts/:id/approve', requireSocialAuth, (c) => {
  const result = getProfileOrFail(c);
  if (result.error) return result.response;
  const { profile } = result;

  const draftId = c.req.param('id');
  const draft = getPulseDraft(draftId);
  if (!draft || draft.profile_id !== profile.id) {
    return c.json({ error: 'Draft not found', code: 'NOT_FOUND' }, 404);
  }
  if (draft.status !== 'pending') {
    return c.json({ error: `Cannot approve a draft with status '${draft.status}'`, code: 'INVALID_STATE' }, 409);
  }

  const updated = approvePulseDraft(draftId, profile.id);
  return c.json({ ok: true, draft: draftToApi(updated!) });
});

// ─── POST /drafts/:id/reject — Reject draft ───────────────────────────────

pulseRouter.post('/drafts/:id/reject', requireSocialAuth, async (c) => {
  const result = getProfileOrFail(c);
  if (result.error) return result.response;
  const { profile } = result;

  const draftId = c.req.param('id');
  const draft = getPulseDraft(draftId);
  if (!draft || draft.profile_id !== profile.id) {
    return c.json({ error: 'Draft not found', code: 'NOT_FOUND' }, 404);
  }
  if (draft.status !== 'pending') {
    return c.json({ error: `Cannot reject a draft with status '${draft.status}'`, code: 'INVALID_STATE' }, 409);
  }

  const body = await c.req.json<{ reason?: string }>().catch(() => ({}));
  const updated = rejectPulseDraft(draftId, profile.id, (body as { reason?: string }).reason);
  return c.json({ ok: true, draft: draftToApi(updated!) });
});

// ─── POST /drafts/:id/publish — Publish approved draft ────────────────────

pulseRouter.post('/drafts/:id/publish', requireSocialAuth, (c) => {
  const result = getProfileOrFail(c);
  if (result.error) return result.response;
  const { profile } = result;

  const draftId = c.req.param('id');
  const draft = getPulseDraft(draftId);
  if (!draft || draft.profile_id !== profile.id) {
    return c.json({ error: 'Draft not found', code: 'NOT_FOUND' }, 404);
  }
  if (draft.status !== 'approved') {
    return c.json({ error: `Cannot publish a draft with status '${draft.status}'. Draft must be approved first.`, code: 'INVALID_STATE' }, 409);
  }

  const published = publishPulseDraft(draftId, profile.id);
  if (!published) {
    return c.json({ error: 'Failed to publish draft', code: 'INTERNAL_ERROR' }, 500);
  }

  const updatedDraft = getPulseDraft(draftId);
  return c.json({ ok: true, draft: draftToApi(updatedDraft!), postId: published.postId }, 201);
});

// ─── GET /drafts/:id/audit — Get audit log for a draft ────────────────────

pulseRouter.get('/drafts/:id/audit', requireSocialAuth, (c) => {
  const result = getProfileOrFail(c);
  if (result.error) return result.response;
  const { profile } = result;

  const draftId = c.req.param('id');
  const draft = getPulseDraft(draftId);
  if (!draft || draft.profile_id !== profile.id) {
    return c.json({ error: 'Draft not found', code: 'NOT_FOUND' }, 404);
  }

  const entries = getPulseDraftAuditLog(draftId);
  return c.json({ audit: entries.map(auditEntryToApi) });
});
