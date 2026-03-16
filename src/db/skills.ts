import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { getDb } from './connection';
import { batchedDelete } from './audit';

// ─── Skills ───────────────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt_template: string;
  author_key: string;
  public: number;
  credit_cost: number;
  revenue_share_pct: number;
  uses: number;
  created_at: string;
  // migration-added columns (may be null on old rows)
  version: string;
  input_schema_json: string | null;
  output_schema_json: string | null;
  published_at: string | null;
  tags_json: string | null;
  forked_from: string | null;
  ab_challenger: string | null;
  // v2 marketplace columns
  readme: string | null;
  license: string | null;
  runtime_json: string | null;
  stars: number;
  views: number;
  forks: number;
  security_status: string;
  scanned_at: string | null;
  status: string;
  display_name: string | null;
  changelog: string | null;
  category: string;
  skill_type: 'prompt_template' | 'api_proxy' | 'data' | 'composite';
  proxy_url: string | null;
  proxy_method: string;
  /** JSON-serialised SkillExecutionPlan — if present, bypasses LLM intent parsing */
  execution_plan_json: string | null;
  /** Skill class: standard (default), recursive (self-refining), self_checking (output validation) */
  skill_class: 'standard' | 'recursive' | 'self_checking';
  /** EVM wallet address on Base — if set, 85% of x402 revenue is auto-split here */
  creator_evm_wallet: string | null;
  /** Canonical example response — shown on skill cards so agents know exactly what they'll receive */
  sample_output_json: string | null;
  /** How often the underlying data refreshes: realtime | hourly | daily | weekly | static */
  update_frequency: string;
  /** ID of the paired skill (LLM ↔ data variant) for marketplace toggle cards */
  paired_skill_id: string | null;
  /** Creator-configurable max invocations per hour. Null = unlimited. */
  max_calls_per_hour: number | null;
  /** Health status for data skill monitoring: HEALTHY | DEGRADED | DOWN */
  health_status: string;
  health_checked_at: string | null;
  health_fail_count: number;
  // v64: trust signal denormalization
  avg_rating: number;
  rating_count: number;
  success_rate: number;
  avg_latency_ms: number;
  /** JSON array of dependency definitions for composite skills */
  dependencies_json: string | null;
  // v65: SLA contracts + output contracts
  /** JSON SLA guarantees: { guaranteed_uptime, max_latency_ms, min_success_rate, penalty_pct } */
  sla_json: string | null;
  /** JSON Schema for output validation — agents can trust output shape */
  output_contract_json: string | null;
  // v66: composability upgrades, penalty escalation
  /** JSON config for composite execution: { cacheTtl?, executionMode?, maxTotalCredits? } */
  composite_config_json: string | null;
  /** Penalty tier for SLA violations: 0=clean, 1=warning, 2=reduced visibility, 3=delisted */
  penalty_tier: number;
  penalty_updated_at: string | null;
  /** Soft-delete active flag */
  active: number;
  // v67: dynamic pricing, composite-of-composite, autonomous hiring/firing
  /** JSON dynamic pricing config: { surge?, volumeDiscounts?, offPeak? } */
  pricing_config_json: string | null;
  /** Computed max composite depth (0 for non-composite, 1+ for nested composites) */
  composite_depth: number;
  /** Enable auto-replacement of degraded deps in composite skills */
  auto_replace: number;
}

export function createSkill(params: {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  authorKey: string;
  public: boolean;
  creditCost: number;
  displayName?: string;
  changelog?: string;
  category?: string;
  skillType?: 'prompt_template' | 'api_proxy' | 'data' | 'composite';
  proxyUrl?: string;
  proxyMethod?: string;
  executionPlanJson?: string;
  skillClass?: 'standard' | 'recursive' | 'self_checking';
  creatorEvmWallet?: string;
  sampleOutputJson?: string;
  updateFrequency?: string;
  pairedSkillId?: string;
  dependenciesJson?: string;
  slaJson?: string;
  outputContractJson?: string;
  compositeConfigJson?: string;
  pricingConfigJson?: string;
  autoReplace?: boolean;
}): void {
  // Validate composite skill dependencies
  if (params.skillType === 'composite' && params.dependenciesJson) {
    validateCompositeDependencies(params.id, params.dependenciesJson);
  }

  getDb()
    .prepare(`INSERT INTO skills (id, name, description, prompt_template, author_key, public, credit_cost, display_name, changelog, category, skill_type, proxy_url, proxy_method, execution_plan_json, skill_class, creator_evm_wallet, sample_output_json, update_frequency, paired_skill_id, dependencies_json, sla_json, output_contract_json, composite_config_json, pricing_config_json, auto_replace)
              VALUES (@id, @name, @description, @promptTemplate, @authorKey, @public, @creditCost, @displayName, @changelog, @category, @skillType, @proxyUrl, @proxyMethod, @executionPlanJson, @skillClass, @creatorEvmWallet, @sampleOutputJson, @updateFrequency, @pairedSkillId, @dependenciesJson, @slaJson, @outputContractJson, @compositeConfigJson, @pricingConfigJson, @autoReplace)`)
    .run({
      ...params,
      public: params.public ? 1 : 0,
      displayName: params.displayName ?? null,
      changelog: params.changelog ?? null,
      category: params.category ?? 'general',
      skillType: params.skillType ?? 'prompt_template',
      proxyUrl: params.proxyUrl ?? null,
      proxyMethod: params.proxyMethod ?? 'POST',
      executionPlanJson: params.executionPlanJson ?? null,
      skillClass: params.skillClass ?? 'standard',
      creatorEvmWallet: params.creatorEvmWallet ?? null,
      sampleOutputJson: params.sampleOutputJson ?? null,
      updateFrequency: params.updateFrequency ?? 'static',
      pairedSkillId: params.pairedSkillId ?? null,
      dependenciesJson: params.dependenciesJson ?? null,
      slaJson: params.slaJson ?? null,
      outputContractJson: params.outputContractJson ?? null,
      compositeConfigJson: params.compositeConfigJson ?? null,
      pricingConfigJson: params.pricingConfigJson ?? null,
      autoReplace: params.autoReplace ? 1 : 0,
    });
}

export function getSkill(id: string): Skill | undefined {
  return getDb().prepare('SELECT * FROM skills WHERE id = ? AND active = 1').get(id) as Skill | undefined;
}

export function listPublicSkills(offset = 0, limit = 50, skillType?: string, tag?: string): Skill[] {
  const clauses = ["public = 1", "active = 1", "security_status != 'FLAGGED'"];
  const args: unknown[] = [];
  if (skillType) { clauses.push('skill_type = ?'); args.push(skillType); }
  if (tag) { clauses.push("tags_json LIKE '%' || ? || '%'"); args.push(`"${tag}"`); }
  args.push(Math.min(limit, 100), offset);
  return getDb()
    .prepare(`SELECT * FROM skills WHERE ${clauses.join(' AND ')} ORDER BY uses DESC, created_at DESC LIMIT ? OFFSET ?`)
    .all(...args) as Skill[];
}

export function countPublicSkills(skillType?: string, tag?: string): number {
  const clauses = ["public = 1", "active = 1", "security_status != 'FLAGGED'"];
  const args: unknown[] = [];
  if (skillType) { clauses.push('skill_type = ?'); args.push(skillType); }
  if (tag) { clauses.push("tags_json LIKE '%' || ? || '%'"); args.push(`"${tag}"`); }
  return (getDb()
    .prepare(`SELECT COUNT(*) as n FROM skills WHERE ${clauses.join(' AND ')}`)
    .get(...args) as { n: number }).n;
}

