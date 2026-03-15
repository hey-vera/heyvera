/**
 * Automated Skill Quality Gates — objective quality scoring for skills.
 *
 * Every skill gets a 0-100 score from reliability, performance, trust, and usage metrics.
 * Agents use this to decide what to trust.
 */

import { getDb } from '../db/connection';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QualityScore {
  skillId: string;
  score: number;            // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: {
    reliability: number;    // 0-25: uptime + success rate
    performance: number;    // 0-25: response time
    trust: number;          // 0-25: ratings + verification + age
    usage: number;          // 0-25: invocation count + unique users
  };
  flags: string[];
  lastComputed: string;
}

export interface PrePublishCheck {
  approved: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  suggestions: string[];
}

// ─── Internal row types ──────────────────────────────────────────────────────

interface SkillRow {
  id: string;
  name: string;
  avg_rating: number | null;
  verified: number;
  created_at: string;
  sla_json: string | null;
  security_status: string;
  skill_type: string;
}

interface MetricsRow {
  success_rate: number | null;
  avg_latency_ms: number | null;
}

interface UsageRow {
  total_invocations: number;
  unique_users: number;
}

interface WeekRow {
  cnt: number;
}

// ─── Grade mapping ───────────────────────────────────────────────────────────

function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── In-memory quality score cache ────────────────────────────────────────────

const qualityCache = new Map<string, { score: QualityScore; expiresAt: number }>();
const QUALITY_CACHE_TTL = 3600_000; // 1 hour

/**
 * Invalidate the quality score cache for a specific skill, or all skills.
 */
export function invalidateQualityCache(skillId?: string): void {
  if (skillId) qualityCache.delete(skillId);
  else qualityCache.clear();
}

// ─── Compute quality score for a single skill ────────────────────────────────

