/**
 * Seed official ClawHub skills into the DB on first boot.
 * Idempotent — skips skills that already exist.
 */
import { getDb } from '../db/index';
import { logger } from '../utils/logger';

interface OfficialSkill {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  creditCost: number;
  version: string;
  tags: string[];
  inputSchema: object;
  outputSchema: object;
}

const OFFICIAL_SKILLS: OfficialSkill[] = [
  {
    id: 'token-analysis',
    name: 'Token Analyst Pro',
    description: 'Comprehensive token due diligence: fundamentals, on-chain health, holder analysis, liquidity depth, and risk/opportunity scoring for any Solana token.',
    promptTemplate: 'Perform comprehensive due diligence on the Solana token {{token}} at {{depth}} depth over the last {{timeframe}}. Cover: 1) Price action — current price, 24h/7d/30d change, ATH distance. 2) On-chain health — daily active addresses, transaction count, velocity. 3) Holder analysis — total holders, top 10 concentration %, insider wallets. 4) Liquidity — DEX pool depth, bid/ask spread, slippage at $1K/$10K. 5) Fundamentals — market cap, FDV, circulating vs total supply. 6) Risk flags — rug pull indicators, mint authority status, freeze authority. Score opportunity 0-10 and risk 0-10. Conclude with a clear BUY/HOLD/AVOID recommendation and 3 specific action items.',
    creditCost: 5,
    version: '2.0.0',
    tags: ['defi', 'solana', 'token', 'analysis', 'due-diligence'],
    inputSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', description: 'Token symbol or mint address (e.g. SOL, BONK, or a Solana mint pubkey)' },
        depth: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard', description: 'Analysis depth' },
        timeframe: { type: 'string', enum: ['24h', '7d', '30d'], default: '7d', description: 'Lookback period for trend data' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'Human-readable analysis summary' },
        opportunityScore: { type: 'number', description: '0–10 opportunity rating' },
        riskScore: { type: 'number', description: '0–10 risk rating' },
        liquidityScore: { type: 'number', description: '0-10 liquidity rating' },
        recommendation: { type: 'string', description: 'BUY/HOLD/AVOID' },
        suggestedActions: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    id: 'social-sentiment',
    name: 'Social Sentiment Scanner',
    description: 'Multi-platform sentiment analysis: Twitter/X, Reddit, Telegram, and Discord buzz for any crypto project, token, or narrative.',
    promptTemplate: 'Analyze social sentiment for "{{topic}}" across {{platform}} over the last {{timeframe}}. Deliver: 1) Overall sentiment score from -10 (extreme fear) to +10 (extreme greed). 2) Platform breakdown — bullish vs bearish ratio per platform. 3) Volume analysis — mention count vs 7-day average, unusual spikes. 4) Key influencer takes — top 3 notable accounts and their stance. 5) Narrative themes — top 3 trending narratives driving sentiment. 6) Momentum — is sentiment accelerating or decelerating? 7) Contrarian signal — flag if sentiment is at extremes that historically precede reversals.',
    creditCost: 3,
    version: '2.0.0',
    tags: ['social', 'sentiment', 'twitter', 'crypto', 'telegram'],
    inputSchema: {
      type: 'object',
      required: ['topic'],
      properties: {
        topic: { type: 'string', description: 'Token, project name, or search term' },
        timeframe: { type: 'string', enum: ['1h', '24h', '7d'], default: '24h', description: 'Analysis timeframe' },
        platform: { type: 'string', enum: ['all', 'twitter', 'reddit', 'telegram'], default: 'all', description: 'Platform filter' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        sentimentScore: { type: 'number', description: '-10 to +10' },
        bullishPct: { type: 'number' },
        bearishPct: { type: 'number' },
        momentum: { type: 'string', description: 'accelerating/stable/decelerating' },
        contrarianAlert: { type: 'boolean', description: 'True if sentiment at historical extreme' },
        topThemes: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'portfolio-optimizer',
    name: 'Portfolio Optimizer Pro',
    description: 'AI-powered Solana portfolio analysis: allocation scoring, risk assessment, correlation analysis, rebalancing strategy, and specific swap recommendations.',
    promptTemplate: 'Analyze the Solana wallet {{wallet}} portfolio with {{riskLevel}} risk tolerance. {{includeStables}} stablecoins in analysis. Deliver: 1) Current allocation — list each token with USD value, % of portfolio, and 7d performance. 2) Concentration risk — Herfindahl index, overexposed positions (>25% single asset). 3) Correlation analysis — identify highly correlated holdings that amplify risk. 4) Risk score 0-100 (higher = riskier) based on volatility, concentration, and liquidity. 5) Rebalancing plan — specific swap recommendations with target allocations. 6) Missing exposure — asset classes or sectors the portfolio lacks. 7) Estimated portfolio beta vs SOL. Format swap recommendations as: SELL X% of TOKEN_A → BUY TOKEN_B.',
    creditCost: 8,
    version: '2.0.0',
    tags: ['portfolio', 'solana', 'defi', 'rebalance', 'risk'],
    inputSchema: {
      type: 'object',
      required: ['wallet'],
      properties: {
        wallet: { type: 'string', description: 'Solana wallet address' },
        riskLevel: { type: 'string', enum: ['conservative', 'moderate', 'aggressive'], default: 'moderate', description: 'Target risk tolerance' },
        includeStables: { type: 'boolean', default: true, description: 'Include stablecoins in analysis' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        riskScore: { type: 'number', description: '0-100 portfolio risk score' },
        concentrationRisk: { type: 'string', description: 'low/medium/high/critical' },
        portfolioBeta: { type: 'number', description: 'Beta vs SOL' },
        currentAllocation: { type: 'object' },
        swaps: { type: 'array', items: { type: 'object' }, description: 'Specific swap recommendations' },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'wallet-profiler',
    name: 'Wallet Profiler',
    description: 'Full Solana wallet profiling: token holdings, transaction history, DeFi positions, PnL estimates, and whale classification.',
    promptTemplate: 'Profile the Solana wallet {{wallet}}. Analyze: token holdings and values, recent transaction patterns (last {{timeframe}}), DeFi positions (lending, LP, staking), estimated total PnL, wallet age and activity level, and classify as whale/trader/holder/bot. Provide a wallet health score from 0-100.',
    creditCost: 6,
    version: '1.0.0',
    tags: ['solana', 'wallet', 'defi', 'analytics'],
    inputSchema: {
      type: 'object',
      required: ['wallet'],
      properties: {
        wallet: { type: 'string', description: 'Solana wallet address' },
        timeframe: { type: 'string', enum: ['24h', '7d', '30d', '90d'], default: '7d', description: 'Analysis timeframe' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        walletType: { type: 'string', description: 'whale/trader/holder/bot' },
        healthScore: { type: 'number', description: '0-100 wallet health score' },
        totalValueUsd: { type: 'number' },
        topHoldings: { type: 'array', items: { type: 'object' } },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'trending-tokens',
    name: 'Trending Tokens',
    description: 'Discover trending Solana tokens by volume, social buzz, new listings, and momentum indicators.',
    promptTemplate: 'Find the top trending Solana tokens right now. Analyze: tokens with the highest 24h volume surge, new listings gaining traction, social media buzz leaders, and momentum breakouts. Focus on {{category}} tokens. Rank the top 10 with buy/hold/avoid signals and risk levels.',
    creditCost: 4,
    version: '1.0.0',
    tags: ['solana', 'trending', 'defi', 'discovery'],
    inputSchema: {
      type: 'object',
      required: [],
      properties: {
        category: { type: 'string', enum: ['all', 'memecoins', 'defi', 'gaming', 'ai'], default: 'all', description: 'Token category filter' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        tokens: { type: 'array', items: { type: 'object' } },
        marketMood: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'whale-tracker',
    name: 'Whale Tracker',
    description: 'Track large wallet movements: whale accumulation, distribution, unusual transfers, and smart money flow on Solana.',
    promptTemplate: 'Track whale activity for {{token}} on Solana. Identify: the largest holders and recent changes in their positions, significant buy/sell transactions in the last {{timeframe}}, smart money wallets accumulating or distributing, and any unusual transfer patterns. Summarize the whale sentiment as bullish/neutral/bearish.',
    creditCost: 5,
    version: '1.0.0',
    tags: ['solana', 'whale', 'on-chain', 'analytics'],
    inputSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', description: 'Token symbol or mint address' },
        timeframe: { type: 'string', enum: ['1h', '24h', '7d'], default: '24h', description: 'Lookback window' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        whaleSentiment: { type: 'string', description: 'bullish/neutral/bearish' },
        topWhales: { type: 'array', items: { type: 'object' } },
        netFlow: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'defi-yield-scanner',
    name: 'DeFi Yield Scanner',
    description: 'Scan Solana DeFi protocols for the best yield opportunities: lending rates, LP APYs, staking rewards, and risk-adjusted returns.',
    promptTemplate: 'Scan Solana DeFi protocols for the best yield opportunities. Risk tolerance: {{riskLevel}}. Minimum investment: ${{minAmount}}. Find: top lending/borrowing rates, liquidity pool APYs, staking rewards, and vault strategies. Rank by risk-adjusted return. Flag impermanent loss risks and smart contract audit status.',
    creditCost: 5,
    version: '1.0.0',
    tags: ['solana', 'defi', 'yield', 'farming'],
    inputSchema: {
      type: 'object',
      required: [],
      properties: {
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'degen'], default: 'medium', description: 'Risk tolerance' },
        minAmount: { type: 'number', default: 100, description: 'Minimum USD investment' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        opportunities: { type: 'array', items: { type: 'object' } },
        bestRiskAdjusted: { type: 'object' },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'token-launch-radar',
    name: 'Token Launch Radar',
    description: 'Monitor upcoming and recent Solana token launches: presales, IDOs, fair launches, and early-stage projects.',
    promptTemplate: 'Scan for upcoming and recent Solana token launches. Focus on {{launchType}} launches. Analyze: project team and backing, tokenomics and vesting, community size and engagement, smart contract verification status, and potential red flags. Rate each launch opportunity from 1-10 for legitimacy and potential.',
    creditCost: 4,
    version: '1.0.0',
    tags: ['solana', 'launches', 'presale', 'discovery'],
    inputSchema: {
      type: 'object',
      required: [],
      properties: {
        launchType: { type: 'string', enum: ['all', 'presale', 'fair-launch', 'ido'], default: 'all', description: 'Launch type filter' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        launches: { type: 'array', items: { type: 'object' } },
        topPick: { type: 'object' },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'price-oracle',
    name: 'Price Oracle',
    description: 'Real-time and historical price data with technical analysis: support/resistance, moving averages, RSI, and price predictions.',
    promptTemplate: 'Provide price analysis for {{token}} on Solana. Include: current price and 24h change, key support and resistance levels, moving averages (20/50/200), RSI and MACD indicators, volume analysis, and a short-term price outlook. Timeframe: {{timeframe}}. Give a clear bullish/neutral/bearish signal with confidence level.',
    creditCost: 3,
    version: '1.0.0',
    tags: ['solana', 'price', 'technical-analysis', 'trading'],
    inputSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', description: 'Token symbol or mint address' },
        timeframe: { type: 'string', enum: ['1h', '4h', '1d', '1w'], default: '1d', description: 'Chart timeframe' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        price: { type: 'number' },
        signal: { type: 'string', description: 'bullish/neutral/bearish' },
        confidence: { type: 'number', description: '0-100' },
        support: { type: 'number' },
        resistance: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'nft-collection-intel',
    name: 'NFT Collection Intel',
    description: 'Analyze Solana NFT collections: floor price trends, holder distribution, wash trading detection, and investment potential.',
    promptTemplate: 'Analyze the Solana NFT collection "{{collection}}". Evaluate: floor price and trend (last {{timeframe}}), listing and sales volume, unique holder count and distribution, wash trading indicators, top holder concentration, and overall collection health. Provide a buy/hold/sell recommendation with rationale.',
    creditCost: 5,
    version: '1.0.0',
    tags: ['solana', 'nft', 'analytics', 'collection'],
    inputSchema: {
      type: 'object',
      required: ['collection'],
      properties: {
        collection: { type: 'string', description: 'NFT collection name or address' },
        timeframe: { type: 'string', enum: ['24h', '7d', '30d'], default: '7d', description: 'Analysis period' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        floorPrice: { type: 'number' },
        recommendation: { type: 'string', description: 'buy/hold/sell' },
        washTradingRisk: { type: 'string', description: 'low/medium/high' },
        holderConcentration: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
];

const CLAWHUB_KEY = 'clawhub-official';
export const TREASURY_KEY = 'clawhub-treasury';

/** Ensure the platform's own api_keys row exists so revenue share credits
 *  accumulate properly when official skills are invoked. */
function ensurePlatformKey(db: ReturnType<typeof getDb>): void {
  const existing = db.prepare('SELECT key FROM api_keys WHERE key = ?').get(CLAWHUB_KEY);
  if (!existing) {
    db.prepare(
      `INSERT INTO api_keys (key, email, credits, credits_used, active, created_at)
       VALUES (?, 'platform@claw-net.org', 0, 0, 1, datetime('now'))`
    ).run(CLAWHUB_KEY);
  }
}

/** Ensure the treasury key exists to collect 3% platform fees from marketplace sales. */
function ensureTreasuryKey(db: ReturnType<typeof getDb>): void {
  const existing = db.prepare('SELECT key FROM api_keys WHERE key = ?').get(TREASURY_KEY);
  if (!existing) {
    db.prepare(
      `INSERT INTO api_keys (key, email, credits, credits_used, active, created_at)
       VALUES (?, 'treasury@claw-net.org', 0, 0, 1, datetime('now'))`
    ).run(TREASURY_KEY);
  }
}

export function seedOfficialSkills(): void {
  const db = getDb();
  ensurePlatformKey(db);
  ensureTreasuryKey(db);
  let seeded = 0;

  for (const skill of OFFICIAL_SKILLS) {
    const existing = db.prepare('SELECT id FROM skills WHERE id = ?').get(skill.id);
    if (existing) continue;

    db.prepare(`
      INSERT INTO skills
        (id, name, description, prompt_template, author_key, public, credit_cost,
         version, tags_json, input_schema_json, output_schema_json, published_at)
      VALUES
        (@id, @name, @description, @promptTemplate, @authorKey, 1, @creditCost,
         @version, @tagsJson, @inputSchemaJson, @outputSchemaJson, datetime('now'))
    `).run({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      promptTemplate: skill.promptTemplate,
      authorKey: CLAWHUB_KEY,
      creditCost: skill.creditCost,
      version: skill.version,
      tagsJson: JSON.stringify(skill.tags),
      inputSchemaJson: JSON.stringify(skill.inputSchema),
      outputSchemaJson: JSON.stringify(skill.outputSchema),
    });
    seeded++;
  }

  if (seeded > 0) {
    logger.info({ seeded }, 'Official ClawHub skills seeded');
  }

  // Update existing official skills with latest templates — idempotent, runs every boot.
  // Ensures VPS DB always reflects current prompt templates, names, and schemas.
  let updated = 0;
  for (const skill of OFFICIAL_SKILLS) {
    const result = db.prepare(`
      UPDATE skills SET
        name = @name,
        description = @description,
        prompt_template = @promptTemplate,
        tags_json = @tagsJson,
        input_schema_json = @inputSchemaJson,
        output_schema_json = @outputSchemaJson,
        version = @version
      WHERE id = @id AND author_key = @authorKey
    `).run({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      promptTemplate: skill.promptTemplate,
      tagsJson: JSON.stringify(skill.tags),
      inputSchemaJson: JSON.stringify(skill.inputSchema),
      outputSchemaJson: JSON.stringify(skill.outputSchema),
      version: skill.version,
      authorKey: CLAWHUB_KEY,
    });
    if (result.changes > 0) updated++;
  }
  if (updated > 0) {
    logger.info({ updated }, 'Official ClawHub skills updated to latest templates');
  }
}
