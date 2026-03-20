/**
 * Manifest — DB helpers for the manifest_memory table (v79)
 *
 * Stores every manifest request + verdict for:
 * - Decision memory (recall past checks on same subject)
 * - Outcome tracking (agents report what happened after acting)
 * - Collective intelligence (aggregate outcome stats across all agents)
 * - Deduplication (identical requests within 5 min return cached)
 */
import { nanoid } from 'nanoid';
import { getDb } from './connection';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ManifestMemoryRow {
  id: string;
  api_key: string;
  session_id: string | null;
  created_at: string;
  request_hash: string;
  domain: string;
  subject: string | null;
  action_type: string | null;
  overall_verdict: string;
  verify_overall: string | null;
  verify_claims_checked: number;
  verify_claims_verified: number;
  verify_claims_disputed: number;
  assess_status: string | null;
  assess_premises_valid: number | null;
  preflight_status: string | null;
  preflight_risk_score: number | null;
  confidence: number;
  summary: string | null;
  detail_json: string;
  outcome: string | null;
  outcome_data: string | null;
  outcome_at: string | null;
  outcome_value: number | null;
}

export interface ManifestWriteParams {
  apiKey: string;
  sessionId?: string;
  requestHash: string;
  domain: string;
  subject?: string;
  actionType?: string;
  overallVerdict: string;
  verifyOverall?: string;
  verifyClaimsChecked?: number;
  verifyClaimsVerified?: number;
  verifyClaimsDisputed?: number;
  assessStatus?: string;
  assessPremisesValid?: number;
  preflightStatus?: string;
  preflightRiskScore?: number;
  confidence: number;
  summary?: string;
  detailJson: Record<string, unknown>;
}

// ─── Write ──────────────────────────────────────────────────────────────────

