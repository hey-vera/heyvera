import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { getDb } from './connection';

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
  skill_type: 'prompt_template' | 'api_proxy';
  proxy_url: string | null;
  proxy_method: string;
  /** JSON-serialised SkillExecutionPlan — if present, bypasses LLM intent parsing */
  execution_plan_json: string | null;
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
  skillType?: 'prompt_template' | 'api_proxy';
  proxyUrl?: string;
  proxyMethod?: string;
  executionPlanJson?: string;
}): void {
  getDb()
    .prepare(`INSERT INTO skills (id, name, description, prompt_template, author_key, public, credit_cost, display_name, changelog, category, skill_type, proxy_url, proxy_method, execution_plan_json)
              VALUES (@id, @name, @description, @promptTemplate, @authorKey, @public, @creditCost, @displayName, @changelog, @category, @skillType, @proxyUrl, @proxyMethod, @executionPlanJson)`)
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
    });
}

export function getSkill(id: string): Skill | undefined {
  return getDb().prepare('SELECT * FROM skills WHERE id = ? AND active = 1').get(id) as Skill | undefined;
}

export function listPublicSkills(offset = 0, limit = 50): Skill[] {
  return getDb()
    .prepare('SELECT * FROM skills WHERE public = 1 AND active = 1 ORDER BY uses DESC, created_at DESC LIMIT ? OFFSET ?')
    .all(Math.min(limit, 100), offset) as Skill[];
}

export function countPublicSkills(): number {
  return (getDb()
    .prepare('SELECT COUNT(*) as n FROM skills WHERE public = 1 AND active = 1')
    .get() as { n: number }).n;
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
  const result = getDb()
    .prepare('UPDATE skills SET active = 0 WHERE id = ? AND author_key = ? AND active = 1')
    .run(id, authorKey);
  return result.changes > 0;
}

export function updateSkillVisibility(id: string, authorKey: string, isPublic: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE skills SET public = ? WHERE id = ? AND author_key = ? AND active = 1')
    .run(isPublic ? 1 : 0, id, authorKey);
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
  } catch (err) {
    logger.error({ err }, 'Failed to record skill metric');
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
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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
