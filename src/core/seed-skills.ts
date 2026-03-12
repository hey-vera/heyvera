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
  /** Deterministic execution plan — bypasses LLM intent parsing */
  executionPlan: Array<{ endpointId: string; params: Record<string, string> }>;
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
    executionPlan: [
      { endpointId: 'claw-token-price',   params: { symbol: '{token}' } },
      { endpointId: 'claw-token-risk',    params: { symbol: '{token}' } },
      { endpointId: 'claw-token-holders', params: { symbol: '{token}' } },
      { endpointId: 'claw-x-mentions',    params: { query: '{token} crypto' } },
    ],
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
    executionPlan: [
      { endpointId: 'claw-x-mentions',      params: { query: '{topic}' } },
      { endpointId: 'claw-reddit-sentiment', params: { query: '{topic}' } },
    ],
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
    executionPlan: [
      { endpointId: 'claw-wallet-portfolio', params: { walletAddress: '{wallet}' } },
      { endpointId: 'claw-tx-history',       params: { walletAddress: '{wallet}' } },
    ],
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
    executionPlan: [
      { endpointId: 'claw-wallet-portfolio', params: { walletAddress: '{wallet}' } },
      { endpointId: 'claw-tx-history',       params: { walletAddress: '{wallet}' } },
      { endpointId: 'claw-wallet-risk',      params: { walletAddress: '{wallet}' } },
    ],
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
    executionPlan: [
      { endpointId: 'claw-trending-tokens', params: {} },
      { endpointId: 'claw-x-mentions',      params: { query: 'solana trending tokens' } },
    ],
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
    executionPlan: [
      { endpointId: 'claw-token-price',   params: { symbol: '{token}' } },
      { endpointId: 'claw-token-holders', params: { symbol: '{token}' } },
      { endpointId: 'einstein-whales',    params: { symbol: '{token}' } },
    ],
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
    executionPlan: [
      { endpointId: 'apollo-defi-yields',  params: {} },
      { endpointId: 'diamondclaws-yield',  params: {} },
    ],
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
    executionPlan: [
      { endpointId: 'claw-trending-tokens', params: {} },
      { endpointId: 'rootdata-hot-x',       params: {} },
    ],
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
    executionPlan: [
      { endpointId: 'claw-token-price', params: { symbol: '{token}' } },
      { endpointId: 'coinank-kline',    params: { symbol: '{token}/USDT', interval: '1h' } },
    ],
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
    executionPlan: [
      { endpointId: 'claw-token-price',   params: { symbol: '{collection}' } },
      { endpointId: 'claw-token-holders', params: { symbol: '{collection}' } },
    ],
  },
];

// ─── Official DATA skill variants ─────────────────────────────────────────────
// Paired with their prompt_template counterparts for marketplace toggle cards.
// These return raw structured JSON — no LLM synthesis.

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
  /** ID of the prompt_template skill this is paired with */
  pairedWith: string;
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
    pairedWith: 'price-oracle',
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
      required: [],
      properties: {
        sortBy: { type: 'string', enum: ['volume', 'social', 'new'], default: 'volume', description: 'Sort criteria' },
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
    pairedWith: 'trending-tokens',
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
    pairedWith: 'whale-tracker',
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
      required: [],
      properties: {
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'all'], default: 'all', description: 'Risk filter' },
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
    pairedWith: 'defi-yield-scanner',
  },
  {
    id: 'token-analysis-data',
    name: 'Token Metrics Data',
    description: 'Comprehensive token metrics as structured JSON: price, holders, risk score, liquidity, and supply data. No LLM analysis.',
    creditCost: 2,
    version: '1.0.0',
    tags: ['solana', 'token', 'data', 'metrics'],
    proxyUrl: 'https://clawapis.com/solscan/token/meta',
    updateFrequency: 'hourly',
    sampleOutput: {
      token: 'SOL',
      priceUsd: 142.57,
      change24h: 3.2,
      volume24h: 1_283_000_000,
      marketCap: 62_400_000_000,
      totalHolders: 1_234_567,
      top10ConcentrationPct: 18.4,
      riskScore: 12,
      riskLevel: 'low',
      mintAuthority: false,
      freezeAuthority: false,
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
        totalHolders: { type: 'number' },
        top10ConcentrationPct: { type: 'number' },
        riskScore: { type: 'number' },
        riskLevel: { type: 'string' },
        mintAuthority: { type: 'boolean' },
        freezeAuthority: { type: 'boolean' },
      },
    },
    pairedWith: 'token-analysis',
  },
  {
    id: 'wallet-profiler-data',
    name: 'Wallet Holdings Data',
    description: 'Full token holdings, SOL balance, and total USD value for any Solana wallet. Raw portfolio data as JSON.',
    creditCost: 2,
    version: '1.0.0',
    tags: ['solana', 'wallet', 'data', 'portfolio'],
    proxyUrl: 'https://clawapis.com/solscan/account/portfolio',
    updateFrequency: 'hourly',
    sampleOutput: {
      address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
      totalValueUsd: 142_350.00,
      solBalance: 850.25,
      tokens: [
        { symbol: 'SOL', balance: 850.25, valueUsd: 121_290.68 },
        { symbol: 'BONK', balance: 500_000_000, valueUsd: 11_700.00 },
      ],
      nftCount: 12,
    },
    inputSchema: {
      type: 'object',
      required: ['wallet'],
      properties: {
        wallet: { type: 'string', description: 'Solana wallet address (base58)' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        totalValueUsd: { type: 'number' },
        solBalance: { type: 'number' },
        tokens: { type: 'array', items: { type: 'object' } },
        nftCount: { type: 'number' },
      },
    },
    pairedWith: 'wallet-profiler',
  },
  {
    id: 'token-launch-data',
    name: 'Token Launches Data',
    description: 'Upcoming and recent Solana token launches as a JSON list: project name, launch date, type, and community size.',
    creditCost: 1,
    version: '1.0.0',
    tags: ['solana', 'launches', 'data', 'discovery'],
    proxyUrl: 'https://clawapis.com/solscan/token/trending',
    updateFrequency: 'daily',
    sampleOutput: {
      launches: [
        { name: 'ProjectX', symbol: 'PRJX', launchDate: '2026-03-15', type: 'fair-launch', communitySize: 45_000, status: 'upcoming' },
        { name: 'AuraFi', symbol: 'AURA', launchDate: '2026-03-10', type: 'ido', communitySize: 12_000, status: 'launched' },
      ],
      updatedAt: '2026-03-12T00:00:00Z',
    },
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
        updatedAt: { type: 'string' },
      },
    },
    pairedWith: 'token-launch-radar',
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

