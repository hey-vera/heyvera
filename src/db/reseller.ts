import { getDb, logAudit } from './connection';

export interface ResellerConfig {
  api_key: string;
  markup_pct: number;
  models_allowed: string | null;
  rate_limit_per_child: number | null;
  billing_label: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export function getResellerConfig(apiKey: string): ResellerConfig | null {
  return (getDb()
    .prepare('SELECT * FROM reseller_configs WHERE api_key = ? AND active = 1')
    .get(apiKey) as ResellerConfig | undefined) ?? null;
}

export function upsertResellerConfig(apiKey: string, config: Partial<Omit<ResellerConfig, 'api_key' | 'created_at' | 'updated_at'>>): void {
  const existing = getDb()
    .prepare('SELECT 1 FROM reseller_configs WHERE api_key = ?')
    .get(apiKey);

  if (existing) {
    const sets: string[] = ["updated_at = datetime('now')"];
    const params: Record<string, unknown> = { api_key: apiKey };

    if (config.markup_pct !== undefined) { sets.push('markup_pct = @markup_pct'); params.markup_pct = config.markup_pct; }
    if (config.models_allowed !== undefined) { sets.push('models_allowed = @models_allowed'); params.models_allowed = config.models_allowed; }
    if (config.rate_limit_per_child !== undefined) { sets.push('rate_limit_per_child = @rate_limit_per_child'); params.rate_limit_per_child = config.rate_limit_per_child; }
    if (config.billing_label !== undefined) { sets.push('billing_label = @billing_label'); params.billing_label = config.billing_label; }
    if (config.active !== undefined) { sets.push('active = @active'); params.active = config.active; }

    getDb().prepare(`UPDATE reseller_configs SET ${sets.join(', ')} WHERE api_key = @api_key`).run(params);
  } else {
    getDb().prepare(`
      INSERT INTO reseller_configs (api_key, markup_pct, models_allowed, rate_limit_per_child, billing_label, active)
      VALUES (@api_key, @markup_pct, @models_allowed, @rate_limit_per_child, @billing_label, @active)
    `).run({
      api_key: apiKey,
      markup_pct: config.markup_pct ?? 0,
      models_allowed: config.models_allowed ?? null,
      rate_limit_per_child: config.rate_limit_per_child ?? null,
      billing_label: config.billing_label ?? null,
      active: config.active ?? 1,
    });
  }

  logAudit({ entityType: 'reseller_config', entityId: apiKey, action: 'RESELLER_UPSERT', data: config });
}

export function deleteResellerConfig(apiKey: string): boolean {
  const result = getDb()
    .prepare("UPDATE reseller_configs SET active = 0, updated_at = datetime('now') WHERE api_key = ? AND active = 1")
    .run(apiKey);
  if (result.changes > 0) {
    logAudit({ entityType: 'reseller_config', entityId: apiKey, action: 'RESELLER_DELETE' });
  }
  return result.changes > 0;
}

export function getResellerMarkup(parentKey: string): number {
  const row = getDb()
    .prepare('SELECT markup_pct FROM reseller_configs WHERE api_key = ? AND active = 1')
    .get(parentKey) as { markup_pct: number } | undefined;
  return row?.markup_pct ?? 0;
}

export function isModelAllowed(parentKey: string, modelId: string): boolean {
  const row = getDb()
    .prepare('SELECT models_allowed FROM reseller_configs WHERE api_key = ? AND active = 1')
    .get(parentKey) as { models_allowed: string | null } | undefined;
  if (!row || !row.models_allowed) return true; // null = all models allowed
  try {
    const allowed = JSON.parse(row.models_allowed) as string[];
    return allowed.includes(modelId);
  } catch {
    return true; // malformed JSON = allow all
  }
}
