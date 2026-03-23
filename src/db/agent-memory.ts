/**
 * agent-memory.ts — Structured agent memory (Phase 3, from RecallNet)
 *
 * Upgrades from 50KB JSON blobs to searchable, structured documents.
 * Each memory is a typed document with metadata for semantic search.
 *
 * Memory types:
 *   - context: conversation/task context
 *   - fact: learned facts about the world
 *   - preference: user/agent preferences
 *   - skill_result: cached skill execution results
 *   - reflection: agent self-assessment
 */

import { getDb, logAudit } from './connection';
import { nanoid } from 'nanoid';
import { aidHash } from '../utils/crypto-agility';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentMemory {
  id: string;
  sessionId: string;
  ownerKey: string;
  memoryType: 'context' | 'fact' | 'preference' | 'skill_result' | 'reflection';
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  contentHash: string;
  importance: number; // 0-1, for retrieval ranking
  accessCount: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function createMemory(data: {
  sessionId: string;
  ownerKey: string;
  memoryType: AgentMemory['memoryType'];
  content: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  importance?: number;
  ttlSeconds?: number;
}): AgentMemory {
  const id = `mem-${nanoid(16)}`;
  const contentHash = aidHash(data.content).slice(0, 32);
  const tags = data.tags || [];
  const importance = data.importance ?? 0.5;
  const now = new Date().toISOString();
  const expiresAt = data.ttlSeconds
    ? new Date(Date.now() + data.ttlSeconds * 1000).toISOString()
    : null;

  // Check size limit (50KB per memory, 500KB total per session)
  if (Buffer.byteLength(data.content) > 50_000) {
    throw new Error('Memory content exceeds 50KB limit');
  }

  const sessionSize = getDb().prepare(`
    SELECT COALESCE(SUM(LENGTH(content)), 0) as total
    FROM agent_memories WHERE session_id = ? AND owner_key = ?
  `).get(data.sessionId, data.ownerKey) as { total: number };

  if (sessionSize.total + Buffer.byteLength(data.content) > 500_000) {
    throw new Error('Session memory limit exceeded (500KB)');
  }

  getDb().prepare(`
    INSERT INTO agent_memories (id, session_id, owner_key, memory_type, content,
                               metadata_json, tags_json, content_hash, importance,
                               expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.sessionId, data.ownerKey, data.memoryType, data.content,
    JSON.stringify(data.metadata || {}), JSON.stringify(tags),
    contentHash, importance, expiresAt,
  );

  return {
    id, sessionId: data.sessionId, ownerKey: data.ownerKey,
    memoryType: data.memoryType, content: data.content,
    metadata: data.metadata || {}, tags, contentHash, importance,
    accessCount: 0, createdAt: now, updatedAt: now, expiresAt,
  };
}

export function getMemory(id: string): AgentMemory | null {
  const row = getDb().prepare(`
    SELECT * FROM agent_memories WHERE id = ?
  `).get(id) as any;

  if (!row) return null;

  // Increment access count
  getDb().prepare(`UPDATE agent_memories SET access_count = access_count + 1 WHERE id = ?`).run(id);

  return rowToMemory(row);
}

export function searchMemories(opts: {
  ownerKey: string;
  sessionId?: string;
  memoryType?: AgentMemory['memoryType'];
  tags?: string[];
  query?: string;
  limit?: number;
  minImportance?: number;
}): AgentMemory[] {
  let sql = `SELECT * FROM agent_memories WHERE owner_key = ?`;
  const params: unknown[] = [opts.ownerKey];

  // Filter expired
  sql += ` AND (expires_at IS NULL OR expires_at > datetime('now'))`;

  if (opts.sessionId) {
    sql += ` AND session_id = ?`;
    params.push(opts.sessionId);
  }

  if (opts.memoryType) {
    sql += ` AND memory_type = ?`;
    params.push(opts.memoryType);
  }

  if (opts.query) {
    sql += ` AND content LIKE ?`;
    params.push(`%${opts.query}%`);
  }

  if (opts.tags && opts.tags.length > 0) {
    for (const tag of opts.tags) {
      sql += ` AND tags_json LIKE ?`;
      params.push(`%"${tag}"%`);
    }
  }

  if (opts.minImportance) {
    sql += ` AND importance >= ?`;
    params.push(opts.minImportance);
  }

  sql += ` ORDER BY importance DESC, access_count DESC, created_at DESC`;
  sql += ` LIMIT ?`;
  params.push(opts.limit || 20);

  const rows = getDb().prepare(sql).all(...params) as any[];
  return rows.map(rowToMemory);
}

export function updateMemory(id: string, updates: {
  content?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  importance?: number;
}): boolean {
  const parts: string[] = ['updated_at = datetime(\'now\')'];
  const params: unknown[] = [];

  if (updates.content !== undefined) {
    if (Buffer.byteLength(updates.content) > 50_000) {
      throw new Error('Memory content exceeds 50KB limit');
    }
    parts.push('content = ?');
    params.push(updates.content);
    parts.push('content_hash = ?');
    params.push(aidHash(updates.content).slice(0, 32));
  }

  if (updates.metadata !== undefined) {
    parts.push('metadata_json = ?');
    params.push(JSON.stringify(updates.metadata));
  }

  if (updates.tags !== undefined) {
    parts.push('tags_json = ?');
    params.push(JSON.stringify(updates.tags));
  }

  if (updates.importance !== undefined) {
    parts.push('importance = ?');
    params.push(updates.importance);
  }

  params.push(id);

  const result = getDb().prepare(
    `UPDATE agent_memories SET ${parts.join(', ')} WHERE id = ?`
  ).run(...params);

  return result.changes > 0;
}

export function deleteMemory(id: string): boolean {
  return getDb().prepare(`DELETE FROM agent_memories WHERE id = ?`).run(id).changes > 0;
}

export function pruneExpiredMemories(): number {
  return getDb().prepare(
    `DELETE FROM agent_memories WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`
  ).run().changes;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToMemory(row: any): AgentMemory {
  return {
    id: row.id,
    sessionId: row.session_id,
    ownerKey: row.owner_key,
    memoryType: row.memory_type,
    content: row.content,
    metadata: JSON.parse(row.metadata_json || '{}'),
    tags: JSON.parse(row.tags_json || '[]'),
    contentHash: row.content_hash,
    importance: row.importance,
    accessCount: row.access_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}