/** Ensure the treasury key exists and is active to collect 3% platform fees from
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

  // ─── Seed prompt_template skills ────────────────────────────────────────────
  for (const skill of OFFICIAL_SKILLS) {
    const existing = db.prepare('SELECT id FROM skills WHERE id = ?').get(skill.id);
    if (existing) continue;

    db.prepare(`
      INSERT INTO skills
        (id, name, description, prompt_template, author_key, public, credit_cost,
         version, tags_json, input_schema_json, output_schema_json, published_at,
         security_status, scanned_at, execution_plan_json)
      VALUES
        (@id, @name, @description, @promptTemplate, @authorKey, 1, @creditCost,
         @version, @tagsJson, @inputSchemaJson, @outputSchemaJson, datetime('now'),
         'VERIFIED', datetime('now'), @executionPlanJson)
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
      executionPlanJson: JSON.stringify(skill.executionPlan),
    });
    seeded++;
  }

  // ─── Seed data skill variants ───────────────────────────────────────────────
  for (const skill of OFFICIAL_DATA_SKILLS) {
    const existing = db.prepare('SELECT id FROM skills WHERE id = ?').get(skill.id);
    if (existing) continue;

    db.prepare(`
      INSERT INTO skills
        (id, name, description, prompt_template, author_key, public, credit_cost,
         version, tags_json, input_schema_json, output_schema_json, published_at,
         security_status, scanned_at, skill_type, proxy_url, proxy_method,
         update_frequency, sample_output_json, paired_skill_id)
      VALUES
        (@id, @name, @description, '', @authorKey, 1, @creditCost,
         @version, @tagsJson, @inputSchemaJson, @outputSchemaJson, datetime('now'),
         'VERIFIED', datetime('now'), 'data', @proxyUrl, 'GET',
         @updateFrequency, @sampleOutputJson, @pairedSkillId)
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
      pairedSkillId: skill.pairedWith,
    });
    seeded++;
  }

  if (seeded > 0) {
    logger.info({ seeded }, 'Official ClawHub skills seeded');
  }

  // ─── Update existing official skills with latest templates ──────────────────
  // Idempotent — runs every boot so VPS DB always reflects current definitions.
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
        version = @version,
        security_status = 'VERIFIED',
        scanned_at = datetime('now'),
        execution_plan_json = @executionPlanJson
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
      executionPlanJson: JSON.stringify(skill.executionPlan),
    });
    if (result.changes > 0) updated++;
  }

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
        paired_skill_id = @pairedSkillId
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
      pairedSkillId: skill.pairedWith,
    });
    if (result.changes > 0) updated++;
  }

  if (updated > 0) {
    logger.info({ updated }, 'Official ClawHub skills updated to latest templates');
  }

  // ─── Set paired_skill_id on prompt_template skills (bidirectional link) ─────
  // Data skills already point at their LLM pair via pairedWith.
  // This sets the reverse link so LLM skills also point at their data pair.
  let paired = 0;
  for (const dataSkill of OFFICIAL_DATA_SKILLS) {
    const result = db.prepare(`
      UPDATE skills SET paired_skill_id = @dataSkillId
      WHERE id = @llmSkillId AND author_key = @authorKey AND (paired_skill_id IS NULL OR paired_skill_id != @dataSkillId)
    `).run({
      dataSkillId: dataSkill.id,
      llmSkillId: dataSkill.pairedWith,
      authorKey: CLAWHUB_KEY,
    });
    if (result.changes > 0) paired++;
  }
  if (paired > 0) {
    logger.info({ paired }, 'Official skill pairs linked');
  }
}
