import { getDb } from './connection';
import { nanoid } from 'nanoid';

// ─── Row interfaces (snake_case matches SQLite columns) ──────────────────────

export interface PulseDraftRow {
  id: string;
  profile_id: string;
  body: string;
  visibility: string;
  author_mode: string;
  linked_agent_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PulseAuditLogRow {
  id: string;
  draft_id: string;
  action: string;
  actor_profile_id: string;
  details: string | null;
  created_at: string;
}

// ─── Draft queries ──────────────────────────────────────────────────────────

export function createPulseDraft(data: {
  profileId: string;
  body: string;
  visibility?: string;
  authorMode?: string;
  linkedAgentId?: string | null;
}): PulseDraftRow {
  const db = getDb();
  const id = nanoid();
  const visibility = data.visibility ?? 'public';
  const authorMode = data.authorMode ?? 'agent';
  const linkedAgentId = data.linkedAgentId ?? null;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO pulse_drafts (id, profile_id, body, visibility, author_mode, linked_agent_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.profileId, data.body, visibility, authorMode, linkedAgentId);

    db.prepare(`
      INSERT INTO pulse_audit_log (id, draft_id, action, actor_profile_id, details)
      VALUES (?, ?, 'created', ?, NULL)
    `).run(nanoid(), id, data.profileId);
  })();

  return db
    .prepare('SELECT * FROM pulse_drafts WHERE id = ?')
    .get(id) as PulseDraftRow;
}

export function listPulseDrafts(
  profileId: string,
  status?: string,
): PulseDraftRow[] {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM pulse_drafts WHERE profile_id = ? AND status = ? ORDER BY created_at DESC')
      .all(profileId, status) as PulseDraftRow[];
  }
  return db
    .prepare('SELECT * FROM pulse_drafts WHERE profile_id = ? ORDER BY created_at DESC')
    .all(profileId) as PulseDraftRow[];
}

export function getPulseDraft(draftId: string): PulseDraftRow | undefined {
  return getDb()
    .prepare('SELECT * FROM pulse_drafts WHERE id = ?')
    .get(draftId) as PulseDraftRow | undefined;
}

export function approvePulseDraft(
  draftId: string,
  actorProfileId: string,
): PulseDraftRow | undefined {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`
      UPDATE pulse_drafts SET status = 'approved', updated_at = datetime('now')
      WHERE id = ?
    `).run(draftId);

    db.prepare(`
      INSERT INTO pulse_audit_log (id, draft_id, action, actor_profile_id, details)
      VALUES (?, ?, 'approved', ?, NULL)
    `).run(nanoid(), draftId, actorProfileId);
  })();

  return getPulseDraft(draftId);
}

export function rejectPulseDraft(
  draftId: string,
  actorProfileId: string,
  reason?: string,
): PulseDraftRow | undefined {
  const db = getDb();
  const details = reason ? JSON.stringify({ reason }) : null;

  db.transaction(() => {
    db.prepare(`
      UPDATE pulse_drafts SET status = 'rejected', updated_at = datetime('now')
      WHERE id = ?
    `).run(draftId);

    db.prepare(`
      INSERT INTO pulse_audit_log (id, draft_id, action, actor_profile_id, details)
      VALUES (?, ?, 'rejected', ?, ?)
    `).run(nanoid(), draftId, actorProfileId, details);
  })();

  return getPulseDraft(draftId);
}

/**
 * Publish an approved draft as a real social post.
 * Inserts into social_posts, updates draft status, and logs the audit event.
 * Returns the new post row (with author join) or undefined if the draft was not found.
 */
export function publishPulseDraft(
  draftId: string,
  actorProfileId: string,
): { postId: string } | undefined {
  const db = getDb();
  const draft = getPulseDraft(draftId);
  if (!draft) return undefined;

  const postId = nanoid();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO social_posts (id, profile_id, body, visibility, author_mode, linked_agent_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(postId, draft.profile_id, draft.body, draft.visibility, draft.author_mode, draft.linked_agent_id);

    db.prepare(`
      UPDATE pulse_drafts SET status = 'published', updated_at = datetime('now')
      WHERE id = ?
    `).run(draftId);

    db.prepare(`
      INSERT INTO pulse_audit_log (id, draft_id, action, actor_profile_id, details)
      VALUES (?, ?, 'published', ?, ?)
    `).run(nanoid(), draftId, actorProfileId, JSON.stringify({ postId }));
  })();

  return { postId };
}

// ─── Audit log queries ──────────────────────────────────────────────────────

export function getPulseDraftAuditLog(draftId: string): PulseAuditLogRow[] {
  return getDb()
    .prepare('SELECT * FROM pulse_audit_log WHERE draft_id = ? ORDER BY created_at ASC')
    .all(draftId) as PulseAuditLogRow[];
}