export function computeQualityScore(skillId: string): QualityScore | null {
  // Check cache first
  const cached = qualityCache.get(skillId);
  if (cached && Date.now() < cached.expiresAt) return cached.score;

  const db = getDb();

  const skill = db.prepare(
    `SELECT id, name, avg_rating, verified, created_at, sla_json, security_status, skill_type
     FROM skills WHERE id = ?`
  ).get(skillId) as SkillRow | undefined;

  if (!skill) return null;

  // ── Reliability (0-25) ──────────────────────────────────────────────────
  const metrics = db.prepare(
    `SELECT
       AVG(CASE WHEN status = 'success' THEN 1.0 ELSE 0.0 END) * 100 AS success_rate,
       AVG(latency_ms) AS avg_latency_ms
     FROM skill_metrics
     WHERE skill_id = ?`
  ).get(skillId) as MetricsRow | undefined;

  const successRate = metrics?.success_rate ?? 0;
  let reliability: number;
  if (successRate >= 99) reliability = 25;
  else if (successRate >= 95) reliability = 20;
  else if (successRate >= 90) reliability = 15;
  else if (successRate >= 80) reliability = 10;
  else reliability = 5;

  // SLA bonus
  if (skill.sla_json) {
    try {
      const sla = JSON.parse(skill.sla_json);
      const meetsLatency = !sla.max_latency_ms || (metrics?.avg_latency_ms ?? Infinity) <= sla.max_latency_ms;
      const meetsSuccess = !sla.min_success_rate || successRate >= sla.min_success_rate;
      if (meetsLatency && meetsSuccess) {
        reliability = Math.min(25, reliability + 5);
      }
    } catch {
      // Malformed SLA — skip bonus
    }
  }

  // ── Performance (0-25) ──────────────────────────────────────────────────
  const avgLatency = metrics?.avg_latency_ms ?? 5000;
  let performance: number;
  if (avgLatency <= 200) performance = 25;
  else if (avgLatency <= 500) performance = 20;
  else if (avgLatency <= 1000) performance = 15;
  else if (avgLatency <= 3000) performance = 10;
  else performance = 5;

  // ── Trust (0-25) ────────────────────────────────────────────────────────
  const avgRating = skill.avg_rating ?? 0;
  let trust: number;
  if (avgRating >= 4.5) trust = 15;
  else if (avgRating >= 4.0) trust = 10;
  else if (avgRating >= 3.0) trust = 5;
  else trust = 2;

  if (skill.verified) trust = Math.min(25, trust + 5);

  const createdAt = new Date(skill.created_at);
  const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 30) trust = Math.min(25, trust + 3);
  else if (ageDays > 7) trust = Math.min(25, trust + 2);

  // ── Usage (0-25) ────────────────────────────────────────────────────────
  const usageData = db.prepare(
    `SELECT
       COUNT(*) AS total_invocations,
       COUNT(DISTINCT api_key) AS unique_users
     FROM transactions
     WHERE skill_id = ?`
  ).get(skillId) as UsageRow | undefined;

  const totalInvocations = usageData?.total_invocations ?? 0;
  const uniqueUsers = usageData?.unique_users ?? 0;

  let usage: number;
  if (totalInvocations >= 100) usage = 15;
  else if (totalInvocations >= 50) usage = 10;
  else if (totalInvocations >= 10) usage = 5;
  else usage = 2;

  if (uniqueUsers >= 10) usage = Math.min(25, usage + 5);
  else if (uniqueUsers >= 5) usage = Math.min(25, usage + 3);

  // Trending: this week vs last week
  const thisWeek = (db.prepare(
    `SELECT COUNT(*) AS cnt FROM transactions
     WHERE skill_id = ? AND created_at >= datetime('now', '-7 days')`
  ).get(skillId) as WeekRow | undefined)?.cnt ?? 0;

  const lastWeek = (db.prepare(
    `SELECT COUNT(*) AS cnt FROM transactions
     WHERE skill_id = ? AND created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')`
  ).get(skillId) as WeekRow | undefined)?.cnt ?? 0;

  if (thisWeek > lastWeek && thisWeek > 0) {
    usage = Math.min(25, usage + 5);
  }

  // ── Final score + flags ─────────────────────────────────────────────────
  const score = reliability + performance + trust + usage;
  const grade = scoreToGrade(score);

  const flags: string[] = [];
  if (avgRating > 0 && avgRating < 3.0) flags.push('low_rating');
  if (avgLatency > 3000) flags.push('slow_response');
  if (!skill.verified) flags.push('unverified');
  if (!skill.sla_json) flags.push('no_sla');
  if (totalInvocations < 10) flags.push('low_usage');
  if (ageDays < 7) flags.push('new_skill');

  const result: QualityScore = {
    skillId,
    score,
    grade,
    breakdown: { reliability, performance, trust, usage },
    flags,
    lastComputed: new Date().toISOString(),
  };

  // Cache the computed result
  qualityCache.set(skillId, { score: result, expiresAt: Date.now() + QUALITY_CACHE_TTL });

  return result;
}

// ─── Batch compute for all public skills ─────────────────────────────────────