export function writeManifestMemory(params: ManifestWriteParams): string {
  const id = nanoid();
  getDb().prepare(`
    INSERT INTO manifest_memory (
      id, api_key, session_id, request_hash, domain, subject, action_type,
      overall_verdict, verify_overall, verify_claims_checked, verify_claims_verified,
      verify_claims_disputed, assess_status, assess_premises_valid,
      preflight_status, preflight_risk_score, confidence, summary, detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, params.apiKey, params.sessionId || null, params.requestHash,
    params.domain, params.subject || null, params.actionType || null,
    params.overallVerdict, params.verifyOverall || null,
    params.verifyClaimsChecked || 0, params.verifyClaimsVerified || 0,
    params.verifyClaimsDisputed || 0, params.assessStatus || null,
    params.assessPremisesValid ?? null, params.preflightStatus || null,
    params.preflightRiskScore ?? null, params.confidence,
    params.summary || null, JSON.stringify(params.detailJson)
  );
  return id;
}

// ─── Query ──────────────────────────────────────────────────────────────────

const VALID_VERDICTS = ['PROCEED', 'CAUTION', 'HOLD', 'BLOCK'];
const SAFE_STRING_RE = /^[\w.-]{1,50}$/;

export function queryManifestMemory(apiKey: string, options?: {
  subject?: string;
  actionType?: string;
  verdict?: string;
  domain?: string;
  limit?: number;
  since?: string;
}): ManifestMemoryRow[] {
  let sql = 'SELECT * FROM manifest_memory WHERE api_key = ?';
  const params: unknown[] = [apiKey];

  if (options?.subject) { sql += ' AND subject = ?'; params.push(options.subject); }
  if (options?.actionType && SAFE_STRING_RE.test(options.actionType)) {
    sql += ' AND action_type = ?'; params.push(options.actionType);
  }
  if (options?.verdict && VALID_VERDICTS.includes(options.verdict)) {
    sql += ' AND overall_verdict = ?'; params.push(options.verdict);
  }
  if (options?.domain && SAFE_STRING_RE.test(options.domain)) {
    sql += ' AND domain = ?'; params.push(options.domain);
  }
  if (options?.since) { sql += ' AND created_at > ?'; params.push(options.since); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(options?.limit || 20);

  return getDb().prepare(sql).all(...params) as ManifestMemoryRow[];
}

export function getManifestById(id: string): ManifestMemoryRow | undefined {
  return getDb().prepare('SELECT * FROM manifest_memory WHERE id = ?').get(id) as ManifestMemoryRow | undefined;
}

// ─── Deduplication ──────────────────────────────────────────────────────────

export function getRecentDuplicate(requestHash: string, withinMinutes: number = 5): ManifestMemoryRow | undefined {
  return getDb().prepare(
    `SELECT * FROM manifest_memory WHERE request_hash = ? AND created_at > datetime('now', ?) ORDER BY created_at DESC LIMIT 1`
  ).get(requestHash, `-${withinMinutes} minutes`) as ManifestMemoryRow | undefined;
}

export function computeRequestHash(apiKey: string, body: unknown): string {
  return crypto.createHash('sha256')
    .update(`${apiKey}:${JSON.stringify(body)}`)
    .digest('hex')
    .slice(0, 16);
}

// ─── Outcome Tracking ──────────────────────────────────────────────────────

export function recordManifestOutcome(
  manifestId: string,
  apiKey: string,
  outcome: 'positive' | 'negative' | 'neutral',
  outcomeData?: Record<string, unknown>,
  outcomeValue?: number,
): boolean {
  const result = getDb().prepare(`
    UPDATE manifest_memory SET outcome = ?, outcome_data = ?, outcome_at = datetime('now'), outcome_value = ?
    WHERE id = ? AND api_key = ?
  `).run(outcome, outcomeData ? JSON.stringify(outcomeData) : null, outcomeValue ?? null, manifestId, apiKey);
  return result.changes > 0;
}

// ─── Collective Intelligence ────────────────────────────────────────────────

export function getOutcomeStats(options?: {
  subject?: string;
  verdict?: string;
  domain?: string;
  since?: string;
}): { total: number; positive: number; negative: number; neutral: number; positive_pct: number; negative_pct: number } {
  let sql = 'SELECT outcome, COUNT(*) as cnt FROM manifest_memory WHERE outcome IS NOT NULL';
  const params: unknown[] = [];

  if (options?.subject) { sql += ' AND subject = ?'; params.push(options.subject); }
  if (options?.verdict) { sql += ' AND overall_verdict = ?'; params.push(options.verdict); }
  if (options?.domain) { sql += ' AND domain = ?'; params.push(options.domain); }
  if (options?.since) { sql += ' AND created_at > ?'; params.push(options.since); }

  sql += ' GROUP BY outcome';

  const rows = getDb().prepare(sql).all(...params) as Array<{ outcome: string; cnt: number }>;
  const positive = rows.find(r => r.outcome === 'positive')?.cnt || 0;
  const negative = rows.find(r => r.outcome === 'negative')?.cnt || 0;
  const neutral = rows.find(r => r.outcome === 'neutral')?.cnt || 0;
  const total = positive + negative + neutral;

  return {
    total,
    positive,
    negative,
    neutral,
    positive_pct: total > 0 ? Math.round((positive / total) * 100) : 0,
    negative_pct: total > 0 ? Math.round((negative / total) * 100) : 0,
  };
}

export function getVerdictOutcomeStats(verdict: string): { acted_count: number; positive_pct: number; negative_pct: number } | null {
  const stats = getOutcomeStats({ verdict });
  if (stats.total < 10) return null; // not enough data
  return {
    acted_count: stats.total,
    positive_pct: stats.positive_pct,
    negative_pct: stats.negative_pct,
  };
}

// ─── Memory Context (for manifest responses) ────────────────────────────────

export function getMemoryContext(apiKey: string, subject?: string): {
  total_manifests: number;
  recent_verdicts: string[];
  last_check?: { verdict: string; confidence: number; created_at: string };
  subject_history?: { checks: number; last_verdict: string; outcomes: { positive: number; negative: number } };
} {
  const totalRow = getDb().prepare('SELECT COUNT(*) as cnt FROM manifest_memory WHERE api_key = ?').get(apiKey) as { cnt: number };

  const recentRows = getDb().prepare(
    'SELECT overall_verdict FROM manifest_memory WHERE api_key = ? ORDER BY created_at DESC LIMIT 5'
  ).all(apiKey) as Array<{ overall_verdict: string }>;

  const lastRow = getDb().prepare(
    'SELECT overall_verdict, confidence, created_at FROM manifest_memory WHERE api_key = ? ORDER BY created_at DESC LIMIT 1'
  ).get(apiKey) as { overall_verdict: string; confidence: number; created_at: string } | undefined;

  let subjectHistory;
  if (subject) {
    const subjectRows = getDb().prepare(
      'SELECT COUNT(*) as cnt FROM manifest_memory WHERE api_key = ? AND subject = ?'
    ).get(apiKey, subject) as { cnt: number };

    const lastSubject = getDb().prepare(
      'SELECT overall_verdict FROM manifest_memory WHERE api_key = ? AND subject = ? ORDER BY created_at DESC LIMIT 1'
    ).get(apiKey, subject) as { overall_verdict: string } | undefined;

    const outcomeRows = getDb().prepare(
      'SELECT outcome, COUNT(*) as cnt FROM manifest_memory WHERE api_key = ? AND subject = ? AND outcome IS NOT NULL GROUP BY outcome'
    ).all(apiKey, subject) as Array<{ outcome: string; cnt: number }>;

    subjectHistory = {
      checks: subjectRows.cnt,
      last_verdict: lastSubject?.overall_verdict || 'none',
      outcomes: {
        positive: outcomeRows.find(r => r.outcome === 'positive')?.cnt || 0,
        negative: outcomeRows.find(r => r.outcome === 'negative')?.cnt || 0,
      },
    };
  }

  return {
    total_manifests: totalRow.cnt,
    recent_verdicts: recentRows.map(r => r.overall_verdict),
    last_check: lastRow ? { verdict: lastRow.overall_verdict, confidence: lastRow.confidence, created_at: lastRow.created_at } : undefined,
    subject_history: subjectHistory,
  };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

export function cleanupOldManifests(retentionDays: number = 90): number {
  const result = getDb().prepare(
    `DELETE FROM manifest_memory WHERE created_at < datetime('now', ?) AND id IN (SELECT id FROM manifest_memory WHERE created_at < datetime('now', ?) LIMIT 5000)`
  ).run(`-${retentionDays} days`, `-${retentionDays} days`);
  return result.changes;
}
