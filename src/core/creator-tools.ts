/**
 * Creator Onboarding Helpers — make it easy for new creators to publish skills.
 *
 * Template generation, config validation, revenue estimation, and creator stats.
 */

import { getDb } from '../db/index';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SkillTemplate {
  name: string;
  description: string;
  skill_type: 'api_proxy' | 'prompt_template' | 'data' | 'composite';
  prompt_template: string;
  credit_cost: number;
  tags_json: string;
  input_schema_json: string;
  output_schema_json: string;
  sample_output_json: string;
  proxy_url?: string;
  proxy_method?: string;
  dependencies_json?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RevenueEstimate {
  dailyCredits: number;
  monthlyCredits: number;
  monthlyUsd: number;
  creatorShareCredits: number;
  creatorShareUsd: number;
  breakEvenDays: number;
}

export interface CreatorStats {
  skillCount: number;
  totalRevenue: number;
  totalInvocations: number;
  avgRating: number;
  topSkill: { id: string; name: string; revenue: number } | null;
  revenueThisMonth: number;
  revenueLastMonth: number;
  growth: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Fee spine v1: creator keeps 95% base (was 90%).
// Infrastructure rate is 5% for new agents, scales to 2% at 90+ trust.
// See fee-spine.ts for the full trust-scaled formula.
const REVENUE_SHARE = 0.95;
const USD_PER_CREDIT = 0.001;

const DEFAULT_CREDIT_COSTS: Record<string, number> = {
  api_proxy: 1,
  prompt_template: 2,
  data: 1,          // deprecated — auto-converts to api_proxy on creation
  composite: 3,
};

// ─── Template Generation ──────────────────────────────────────────────────────

/**
 * Generate a complete skill creation payload with sensible defaults.
 */
export function generateSkillTemplate(
  type: 'api_proxy' | 'prompt_template' | 'data' | 'composite',
  name: string,
  description: string,
): SkillTemplate {
  // 'data' is deprecated — treat as api_proxy with GET
  const effectiveType = type === 'data' ? 'api_proxy' : type;
  const creditCost = DEFAULT_CREDIT_COSTS[effectiveType] ?? 1;

  const base: SkillTemplate = {
    name,
    description,
    skill_type: effectiveType,
    prompt_template: '',
    credit_cost: creditCost,
    tags_json: JSON.stringify([effectiveType]),
    input_schema_json: JSON.stringify({
      type: 'object',
      properties: { query: { type: 'string', description: 'Input query' } },
      required: ['query'],
    }),
    output_schema_json: JSON.stringify({
      type: 'object',
      properties: { result: { type: 'string' } },
    }),
    sample_output_json: JSON.stringify({ result: 'Sample output for ' + name }),
  };

  switch (effectiveType) {
    case 'prompt_template':
      base.prompt_template = `You are a helpful assistant for ${name}.\n\nUser query: {{query}}\n\nRespond concisely and accurately.`;
      break;
    case 'api_proxy':
      base.proxy_url = 'https://api.example.com/v1/endpoint';
      base.proxy_method = type === 'data' ? 'GET' : 'POST';
      base.prompt_template = name;
      break;
    case 'composite':
      base.prompt_template = name;
      base.dependencies_json = JSON.stringify([]);
      break;
  }

  return base;
}

// ─── Config Validation ────────────────────────────────────────────────────────

/**
 * Validate a skill config before publishing. Checks type-specific requirements.
 */
export function validateSkillConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.name || typeof config.name !== 'string' || (config.name as string).trim().length === 0) {
    errors.push('name is required and must be a non-empty string');
  }
  if (!config.description || typeof config.description !== 'string' || (config.description as string).trim().length === 0) {
    errors.push('description is required and must be a non-empty string');
  }

  const skillType = (config.skill_type as string) ?? 'prompt_template';

  if (!['api_proxy', 'prompt_template', 'data', 'composite'].includes(skillType)) {
    errors.push(`Invalid skill_type: ${skillType}. Must be api_proxy, prompt_template, data, or composite`);
  }

  // Credit cost
  const creditCost = config.credit_cost;
  if (creditCost !== undefined) {
    if (typeof creditCost !== 'number' || creditCost < 0) {
      errors.push('credit_cost must be a non-negative number');
    }
  }

  // Type-specific checks
  switch (skillType) {
    case 'prompt_template': {
      const tmpl = config.prompt_template;
      if (!tmpl || typeof tmpl !== 'string') {
        errors.push('prompt_template is required for prompt_template skills');
      } else if (!tmpl.includes('{{')) {
        warnings.push('prompt_template has no {{variables}} — consider adding template variables for dynamic inputs');
      }
      break;
    }
    case 'api_proxy': {
      const proxyUrl = config.proxy_url;
      if (!proxyUrl || typeof proxyUrl !== 'string') {
        errors.push('proxy_url is required for api_proxy skills');
      } else {
        try {
          const url = new URL(proxyUrl as string);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            errors.push('proxy_url must use http or https protocol');
          }
          if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            errors.push('proxy_url cannot point to localhost');
          }
        } catch {
          errors.push('proxy_url is not a valid URL');
        }
      }
      break;
    }
    case 'data': {
      if (!config.sample_output_json) {
        warnings.push('data skills should include sample_output_json for documentation');
      }
      break;
    }
    case 'composite': {
      const deps = config.dependencies_json;
      if (!deps) {
        warnings.push('composite skills should include dependencies_json listing sub-skill IDs');
      } else {
        try {
          const parsed = typeof deps === 'string' ? JSON.parse(deps) : deps;
          if (!Array.isArray(parsed)) {
            errors.push('dependencies_json must be an array');
          } else if (parsed.length === 0) {
            warnings.push('composite skill has no dependencies — add sub-skill IDs');
          } else if (parsed.length > 5) {
            errors.push('composite skills support a maximum of 5 dependencies');
          } else {
            // Check if referenced skills exist
            for (const depId of parsed) {
              if (typeof depId === 'string') {
                const exists = getDb().prepare('SELECT 1 FROM skills WHERE id = ?').get(depId);
                if (!exists) {
                  errors.push(`Dependency skill not found: ${depId}`);
                }
              }
            }
          }
        } catch {
          errors.push('dependencies_json is not valid JSON');
        }
      }
      break;
    }
  }

  // Tags validation
  if (config.tags_json) {
    try {
      const tags = typeof config.tags_json === 'string' ? JSON.parse(config.tags_json as string) : config.tags_json;
      if (!Array.isArray(tags)) {
        errors.push('tags_json must be a JSON array of strings');
      } else if (tags.length > 10) {
        warnings.push('More than 10 tags — consider reducing for clarity');
      }
    } catch {
      errors.push('tags_json is not valid JSON');
    }
  } else {
    warnings.push('No tags provided — adding tags improves discoverability');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Revenue Estimation ───────────────────────────────────────────────────────

/**
 * Estimate potential revenue for a skill at a given price and usage level.
 */
export function estimateSkillRevenue(creditCost: number, estimatedDailyUses: number): RevenueEstimate {
  const dailyCredits = creditCost * estimatedDailyUses;
  const monthlyCredits = dailyCredits * 30;
  const monthlyUsd = monthlyCredits * USD_PER_CREDIT;
  const creatorShareCredits = Math.round(monthlyCredits * REVENUE_SHARE * 1000000) / 1000000;
  const creatorShareUsd = Math.round(creatorShareCredits * USD_PER_CREDIT * 100) / 100;
  // Break-even: how many days until the first payout threshold (1000 credits minimum)
  const dailyCreatorCredits = dailyCredits * REVENUE_SHARE;
  const breakEvenDays = dailyCreatorCredits > 0 ? Math.ceil(1000 / dailyCreatorCredits) : Infinity;

  return {
    dailyCredits,
    monthlyCredits,
    monthlyUsd: Math.round(monthlyUsd * 100) / 100,
    creatorShareCredits,
    creatorShareUsd,
    breakEvenDays: breakEvenDays === Infinity ? -1 : breakEvenDays,
  };
}

// ─── Creator Stats ────────────────────────────────────────────────────────────

/**
 * Aggregate creator statistics: skill count, revenue, invocations, ratings.
 */
export function getCreatorStats(apiKey: string): CreatorStats {
  try {
    // Skill count
    const skillRow = getDb().prepare(`
      SELECT COUNT(*) AS cnt FROM skills WHERE author_key = ? AND active = 1
    `).get(apiKey) as { cnt: number };

    // Total revenue from transactions where creator is the recipient
    const revenueRow = getDb().prepare(`
      SELECT COALESCE(SUM(amount_credits), 0) AS total FROM transactions
      WHERE to_agent = ? AND type IN ('skill_purchase', 'skill_invoke', 'payout')
    `).get(apiKey) as { total: number };

    // Total invocations (uses on creator's skills)
    const usesRow = getDb().prepare(`
      SELECT COALESCE(SUM(uses), 0) AS total FROM skills WHERE author_key = ?
    `).get(apiKey) as { total: number };

    // Average rating across creator's skills
    const ratingRow = getDb().prepare(`
      SELECT COALESCE(AVG(avg_rating), 0) AS avg FROM skills
      WHERE author_key = ? AND active = 1 AND rating_count > 0
    `).get(apiKey) as { avg: number };

    // Top skill by revenue
    const topSkillRow = getDb().prepare(`
      SELECT s.id, s.name, COALESCE(SUM(t.amount_credits), 0) AS revenue
      FROM skills s
      LEFT JOIN transactions t ON t.skill_id = s.id AND t.to_agent = ?
      WHERE s.author_key = ? AND s.active = 1
      GROUP BY s.id
      ORDER BY revenue DESC
      LIMIT 1
    `).get(apiKey, apiKey) as { id: string; name: string; revenue: number } | undefined;

    // Revenue this month
    const thisMonthRow = getDb().prepare(`
      SELECT COALESCE(SUM(amount_credits), 0) AS total FROM transactions
      WHERE to_agent = ? AND type IN ('skill_purchase', 'skill_invoke', 'payout')
        AND created_at >= datetime('now', 'start of month')
    `).get(apiKey) as { total: number };

    // Revenue last month
    const lastMonthRow = getDb().prepare(`
      SELECT COALESCE(SUM(amount_credits), 0) AS total FROM transactions
      WHERE to_agent = ? AND type IN ('skill_purchase', 'skill_invoke', 'payout')
        AND created_at >= datetime('now', 'start of month', '-1 month')
        AND created_at < datetime('now', 'start of month')
    `).get(apiKey) as { total: number };

    const revenueThisMonth = thisMonthRow.total;
    const revenueLastMonth = lastMonthRow.total;
    const growth = revenueLastMonth > 0
      ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100) / 100
      : revenueThisMonth > 0 ? 1 : 0;

    return {
      skillCount: skillRow.cnt,
      totalRevenue: revenueRow.total,
      totalInvocations: usesRow.total,
      avgRating: Math.round(ratingRow.avg * 100) / 100,
      topSkill: topSkillRow && topSkillRow.id ? { id: topSkillRow.id, name: topSkillRow.name, revenue: topSkillRow.revenue } : null,
      revenueThisMonth,
      revenueLastMonth,
      growth,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get creator stats');
    return {
      skillCount: 0, totalRevenue: 0, totalInvocations: 0, avgRating: 0,
      topSkill: null, revenueThisMonth: 0, revenueLastMonth: 0, growth: 0,
    };
  }
}