export function getQualityScores(limit?: number): QualityScore[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id FROM skills WHERE is_public = 1 AND security_status != 'DELISTED'
     ORDER BY avg_rating DESC
     LIMIT ?`
  ).all(limit ?? 1000) as Array<{ id: string }>;

  const scores: QualityScore[] = [];
  for (const row of rows) {
    const score = computeQualityScore(row.id);
    if (score) scores.push(score);
  }

  return scores;
}

// ─── Pre-publish validation ──────────────────────────────────────────────────

export async function validateBeforePublish(config: Record<string, unknown>): Promise<PrePublishCheck> {
  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
  const suggestions: string[] = [];
  let estimatedScore = 50; // base for a new skill

  const skillType = (config.skillType as string) ?? (config.skill_type as string) ?? 'prompt_template';
  const description = (config.description as string) ?? '';
  const creditCost = (config.creditCost as number) ?? (config.credit_cost as number) ?? 0;
  const tags = (config.tags as string[]) ?? [];
  const proxyUrl = (config.proxyUrl as string) ?? (config.proxy_url as string) ?? '';
  const promptTemplate = (config.promptTemplate as string) ?? (config.prompt_template as string) ?? '';
  const sampleOutput = (config.sampleOutputJson as string) ?? (config.sample_output_json as string) ?? '';

  // Check: description length
  const descOk = description.length >= 20;
  checks.push({
    name: 'description_length',
    passed: descOk,
    detail: descOk ? `Description is ${description.length} chars` : `Description too short (${description.length} chars, need 20+)`,
  });
  if (!descOk) {
    suggestions.push('Write a more detailed description (at least 20 characters) to help agents discover your skill.');
    estimatedScore -= 10;
  }

  // Check: credit cost reasonable
  const costOk = creditCost >= 0.001 && creditCost <= 1000;
  checks.push({
    name: 'credit_cost',
    passed: costOk,
    detail: costOk ? `Credit cost ${creditCost} is within range` : `Credit cost ${creditCost} outside range 0.001-1000`,
  });
  if (!costOk) {
    suggestions.push('Set credit_cost between 0.001 and 1000.');
    estimatedScore -= 10;
  }

  // Check: tags exist
  const tagsOk = tags.length >= 1;
  checks.push({
    name: 'tags_present',
    passed: tagsOk,
    detail: tagsOk ? `${tags.length} tag(s) provided` : 'No tags provided',
  });
  if (!tagsOk) {
    suggestions.push('Add at least one tag to improve discoverability.');
    estimatedScore -= 5;
  }

  // Check: proxy_url reachable (api_proxy skills)
  if (skillType === 'api_proxy') {
    if (!proxyUrl) {
      checks.push({ name: 'proxy_url', passed: false, detail: 'No proxy_url provided for api_proxy skill' });
      suggestions.push('api_proxy skills require a proxy_url.');
      estimatedScore -= 15;
    } else {
      let reachable = false;
      try {
        const res = await fetch(proxyUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        reachable = res.status < 500;
      } catch {
        // unreachable
      }
      checks.push({
        name: 'proxy_url',
        passed: reachable,
        detail: reachable ? `proxy_url ${proxyUrl} is reachable` : `proxy_url ${proxyUrl} is unreachable`,
      });
      if (!reachable) {
        suggestions.push('Ensure your proxy_url is publicly accessible and responds to HEAD requests.');
        estimatedScore -= 15;
      }
    }
  }

  // Check: prompt_template has variables (prompt_template skills)
  if (skillType === 'prompt_template') {
    const hasVars = /\{\{.+?\}\}/.test(promptTemplate);
    checks.push({
      name: 'prompt_template_vars',
      passed: hasVars,
      detail: hasVars ? 'Prompt template contains variables' : 'Prompt template has no {{variable}} placeholders',
    });
    if (!hasVars) {
      suggestions.push('Add at least one {{variable}} to your prompt template so agents can pass inputs.');
      estimatedScore -= 10;
    }
  }

  // Check: sample_output_json is valid JSON (data skills)
  if (skillType === 'data' && sampleOutput) {
    let validJson = false;
    try {
      JSON.parse(sampleOutput);
      validJson = true;
    } catch {
      // invalid
    }
    checks.push({
      name: 'sample_output_json',
      passed: validJson,
      detail: validJson ? 'sample_output_json is valid JSON' : 'sample_output_json is not valid JSON',
    });
    if (!validJson) {
      suggestions.push('Fix your sample_output_json — it must be valid JSON.');
      estimatedScore -= 5;
    }
  }

  const clampedScore = Math.max(0, Math.min(100, estimatedScore));
  const allPassed = checks.every(ch => ch.passed);

  return {
    approved: allPassed,
    score: clampedScore,
    checks,
    suggestions,
  };
}
