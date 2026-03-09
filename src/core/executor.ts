import { isEndpointAvailable, recordSuccess, recordFailure } from './circuit-breaker';
import { ParsedIntent } from './intent-parser';
import { findEndpoint } from '../config/api-registry';
import { cacheGet, cacheSet, cacheKey } from '../cache/index';
import { logger } from '../utils/logger';
import { isClawApisReady, clawApiCall } from '../providers/clawapis';

export interface StepResult {
  endpointId: string;
  success: boolean;
  cached: boolean;
  durationMs: number;
  cost: number;
  data?: unknown;
  error?: string;
}

export interface ExecutionResult {
  steps: StepResult[];
  totalCost: number;
  totalDurationMs: number;
}

function mockData(endpointId: string): unknown {
  const mocks: Record<string, unknown> = {
    // ClawAPIs — Solana / on-chain
    'claw-token-price':      { priceUsd: 0.0234, change24h: 5.2, volume24h: 1200000, marketCap: 23400000, liquidity: 450000 },
    'claw-token-metadata':   { name: 'Bonk', symbol: 'BONK', decimals: 5, totalSupply: 93700000000000, description: 'The first Solana dog coin' },
    'claw-token-holders':    { totalHolders: 847293, top10Concentration: 23.4, top25Concentration: 38.1, topHolders: [] },
    'claw-token-risk':       { riskScore: 28, riskLevel: 'low', flags: [], mintAuthority: false, freezeAuthority: false, lpLocked: true },
    'claw-wallet-portfolio': { totalValueUsd: 4823.12, solBalance: 12.4, tokens: [], nfts: [] },
    'claw-tx-history':       { transactions: [], totalCount: 142, swapCount: 67, transferCount: 75 },
    'claw-trending-tokens':  { tokens: [{ symbol: 'BONK', mintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', priceUsd: 0.0234 }], timestamp: new Date().toISOString() },
    'claw-x-mentions':       { mentionCount: 1243, sentimentScore: 0.72, sentimentLabel: 'positive', topTweets: [], engagementTotal: 48200 },
    'claw-x-profile':        { displayName: 'BONK', followers: 89200, following: 142, verified: false, bio: 'The first Solana dog coin', recentTweets: [] },
    'claw-linkedin-profile': { name: 'Founder Name', headline: 'Building in Web3', currentRole: 'CEO', company: 'SimToken', experience: [], education: [], connections: 500 },
    'claw-instagram-check':  { exists: true, followers: 12400, posts: 89, verified: false, bio: 'Crypto project' },
    'claw-reddit-sentiment': { sentimentScore: 0.65, sentimentLabel: 'positive', postCount: 234, topPosts: [], subredditsSearched: ['solana', 'CryptoMoonShots'] },
    'claw-web-scrape':       { title: 'Project Homepage', content: 'Sample scraped content...', links: [], images: [], wordCount: 842 },
    'claw-news-search':      { articles: [{ title: 'BONK surges 50%', summary: 'The Solana meme coin saw massive gains...', url: '#' }], totalResults: 12, query: 'BONK' },
    'claw-wallet-risk':      { riskScore: 15, riskLevel: 'low', flags: [], botProbability: 0.05, mixerInteractions: 0 },
    // CoinGecko x402
    'coingecko-price':       { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 65000, market_cap: 1280000000000, price_change_percentage_24h: 2.3 },
    'coingecko-coin-data':   { id: 'solana', symbol: 'sol', name: 'Solana', description: { en: 'Solana is a high-performance blockchain.' }, market_data: { current_price: { usd: 145 } } },
    // Rug Munch
    'rugmunch-risk':         { score: 82, verdict: 'safe', rugPullRisk: 'low', liquidityLocked: true, mintAuthority: false },
    'rugmunch-honeypot':     { isHoneypot: false, canSell: true, sellTax: 0, buyTax: 0 },
    'rugmunch-holder-analysis': { totalHolders: 12400, top10Pct: 21.3, devWalletPct: 4.1, suspicious: false },
    // Einstein AI
    'einstein-whales':       { whales: [{ address: '5xyz...', balanceUsd: 4200000, activity: 'accumulating' }], totalWhalePct: 18.2 },
    'einstein-dex':          { pairs: [{ exchange: 'Raydium', price: 0.0234, liquidity: 450000, volume24h: 1200000 }] },
    'einstein-mev':          { mevActivity: 'low', sandwichAttacks24h: 2, frontrunCount: 5, estimatedLossUsd: 120 },
    // Apollo Intelligence
    'apollo-prices':         { prices: { BTC: 65000, ETH: 3200, SOL: 145 }, timestamp: new Date().toISOString() },
    'apollo-osint':          { entity: 'Example Project', risk: 'low', linkedAddresses: [], socialPresence: 'strong' },
    'apollo-defi-yields':    { protocols: [{ name: 'Marinade', apy: 7.2, tvl: 890000000 }] },
    // DiamondClaws
    'diamondclaws-yield':    { bestYield: { protocol: 'Kamino', apy: 12.4, asset: 'USDC' }, alternatives: [] },
    'diamondclaws-protocol-risk': { protocol: 'Raydium', riskScore: 22, auditStatus: 'audited', tvl: 980000000 },
    'diamondclaws-gas':      { solana: { avgFee: 0.00025, priorityFee: 0.001 }, ethereum: { gwei: 18, usdEstimate: 2.4 } },
    // Elsa Finance
    'elsa-portfolio':        { totalUsd: 12430.50, positions: [{ asset: 'SOL', amount: 50, valueUsd: 7250 }], pnl24h: 234.12 },
    'elsa-swap-quote':       { inputToken: 'SOL', outputToken: 'USDC', inputAmount: 1, expectedOutput: 144.8, priceImpact: 0.05, route: ['Raydium'] },
    // SLAMai
    'slamai-signals':        { signals: [{ token: 'BONK', signal: 'buy', confidence: 0.74, basis: 'momentum + volume spike' }] },
    // Automaton Oracle
    'automaton-price':       { token: 'SOL', price: 145.20, source: 'aggregated', confidence: 0.98 },
    'automaton-signals':     { bullish: ['SOL', 'BONK'], bearish: ['FTT'], neutral: ['ETH'], generatedAt: new Date().toISOString() },
    'automaton-pump-radar':  { pumping: [{ token: 'MYRO', change1h: 42.1, volume1h: 8900000 }], scanTime: new Date().toISOString() },
    // Crysha
    'crysha-price':          { symbol: 'SOL', priceUsd: 145.20, priceChange24h: 3.1, exchanges: ['Binance', 'Coinbase', 'Kraken'] },
    // twit.sh
    'twitsh-search':         { tweets: [{ id: '1', text: 'BONK to the moon!', likes: 342, retweets: 89 }], count: 1 },
    'twitsh-user':           { username: 'bonk_inu', followers: 89200, verified: false, bio: 'Official BONK account' },
    // Gloria AI
    'gloria-news':           { articles: [{ title: 'Solana hits new ATH', source: 'CoinDesk', sentiment: 'positive', publishedAt: new Date().toISOString() }] },
    // Olostep
    'olostep-scrape':        { url: 'https://example.com', title: 'Example Page', markdown: '# Example\nSample content...', links: [] },
    'olostep-answers':       { question: 'What is Solana?', answer: 'Solana is a high-performance Layer 1 blockchain.', sources: [] },
    // Minifetch
    'minifetch-summary':     { url: 'https://example.com', summary: 'This page describes a new DeFi protocol on Solana.', wordCount: 320 },
    // Pylon
    'pylon-search':          { query: 'solana defi', results: [{ title: 'Solana DeFi Overview', url: 'https://example.com', snippet: '...' }] },
    'pylon-extract':         { url: 'https://example.com', data: { price: '$145', protocol: 'Raydium' }, confidence: 0.91 },
    // Browserbase
    'browserbase-session':   { sessionId: 'bb-mock-001', screenshot: null, html: '<html>...</html>', text: 'Page content here' },
    // BlackSwan
    'blackswan-risk':        { overallRisk: 'medium', factors: [{ name: 'exchange concentration', risk: 'high' }], score: 58 },
    // Moltalyzer
    'moltalyzer-token-intel': { token: 'BONK', insiderActivity: false, washTradingScore: 12, legitimacyScore: 87 },
    // CrossFin
    'crossfin-kimchi':       { premium: 2.3, direction: 'KR > US', opportunity: true, exchanges: { kr: 'Upbit', us: 'Coinbase' } },
    // Messari
    'messari-asset':         { id: 'solana', name: 'Solana', symbol: 'SOL', metrics: { market_data: { price_usd: 145 } } },
    // x402 Discovery
    'x402-discover':         { providers: [{ name: 'ClawAPIs', baseUrl: 'https://clawapis.com', endpoints: 12 }] },
    'x402-route':            { recommended: 'clawapis.com', reason: 'lowest cost for Solana data', alternatives: [] },
    // PayAI
    'payai-discovery':       { agents: [{ id: 'claw-net', capabilities: ['solana', 'social', 'defi'], pricePerCall: 0.001 }] },
  };
  return mocks[endpointId] ?? { result: 'mock data', endpointId };
}

function normalizeParams(endpointId: string, params: Record<string, string>): Record<string, unknown> {
  // These endpoints take no query params — strip everything the LLM adds
  const noParamEndpoints = ['claw-trending-tokens', 'claw-token-risk'];
  if (noParamEndpoints.includes(endpointId)) return {};

  const normalized: Record<string, unknown> = { ...params };

  // Solscan uses 'address' for token mint addresses
  if (normalized.mintAddress) {
    normalized.address = normalized.mintAddress;
    delete normalized.mintAddress;
  }

  // X API search needs 'query' param
  if (['claw-x-mentions', 'claw-reddit-sentiment', 'claw-news-search'].includes(endpointId)) {
    if (!normalized.query && normalized.symbol) {
      normalized.query = `${normalized.symbol} crypto`;
    }
    if (!normalized.query && normalized.token) {
      normalized.query = `${normalized.token} crypto`;
    }
    normalized.max_results = normalized.max_results ?? '10';
  }

  // X user lookup needs 'username' not 'handle'
  if (['claw-x-profile', 'claw-linkedin-profile', 'claw-instagram-check'].includes(endpointId)) {
    if (normalized.handle) {
      normalized.username = normalized.handle;
      delete normalized.handle;
    }
  }

  return normalized;
}

async function executeStep(
  stepIndex: number,
  intent: ParsedIntent
): Promise<StepResult> {
  const step = intent.steps[stepIndex];
  const endpoint = findEndpoint(step.endpointId);
  const start = Date.now();

  if (!endpoint) {
    return { endpointId: step.endpointId, success: false, cached: false, durationMs: 0, cost: 0, error: 'ENDPOINT_NOT_FOUND' };
  }

  const key = cacheKey(step.endpointId, step.params);
  const cached = await cacheGet<unknown>(key);
  if (cached !== null) {
    logger.debug({ endpointId: step.endpointId }, 'Cache hit');
    return { endpointId: step.endpointId, success: true, cached: true, durationMs: Date.now() - start, cost: 0, data: cached };
  }

  if (!isEndpointAvailable(step.endpointId)) {
    return { endpointId: step.endpointId, success: false, cached: false, durationMs: 0, cost: 0, error: 'CIRCUIT_OPEN' };
  }

  try {
    const apiPath = endpoint.path ?? '/solscan/token/meta';
    const data = isClawApisReady()
      ? await clawApiCall(apiPath, normalizeParams(step.endpointId, step.params), endpoint.baseUrl)
      : mockData(step.endpointId);
    await cacheSet(key, data);
    recordSuccess(step.endpointId);
    return { endpointId: step.endpointId, success: true, cached: false, durationMs: Date.now() - start, cost: endpoint.costPerCall, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ endpointId: step.endpointId, error }, 'Step execution failed');
    recordFailure(step.endpointId);
    return { endpointId: step.endpointId, success: false, cached: false, durationMs: Date.now() - start, cost: 0, error };
  }
}

export async function executePlan(intent: ParsedIntent): Promise<ExecutionResult> {
  const start = Date.now();
  const allResults: StepResult[] = new Array(intent.steps.length);

  for (const group of intent.parallelGroups) {
    const groupResults = await Promise.allSettled(
      group.map((indexStr) => executeStep(parseInt(indexStr), intent))
    );
    groupResults.forEach((result, i) => {
      const stepIndex = parseInt(group[i]);
      if (result.status === 'fulfilled') {
        allResults[stepIndex] = result.value;
      } else {
        allResults[stepIndex] = {
          endpointId: intent.steps[stepIndex]?.endpointId ?? 'unknown',
          success: false, cached: false, durationMs: 0, cost: 0,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
      }
    });
  }

  const steps = allResults.filter(Boolean);
  const totalCost = steps.reduce((sum, s) => sum + s.cost, 0);

  return { steps, totalCost, totalDurationMs: Date.now() - start };
}