export function getSkillsByAuthor(authorKey: string, limit = 200): Skill[] {
  return getDb()
    .prepare('SELECT * FROM skills WHERE author_key = ? AND active = 1 ORDER BY created_at DESC LIMIT ?')
    .all(authorKey, limit) as Skill[];
}

export function countSkillsByAuthor(authorKey: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM skills WHERE author_key = ? AND active = 1')
    .get(authorKey) as { count: number };
  return row.count;
}

export function incrementSkillUses(id: string): void {
  getDb().prepare('UPDATE skills SET uses = uses + 1 WHERE id = ?').run(id);
}

export function deleteSkill(id: string, authorKey: string): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE skills SET active = 0 WHERE id = ? AND author_key = ? AND active = 1')
    .run(id, authorKey);
  if (result.changes > 0) {
    db.prepare('DELETE FROM discovery_cache WHERE id = ?').run(id);
  }
  return result.changes > 0;
}

export function updateSkillVisibility(id: string, authorKey: string, isPublic: boolean): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE skills SET public = ? WHERE id = ? AND author_key = ? AND active = 1')
    .run(isPublic ? 1 : 0, id, authorKey);
  if (result.changes > 0 && !isPublic) {
    db.prepare('DELETE FROM discovery_cache WHERE id = ?').run(id);
  }
  return result.changes > 0;
}

// ─── Discovery / Vector Search ────────────────────────────────────────────────

export function upsertDiscovery(params: {
  id: string;
  skillName: string;
  skillDesc: string;
  provider: string;
  embedding: Float32Array;
}): void {
  const db = getDb();
  db.transaction(() => {
    const existing = db
      .prepare('SELECT rowid_vec FROM discovery_cache WHERE id = ?')
      .get(params.id) as { rowid_vec: number } | undefined;
    if (existing?.rowid_vec) {
      db.prepare('DELETE FROM skill_embeddings WHERE rowid = ?').run(existing.rowid_vec);
    }

    const insert = db.prepare('INSERT INTO skill_embeddings(embedding) VALUES (?)');
    const result = insert.run(params.embedding);

    db.prepare(`
      INSERT OR REPLACE INTO discovery_cache (id, skill_name, skill_desc, provider, rowid_vec, ttl_expires)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+24 hours'))
    `).run(params.id, params.skillName, params.skillDesc, params.provider, result.lastInsertRowid);
  })();
}

export function searchDiscovery(queryEmbedding: Float32Array, limit = 10): {
  id: string; skillName: string; skillDesc: string; provider: string; distance: number;
}[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT dc.id, dc.skill_name, dc.skill_desc, dc.provider, se.distance
    FROM skill_embeddings se
    JOIN discovery_cache dc ON dc.rowid_vec = se.rowid
    WHERE se.embedding MATCH ?
      AND k = ?
    ORDER BY se.distance
  `).all(queryEmbedding, limit) as {
    id: string; skill_name: string; skill_desc: string; provider: string; distance: number;
  }[];

  return rows.map(r => ({
    id: r.id,
    skillName: r.skill_name,
    skillDesc: r.skill_desc,
    provider: r.provider,
    distance: r.distance,
  }));
}

export function getDiscoveryCacheIds(): string[] {
  return (getDb()
    .prepare('SELECT id FROM discovery_cache LIMIT 10000')
    .all() as { id: string }[])
    .map(r => r.id);
}

export function cleanExpiredDiscoveryCache(): number {
  return getDb()
    .prepare(`DELETE FROM discovery_cache WHERE ttl_expires < datetime('now')`)
    .run().changes;
}

// ─── Skill Schemas / Metadata ─────────────────────────────────────────────────

export function updateSkillSchemas(id: string, params: {
  version?: string;
  inputSchemaJson?: string;
  outputSchemaJson?: string;
  publishedAt?: string;
  tagsJson?: string;
}): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (params.version !== undefined)        { fields.push('version = ?');          values.push(params.version); }
  if (params.inputSchemaJson !== undefined) { fields.push('input_schema_json = ?'); values.push(params.inputSchemaJson); }
  if (params.outputSchemaJson !== undefined){ fields.push('output_schema_json = ?'); values.push(params.outputSchemaJson); }
  if (params.publishedAt !== undefined)    { fields.push('published_at = ?');     values.push(params.publishedAt); }
  if (params.tagsJson !== undefined)       { fields.push('tags_json = ?');        values.push(params.tagsJson); }
  if (fields.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE skills SET ${fields.join(', ')} WHERE id = ? AND active = 1`).run(...values);
}

// ─── Skill Metrics ────────────────────────────────────────────────────────────

