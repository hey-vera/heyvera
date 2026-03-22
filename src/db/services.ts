import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { getDb } from './connection';

// ─── Mesh Peers ───────────────────────────────────────────────────────────────

export function upsertPeer(id: string, multiaddr: string, metadata?: Record<string, unknown>): void {
  if (!id || typeof id !== 'string' || id.length > 256) return;
  if (typeof multiaddr !== 'string' || multiaddr.length > 512) return;
  if (multiaddr && !multiaddr.startsWith('/')) return;

  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO peers (id, multiaddr, last_seen, metadata_json)
         VALUES (?, ?, datetime('now'), ?)`
      )
      .run(id, multiaddr, metadata ? JSON.stringify(metadata) : null);
  } catch (err) {
    logger.error({ err }, 'Failed to upsert peer');
  }
}

export function getPeers(limit = 200): { id: string; multiaddr: string; last_seen: string; metadata_json: string | null }[] {
  return getDb()
    .prepare(`SELECT id, multiaddr, last_seen, metadata_json FROM peers
              WHERE last_seen > datetime('now', '-24 hours')
              ORDER BY last_seen DESC LIMIT ?`)
    .all(Math.min(limit, 500)) as { id: string; multiaddr: string; last_seen: string; metadata_json: string | null }[];
}

/** Remove peers not seen in over 7 days */
export function pruneStalePeers(): number {
  return getDb()
    .prepare(`DELETE FROM peers WHERE last_seen < datetime('now', '-7 days')`)
    .run().changes;
}

// ─── Telegram Subscribers ─────────────────────────────────────────────────────

export function addTelegramSubscriber(chatId: number): boolean {
  const info = getDb()
    .prepare(`INSERT OR IGNORE INTO telegram_subscribers (chat_id) VALUES (?)`)
    .run(chatId);
  return info.changes > 0;
}

export function removeTelegramSubscriber(chatId: number): boolean {
  const info = getDb()
    .prepare(`DELETE FROM telegram_subscribers WHERE chat_id = ?`)
    .run(chatId);
  return info.changes > 0;
}

export function getTelegramSubscribers(): number[] {
  const rows = getDb()
    .prepare(`SELECT chat_id FROM telegram_subscribers`)
    .all() as { chat_id: number }[];
  return rows.map((r) => r.chat_id);
}

export function isTelegramSubscriber(chatId: number): boolean {
  const row = getDb()
    .prepare(`SELECT 1 FROM telegram_subscribers WHERE chat_id = ?`)
    .get(chatId);
  return !!row;
}

// ─── XMTP Subscribers ─────────────────────────────────────────────────────────

export function addXmtpSubscriber(address: string): boolean {
  const info = getDb()
    .prepare(`INSERT OR IGNORE INTO xmtp_subscribers (address) VALUES (?)`)
    .run(address.toLowerCase());
  return info.changes > 0;
}

export function removeXmtpSubscriber(address: string): boolean {
  const info = getDb()
    .prepare(`DELETE FROM xmtp_subscribers WHERE address = ?`)
    .run(address.toLowerCase());
  return info.changes > 0;
}

export function getXmtpSubscribers(): string[] {
  const rows = getDb()
    .prepare(`SELECT address FROM xmtp_subscribers`)
    .all() as { address: string }[];
  return rows.map((r) => r.address);
}

export function isXmtpSubscriber(address: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 FROM xmtp_subscribers WHERE address = ?`)
    .get(address.toLowerCase());
  return !!row;
}

export function linkXmtpApiKey(address: string, apiKey: string): boolean {
  const info = getDb()
    .prepare(`UPDATE xmtp_subscribers SET api_key = ? WHERE address = ?`)
    .run(apiKey, address.toLowerCase());
  return info.changes > 0;
}

