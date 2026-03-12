import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { getDb, safeJsonParse } from './connection';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentContext {
  id: string;
  api_key: string;
  endpoint_id: string;
  params_hash: string;
  category: string | null;
  data: unknown;
  size_bytes: number;
  hit_count: number;
  created_at: string;
  expires_at: string;
}

export interface ContextStats {
  totalEntries: number;
  totalSizeBytes: number;
  categories: { category: string; count: number }[];
  oldestEntry: string | null;
  newestEntry: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Hash endpoint + params into a stable key for dedup */
export function contextParamsHash(endpointId: string, params: Record<string, unknown>): string {
  const normalized = JSON.stringify({ endpointId, params: Object.fromEntries(Object.entries(params).sort()) });
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// Default context TTL multiplier — context lives 3x longer than ephemeral cache
const CONTEXT_TTL_MULTIPLIER = 3;

// Max entries per agent — prevent unbounded growth
const MAX_ENTRIES_PER_AGENT = 500;

// Max total size per agent (5MB)
const MAX_SIZE_PER_AGENT = 5 * 1024 * 1024;

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Store an API response in the agent's context namespace.
 * Uses INSERT OR REPLACE so repeated calls for the same endpoint+params update the entry.
 */
export function setAgentContext(
  apiKey: string,
  endpointId: string,
  params: Record<string, unknown>,
  data: unknown,
  category: string | null,
  cacheTtlSeconds: number,
): void {
  try {
    const paramsHash = contextParamsHash(endpointId, params);
    const dataJson = JSON.stringify(data);
    const sizeBytes = Buffer.byteLength(dataJson, 'utf8');

    // Skip if single entry exceeds 500KB
    if (sizeBytes > 500 * 1024) return;

    const ttl = cacheTtlSeconds * CONTEXT_TTL_MULTIPLIER;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    const db = getDb();

    // Check agent limits before inserting
    const stats = db.prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as total_size FROM agent_contexts WHERE api_key = ?`
    ).get(apiKey) as { cnt: number; total_size: number };

    // Evict oldest entries if at capacity
    if (stats.cnt >= MAX_ENTRIES_PER_AGENT || stats.total_size + sizeBytes > MAX_SIZE_PER_AGENT) {
      db.prepare(
        `DELETE FROM agent_contexts WHERE id IN (
          SELECT id FROM agent_contexts WHERE api_key = ? ORDER BY hit_count ASC, created_at ASC LIMIT 50
        )`
      ).run(apiKey);
    }

    db.prepare(`
      INSERT OR REPLACE INTO agent_contexts (id, api_key, endpoint_id, params_hash, category, data_json, size_bytes, hit_count, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(nanoid(16), apiKey, endpointId, paramsHash, category, dataJson, sizeBytes, expiresAt);
  } catch (err) {
    // Never let context storage failures affect the caller
    logger.debug({ err, endpointId }, 'Agent context store failed');
  }
}

/**
 * Look up a cached response in the agent's context namespace.
 * Returns null if not found or expired. Increments hit_count on match.
 */
export function getAgentContext(
  apiKey: string,
  endpointId: string,
  params: Record<string, unknown>,
): unknown | null {
  try {
    const paramsHash = contextParamsHash(endpointId, params);
    const row = getDb().prepare(`
      SELECT id, data_json FROM agent_contexts
      WHERE api_key = ? AND endpoint_id = ? AND params_hash = ? AND expires_at > datetime('now')
    `).get(apiKey, endpointId, paramsHash) as { id: string; data_json: string } | undefined;

    if (!row) return null;

    // Bump hit count (fire-and-forget)
    try {
      getDb().prepare(`UPDATE agent_contexts SET hit_count = hit_count + 1 WHERE id = ?`).run(row.id);
    } catch { /* non-critical */ }

    return safeJsonParse(row.data_json, null);
  } catch {
    return null;
  }
}

/**
 * List context entries for an agent (summary view — no data payload).
 */
export function listAgentContexts(apiKey: string, limit = 100): Omit<AgentContext, 'data'>[] {
  const rows = getDb().prepare(`
    SELECT id, api_key, endpoint_id, params_hash, category, size_bytes, hit_count, created_at, expires_at
    FROM agent_contexts
    WHERE api_key = ? AND expires_at > datetime('now')
    ORDER BY hit_count DESC, created_at DESC
    LIMIT ?
  `).all(apiKey, limit) as Omit<AgentContext, 'data'>[];
  return rows;
}

/**
 * Get stats about an agent's context namespace.
 */
export function getAgentContextStats(apiKey: string): ContextStats {
  const db = getDb();

  const summary = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as total_size,
           MIN(created_at) as oldest, MAX(created_at) as newest
    FROM agent_contexts WHERE api_key = ? AND expires_at > datetime('now')
  `).get(apiKey) as { cnt: number; total_size: number; oldest: string | null; newest: string | null };

  const categories = db.prepare(`
    SELECT COALESCE(category, 'uncategorized') as category, COUNT(*) as count
    FROM agent_contexts WHERE api_key = ? AND expires_at > datetime('now')
    GROUP BY category ORDER BY count DESC
  `).all(apiKey) as { category: string; count: number }[];

  return {
    totalEntries: summary.cnt,
    totalSizeBytes: summary.total_size,
    categories,
    oldestEntry: summary.oldest,
    newestEntry: summary.newest,
  };
}

/**
 * Clear all context entries for an agent, optionally filtered by endpoint.
 */
export function clearAgentContext(apiKey: string, endpointId?: string): number {
  if (endpointId) {
    const result = getDb().prepare(
      `DELETE FROM agent_contexts WHERE api_key = ? AND endpoint_id = ?`
    ).run(apiKey, endpointId);
    return result.changes;
  }
  const result = getDb().prepare(`DELETE FROM agent_contexts WHERE api_key = ?`).run(apiKey);
  return result.changes;
}

/**
 * Purge all expired context entries across all agents.
 * Called by the daily cleanup cron.
 */
export function purgeExpiredContexts(): number {
  const result = getDb().prepare(
    `DELETE FROM agent_contexts WHERE expires_at <= datetime('now')`
  ).run();
  return result.changes;
}