export function recordSkillMetric(params: {
  skillId: string;
  version: string;
  latencyMs: number;
  success: boolean;
  costCredits: number;
}): void {
  try {
    getDb()
      .prepare(`INSERT INTO skill_metrics (id, skill_id, version, latency_ms, success, cost_credits)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(nanoid(12), params.skillId, params.version, params.latencyMs, params.success ? 1 : 0, params.costCredits);
    updateSkillTrustSignals(params.skillId);
  } catch (err) {
    logger.error({ err }, 'Failed to record skill metric');
  }
}

/**
 * Refresh denormalized trust signal columns on a skill.
 * Called after recordSkillMetric() and rateSkill() to keep listing data fresh.
 */
export function updateSkillTrustSignals(skillId: string): void {
  try {
    getDb().prepare(`
      UPDATE skills SET
        avg_rating = COALESCE((SELECT ROUND(AVG(rating),1) FROM skill_ratings WHERE skill_id = ?), 0),
        rating_count = COALESCE((SELECT COUNT(*) FROM skill_ratings WHERE skill_id = ?), 0),
        success_rate = COALESCE((SELECT ROUND(AVG(success)*100,1) FROM skill_metrics WHERE skill_id = ?), 0),
        avg_latency_ms = COALESCE((SELECT ROUND(AVG(latency_ms),0) FROM skill_metrics WHERE skill_id = ?), 0)
      WHERE id = ?
    `).run(skillId, skillId, skillId, skillId, skillId);
  } catch (err) {
    logger.error({ err, skillId }, 'Failed to update trust signals');
  }
}

export interface SkillMetricsSummary {
  version: string;
  invocations: number;
  successRate: number;
  avgLatencyMs: number;
  avgCostCredits: number;
}

export function getSkillMetricsSummary(skillId: string): SkillMetricsSummary[] {
  return getDb()
    .prepare(`
      SELECT version,
             COUNT(*) as invocations,
             ROUND(AVG(success) * 100, 1) as successRate,
             ROUND(AVG(latency_ms), 0) as avgLatencyMs,
             ROUND(AVG(cost_credits), 2) as avgCostCredits
      FROM skill_metrics WHERE skill_id = ?
      GROUP BY version ORDER BY version DESC
    `)
    .all(skillId) as SkillMetricsSummary[];
}

// ─── Skill Versions / Forking ─────────────────────────────────────────────────

export function recordSkillVersion(params: {
  id: string;
  skillId: string;
  version: string;
  forkedFromSkill?: string;
  forkedFromVersion?: string;
  forkedByAgent?: string;
}): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO skill_versions (id, skill_id, version, forked_from_skill, forked_from_version, forked_by_agent)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(params.id, params.skillId, params.version,
      params.forkedFromSkill ?? null, params.forkedFromVersion ?? null, params.forkedByAgent ?? null);
}

export function promoteChallenger(skillId: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as Skill | undefined;
    if (!skill?.ab_challenger) return false;

    const challenger = db.prepare('SELECT * FROM skills WHERE id = ?').get(skill.ab_challenger) as Skill | undefined;
    if (!challenger) return false;

    db.prepare(`UPDATE skills SET prompt_template = ?, description = ?, credit_cost = ?,
      input_schema_json = ?, output_schema_json = ?, tags_json = ?,
      version = ?, ab_challenger = NULL WHERE id = ?`)
      .run(challenger.prompt_template, challenger.description, challenger.credit_cost,
        challenger.input_schema_json, challenger.output_schema_json, challenger.tags_json,
        challenger.version ?? '1.0.0', skillId);

    db.prepare(`UPDATE skill_versions SET promoted = 1 WHERE skill_id = ?`).run(skill.ab_challenger);
    db.prepare(`UPDATE skills SET active = 0 WHERE id = ?`).run(skill.ab_challenger);

    return true;
  })();
}

export function getSkillWithAb(id: string): Skill | undefined {
  return getDb().prepare('SELECT * FROM skills WHERE id = ? AND active = 1').get(id) as Skill | undefined;
}

// ─── Skill Stars ──────────────────────────────────────────────────────────────

export function incrementSkillViews(skillId: string): void {
  getDb().prepare('UPDATE skills SET views = views + 1 WHERE id = ?').run(skillId);
}

export function starSkill(skillId: string, agentKey: string): { ok: boolean; alreadyStarred: boolean } {
  const db = getDb();
  return db.transaction(() => {
    const info = db.prepare('INSERT OR IGNORE INTO skill_stars (skill_id, agent_key) VALUES (?, ?)').run(skillId, agentKey);
    if (info.changes === 0) return { ok: false, alreadyStarred: true };
    db.prepare('UPDATE skills SET stars = stars + 1 WHERE id = ?').run(skillId);
    return { ok: true, alreadyStarred: false };
  })();
}

export function unstarSkill(skillId: string, agentKey: string): { ok: boolean } {
  const db = getDb();
  return db.transaction(() => {
    const info = db.prepare('DELETE FROM skill_stars WHERE skill_id = ? AND agent_key = ?').run(skillId, agentKey);
    if (info.changes === 0) return { ok: false };
    db.prepare('UPDATE skills SET stars = CASE WHEN stars > 0 THEN stars - 1 ELSE 0 END WHERE id = ?').run(skillId);
    return { ok: true };
  })();
}

export function hasStarred(skillId: string, agentKey: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM skill_stars WHERE skill_id = ? AND agent_key = ?').get(skillId, agentKey);
  return !!row;
}

// ─── Verified Publisher Program ───────────────────────────────────────────────

export interface VerificationEligibility {
  eligible: boolean;
  reasons: string[];
  metrics: {
    reputationScore: number;
    totalSkills: number;
    skillsWith100Invocations: number;
    avgSuccessRate: number;
    hasClerkAccount: boolean;
    reportCount: number;
  };
}

/**
 * Check if a publisher meets automated verification criteria:
 * - Reputation score >= 5.0
 * - At least 3 public skills with >= 100 invocations each
 * - Average success rate >= 90% across all skills
 * - Linked Clerk account (email verified)
 * - No flagged skills (0 active reports)
 */
export function checkVerificationEligibility(authorKey: string): VerificationEligibility {
  const db = getDb();
  const reasons: string[] = [];

  // Reputation score
  const repRow = db.prepare(
    `SELECT COALESCE(SUM(score_delta), 0) as score FROM reputation_events WHERE agent_id = ?`
  ).get(authorKey) as { score: number };
  const reputationScore = Math.round((repRow.score ?? 0) * 100) / 100;
  if (reputationScore < 5.0) reasons.push(`Reputation score ${reputationScore} < 5.0 required`);

  // Skills with 100+ invocations
  const skillStats = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN uses >= 100 THEN 1 ELSE 0 END) as high_use
    FROM skills WHERE author_key = ? AND active = 1 AND public = 1
  `).get(authorKey) as { total: number; high_use: number };
  if (skillStats.high_use < 3) reasons.push(`${skillStats.high_use}/3 skills with 100+ invocations`);

  // Average success rate across all author's skills
  const successRow = db.prepare(`
    SELECT ROUND(AVG(success) * 100, 1) as avgRate
    FROM skill_metrics sm
    JOIN skills s ON s.id = sm.skill_id
    WHERE s.author_key = ? AND s.active = 1
  `).get(authorKey) as { avgRate: number | null };
  const avgSuccessRate = successRow.avgRate ?? 0;
  if (avgSuccessRate < 90) reasons.push(`Success rate ${avgSuccessRate}% < 90% required`);

  // Clerk account linked
  const clerkRow = db.prepare(
    `SELECT clerk_user_id FROM api_keys WHERE key = ?`
  ).get(authorKey) as { clerk_user_id: string | null } | undefined;
  const hasClerkAccount = !!clerkRow?.clerk_user_id;
  if (!hasClerkAccount) reasons.push('No linked Clerk account');

  // No flagged/reported skills
  const reportRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM skill_reports sr
    JOIN skills s ON s.id = sr.skill_id
    WHERE s.author_key = ? AND s.active = 1
  `).get(authorKey) as { cnt: number };
  if (reportRow.cnt > 0) reasons.push(`${reportRow.cnt} active report(s) on skills`);

  return {
    eligible: reasons.length === 0,
    reasons,
    metrics: {
      reputationScore,
      totalSkills: skillStats.total,
      skillsWith100Invocations: skillStats.high_use,
      avgSuccessRate,
      hasClerkAccount,
      reportCount: reportRow.cnt,
    },
  };
}

/**
 * Auto-verify all eligible skills from a publisher.
 * Only promotes CLEAN/UNSCANNED skills (not FLAGGED or SUSPICIOUS).
 */
export function autoVerifyPublisher(authorKey: string): number {
  const db = getDb();
  const result = db.prepare(`
    UPDATE skills SET security_status = 'VERIFIED', scanned_at = datetime('now')
    WHERE author_key = ? AND active = 1 AND security_status IN ('CLEAN', 'UNSCANNED')
  `).run(authorKey);
  return result.changes;
}

// ─── Skill Security / Reporting ───────────────────────────────────────────────

export function updateSkillSecurityStatus(skillId: string, status: 'UNSCANNED' | 'CLEAN' | 'SUSPICIOUS' | 'FLAGGED' | 'VERIFIED', flags?: string[]): void {
  getDb().prepare(
    `UPDATE skills SET security_status = ?, scanned_at = datetime('now') WHERE id = ?`
  ).run(status, skillId);
  if (flags && flags.length > 0) {
    logger.warn({ skillId, status, flags }, 'Skill security scan flagged');
  }
}

export function reportSkill(skillId: string, reporterKey: string, reason: string): { ok: boolean; error?: string; reportCount?: number } {
  const db = getDb();
  return db.transaction(() => {
    const info = db.prepare(
      `INSERT OR IGNORE INTO skill_reports (skill_id, reporter_key, reason) VALUES (?, ?, ?)`
    ).run(skillId, reporterKey, reason);
    if (info.changes === 0) return { ok: false, error: 'Already reported' };

    const { count } = db.prepare(
      `SELECT COUNT(*) as count FROM skill_reports WHERE skill_id = ?`
    ).get(skillId) as { count: number };

    if (count >= 3) {
      db.prepare(`UPDATE skills SET security_status = 'FLAGGED' WHERE id = ? AND security_status NOT IN ('VERIFIED','FLAGGED')`).run(skillId);
    }
    return { ok: true, reportCount: count };
  })();
}

export function getSkillReportCount(skillId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM skill_reports WHERE skill_id = ?')
    .get(skillId) as { count: number };
  return row.count;
}

export function getSkillVersionHistory(skillId: string): { id: string; version: string; changelog: string | null; published_at: string }[] {
  return getDb()
    .prepare(`SELECT id, version, changelog, published_at FROM skill_versions WHERE skill_id = ? ORDER BY published_at DESC LIMIT 20`)
    .all(skillId) as { id: string; version: string; changelog: string | null; published_at: string }[];
}

// ─── Skill Ratings ────────────────────────────────────────────────────────────

export interface SkillRating {
  id: string;
  skill_id: string;
  buyer_key: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface SkillRatingStats {
  avgRating: number;
  ratingCount: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export function rateSkill(params: {
  skillId: string;
  buyerKey: string;
  rating: number;
  comment?: string;
}): { ok: boolean; error?: string } {
  const db = getDb();
  const hasPurchased = db.prepare(
    `SELECT 1 FROM transactions WHERE from_agent = ? AND skill_id = ? AND type = 'SKILL_SALE' LIMIT 1`
  ).get(params.buyerKey, params.skillId);
  if (!hasPurchased) {
    return { ok: false, error: 'Must purchase a skill before rating it' };
  }
  try {
    db.prepare(`INSERT OR REPLACE INTO skill_ratings (id, skill_id, buyer_key, rating, comment)
                VALUES (?, ?, ?, ?, ?)`)
      .run(nanoid(12), params.skillId, params.buyerKey, params.rating, params.comment ?? null);
    updateSkillTrustSignals(params.skillId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

export function getSkillRatings(skillId: string, limit = 20): SkillRating[] {
  return getDb()
    .prepare(`SELECT * FROM skill_ratings WHERE skill_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(skillId, limit) as SkillRating[];
}

export function getSkillRatingStats(skillId: string): SkillRatingStats {
  const db = getDb();
  const rows = db
    .prepare(`SELECT rating, COUNT(*) as cnt FROM skill_ratings WHERE skill_id = ? GROUP BY rating`)
    .all(skillId) as { rating: number; cnt: number }[];
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let total = 0;
  let sum = 0;
  for (const row of rows) {
    const r = row.rating as 1 | 2 | 3 | 4 | 5;
    distribution[r] = row.cnt;
    total += row.cnt;
    sum += row.rating * row.cnt;
  }
  return {
    avgRating: total > 0 ? Math.round((sum / total) * 10) / 10 : 0,
    ratingCount: total,
    distribution,
  };
}

// ─── Featured Skills ──────────────────────────────────────────────────────────

export function setSkillFeatured(skillId: string, featured: boolean): void {
  getDb().prepare(`UPDATE skills SET featured = ? WHERE id = ? AND active = 1`).run(featured ? 1 : 0, skillId);
}

export function getFeaturedSkills(limit = 6): Skill[] {
  return getDb()
    .prepare(`SELECT * FROM skills WHERE public = 1 AND active = 1 AND featured = 1 ORDER BY stars DESC, uses DESC LIMIT ?`)
    .all(limit) as Skill[];
}

// ─── Reputation ───────────────────────────────────────────────────────────────

export function recordReputation(params: {
  agentId: string;
  skillId?: string;
  eventType: string;
  scoreDelta?: number;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .prepare(`INSERT INTO reputation_events (id, agent_id, skill_id, event_type, score_delta, data_json)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        nanoid(16), params.agentId, params.skillId ?? null,
        params.eventType, params.scoreDelta ?? null,
        params.data ? JSON.stringify(params.data) : null
      );
  } catch (err) {
    logger.error({ err }, 'Failed to record reputation event');
  }
}

export function getReputationScore(agentId: string): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(score_delta), 0) as score FROM reputation_events WHERE agent_id = ?`)
    .get(agentId) as { score: number };
  return Math.round((row.score ?? 0) * 100) / 100;
}

export function getReputationEvents(agentId: string, limit = 50): {
  id: string; skill_id: string | null; event_type: string; score_delta: number | null; data_json: string | null; timestamp: string;
}[] {
  return getDb()
    .prepare('SELECT id, skill_id, event_type, score_delta, data_json, timestamp FROM reputation_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(agentId, limit) as { id: string; skill_id: string | null; event_type: string; score_delta: number | null; data_json: string | null; timestamp: string; }[];
}

export function setAbChallenger(skillId: string, challengerId: string): void {
  getDb()
    .prepare(`UPDATE skills SET ab_challenger = ? WHERE id = ?`)
    .run(challengerId, skillId);
}

// ─── Skill Cost Analytics ────────────────────────────────────────────────────

export interface SkillCostAnalytics {
  totalInvocations: number;
  totalCreditsEarned: number;
  avgCostCredits: number;
  medianCostCredits: number;
  p95LatencyMs: number;
  avgLatencyMs: number;
  successRate: number;
  completionRate: number;
  costTrend: { period: string; avgCost: number; invocations: number }[];
}

export function getSkillCostAnalytics(skillId: string): SkillCostAnalytics {
  const db = getDb();

  // Aggregate from skill_metrics
  const agg = db.prepare(`
    SELECT COUNT(*) as total,
           ROUND(AVG(cost_credits), 2) as avgCost,
           ROUND(AVG(latency_ms), 0) as avgLatency,
           ROUND(AVG(success) * 100, 1) as successRate
    FROM skill_metrics WHERE skill_id = ?
  `).get(skillId) as { total: number; avgCost: number; avgLatency: number; successRate: number } | undefined;

  // P95 latency
  const p95Row = db.prepare(`
    SELECT latency_ms FROM skill_metrics
    WHERE skill_id = ? AND latency_ms IS NOT NULL
    ORDER BY latency_ms ASC
    LIMIT 1 OFFSET (SELECT CAST(COUNT(*) * 0.95 AS INTEGER) FROM skill_metrics WHERE skill_id = ? AND latency_ms IS NOT NULL)
  `).get(skillId, skillId) as { latency_ms: number } | undefined;

  // Median cost
  const medianRow = db.prepare(`
    SELECT cost_credits FROM skill_metrics
    WHERE skill_id = ? AND cost_credits IS NOT NULL
    ORDER BY cost_credits ASC
    LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM skill_metrics WHERE skill_id = ? AND cost_credits IS NOT NULL)
  `).get(skillId, skillId) as { cost_credits: number } | undefined;

  // Total credits earned (from transactions)
  const earnings = db.prepare(`
    SELECT COALESCE(SUM(amount_credits - fee_credits), 0) as earned
    FROM transactions WHERE skill_id = ? AND type = 'SKILL_SALE'
  `).get(skillId) as { earned: number };

  // Task completion rate
  const taskAgg = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
    FROM tasks WHERE skill_id = ?
  `).get(skillId) as { total: number; completed: number } | undefined;

  // Weekly cost trend (last 8 weeks)
  const trend = db.prepare(`
    SELECT strftime('%Y-W%W', timestamp) as period,
           ROUND(AVG(cost_credits), 2) as avgCost,
           COUNT(*) as invocations
    FROM skill_metrics WHERE skill_id = ?
      AND timestamp > datetime('now', '-56 days')
    GROUP BY period ORDER BY period ASC
  `).all(skillId) as { period: string; avgCost: number; invocations: number }[];

  return {
    totalInvocations: agg?.total ?? 0,
    totalCreditsEarned: earnings.earned,
    avgCostCredits: agg?.avgCost ?? 0,
    medianCostCredits: medianRow?.cost_credits ?? 0,
    p95LatencyMs: p95Row?.latency_ms ?? 0,
    avgLatencyMs: agg?.avgLatency ?? 0,
    successRate: agg?.successRate ?? 0,
    completionRate: taskAgg && taskAgg.total > 0
      ? Math.round((taskAgg.completed / taskAgg.total) * 1000) / 10
      : 0,
    costTrend: trend,
  };
}

// ─── Composite Skill Validation ──────────────────────────────────────────────

export interface SkillDependency {
  skillId: string;
  paramMapping: Record<string, string>;
  outputKey: string;
  // v66: composability upgrades
  /** Parallel execution group — steps in same group run concurrently */
  group?: number;
  /** Condition — if not met, step is skipped */
  condition?: {
    field: string;   // {{variable}} or {{steps.outputKey.field}}
    op: 'exists' | 'not_exists' | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
    value?: string | number;
  };
  /** Fallback skill ID — used if primary fails after retries */
  fallbackSkillId?: string;
  /** Max retries before fallback (default 1, max 3) */
  retries?: number;
}

/**
 * Validate composite skill dependencies at creation time:
 * - Max 5 dependencies
 * - No self-reference
 * - Each dependency must be a public, active, non-composite skill
 */
function validateCompositeDependencies(compositeId: string, dependenciesJson: string): void {
  let deps: SkillDependency[];
  try {
    deps = JSON.parse(dependenciesJson);
  } catch {
    throw new Error('dependencies_json must be a valid JSON array');
  }
  if (!Array.isArray(deps)) throw new Error('dependencies_json must be an array');
  if (deps.length === 0) throw new Error('Composite skills must have at least 1 dependency');
  if (deps.length > 5) throw new Error('Maximum 5 dependencies per composite skill');

  const db = getDb();
  const seen = new Set<string>();

  // Count total leaf (non-composite) invocations across the entire tree
  let totalLeafCount = 0;

  for (const dep of deps) {
    if (!dep.skillId || typeof dep.skillId !== 'string') throw new Error('Each dependency must have a skillId');
    if (!dep.outputKey || typeof dep.outputKey !== 'string') throw new Error('Each dependency must have an outputKey');
    if (dep.skillId === compositeId) throw new Error('Composite skill cannot depend on itself');
    if (seen.has(dep.skillId)) throw new Error(`Duplicate dependency: ${dep.skillId}`);
    seen.add(dep.skillId);

    const target = db.prepare('SELECT skill_type, public, active, dependencies_json, composite_depth FROM skills WHERE id = ?').get(dep.skillId) as
      { skill_type: string; public: number; active: number; dependencies_json: string | null; composite_depth: number } | undefined;
    if (!target) throw new Error(`Dependency skill not found: ${dep.skillId}`);
    if (!target.active) throw new Error(`Dependency skill is inactive: ${dep.skillId}`);
    if (!target.public) throw new Error(`Dependency skill must be public: ${dep.skillId}`);

    if (target.skill_type === 'composite') {
      // Allow composite-of-composite but enforce max depth 3
      if ((target.composite_depth ?? 0) >= 2) throw new Error(`Composite nesting too deep: ${dep.skillId} (max depth 3)`);
      // Cycle detection: check if target depends on compositeId (BFS)
      if (hasCircularDependency(compositeId, dep.skillId, db)) {
        throw new Error(`Circular dependency detected: ${dep.skillId} depends on this skill`);
      }
      // Count sub-leaves from nested composite
      const subLeaves = countLeafDeps(dep.skillId, db);
      totalLeafCount += subLeaves;
    } else {
      totalLeafCount++;
    }
  }

  if (totalLeafCount > 10) throw new Error(`Total leaf invocations across tree (${totalLeafCount}) exceeds max of 10`);

  // Compute depth for this composite
  const maxChildDepth = deps.reduce((max, dep) => {
    const target = db.prepare('SELECT composite_depth FROM skills WHERE id = ?').get(dep.skillId) as { composite_depth: number } | undefined;
    return Math.max(max, (target?.composite_depth ?? 0));
  }, 0);
  // Store computed depth after insert (called from createSkill)
  // We'll update it after insertion
}

/** BFS cycle detection: does targetId eventually depend on compositeId? */
function hasCircularDependency(compositeId: string, targetId: string, db: ReturnType<typeof getDb>): boolean {
  const visited = new Set<string>();
  const queue = [targetId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const row = db.prepare('SELECT dependencies_json FROM skills WHERE id = ? AND skill_type = ?').get(current, 'composite') as
      { dependencies_json: string | null } | undefined;
    if (!row?.dependencies_json) continue;
    try {
      const deps = JSON.parse(row.dependencies_json) as SkillDependency[];
      for (const d of deps) {
        if (d.skillId === compositeId) return true;
        queue.push(d.skillId);
      }
    } catch { /* ignore parse errors */ }
  }
  return false;
}

/** Count total leaf (non-composite) invocations in a composite tree */
function countLeafDeps(skillId: string, db: ReturnType<typeof getDb>): number {
  const row = db.prepare('SELECT dependencies_json, skill_type FROM skills WHERE id = ?').get(skillId) as
    { dependencies_json: string | null; skill_type: string } | undefined;
  if (!row?.dependencies_json || row.skill_type !== 'composite') return 1;
  try {
    const deps = JSON.parse(row.dependencies_json) as SkillDependency[];
    return deps.reduce((sum, d) => sum + countLeafDeps(d.skillId, db), 0);
  } catch { return 1; }
}

// ─── SLA Contracts ───────────────────────────────────────────────────────────

export interface SkillSLA {
  guaranteed_uptime: number;    // 0-100 percentage
  max_latency_ms: number;       // maximum acceptable latency
  min_success_rate: number;     // 0-100 percentage
  penalty_pct: number;          // 0-100 — % of credit_cost refunded on violation
}

export interface SLAViolation {
  id: string;
  skill_id: string;
  violation_type: 'LATENCY' | 'SUCCESS_RATE' | 'UPTIME';
  measured_value: number;
  sla_threshold: number;
  penalty_credits: number;
  resolved: number;
  created_at: string;
}

/**
 * Check a skill's current metrics against its SLA guarantees.
 * Returns violations found (does not record them — caller decides).
 */
export function checkSLACompliance(skillId: string): {
  compliant: boolean;
  violations: { type: 'LATENCY' | 'SUCCESS_RATE' | 'UPTIME'; measured: number; threshold: number }[];
} {
  const skill = getSkill(skillId);
  if (!skill?.sla_json) return { compliant: true, violations: [] };

  let sla: SkillSLA;
  try { sla = JSON.parse(skill.sla_json); } catch { return { compliant: true, violations: [] }; }

  const violations: { type: 'LATENCY' | 'SUCCESS_RATE' | 'UPTIME'; measured: number; threshold: number }[] = [];

  // Check latency (avg over last 100 invocations)
  if (sla.max_latency_ms > 0) {
    const row = getDb().prepare(
      `SELECT ROUND(AVG(latency_ms), 0) as avg FROM (SELECT latency_ms FROM skill_metrics WHERE skill_id = ? ORDER BY timestamp DESC LIMIT 100)`
    ).get(skillId) as { avg: number | null } | undefined;
    if (row?.avg && row.avg > sla.max_latency_ms) {
      violations.push({ type: 'LATENCY', measured: row.avg, threshold: sla.max_latency_ms });
    }
  }

  // Check success rate (last 100 invocations)
  if (sla.min_success_rate > 0) {
    const row = getDb().prepare(
      `SELECT ROUND(AVG(success) * 100, 1) as rate FROM (SELECT success FROM skill_metrics WHERE skill_id = ? ORDER BY timestamp DESC LIMIT 100)`
    ).get(skillId) as { rate: number | null } | undefined;
    if (row?.rate !== null && row?.rate !== undefined && row.rate < sla.min_success_rate) {
      violations.push({ type: 'SUCCESS_RATE', measured: row.rate, threshold: sla.min_success_rate });
    }
  }

  // Check uptime via health_status
  if (sla.guaranteed_uptime > 0 && skill.health_status === 'DEGRADED') {
    violations.push({ type: 'UPTIME', measured: 0, threshold: sla.guaranteed_uptime });
  }

  return { compliant: violations.length === 0, violations };
}

/** Record an SLA violation in the database. */
export function recordSLAViolation(params: {
  skillId: string;
  violationType: 'LATENCY' | 'SUCCESS_RATE' | 'UPTIME';
  measuredValue: number;
  slaThreshold: number;
  penaltyCredits: number;
}): string {
  const id = nanoid(12);
  getDb().prepare(
    `INSERT INTO sla_violations (id, skill_id, violation_type, measured_value, sla_threshold, penalty_credits)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, params.skillId, params.violationType, params.measuredValue, params.slaThreshold, params.penaltyCredits);
  return id;
}

/** Get recent SLA violations for a skill. */
export function getSLAViolations(skillId: string, limit = 20): SLAViolation[] {
  return getDb()
    .prepare('SELECT * FROM sla_violations WHERE skill_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(skillId, limit) as SLAViolation[];
}

// ─── Output Contract Validation ──────────────────────────────────────────────

/**
 * Validate skill output against its output_contract_json (JSON Schema-like).
 * Returns { valid: true } or { valid: false, errors: [...] }.
 * Supports type checking, required fields, and basic property validation.
 */
export function validateOutputContract(
  output: unknown,
  contractJson: string,
): { valid: boolean; errors: string[] } {
  let contract: { type?: string; required?: string[]; properties?: Record<string, { type?: string }> };
  try { contract = JSON.parse(contractJson); } catch { return { valid: false, errors: ['Invalid contract JSON'] }; }

  const errors: string[] = [];

  // Type check
  if (contract.type) {
    const actualType = Array.isArray(output) ? 'array' : typeof output;
    if (contract.type === 'object' && actualType !== 'object') {
      errors.push(`Expected type "object", got "${actualType}"`);
    } else if (contract.type === 'array' && actualType !== 'array') {
      errors.push(`Expected type "array", got "${actualType}"`);
    }
  }

  // Required fields (for object output)
  if (contract.required && typeof output === 'object' && output !== null && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    for (const field of contract.required) {
      if (!(field in obj)) {
        errors.push(`Missing required field: "${field}"`);
      }
    }
  }

  // Property type checks
  if (contract.properties && typeof output === 'object' && output !== null && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    for (const [key, spec] of Object.entries(contract.properties)) {
      if (key in obj && spec.type) {
        const valType = Array.isArray(obj[key]) ? 'array' : typeof obj[key];
        if (valType !== spec.type && obj[key] !== null) {
          errors.push(`Field "${key}": expected type "${spec.type}", got "${valType}"`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Calculate total credit cost of a composite skill's dependencies. */
export function getCompositeTotalCost(dependenciesJson: string): number {
  let deps: SkillDependency[];
  try { deps = JSON.parse(dependenciesJson); } catch { return 0; }
  if (!Array.isArray(deps)) return 0;

  const db = getDb();
  let total = 0;
  for (const dep of deps) {
    const row = db.prepare('SELECT credit_cost FROM skills WHERE id = ? AND active = 1').get(dep.skillId) as { credit_cost: number } | undefined;
    total += row?.credit_cost ?? 0;
  }
  return total;
}

// ─── Trust Decay ──────────────────────────────────────────────────────────────

/**
 * Recalculate decay weights for all ratings of a skill.
 * Ratings lose 10% of their weight per 30 days since creation.
 * Minimum weight: 0.1 (ratings never fully expire, just fade).
 */
export function recalculateDecayWeights(skillId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE skill_ratings SET decay_weight = MAX(0.1, 1.0 - (
      (julianday('now') - julianday(created_at)) / 30.0 * 0.1
    )) WHERE skill_id = ?
  `).run(skillId);
}

/**
 * Get decay-adjusted average rating for a skill.
 * Returns weighted average where recent ratings count more.
 */
export function getDecayAdjustedRating(skillId: string): { avgRating: number; effectiveCount: number } {
  const row = getDb().prepare(`
    SELECT
      ROUND(COALESCE(SUM(rating * decay_weight) / NULLIF(SUM(decay_weight), 0), 0), 1) as avg_rating,
      ROUND(COALESCE(SUM(decay_weight), 0), 1) as effective_count
    FROM skill_ratings WHERE skill_id = ?
  `).get(skillId) as { avg_rating: number; effective_count: number };
  return { avgRating: row.avg_rating, effectiveCount: row.effective_count };
}

/**
 * Run trust decay across all skills — call from cron.
 * Updates decay_weight on ratings, then refreshes denormalized avg_rating.
 */
export function runTrustDecay(): { updated: number } {
  const db = getDb();
  const result = db.prepare(`
    UPDATE skill_ratings SET decay_weight = MAX(0.1, 1.0 - (
      (julianday('now') - julianday(created_at)) / 30.0 * 0.1
    )) WHERE decay_weight != MAX(0.1, 1.0 - (
      (julianday('now') - julianday(created_at)) / 30.0 * 0.1
    ))
  `).run();

  // Refresh denormalized avg_rating on skills with updated weights
  db.prepare(`
    UPDATE skills SET avg_rating = COALESCE((
      SELECT ROUND(SUM(r.rating * r.decay_weight) / NULLIF(SUM(r.decay_weight), 0), 1)
      FROM skill_ratings r WHERE r.skill_id = skills.id
    ), 0) WHERE id IN (
      SELECT DISTINCT skill_id FROM skill_ratings
    )
  `).run();

  return { updated: result.changes };
}

// ─── Penalty Escalation ───────────────────────────────────────────────────────

export type PenaltyTier = 0 | 1 | 2 | 3;

/**
 * Escalate penalty tier for a skill based on SLA violation count.
 * Tier 0: clean (0 violations in 7 days)
 * Tier 1: warning (3+ violations in 7 days) — no effect, just flagged
 * Tier 2: reduced visibility (6+ violations in 7 days) — excluded from featured/compare
 * Tier 3: delisted (10+ violations in 7 days) — set public=0
 *
 * Returns the new tier if changed, null if unchanged.
 */
export function escalatePenalty(skillId: string): { newTier: PenaltyTier; changed: boolean } {
  const db = getDb();

  // Count violations in last 7 days
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM sla_violations
    WHERE skill_id = ? AND created_at > datetime('now', '-7 days')
  `).get(skillId) as { cnt: number };

  const currentTier = (db.prepare('SELECT penalty_tier FROM skills WHERE id = ?').get(skillId) as { penalty_tier: number })?.penalty_tier ?? 0;
  let newTier: PenaltyTier = 0;

  if (row.cnt >= 10) newTier = 3;
  else if (row.cnt >= 6) newTier = 2;
  else if (row.cnt >= 3) newTier = 1;
  else newTier = 0;

  if (newTier !== currentTier) {
    db.prepare(`UPDATE skills SET penalty_tier = ?, penalty_updated_at = datetime('now') WHERE id = ?`).run(newTier, skillId);

    // Tier 3: auto-delist (set public = 0)
    if (newTier === 3) {
      db.prepare(`UPDATE skills SET public = 0 WHERE id = ?`).run(skillId);
      logger.warn({ skillId, violations: row.cnt }, 'Skill auto-delisted due to penalty tier 3');
    }

    return { newTier, changed: true };
  }

  return { newTier, changed: false };
}

/**
 * Get penalty info for a skill.
 */
export function getPenaltyInfo(skillId: string): { tier: PenaltyTier; updatedAt: string | null; recentViolations: number } {
  const db = getDb();
  const skill = db.prepare('SELECT penalty_tier, penalty_updated_at FROM skills WHERE id = ?').get(skillId) as { penalty_tier: number; penalty_updated_at: string | null } | undefined;
  const violations = (db.prepare('SELECT COUNT(*) as cnt FROM sla_violations WHERE skill_id = ? AND created_at > datetime(\'now\', \'-7 days\')').get(skillId) as { cnt: number })?.cnt ?? 0;
  return { tier: (skill?.penalty_tier ?? 0) as PenaltyTier, updatedAt: skill?.penalty_updated_at ?? null, recentViolations: violations };
}

// ─── Structured Report Categories ─────────────────────────────────────────────

export type ReportCategory = 'security' | 'spam' | 'copyright' | 'quality' | 'misleading' | 'other';

export function reportSkillWithCategory(params: {
  skillId: string;
  reporterKey: string;
  reason: string;
  category: ReportCategory;
}): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO skill_reports (skill_id, reporter_key, reason, category)
       VALUES (?, ?, ?, ?)`
    ).run(params.skillId, params.reporterKey, params.reason, params.category);

    // Auto-flag after 3 reports (same as original reportSkill)
    const count = (db.prepare('SELECT COUNT(*) as n FROM skill_reports WHERE skill_id = ?').get(params.skillId) as { n: number }).n;
    if (count >= 3) {
      db.prepare(`UPDATE skills SET security_status = 'FLAGGED' WHERE id = ? AND security_status != 'VERIFIED'`).run(params.skillId);
    }
  })();
}

export function getReportsByCategory(skillId: string): { category: string; count: number }[] {
  return getDb().prepare(
    `SELECT category, COUNT(*) as count FROM skill_reports WHERE skill_id = ? GROUP BY category ORDER BY count DESC`
  ).all(skillId) as { category: string; count: number }[];
}

// ─── Scheduled Skills ─────────────────────────────────────────────────────────

export interface ScheduledSkill {
  id: string;
  skill_id: string;
  caller_key: string;
  variables_json: string | null;
  cron_expression: string;
  next_run_at: string;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  active: number;
  max_credits_per_run: number | null;
  total_runs: number;
  total_credits_spent: number;
  created_at: string;
}

export function createScheduledSkill(params: {
  skillId: string;
  callerKey: string;
  variables?: Record<string, string>;
  cronExpression: string;
  nextRunAt: string;
  maxCreditsPerRun?: number;
}): string {
  const id = nanoid(12);
  getDb().prepare(
    `INSERT INTO scheduled_skills (id, skill_id, caller_key, variables_json, cron_expression, next_run_at, max_credits_per_run)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.skillId, params.callerKey, params.variables ? JSON.stringify(params.variables) : null,
    params.cronExpression, params.nextRunAt, params.maxCreditsPerRun ?? null);
  return id;
}

export function getScheduledSkills(callerKey: string): ScheduledSkill[] {
  return getDb().prepare(
    'SELECT * FROM scheduled_skills WHERE caller_key = ? AND active = 1 ORDER BY created_at DESC'
  ).all(callerKey) as ScheduledSkill[];
}

export function getDueScheduledSkills(): ScheduledSkill[] {
  return getDb().prepare(
    `SELECT * FROM scheduled_skills WHERE active = 1 AND next_run_at <= datetime('now') LIMIT 50`
  ).all() as ScheduledSkill[];
}

export function updateScheduledSkillRun(id: string, params: {
  nextRunAt: string;
  lastStatus: string;
  lastError?: string;
  creditsSpent: number;
}): void {
  getDb().prepare(`
    UPDATE scheduled_skills SET
      next_run_at = ?, last_run_at = datetime('now'), last_status = ?, last_error = ?,
      total_runs = total_runs + 1, total_credits_spent = total_credits_spent + ?
    WHERE id = ?
  `).run(params.nextRunAt, params.lastStatus, params.lastError ?? null, params.creditsSpent, id);
}

export function deleteScheduledSkill(callerKey: string, id: string): boolean {
  const result = getDb().prepare(
    'UPDATE scheduled_skills SET active = 0 WHERE id = ? AND caller_key = ? AND active = 1'
  ).run(id, callerKey);
  return result.changes > 0;
}

// ─── Dynamic Pricing — Demand Tracking ────────────────────────────────────────

/** Record a skill invocation for demand tracking. Called on every skill invoke. */
export function recordSkillDemand(skillId: string): void {
  const hourBucket = new Date().toISOString().slice(0, 13); // '2026-03-14T15'
  getDb().prepare(
    `INSERT INTO skill_demand (skill_id, hour_bucket, call_count) VALUES (?, ?, 1)
     ON CONFLICT(skill_id, hour_bucket) DO UPDATE SET call_count = call_count + 1`
  ).run(skillId, hourBucket);
}

/** Get current hour demand for a skill. */
export function getSkillDemand(skillId: string): number {
  const hourBucket = new Date().toISOString().slice(0, 13);
  const row = getDb().prepare(
    'SELECT call_count FROM skill_demand WHERE skill_id = ? AND hour_bucket = ?'
  ).get(skillId, hourBucket) as { call_count: number } | undefined;
  return row?.call_count ?? 0;
}

/** Record caller usage for volume discount tracking. */
export function recordCallerUsage(callerKey: string, skillId: string): void {
  const daily = `daily:${new Date().toISOString().slice(0, 10)}`;
  const monthly = `monthly:${new Date().toISOString().slice(0, 7)}`;
  const db = getDb();
  db.prepare(
    `INSERT INTO caller_skill_usage (caller_key, skill_id, period, call_count) VALUES (?, ?, ?, 1)
     ON CONFLICT(caller_key, skill_id, period) DO UPDATE SET call_count = call_count + 1`
  ).run(callerKey, skillId, daily);
  db.prepare(
    `INSERT INTO caller_skill_usage (caller_key, skill_id, period, call_count) VALUES (?, ?, ?, 1)
     ON CONFLICT(caller_key, skill_id, period) DO UPDATE SET call_count = call_count + 1`
  ).run(callerKey, skillId, monthly);
}

/** Get monthly caller usage for a skill (volume discount basis). */
export function getCallerUsageCount(callerKey: string, skillId: string): number {
  const monthly = `monthly:${new Date().toISOString().slice(0, 7)}`;
  const row = getDb().prepare(
    'SELECT call_count FROM caller_skill_usage WHERE caller_key = ? AND skill_id = ? AND period = ?'
  ).get(callerKey, skillId, monthly) as { call_count: number } | undefined;
  return row?.call_count ?? 0;
}

/** Cleanup old demand tracking data. Called from daily cleanup cron. */
export function cleanupDemandData(): { demandRows: number; usageRows: number } {
  const hourCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 13);
  const demandRows = batchedDelete(
    'DELETE FROM skill_demand WHERE rowid IN (SELECT rowid FROM skill_demand WHERE hour_bucket < ?)',
    [hourCutoff]
  );
  const usageCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const usageRows = batchedDelete(
    "DELETE FROM caller_skill_usage WHERE rowid IN (SELECT rowid FROM caller_skill_usage WHERE period LIKE 'daily:%' AND period < ?)",
    [`daily:${usageCutoff}`]
  );
  return { demandRows, usageRows };
}

// ─── Autonomous Hiring/Firing — Composite Auto-Replace ────────────────────────

/**
 * Find a replacement skill for a degraded one in a composite.
 * Matches by skill_type + overlapping tags. Returns best healthy alternative or null.
 */
export function findReplacementSkill(degradedSkillId: string): { id: string; name: string; successRate: number } | null {
  const db = getDb();
  const original = db.prepare('SELECT skill_type, tags_json FROM skills WHERE id = ?').get(degradedSkillId) as
    { skill_type: string; tags_json: string | null } | undefined;
  if (!original) return null;

  // Find healthy skills of same type
  const candidates = db.prepare(`
    SELECT id, name, success_rate, avg_rating, uses, tags_json
    FROM skills WHERE skill_type = ? AND active = 1 AND public = 1
      AND health_status = 'HEALTHY' AND penalty_tier < 2
      AND id != ? AND success_rate >= 80
    ORDER BY (success_rate * 0.4 + avg_rating * 20 * 0.3 + LEAST(uses, 1000) / 10 * 0.2) DESC
    LIMIT 5
  `).all(original.skill_type, degradedSkillId) as Array<{ id: string; name: string; success_rate: number; tags_json: string | null }>;

  if (candidates.length === 0) return null;

  // Prefer candidates with overlapping tags
  if (original.tags_json) {
    try {
      const origTags = JSON.parse(original.tags_json) as string[];
      const scored = candidates.map(c => {
        let tagOverlap = 0;
        try {
          const cTags = JSON.parse(c.tags_json ?? '[]') as string[];
          tagOverlap = origTags.filter(t => cTags.includes(t)).length;
        } catch { /* ignore */ }
        return { ...c, tagOverlap };
      }).sort((a, b) => b.tagOverlap - a.tagOverlap);
      return { id: scored[0].id, name: scored[0].name, successRate: scored[0].success_rate };
    } catch { /* ignore tag parse errors */ }
  }

  return { id: candidates[0].id, name: candidates[0].name, successRate: candidates[0].success_rate };
}

/** Record a composite dependency swap. */
export function swapCompositeDependency(compositeId: string, originalSkillId: string, replacementSkillId: string, reason: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    // Check max 3 active swaps per composite
    const activeSwaps = (db.prepare(
      'SELECT COUNT(*) as n FROM composite_swaps WHERE composite_id = ? AND reverted = 0'
    ).get(compositeId) as { n: number }).n;
    if (activeSwaps >= 3) return false;

    // Record swap
    db.prepare(
      'INSERT INTO composite_swaps (id, composite_id, original_skill_id, replacement_skill_id, reason) VALUES (?, ?, ?, ?, ?)'
    ).run(nanoid(16), compositeId, originalSkillId, replacementSkillId, reason);

    // Update dependencies_json — swap skillId
    const skill = db.prepare('SELECT dependencies_json FROM skills WHERE id = ?').get(compositeId) as { dependencies_json: string } | undefined;
    if (!skill?.dependencies_json) return false;
    const updated = skill.dependencies_json.replace(
      new RegExp(`"skillId"\\s*:\\s*"${originalSkillId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
      `"skillId":"${replacementSkillId}"`
    );
    db.prepare('UPDATE skills SET dependencies_json = ? WHERE id = ?').run(updated, compositeId);
    return true;
  })();
}

/** Revert a swap when the original skill recovers. */
export function revertCompositeSwap(compositeId: string, originalSkillId: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    const swap = db.prepare(
      'SELECT id, replacement_skill_id FROM composite_swaps WHERE composite_id = ? AND original_skill_id = ? AND reverted = 0 ORDER BY created_at DESC LIMIT 1'
    ).get(compositeId, originalSkillId) as { id: string; replacement_skill_id: string } | undefined;
    if (!swap) return false;

    // Restore original in dependencies_json
    const skill = db.prepare('SELECT dependencies_json FROM skills WHERE id = ?').get(compositeId) as { dependencies_json: string } | undefined;
    if (!skill?.dependencies_json) return false;
    const reverted = skill.dependencies_json.replace(
      new RegExp(`"skillId"\\s*:\\s*"${swap.replacement_skill_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
      `"skillId":"${originalSkillId}"`
    );
    db.prepare('UPDATE skills SET dependencies_json = ? WHERE id = ?').run(reverted, compositeId);
    db.prepare('UPDATE composite_swaps SET reverted = 1 WHERE id = ?').run(swap.id);
    return true;
  })();
}

/** Get composites that depend on a specific skill and have auto_replace enabled. */
export function getAutoReplaceComposites(skillId: string): Array<{ id: string; author_key: string }> {
  return getDb().prepare(`
    SELECT id, author_key FROM skills
    WHERE skill_type = 'composite' AND active = 1 AND auto_replace = 1
      AND dependencies_json LIKE '%' || ? || '%'
  `).all(skillId) as Array<{ id: string; author_key: string }>;
}

/** Update scheduled skill with session and trigger fields. */
export function createScheduledSkillV2(params: {
  skillId: string;
  callerKey: string;
  variables?: Record<string, string>;
  cronExpression: string;
  nextRunAt: string;
  maxCreditsPerRun?: number;
  sessionId?: string;
  triggerType?: 'cron' | 'context_change' | 'threshold';
  triggerConfig?: Record<string, unknown>;
}): string {
  const id = nanoid(12);
  getDb().prepare(
    `INSERT INTO scheduled_skills (id, skill_id, caller_key, variables_json, cron_expression, next_run_at, max_credits_per_run, session_id, trigger_type, trigger_config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.skillId, params.callerKey,
    params.variables ? JSON.stringify(params.variables) : null,
    params.cronExpression, params.nextRunAt,
    params.maxCreditsPerRun ?? null,
    params.sessionId ?? null,
    params.triggerType ?? 'cron',
    params.triggerConfig ? JSON.stringify(params.triggerConfig) : null);
  return id;
}
