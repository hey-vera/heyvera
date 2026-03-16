import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import { getDb, safeJsonParse } from './connection';

// ─── Agent Sessions ──────────────────────────────────────────────────────────

const MAX_SESSIONS_PER_KEY = 10;
const MAX_STATE_SIZE = 50_000;

export function createSession(apiKey: string, name?: string): { id: string; name: string | null; state: Record<string, unknown> } {
  const count = getDb()
    .prepare('SELECT COUNT(*) AS cnt FROM agent_sessions WHERE api_key = ?')
    .get(apiKey) as { cnt: number };

  if (count.cnt >= MAX_SESSIONS_PER_KEY) {
    throw new Error('Maximum 10 sessions per key');
  }

  const id = nanoid(16);
  getDb().prepare(`
    INSERT INTO agent_sessions (id, api_key, name, state_json)
    VALUES (?, ?, ?, '{}')
  `).run(id, apiKey, name ?? null);

  logger.info({ sessionId: id, apiKey: maskApiKey(apiKey) }, 'agent session created');
  return { id, name: name ?? null, state: {} };
}

export function getSession(id: string, apiKey: string): {
  id: string; name: string | null; state: Record<string, unknown>; createdAt: string; updatedAt: string;
} | undefined {
  const row = getDb()
    .prepare('SELECT id, name, state_json, created_at, updated_at FROM agent_sessions WHERE id = ? AND api_key = ?')
    .get(id, apiKey) as { id: string; name: string | null; state_json: string; created_at: string; updated_at: string } | undefined;

  if (!row) return undefined;

  return {
    id: row.id,
    name: row.name,
    state: safeJsonParse<Record<string, unknown>>(row.state_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateSessionState(id: string, apiKey: string, updates: Record<string, unknown>): Record<string, unknown> {
  const row = getDb()
    .prepare('SELECT state_json FROM agent_sessions WHERE id = ? AND api_key = ?')
    .get(id, apiKey) as { state_json: string } | undefined;

  if (!row) throw new Error('Session not found');

  const current = safeJsonParse<Record<string, unknown>>(row.state_json, {});
  const merged = Object.assign({}, current, updates);
  const serialized = JSON.stringify(merged);

  if (serialized.length > MAX_STATE_SIZE) {
    throw new Error(`Session state exceeds ${MAX_STATE_SIZE} character limit`);
  }

  getDb().prepare(`
    UPDATE agent_sessions SET state_json = ?, updated_at = datetime('now')
    WHERE id = ? AND api_key = ?
  `).run(serialized, id, apiKey);

  logger.info({ sessionId: id }, 'agent session state updated');
  return merged;
}

export function getSessionState(id: string, apiKey: string): Record<string, unknown> | null {
  const row = getDb()
    .prepare('SELECT state_json FROM agent_sessions WHERE id = ? AND api_key = ?')
    .get(id, apiKey) as { state_json: string } | undefined;

  if (!row) return null;
  return safeJsonParse<Record<string, unknown>>(row.state_json, {});
}

export function listSessions(apiKey: string): Array<{
  id: string; name: string | null; stateSize: number; createdAt: string; updatedAt: string;
}> {
  const rows = getDb()
    .prepare('SELECT id, name, LENGTH(state_json) AS state_size, created_at, updated_at FROM agent_sessions WHERE api_key = ? ORDER BY updated_at DESC')
    .all(apiKey) as Array<{ id: string; name: string | null; state_size: number; created_at: string; updated_at: string }>;

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    stateSize: r.state_size,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function deleteSession(id: string, apiKey: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM agent_sessions WHERE id = ? AND api_key = ?')
    .run(id, apiKey);

  if (result.changes > 0) {
    logger.info({ sessionId: id }, 'agent session deleted');
    return true;
  }
  return false;
}
