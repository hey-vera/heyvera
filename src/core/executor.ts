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
    // nofxos — AI-coin rankings
    'nofxos-ai500':          { coins: [{ rank: 1, symbol: 'TAO', name: 'Bittensor', compositeScore: 94.2, change24h: 3.1 }], totalCount: 500, lastUpdated: new Date().toISOString() },
    'nofxos-ai300':          { coins: [{ rank: 1, symbol: 'TAO', name: 'Bittensor', compositeScore: 94.2 }], totalCount: 300, lastUpdated: new Date().toISOString() },
    'nofxos-netflow':        { tokens: [{ symbol: 'SOL', netFlow: 42000000, direction: 'inflow' }], topInflow: ['SOL', 'TAO'], topOutflow: ['ETH'], marketNetFlow: 120000000 },
    // RootData — VC / funding intelligence
    'rootdata-search':       { projects: [{ name: 'Solana', category: 'Layer 1', fundingTotal: 320000000 }], vcs: [], people: [], totalResults: 1 },
    'rootdata-funding':      { rounds: [{ project: 'Example', amount: 5000000, lead: 'a16z', stage: 'Series A', date: '2024-01-15' }], totalRaised: 5000000, topInvestors: ['a16z'], averageValuation: 50000000 },
    'rootdata-hot-x':        { projects: [{ name: 'Solana', twitterEngagement: 48200, narrative: 'Layer 1' }], trendingNarratives: ['AI', 'RWA', 'DePIN'], hotInvestors: ['a16z', 'Multicoin'], lastUpdated: new Date().toISOString() },
    // CoinAnk — market analytics
    'coinank-kline':         { candles: [{ open: 144.0, high: 146.5, low: 143.2, close: 145.8, volume: 1200000, time: Date.now() }], symbol: 'SOL/USDT', exchange: 'binance', interval: '1h' },
    'coinank-btc-etf-inflow': { totalNetFlow: 520000000, byIssuer: { blackrock: 420000000, fidelity: 100000000 }, totalAUM: 58000000000, date: new Date().toISOString().slice(0, 10), cumulativeInflow: 35000000000 },
    'coinank-hyper-position': { positions: [{ trader: '0xabc...', asset: 'BTC', size: 10, leverage: 5, pnl: 42000 }], totalOI: 2400000000, largestPositions: [], topGainers: [], topLosers: [] },
    'coinank-liquidation-map': { liquidationMap: [{ price: 140, amount: 82000000 }, { price: 120, amount: 210000000 }], nextKeyLevel: 140, longLiquidations: 180000000, shortLiquidations: 45000000, totalAtRisk: 225000000 },
    'coinank-funding-rate':  { fundingRate: 0.0001, annualizedRate: 36.5, nextFundingTime: new Date(Date.now() + 3600000).toISOString(), byExchange: { binance: 0.0001, bybit: 0.00012 } },
    'coinank-fear-greed':    { value: 72, classification: 'Greed', timestamp: new Date().toISOString(), history: [{ value: 68, classification: 'Greed', date: '2024-01-01' }] },
    'coinank-long-short':    { longRatio: 54.2, shortRatio: 45.8, longShortRatio: 1.18, history: [{ longRatio: 52.1, shortRatio: 47.9, time: Date.now() - 3600000 }] },
    // CoinMarketCap
    'cmc-quotes':            { price: 145.20, volume24h: 4200000000, marketCap: 68000000000, percentChange24h: 3.1, rank: 5, circulatingSupply: 468000000 },
    'cmc-rankings':          { coins: [{ rank: 1, symbol: 'BTC', name: 'Bitcoin', price: 65000, marketCap: 1280000000000 }], totalActive: 9800, lastUpdated: new Date().toISOString() },
    // Alpha Vantage
    'alphavantage-stock':    { price: '182.52', open: '181.00', high: '183.40', low: '180.20', volume: '55234000', change: '1.52', changePercent: '0.84%', latestTradingDay: new Date().toISOString().slice(0, 10) },
    'alphavantage-technical': { values: [{ datetime: '2024-01-01', value: '68.42' }], indicator: 'RSI', lastRefreshed: new Date().toISOString().slice(0, 10) },
    // Alpaca
    'alpaca-stock-bars':     { bars: [{ o: 181.00, h: 183.40, l: 180.20, c: 182.52, v: 55234000, t: new Date().toISOString() }], symbol: 'AAPL', timeframe: '1Day', nextPageToken: null },
    // Polygon.io
    'polygon-ticker':        { name: 'Apple Inc.', ticker: 'AAPL', market: 'stocks', locale: 'us', type: 'CS', currency: 'usd', marketCap: 2900000000000, sharesOutstanding: 15700000000 },
    'polygon-aggregates':    { results: [{ o: 181.00, h: 183.40, l: 180.20, c: 182.52, v: 55234000, t: Date.now() }], ticker: 'AAPL', queryCount: 1, resultsCount: 1, adjusted: true },
    // TwelveData
    'twelvedata-price':      { price: '145.2000', symbol: 'SOL/USD', timestamp: Math.floor(Date.now() / 1000) },
    'twelvedata-time-series': { values: [{ datetime: new Date().toISOString().slice(0, 10), open: '144.0', high: '146.5', low: '143.2', close: '145.8', volume: '1200000' }], meta: { symbol: 'SOL/USD', interval: '1day' }, status: 'ok' },
    // x402 Ecosystem Analytics
    'x402list-search':       { providers: [{ name: 'claw402.ai', reliability: 0.99, avgPrice: 0.001, endpointCount: 260 }], endpoints: [], totalResults: 1, averagePrice: 0.001 },
    'x402scan-tx':           { transactions: [], totalVolume: 12400, activeProviders: 13, topEndpoints: ['/api/v1/coinank/kline/lists'] },
    'x402station-monitor':   { services: [{ name: 'claw402.ai', status: 'up', uptimePct: 99.8, avgLatency: 210 }], uptimePct: 99.8, avgLatency: 210, incidentCount: 0, healthScore: 98 },
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

  const STEP_TIMEOUT_MS = 15_000;
  try {
    const apiPath = endpoint.path ?? '/solscan/token/meta';
    let data: unknown;
    if (isClawApisReady()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
      try {
        data = await clawApiCall(apiPath, normalizeParams(step.endpointId, step.params), endpoint.baseUrl, controller.signal);
      } finally {
        clearTimeout(timer);
      }
    } else {
      data = mockData(step.endpointId);
    }
    // YELLOW-8: Reject oversized responses before caching to prevent cache poisoning / memory DoS
    const MAX_RESPONSE_BYTES = 1_000_000; // 1MB
    const responseSize = JSON.stringify(data).length;
    if (responseSize > MAX_RESPONSE_BYTES) {
      logger.warn({ endpointId: step.endpointId, responseSize }, 'API response exceeds max size — skipping cache');
    } else {
      await cacheSet(key, data);
    }
    recordSuccess(step.endpointId);
    return { endpointId: step.endpointId, success: true, cached: false, durationMs: Date.now() - start, cost: endpoint.costPerCall, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    logger.error({ endpointId: step.endpointId, error, timeout: isTimeout }, 'Step execution failed');
    recordFailure(step.endpointId);
    return { endpointId: step.endpointId, success: false, cached: false, durationMs: Date.now() - start, cost: 0, error: isTimeout ? 'STEP_TIMEOUT' : error };
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