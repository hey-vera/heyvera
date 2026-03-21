/**
 * Seed official ClawHub skills into the DB on first boot.
 * Idempotent — skips skills that already exist.
 */
import { getDb } from '../db/index';
import { logger } from '../utils/logger';

// ─── Official DATA skills ─────────────────────────────────────────────────────
// Return raw structured JSON — no LLM synthesis.

interface OfficialDataSkill {
  id: string;
  name: string;
  description: string;
  creditCost: number;
  version: string;
  tags: string[];
  /** ClawAPIs proxy URL — data is fetched from here via GET */
  proxyUrl: string;
  updateFrequency: 'realtime' | 'hourly' | 'daily' | 'weekly' | 'static';
  /** Canonical JSON example shown on the marketplace card */
  sampleOutput: Record<string, unknown>;
  inputSchema: object;
  outputSchema: object;
}

const OFFICIAL_DATA_SKILLS: OfficialDataSkill[] = [
  {
    id: 'price-oracle-data',
    name: 'Price Oracle Data',
    description: 'Real-time token price, 24h change, volume, and market cap as structured JSON. No LLM — raw numbers for programmatic use.',
    creditCost: 1,
    version: '1.0.0',
    tags: ['solana', 'price', 'data', 'realtime'],
    proxyUrl: 'https://clawapis.com/solscan/token/meta',
    updateFrequency: 'realtime',
    sampleOutput: {
      token: 'SOL',
      priceUsd: 142.57,
      change24h: 3.2,
      volume24h: 1_283_000_000,
      marketCap: 62_400_000_000,
      liquidity: 850_000_000,
    },
    inputSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', description: 'Token symbol or mint address' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        priceUsd: { type: 'number' },
        change24h: { type: 'number' },
        volume24h: { type: 'number' },
        marketCap: { type: 'number' },
        liquidity: { type: 'number' },
      },
    },
  },
  {
    id: 'trending-tokens-data',
    name: 'Trending Tokens Data',
    description: 'Top trending Solana tokens by volume and social buzz as a JSON array. Sorted by momentum score.',
    creditCost: 2,
    version: '1.0.0',
    tags: ['solana', 'trending', 'data', 'discovery'],
    proxyUrl: 'https://clawapis.com/solscan/token/trending',
    updateFrequency: 'hourly',
    sampleOutput: {
      tokens: [
        { symbol: 'BONK', priceUsd: 0.0000234, volume24h: 89_000_000, change24h: 15.3, rank: 1 },
        { symbol: 'WIF', priceUsd: 1.42, volume24h: 67_000_000, change24h: 8.7, rank: 2 },
      ],
      updatedAt: '2026-03-12T14:00:00Z',
    },
    inputSchema: {
      type: 'object',
      required: ['sortBy'],
      properties: {
        sortBy: { type: 'string', enum: ['volume', 'social', 'new'], default: 'volume', description: 'Sort criteria (default: volume)' },
        limit: { type: 'number', default: 10, description: 'Number of results (max 50)' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        tokens: { type: 'array', items: { type: 'object' } },
        updatedAt: { type: 'string' },
      },
    },
  },
  {
    id: 'whale-tracker-data',
    name: 'Whale Alerts Data',
    description: 'Large wallet movements for a token: recent whale buys/sells, holder changes, and net flow as structured JSON.',
    creditCost: 2,
    version: '1.0.0',
    tags: ['solana', 'whale', 'data', 'on-chain'],
    proxyUrl: 'https://clawapis.com/solscan/token/holders',
    updateFrequency: 'realtime',
    sampleOutput: {
      token: 'SOL',
      topHolders: [
        { address: '5Q544...', balanceUsd: 42_000_000, changePct24h: 2.1 },
        { address: '9xKpN...', balanceUsd: 31_000_000, changePct24h: -1.5 },
      ],
      totalHolders: 1_234_567,
      top10ConcentrationPct: 18.4,
      netFlowUsd24h: 3_200_000,
    },
    inputSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', description: 'Token symbol or mint address' },
        limit: { type: 'number', default: 20, description: 'Number of top holders' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        topHolders: { type: 'array', items: { type: 'object' } },
        totalHolders: { type: 'number' },
        top10ConcentrationPct: { type: 'number' },
        netFlowUsd24h: { type: 'number' },
      },
    },
  },
  {
    id: 'defi-yield-data',
    name: 'DeFi Yields Data',
    description: 'Current DeFi yield opportunities across Solana protocols: APY, TVL, pool type, and risk tier as a JSON table.',
    creditCost: 2,
    version: '1.0.0',
    tags: ['solana', 'defi', 'yield', 'data'],
    proxyUrl: 'https://clawapis.com/solscan/token/list',
    updateFrequency: 'hourly',
    sampleOutput: {
      opportunities: [
        { protocol: 'Marinade', pool: 'mSOL Staking', apy: 7.2, tvlUsd: 1_400_000_000, type: 'staking', riskTier: 'low' },
        { protocol: 'Raydium', pool: 'SOL-USDC', apy: 24.5, tvlUsd: 89_000_000, type: 'lp', riskTier: 'medium' },
      ],
      updatedAt: '2026-03-12T14:00:00Z',
    },
    inputSchema: {
      type: 'object',
      required: ['riskLevel'],
      properties: {
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'all'], default: 'all', description: 'Risk filter (default: all)' },
        minApy: { type: 'number', default: 0, description: 'Minimum APY filter' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        opportunities: { type: 'array', items: { type: 'object' } },
        updatedAt: { type: 'string' },
      },
    },
  },
];