export function getXmtpApiKey(address: string): string | null {
  const row = getDb()
    .prepare(`SELECT api_key FROM xmtp_subscribers WHERE address = ?`)
    .get(address.toLowerCase()) as { api_key: string | null } | undefined;
  return row?.api_key ?? null;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Task {
  id: string;
  requester_key: string;
  skill_id: string;
  status: TaskStatus;
  input_json: string;
  result_json: string | null;
  error: string | null;
  idempotency_key: string | null;
  webhook_url: string | null;
  cost_credits: number;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function createTask(params: {
  id: string;
  requesterKey: string;
  skillId: string;
  inputJson: string;
  idempotencyKey?: string;
  webhookUrl?: string;
}): void {
  getDb()
    .prepare(`INSERT INTO tasks (id, requester_key, skill_id, input_json, idempotency_key, webhook_url)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(params.id, params.requesterKey, params.skillId, params.inputJson,
      params.idempotencyKey ?? null, params.webhookUrl ?? null);
}

export function getTask(id: string): Task | undefined {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
}

export function getTaskByIdempotencyKey(idempotencyKey: string): Task | undefined {
  return getDb()
    .prepare('SELECT * FROM tasks WHERE idempotency_key = ?')
    .get(idempotencyKey) as Task | undefined;
}

export function listTasks(requesterKey: string, limit = 50, offset = 0): Task[] {
  return getDb()
    .prepare('SELECT * FROM tasks WHERE requester_key = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(requesterKey, Math.min(limit, 100), offset) as Task[];
}

export function countTasks(requesterKey: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as n FROM tasks WHERE requester_key = ?')
    .get(requesterKey) as { n: number };
  return row.n;
}

export function updateTaskRunning(id: string): void {
  getDb()
    .prepare(`UPDATE tasks SET status = 'RUNNING', started_at = datetime('now') WHERE id = ?`)
    .run(id);
}

export function updateTaskCompleted(id: string, resultJson: string, costCredits: number, durationMs: number): void {
  getDb()
    .prepare(`UPDATE tasks SET status = 'COMPLETED', result_json = ?, cost_credits = ?, duration_ms = ?,
              completed_at = datetime('now') WHERE id = ?`)
    .run(resultJson, costCredits, durationMs, id);
}

export function updateTaskFailed(id: string, error: string, durationMs: number): void {
  getDb()
    .prepare(`UPDATE tasks SET status = 'FAILED', error = ?, duration_ms = ?,
              completed_at = datetime('now') WHERE id = ?`)
    .run(error, durationMs, id);
}

export function updateTaskCancelled(id: string): boolean {
  const result = getDb()
    .prepare(`UPDATE tasks SET status = 'CANCELLED', completed_at = datetime('now')
              WHERE id = ? AND status = 'PENDING'`)
    .run(id);
  return result.changes > 0;
}

/** Track webhook delivery attempts and final status */
export function updateWebhookStatus(taskId: string, attempts: number, status: string): void {
  try {
    getDb()
      .prepare(`UPDATE tasks SET webhook_attempts = ?, webhook_status = ? WHERE id = ?`)
      .run(attempts, status, taskId);
  } catch {
    // Don't let webhook tracking failures affect anything
  }
}

// ─── Task Ratings ─────────────────────────────────────────────────────────────

export interface TaskRating {
  id: string;
  task_id: string;
  rated_by: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export function createTaskRating(params: {
  taskId: string;
  ratedBy: string;
  rating: number;
  comment?: string;
}): { ok: boolean; error?: string } {
  try {
    getDb()
      .prepare(`INSERT INTO task_ratings (id, task_id, rated_by, rating, comment) VALUES (?, ?, ?, ?, ?)`)
      .run(nanoid(12), params.taskId, params.ratedBy, params.rating, params.comment ?? null);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Already rated or task not found' };
  }
}

export function getTaskRating(taskId: string): TaskRating | undefined {
  return getDb().prepare('SELECT * FROM task_ratings WHERE task_id = ?').get(taskId) as TaskRating | undefined;
}

// ─── Swarms ────────────────────────────────────────────────────────────────────

export interface SwarmTask {
  id: string;
  task: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  agent_key: string;
  sub_tasks_json: string | null;
  results_json: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export function createSwarmTask(agentKey: string, task: string): string {
  const id = nanoid(16);
  getDb().prepare(`INSERT INTO swarms (id, task, agent_key) VALUES (?, ?, ?)`)
    .run(id, task, agentKey);
  return id;
}

export function getSwarmTask(id: string): SwarmTask | undefined {
  return getDb().prepare(`SELECT * FROM swarms WHERE id = ?`).get(id) as SwarmTask | undefined;
}

export function updateSwarmTask(id: string, params: {
  status: SwarmTask['status'];
  subTasks?: unknown[];
  results?: unknown[];
  error?: string;
}): void {
  getDb().prepare(`
    UPDATE swarms SET status = ?, sub_tasks_json = ?, results_json = ?, error = ?,
    completed_at = CASE WHEN ? IN ('COMPLETED','FAILED') THEN datetime('now') ELSE NULL END
    WHERE id = ?
  `).run(
    params.status,
    params.subTasks ? JSON.stringify(params.subTasks) : null,
    params.results ? JSON.stringify(params.results) : null,
    params.error ?? null,
    params.status, id
  );
}

// ─── Endpoint Health ──────────────────────────────────────────────────────────

export interface EndpointHealth {
  endpoint_id: string;
  provider: string;
  last_checked: string | null;
  last_status: 'up' | 'down' | 'degraded' | 'unknown';
  uptime_pct: number;
  avg_latency_ms: number;
  success_count: number;
  failure_count: number;
  last_error: string | null;
}

export function recordEndpointHealth(params: {
  endpointId: string;
  provider: string;
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
  error?: string;
}): void {
  const existing = getDb()
    .prepare('SELECT success_count, failure_count, avg_latency_ms FROM endpoint_health WHERE endpoint_id = ?')
    .get(params.endpointId) as { success_count: number; failure_count: number; avg_latency_ms: number } | undefined;

  const isSuccess = params.status === 'up';
  const successCount = (existing?.success_count ?? 0) + (isSuccess ? 1 : 0);
  const failureCount = (existing?.failure_count ?? 0) + (isSuccess ? 0 : 1);
  const totalChecks = successCount + failureCount;
  const uptimePct = totalChecks > 0 ? (successCount / totalChecks) * 100 : 100;

  const prevAvg = existing?.avg_latency_ms ?? 0;
  const prevTotal = (existing?.success_count ?? 0) + (existing?.failure_count ?? 0);
  const avgLatency = prevTotal > 0
    ? Math.round((prevAvg * prevTotal + params.latencyMs) / (prevTotal + 1))
    : params.latencyMs;

  getDb().prepare(`
    INSERT INTO endpoint_health (endpoint_id, provider, last_checked, last_status, uptime_pct, avg_latency_ms, success_count, failure_count, last_error)
    VALUES (@endpointId, @provider, datetime('now'), @status, @uptimePct, @avgLatency, @successCount, @failureCount, @error)
    ON CONFLICT(endpoint_id) DO UPDATE SET
      last_checked = datetime('now'),
      last_status = @status,
      uptime_pct = @uptimePct,
      avg_latency_ms = @avgLatency,
      success_count = @successCount,
      failure_count = @failureCount,
      last_error = @error
  `).run({
    endpointId: params.endpointId,
    provider: params.provider,
    status: params.status,
    uptimePct,
    avgLatency,
    successCount,
    failureCount,
    error: params.error ?? null,
  });
}

export function getEndpointHealth(endpointId?: string): EndpointHealth[] {
  if (endpointId) {
    const row = getDb().prepare('SELECT * FROM endpoint_health WHERE endpoint_id = ?').get(endpointId);
    return row ? [row as EndpointHealth] : [];
  }
  return getDb().prepare('SELECT * FROM endpoint_health ORDER BY uptime_pct ASC, last_checked DESC').all() as EndpointHealth[];
}

// ─── Agent Usage Stats ────────────────────────────────────────────────────────

export function getAgentUsageStats(apiKey: string): {
  totalOrchestrations: number;
  totalSkillInvocations: number;
  lastActive: string | null;
} {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN skill_id IS NOT NULL THEN 1 ELSE 0 END) as skill_invocations,
             MAX(timestamp) as last_active
      FROM orchestrations WHERE api_key = ?
    `)
    .get(apiKey) as { total: number; skill_invocations: number; last_active: string | null } | undefined;

  return {
    totalOrchestrations: row?.total ?? 0,
    totalSkillInvocations: row?.skill_invocations ?? 0,
    lastActive: row?.last_active ?? null,
  };
}

// ─── External Registrations ──────────────────────────────────────────────────

export interface ExternalRegistration {
  id: string;
  url: string;
  name: string;
  description: string | null;
  protocol: string;
  http_method: string;
  price_usd: number | null;
  payment_asset: string | null;
  payment_network: string | null;
  category: string;
  provider: string | null;
  contact_email: string | null;
  status: string;
  health_status: string;
  last_probed: string | null;
  probe_result: string | null;
  registered_at: string;
  registered_ip: string | null;
}

export function registerExternalEndpoint(data: {
  url: string;
  name: string;
  description?: string;
  protocol?: string;
  httpMethod?: string;
  priceUsd?: number;
  paymentAsset?: string;
  paymentNetwork?: string;
  category?: string;
  provider?: string;
  contactEmail?: string;
  healthStatus?: string;
  probeResult?: string;
  registeredIp?: string;
}): string {
  const id = nanoid(16);
  getDb()
    .prepare(`INSERT INTO external_registrations
      (id, url, name, description, protocol, http_method, price_usd, payment_asset, payment_network, category, provider, contact_email, health_status, last_probed, probe_result, registered_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`)
    .run(
      id,
      data.url,
      data.name,
      data.description ?? null,
      data.protocol ?? 'x402',
      data.httpMethod ?? 'POST',
      data.priceUsd ?? null,
      data.paymentAsset ?? 'USDC',
      data.paymentNetwork ?? null,
      data.category ?? 'uncategorized',
      data.provider ?? null,
      data.contactEmail ?? null,
      data.healthStatus ?? 'unknown',
      data.probeResult ?? null,
      data.registeredIp ?? null,
    );
  return id;
}

export function getExternalRegistration(id: string): ExternalRegistration | undefined {
  return getDb()
    .prepare('SELECT * FROM external_registrations WHERE id = ?')
    .get(id) as ExternalRegistration | undefined;
}

export function listExternalRegistrations(
  status?: string,
  protocol?: string,
  limit = 50,
  offset = 0,
): ExternalRegistration[] {
  let sql = 'SELECT * FROM external_registrations WHERE 1=1';
  const params: unknown[] = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (protocol) { sql += ' AND protocol = ?'; params.push(protocol); }
  sql += ' ORDER BY registered_at DESC LIMIT ? OFFSET ?';
  params.push(Math.min(limit, 200), offset);
  return getDb().prepare(sql).all(...params) as ExternalRegistration[];
}

export function updateRegistrationProbe(id: string, healthStatus: string, probeResult: string): void {
  getDb()
    .prepare(`UPDATE external_registrations SET health_status = ?, probe_result = ?, last_probed = datetime('now') WHERE id = ?`)
    .run(healthStatus, probeResult, id);
}

// ─── Claim Tokens ──────────────────────────────────────────────────────────────

export function storeClaimToken(params: {
  token: string;
  clerkUserId: string;
  purchaseEmail: string;
  apiKey: string;
  expiresAt: string;
}): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO claim_tokens
      (token, clerk_user_id, purchase_email, api_key, expires_at, used)
      VALUES (@token, @clerkUserId, @purchaseEmail, @apiKey, @expiresAt, 0)`)
    .run(params);
}

export function getClaimToken(token: string): {
  token: string;
  clerk_user_id: string;
  purchase_email: string;
  api_key: string;
  expires_at: string;
  used: number;
} | undefined {
  return getDb()
    .prepare('SELECT * FROM claim_tokens WHERE token = ?')
    .get(token) as {
      token: string; clerk_user_id: string; purchase_email: string;
      api_key: string; expires_at: string; used: number;
    } | undefined;
}

export function deleteClaimToken(token: string): void {
  getDb()
    .prepare('DELETE FROM claim_tokens WHERE token = ?')
    .run(token);
}

/** Atomically marks a claim token as used. Returns true if successful (changes === 1). */
export function markClaimTokenUsed(token: string): boolean {
  const result = getDb()
    .prepare('UPDATE claim_tokens SET used = 1 WHERE token = ? AND used = 0')
    .run(token);
  return result.changes > 0;
}

// ─── Reputation Anchors ──────────────────────────────────────────────────────

import crypto from 'crypto';

export interface ReputationAnchor {
  id: string;
  skill_id: string;
  anchor_hash: string;
  data_snapshot: string;
  anchor_type: string;
  created_at: string;
}

/**
 * Create a SHA-256 reputation anchor for a skill's current trust metrics.
 * The hash is deterministic — anyone with the snapshot JSON can verify it.
 */
export function createReputationAnchor(skillId: string, snapshot: object): string {
  const snapshotJson = JSON.stringify(snapshot);
  const { aidHashPrefixed } = require('../utils/crypto-agility');
  const hash = aidHashPrefixed(snapshotJson);
  const id = nanoid();
  getDb()
    .prepare('INSERT INTO reputation_anchors (id, skill_id, anchor_hash, data_snapshot) VALUES (?, ?, ?, ?)')
    .run(id, skillId, hash, snapshotJson);
  return hash;
}

/** Get recent reputation anchors for a skill. */
export function getReputationAnchors(skillId: string, limit = 10): ReputationAnchor[] {
  return getDb()
    .prepare('SELECT * FROM reputation_anchors WHERE skill_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(skillId, Math.min(limit, 100)) as ReputationAnchor[];
}

/** Get a single reputation anchor by ID. */
export function getReputationAnchor(anchorId: string): ReputationAnchor | undefined {
  return getDb()
    .prepare('SELECT * FROM reputation_anchors WHERE id = ?')
    .get(anchorId) as ReputationAnchor | undefined;
}

/**
 * Verify that a reputation anchor's hash matches its stored snapshot.
 * Also accepts an external snapshot string to verify against the stored hash.
 */
export function verifyReputationAnchor(anchorId: string, externalSnapshot?: string): { valid: boolean; anchor?: ReputationAnchor } {
  const anchor = getDb()
    .prepare('SELECT * FROM reputation_anchors WHERE id = ?')
    .get(anchorId) as ReputationAnchor | undefined;
  if (!anchor) return { valid: false };

  const dataToHash = externalSnapshot ?? anchor.data_snapshot;
  const { aidHashPrefixed } = require('../utils/crypto-agility');
  const computedHash = aidHashPrefixed(dataToHash);
  return { valid: computedHash === anchor.anchor_hash, anchor };
}

// ─── Indexed Endpoints (402index.io sync) ────────────────────────────────────

export interface IndexedEndpoint {
  id: string;
  source_id: string;
  name: string;
  description: string | null;
  url: string;
  protocol: string;
  price_usd: number | null;
  payment_asset: string;
  payment_network: string | null;
  category: string;
  provider: string | null;
  health_status: string;
  uptime_30d: number | null;
  latency_p50_ms: number | null;
  reliability_score: number | null;
  http_method: string;
  source: string;
  last_synced: string;
}

export function getIndexedEndpoints(category?: string, limit = 50, offset = 0, source?: string): IndexedEndpoint[] {
  let sql = 'SELECT * FROM indexed_endpoints WHERE 1=1';
  const params: unknown[] = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (source) { sql += ' AND source = ?'; params.push(source); }
  sql += ' ORDER BY reliability_score DESC NULLS LAST, last_synced DESC LIMIT ? OFFSET ?';
  params.push(Math.min(limit, 200), offset);
  return getDb().prepare(sql).all(...params) as IndexedEndpoint[];
}

export function countIndexedEndpoints(category?: string, source?: string): number {
  let sql = 'SELECT COUNT(*) as n FROM indexed_endpoints WHERE 1=1';
  const params: unknown[] = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (source) { sql += ' AND source = ?'; params.push(source); }
  const row = getDb().prepare(sql).get(...params) as { n: number };
  return row.n;
}

export function searchIndexedEndpoints(query: string, limit = 20): IndexedEndpoint[] {
  const like = `%${query}%`;
  return getDb()
    .prepare(`SELECT * FROM indexed_endpoints
              WHERE name LIKE ? OR description LIKE ? OR category LIKE ? OR provider LIKE ?
              ORDER BY reliability_score DESC NULLS LAST LIMIT ?`)
    .all(like, like, like, like, Math.min(limit, 100)) as IndexedEndpoint[];
}

export function getIndexedEndpointByUrl(url: string): IndexedEndpoint | undefined {
  return getDb()
    .prepare('SELECT * FROM indexed_endpoints WHERE url = ?')
    .get(url) as IndexedEndpoint | undefined;
}

export function getIndexedEndpointsSyncInfo(): { total: number; lastSynced: string | null } {
  const row = getDb()
    .prepare('SELECT COUNT(*) as total, MAX(last_synced) as lastSynced FROM indexed_endpoints')
    .get() as { total: number; lastSynced: string | null };
  return { total: row.total, lastSynced: row.lastSynced };
}
