/**
 * Intelligence Suite — shared data layer
 *
 * Helper functions for the 4 shared intel tables (v78):
 * intel_entities, intel_scores, intel_events, intel_subscriptions
 *
 * Used by: VIE, Context Engine, Agent Trust Score, Predictive Alert Engine
 */
import { nanoid } from 'nanoid';
import { getDb } from './connection';
import { logger } from '../utils/logger';

// ─── Entity helpers ─────────────────────────────────────────────────────────

export function upsertIntelEntity(
  address: string,
  entityType: string,
  chain: string,
  name?: string,
  metadata?: Record<string, unknown>,
): string {
  const existing = getDb().prepare(
    'SELECT id FROM intel_entities WHERE address = ? AND entity_type = ? AND chain = ?'
  ).get(address, entityType, chain) as { id: string } | undefined;

  if (existing) {
    const updates: string[] = ["updated_at = datetime('now')", "last_scored = datetime('now')"];
    const params: unknown[] = [];
    if (name) { updates.push('name = ?'); params.push(name); }
    if (metadata) { updates.push('metadata_json = ?'); params.push(JSON.stringify(metadata)); }
    params.push(existing.id);
    getDb().prepare(`UPDATE intel_entities SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return existing.id;
  }

  const id = nanoid();
  getDb().prepare(
    `INSERT INTO intel_entities (id, address, entity_type, chain, name, metadata_json, last_scored) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, address, entityType, chain, name || null, metadata ? JSON.stringify(metadata) : null);
  return id;
}

export function getIntelEntity(address: string, chain: string): { id: string; name: string | null; entity_type: string; first_seen: string; metadata_json: string | null } | undefined {
  return getDb().prepare(
    'SELECT id, name, entity_type, first_seen, metadata_json FROM intel_entities WHERE address = ? AND chain = ?'
  ).get(address, chain) as any;
}

// ─── Score helpers ──────────────────────────────────────────────────────────

export function upsertIntelScore(
  entityId: string,
  entityAddress: string,
  entityChain: string,
  skillId: string,
  scoreValue: number,
  scoreConfidence: number,
  scoreLevel: string,
  summary?: string,
  detailJson?: Record<string, unknown>,
): void {
  const existing = getDb().prepare(
    'SELECT id, score_value FROM intel_scores WHERE entity_address = ? AND entity_chain = ? AND skill_id = ?'
  ).get(entityAddress, entityChain, skillId) as { id: string; score_value: number } | undefined;

  if (existing) {
    getDb().prepare(
      `UPDATE intel_scores SET score_value = ?, score_confidence = ?, score_level = ?, summary = ?, detail_json = ?, previous_score = ?, score_delta = ?, scored_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(scoreValue, scoreConfidence, scoreLevel, summary || null, detailJson ? JSON.stringify(detailJson) : null, existing.score_value, scoreValue - existing.score_value, existing.id);
  } else {
    getDb().prepare(
      `INSERT INTO intel_scores (id, entity_id, entity_address, entity_chain, skill_id, score_value, score_confidence, score_level, summary, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), entityId, entityAddress, entityChain, skillId, scoreValue, scoreConfidence, scoreLevel, summary || null, detailJson ? JSON.stringify(detailJson) : null);
  }
}

export function getIntelScore(entityAddress: string, entityChain: string, skillId: string): {
  score_value: number; score_confidence: number; score_level: string; summary: string | null; previous_score: number | null; score_delta: number | null; scored_at: string;
} | undefined {
  return getDb().prepare(
    'SELECT score_value, score_confidence, score_level, summary, previous_score, score_delta, scored_at FROM intel_scores WHERE entity_address = ? AND entity_chain = ? AND skill_id = ?'
  ).get(entityAddress, entityChain, skillId) as any;
}

export function getAllIntelScores(entityAddress: string, entityChain: string): Array<{
  skill_id: string; score_value: number; score_confidence: number; score_level: string; summary: string | null; scored_at: string;
}> {
  return getDb().prepare(
    'SELECT skill_id, score_value, score_confidence, score_level, summary, scored_at FROM intel_scores WHERE entity_address = ? AND entity_chain = ? ORDER BY scored_at DESC'
  ).all(entityAddress, entityChain) as any[];
}

// ─── Event helpers ──────────────────────────────────────────────────────────

export function appendIntelEvent(
  entityId: string,
  entityAddress: string,
  entityChain: string,
  skillId: string,
  eventType: string,
  severity: 'info' | 'warning' | 'critical',
  payload: Record<string, unknown>,
  apiKeyHash?: string,
): void {
  getDb().prepare(
    'INSERT INTO intel_events (id, entity_id, entity_address, entity_chain, skill_id, event_type, severity, payload_json, api_key_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(nanoid(), entityId, entityAddress, entityChain, skillId, eventType, severity, JSON.stringify(payload), apiKeyHash || null);
}

export function getIntelEvents(entityAddress: string, entityChain: string, options?: {
  skillId?: string; eventType?: string; severity?: string; limit?: number; since?: string;
}): Array<{ id: string; skill_id: string; event_type: string; severity: string; payload_json: string; created_at: string }> {
  let sql = 'SELECT id, skill_id, event_type, severity, payload_json, created_at FROM intel_events WHERE entity_address = ? AND entity_chain = ?';
  const params: unknown[] = [entityAddress, entityChain];

  if (options?.skillId) { sql += ' AND skill_id = ?'; params.push(options.skillId); }
  if (options?.eventType) { sql += ' AND event_type = ?'; params.push(options.eventType); }
  if (options?.severity) { sql += ' AND severity = ?'; params.push(options.severity); }
  if (options?.since) { sql += ' AND created_at > ?'; params.push(options.since); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(options?.limit || 50);

  return getDb().prepare(sql).all(...params) as any[];
}

export function getEventCountSince(entityAddress: string, entityChain: string, skillId: string, since: string): number {
  const row = getDb().prepare(
    'SELECT COUNT(*) as cnt FROM intel_events WHERE entity_address = ? AND entity_chain = ? AND skill_id = ? AND created_at > ?'
  ).get(entityAddress, entityChain, skillId, since) as { cnt: number };
  return row.cnt;
}

// ─── Subscription helpers ───────────────────────────────────────────────────

export function createIntelSubscription(
  apiKey: string,
  entityAddress: string,
  entityChain: string,
  entityType: string,
  alertTypes: string[],
  webhookUrl?: string,
  thresholdJson?: Record<string, unknown>,
): string {
  const id = nanoid();
  getDb().prepare(
    'INSERT INTO intel_subscriptions (id, api_key, entity_address, entity_chain, entity_type, alert_types, webhook_url, threshold_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, apiKey, entityAddress, entityChain, entityType, JSON.stringify(alertTypes), webhookUrl || null, thresholdJson ? JSON.stringify(thresholdJson) : null);
  return id;
}

export function getActiveSubscriptions(entityAddress: string, entityChain: string): Array<{
  id: string; api_key: string; alert_types: string; webhook_url: string | null; threshold_json: string | null;
}> {
  return getDb().prepare(
    'SELECT id, api_key, alert_types, webhook_url, threshold_json FROM intel_subscriptions WHERE entity_address = ? AND entity_chain = ? AND active = 1'
  ).all(entityAddress, entityChain) as any[];
}

export function getSubscriptionsForKey(apiKey: string): Array<{
  id: string; entity_address: string; entity_chain: string; entity_type: string; alert_types: string; webhook_url: string | null; active: number; fire_count: number;
}> {
  return getDb().prepare(
    'SELECT id, entity_address, entity_chain, entity_type, alert_types, webhook_url, active, fire_count FROM intel_subscriptions WHERE api_key = ? ORDER BY created_at DESC'
  ).all(apiKey) as any[];
}

export function deleteIntelSubscription(id: string, apiKey: string): boolean {
  const result = getDb().prepare('UPDATE intel_subscriptions SET active = 0, updated_at = datetime(\'now\') WHERE id = ? AND api_key = ?').run(id, apiKey);
  return result.changes > 0;
}

// ─── Cross-reference helper (for response envelope) ─────────────────────────

export function getRelatedScores(entityAddress: string, entityChain: string): {
  vie_score: number | null; vie_level: string | null; vie_updated: string | null;
  context_summary: string | null; context_anomaly_count: number | null; context_updated: string | null;
  trust_score: number | null; trust_level: string | null; trust_updated: string | null;
  active_alerts: number | null; alert_updated: string | null;
} {
  const scores = getAllIntelScores(entityAddress, entityChain);
  const vie = scores.find(s => s.skill_id === 'vie');
  const context = scores.find(s => s.skill_id === 'context');
  const trust = scores.find(s => s.skill_id === 'trust');
  const alert = scores.find(s => s.skill_id === 'alert');

  const alertCount = alert ? getDb().prepare(
    'SELECT COUNT(*) as cnt FROM intel_subscriptions WHERE entity_address = ? AND entity_chain = ? AND active = 1'
  ).get(entityAddress, entityChain) as { cnt: number } : null;

  return {
    vie_score: vie?.score_value ?? null,
    vie_level: vie?.score_level ?? null,
    vie_updated: vie?.scored_at ?? null,
    context_summary: context?.summary ?? null,
    context_anomaly_count: null, // populated when Context Engine exists
    context_updated: context?.scored_at ?? null,
    trust_score: trust?.score_value ?? null,
    trust_level: trust?.score_level ?? null,
    trust_updated: trust?.scored_at ?? null,
    active_alerts: alertCount?.cnt ?? null,
    alert_updated: alert?.scored_at ?? null,
  };
}