const CLAWHUB_KEY = 'clawhub-official';
export const TREASURY_KEY = 'clawhub-treasury';

/** Ensure the platform's own api_keys row exists so revenue share credits
 *  accumulate properly when official skills are invoked. */
function ensurePlatformKey(db: ReturnType<typeof getDb>): void {
  const existing = db.prepare('SELECT key, active FROM api_keys WHERE key = ?').get(CLAWHUB_KEY) as { key: string; active: number } | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO api_keys (key, email, credits, credits_used, active, created_at)
       VALUES (?, 'platform@claw-net.org', 0, 0, 1, datetime('now'))`
    ).run(CLAWHUB_KEY);
  } else if (existing.active === 0) {
    // Should never happen, but guard against admin accidentally revoking the platform key
    db.prepare('UPDATE api_keys SET active = 1 WHERE key = ?').run(CLAWHUB_KEY);
    logger.warn('clawhub-official was deactivated — re-activated to restore skill invocation');
  }
}

/** Ensure the treasury key exists and is active to collect 15% platform fees from
 *  marketplace sales. If deactivated (e.g. via admin revoke), all marketplace purchases
 *  will fail — re-activate automatically on startup to prevent a silent outage. */
function ensureTreasuryKey(db: ReturnType<typeof getDb>): void {
  const existing = db.prepare('SELECT key, active FROM api_keys WHERE key = ?').get(TREASURY_KEY) as { key: string; active: number } | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO api_keys (key, email, credits, credits_used, active, created_at)
       VALUES (?, 'treasury@claw-net.org', 0, 0, 1, datetime('now'))`
    ).run(TREASURY_KEY);
  } else if (existing.active === 0) {
    // Treasury deactivated → every marketplace purchase would fail — re-activate immediately.
    db.prepare('UPDATE api_keys SET active = 1 WHERE key = ?').run(TREASURY_KEY);
    logger.warn('clawhub-treasury was deactivated — re-activated to restore marketplace function');
  }
}

export function seedOfficialSkills(): void {
  const db = getDb();
  ensurePlatformKey(db);
  ensureTreasuryKey(db);
  let seeded = 0;

  // ─── Seed data skills ──────────────────────────────────────────────────────
  for (const skill of OFFICIAL_DATA_SKILLS) {
    const existing = db.prepare('SELECT id FROM skills WHERE id = ?').get(skill.id);
    if (existing) continue;

    db.prepare(`
      INSERT INTO skills
        (id, name, description, prompt_template, author_key, public, credit_cost,
         version, tags_json, input_schema_json, output_schema_json, published_at,
         security_status, scanned_at, skill_type, proxy_url, proxy_method,
         update_frequency, sample_output_json)
      VALUES
        (@id, @name, @description, '', @authorKey, 1, @creditCost,
         @version, @tagsJson, @inputSchemaJson, @outputSchemaJson, datetime('now'),
         'VERIFIED', datetime('now'), 'data', @proxyUrl, 'GET',
         @updateFrequency, @sampleOutputJson)
    `).run({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      authorKey: CLAWHUB_KEY,
      creditCost: skill.creditCost,
      version: skill.version,
      tagsJson: JSON.stringify(skill.tags),
      inputSchemaJson: JSON.stringify(skill.inputSchema),
      outputSchemaJson: JSON.stringify(skill.outputSchema),
      proxyUrl: skill.proxyUrl,
      updateFrequency: skill.updateFrequency,
      sampleOutputJson: JSON.stringify(skill.sampleOutput),
    });
    seeded++;
  }

  if (seeded > 0) {
    logger.info({ seeded }, 'Official ClawHub skills seeded');
  }

  // ─── Update existing official skills with latest definitions ───────────────
  // Idempotent — runs every boot so VPS DB always reflects current definitions.
  let updated = 0;
  for (const skill of OFFICIAL_DATA_SKILLS) {
    const result = db.prepare(`
      UPDATE skills SET
        name = @name,
        description = @description,
        tags_json = @tagsJson,
        input_schema_json = @inputSchemaJson,
        output_schema_json = @outputSchemaJson,
        version = @version,
        security_status = 'VERIFIED',
        scanned_at = datetime('now'),
        proxy_url = @proxyUrl,
        update_frequency = @updateFrequency,
        sample_output_json = @sampleOutputJson,
        paired_skill_id = NULL
      WHERE id = @id AND author_key = @authorKey
    `).run({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tagsJson: JSON.stringify(skill.tags),
      inputSchemaJson: JSON.stringify(skill.inputSchema),
      outputSchemaJson: JSON.stringify(skill.outputSchema),
      version: skill.version,
      authorKey: CLAWHUB_KEY,
      proxyUrl: skill.proxyUrl,
      updateFrequency: skill.updateFrequency,
      sampleOutputJson: JSON.stringify(skill.sampleOutput),
    });
    if (result.changes > 0) updated++;
  }

  if (updated > 0) {
    logger.info({ updated }, 'Official ClawHub skills updated to latest definitions');
  }
}
