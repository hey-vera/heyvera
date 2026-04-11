import { isEndpointAvailable, recordSuccess, recordFailure } from './circuit-breaker';
import { ParsedIntent } from './intent-parser';
import { findEndpoint } from '../config/api-registry';
import { cacheKey, smartCacheGet, smartCacheSet, enqueueRefresh, computeDiff, coalesceRequest, cacheNegative, getNegativeCache, type CacheFreshness, type DiffResult } from '../cache/index';
import { logger } from '../utils/logger';
import { isX402Ready, x402Call, getLastBirthCertificate } from '../providers/x402-client';
import { checkEndpointViaZauth } from './zauth-discovery';
// BirthCertificate type from soma-heart (inline to avoid CJS/ESM resolution)
type BirthCertificate = { dataHash: string; signature: string; timestamp: string; publicKey: string; heartbeatIndex: number };
import { getAgentContext, setAgentContext, getSkill } from '../db/index';
import { creditCostForEndpoint, round6 } from './credits';
import { generateSeedCommitment } from './commit-reveal';
import { createComputationCertificate, type ComputationCertificate } from './computation-certificate';
import { checkSum, checkCount, checkMinMax, checkSort, checkEconomicOnly, type SpotCheckResult } from './spot-check';
import { getComputationType, resolveComputationType } from './computation-types';
import { somaHash, somaHashJson } from '../utils/crypto-agility';
import { resolveAgentDid, appendAction } from './soma-heartbeat';

export interface StepResult {
  endpointId: string;
  success: boolean;
  cached: boolean;
  staleServed?: boolean;       // True if served from SWR stale cache
  contentChanged?: boolean;    // True if fresh fetch returned different data than cache
  durationMs: number;
  cost: number;
  data?: unknown;
  diff?: DiffResult | null;    // Delta between previous and current (opt-in)
  error?: string;
  birthCertificate?: BirthCertificate;  // Soma provenance (present when heart is active)
  computationCertId?: string;           // Computation certificate ID (when endpoint has computationType)
}

export interface ExecutionResult {
  steps: StepResult[];
  totalCost: number;
  totalDurationMs: number;
  birthCertificates?: BirthCertificate[];  // Soma provenance from all steps
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
    // DexScreener
    'dexscreener-token':  { pairs: [{ pairAddress: 'abc123', baseToken: { symbol: 'SOL', name: 'Solana' }, quoteToken: { symbol: 'USDC' }, priceUsd: '145.20', volume: { h24: 42000000 }, liquidity: { usd: 8500000 }, priceChange: { h24: 3.1 }, txns: { h24: { buys: 12400, sells: 11800 } } }] },
    'dexscreener-pair':   { pairAddress: 'abc123', baseToken: { symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '145.20', volume: { h24: 42000000 }, liquidity: { usd: 8500000 }, fdv: 68000000000 },
    'dexscreener-search': { pairs: [{ baseToken: { symbol: 'SOL', name: 'Solana', address: 'So11111111111111111111111111111111111111112' }, priceUsd: '145.20' }] },
    // CoinGecko additional
    'coingecko-history':  { prices: [[1710000000000, 145.2], [1710086400000, 146.8], [1710172800000, 143.5]], market_caps: [[1710000000000, 68000000000]], total_volumes: [[1710000000000, 4200000000]] },
    'coingecko-trending': { coins: [{ item: { id: 'solana', name: 'Solana', symbol: 'SOL', market_cap_rank: 5, price_btc: 0.00223 } }] },
    'coingecko-global':   { data: { total_market_cap: { usd: 2800000000000 }, total_volume: { usd: 120000000000 }, market_cap_percentage: { btc: 52.1, eth: 16.3 }, active_cryptocurrencies: 14200 } },
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
    // Cascade Surf
    'cascade-twitter-search':    { tweets: [{ id: '1234', text: 'SOL breaking out 🚀', user: '@trader1', likes: 420, retweets: 89 }], totalCount: 1 },
    'cascade-twitter-user':      { user: 'ClawNet', followers: 2500, following: 180, verified: false, bio: 'AI agent orchestration layer' },
    'cascade-twitter-followers': { followers: [{ username: 'user1', followers: 500 }], totalCount: 2500 },
    'cascade-twitter-timeline':  { tweets: [{ id: '5678', text: 'Just launched x402 support!', likes: 120, retweets: 30 }], totalCount: 50 },
    'cascade-twitter-trending':  { trends: [{ name: '#Solana', tweetVolume: 48000 }, { name: '$SOL', tweetVolume: 12000 }], asOf: new Date().toISOString() },
    'cascade-reddit-search':     { posts: [{ title: 'Solana ecosystem update', subreddit: 'solana', score: 420, comments: 89 }], totalCount: 1 },
    'cascade-reddit-subreddit':  { posts: [{ title: 'Daily discussion', score: 120, comments: 340 }], subredditInfo: { name: 'solana', subscribers: 280000 } },
    'cascade-web-search':        { results: [{ title: 'Solana Documentation', url: 'https://solana.com/docs', snippet: 'Build on Solana...' }], totalEstimate: 1200000 },
    'cascade-web-crawl':         { content: 'Page content here...', title: 'Example Page', meta: { description: 'An example page' }, links: ['https://example.com/page2'] },
    'cascade-llm-inference':     { choices: [{ message: { role: 'assistant', content: 'Hello! How can I help?' } }], usage: { prompt_tokens: 10, completion_tokens: 20 }, model: 'claude-sonnet' },
    // Dexter
    'dexter-supported':          { networks: ['solana', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'], tokens: ['USDC', 'USDT', 'DAI'], capabilities: ['verify', 'settle'] },
    // RelAI
    'relai-marketplace':         { apis: [{ name: 'Token Analytics', provider: 'DataFi', price: 0.002, chain: 'base' }], totalCount: 850, categories: ['defi', 'social', 'ai'], chains: ['base', 'solana', 'polygon'] },
    // AnySpend
    'anyspend-facilitator':      { supported: true, networks: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'bnb', 'avalanche', 'solana'], tokens: ['USDC', 'USDT', 'DAI', 'ETH', 'SOL'] },
    // Meridian
    'meridian-payment':          { supported: true, capabilities: ['route', 'settle', 'identity'] },
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
    // EthSkills
    'ethskills-audit':       { content: '# Smart Contract Audit Checklist\n\n## 1. Access Control\n- Check for unprotected functions...', format: 'markdown' },
    'ethskills-security':    { content: '# Ethereum Security\n\n## Common Vulnerabilities\n- Reentrancy...', format: 'markdown' },
    'ethskills-defi':        { content: '# DeFi Protocols\n\n## AMM Patterns\n- Constant product...', format: 'markdown' },
    'ethskills-testing':     { content: '# Testing Patterns\n\n## Unit Testing\n- Use Foundry forge test...', format: 'markdown' },
    'ethskills-l2':          { content: '# Layer 2s\n\n## Rollup Types\n- Optimistic: fraud proofs...', format: 'markdown' },
    'ethskills-ship':        { content: '# Shipping Guide\n\n## Deployment Checklist\n- Verify contracts on Etherscan...', format: 'markdown' },
    // Browser Use
    'browseruse-navigate':   { result: 'Page loaded successfully', steps: 3, screenshots: ['screenshot1.png'], cost: 0.018 },
    // Xona
    'xona-image-gen':        { imageUrl: 'https://xona-agent.com/generated/abc123.png', model: 'xona-v2', cost: 0.01 },
    // zauth
    'zauth-endpoint-verify': { trustScore: 92, healthStatus: 'healthy', successRate: 0.98, lastChecked: new Date().toISOString() },
    'zauth-pentest':         { vulnerabilities: [], riskScore: 15, recommendations: ['Enable HSTS header'] },
    // QuickNode
    'quicknode-streams':     { events: [{ type: 'Transfer', blockNumber: 19500000, chain: 'ethereum' }] },
    // Allium
    'allium-transactions':   { transactions: [{ hash: '0xabc...', from: '0x123...', to: '0x456...', value: '1.5', chain: 'ethereum' }], totalCount: 1, chain: 'ethereum' },
    'allium-balances':       { balances: [{ token: 'USDC', amount: '1500.00', valueUsd: 1500 }], totalValueUsd: 1500, chain: 'base' },
    // Heurist
    'heurist-inference':     { choices: [{ message: { role: 'assistant', content: 'Decentralized inference response' } }], usage: { total_tokens: 50 }, model: 'mistral-7b' },
    'heurist-image':         { images: [{ url: 'https://heurist.xyz/generated/img123.png' }], model: 'sdxl' },
    // Skyfire
    'skyfire-pay':           { transactionId: 'sf_tx_123', status: 'completed', amount: 0.01 },
    // VeryAI
    'veryai-verify':         { verified: true, confidence: 0.94, issues: [], sources: ['coingecko', 'defillama'] },
    // Nevermined
    'nevermined-search':     { assets: [{ name: 'DeFi TVL Dataset', type: 'dataset', price: 0.1 }], totalCount: 1 },
    // Semantic Layer
    'semantic-layer-query':  { result: [{ protocol: 'Aave', tvl: 12500000000 }], sql: 'SELECT protocol, tvl FROM defi_protocols ORDER BY tvl DESC LIMIT 5', chain: 'ethereum', confidence: 0.92 },
    // Cred Protocol
    'cred-credit-score':     { creditScore: 720, defaultProbability: 0.03, debtToCollateral: 0.45, protocols: ['Aave', 'Compound'] },
    'cred-credit-report':    { creditReport: { score: 720, grade: 'A' }, positions: [{ protocol: 'Aave', debt: 5000, collateral: 12000 }], liquidations: 0, protocols: 3, chains: ['ethereum', 'polygon'] },
    // SQD
    'sqd-query':             { data: [{ from: '0x123...', to: '0x456...', value: '1.5', token: 'USDC' }], chain: 'ethereum', blockRange: [19000000, 19500000], validated: true },
    // Birdeye
    'birdeye-token-price':   { price: 145.20, priceChange24h: 3.1, volume24h: 4200000000, liquidity: 890000000 },
    'birdeye-wallet-pnl':    { totalPnl: 12500, tokens: [{ symbol: 'SOL', pnl: 8000, trades: 15 }], winRate: 0.73, totalTrades: 42 },
    'birdeye-smart-money':   { trending: [{ symbol: 'SOL', netBuy: 2500000 }], topBuyers: ['whale1'], topSellers: [], netFlow: 5000000 },
    // Dune
    'dune-query':            { result: { rows: [{ total_volume: 42000000 }] }, rows: 1, metadata: { query_id: 12345 }, executionId: 'exec_abc' },
    // Nansen
    'nansen-smart-money':    { signals: [{ type: 'accumulation', token: 'ETH', amount: 5000 }], wallets: 42, labels: ['VC', 'whale'], totalFlow: 25000000 },
    'nansen-token-screener': { tokens: [{ symbol: 'ETH', smartMoneyScore: 92, holderComposition: { smart: 0.35, retail: 0.65 } }], smartMoneyScore: 92, holderComposition: {}, institutionalInterest: 'high' },
    // growthepie
    'growthepie-l2-metrics': { metrics: [{ l2: 'Arbitrum', activeAddresses: 450000, tvl: 8500000000 }], l2s: ['Arbitrum', 'Optimism', 'Base', 'zkSync'], timeRange: '30d' },
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

// ─── Agent Service Execution ──────────────────────────────────────────────────
// Executes a marketplace skill (api_proxy or data) as a step in the orchestration
// pipeline. Used when optimizePlan() substitutes a missing built-in endpoint with
// an agent service (endpointId = "skill:<id>").

async function executeAgentService(
  skillId: string,
  params: Record<string, unknown>,
): Promise<{ data: unknown; costUsd: number }> {
  const skill = getSkill(skillId);
  if (!skill) throw new Error(`Agent service not found: ${skillId}`);
  if (skill.status === 'delisted') throw new Error(`Agent service delisted: ${skillId}`);

  // api_proxy skills — direct HTTP call to the proxy URL
  if ((skill.skill_type === 'api_proxy' || skill.skill_type === 'data') && skill.proxy_url) {
    // SSRF guard — block private IPs / localhost
    try {
      const url = new URL(skill.proxy_url);
      const host = url.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
        throw new Error('Agent service URL points to a blocked address');
      }
      if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) {
        throw new Error('Agent service URL points to a private network');
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Agent service')) throw err;
      throw new Error(`Invalid agent service URL: ${skill.proxy_url}`);
    }

    const method = skill.proxy_method || 'POST';
    const res = await fetch(skill.proxy_url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method !== 'GET' ? JSON.stringify(params) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`Agent service returned ${res.status}`);
    const data = await res.json().catch(async () => ({ raw: await res.text() }));
    const costUsd = round6(skill.credit_cost / 1000); // credit_cost → USD
    return { data, costUsd };
  }

  throw new Error(`Agent service ${skillId} has no proxy URL (type: ${skill.skill_type})`);
}

async function executeStep(
  stepIndex: number,
  intent: ParsedIntent,
  agentKey?: string,
  freshness: CacheFreshness = 'smart',
  wantDiff: boolean = false,
): Promise<StepResult> {
  const step = intent.steps[stepIndex];
  const start = Date.now();

  // ── Agent Service Steps ─────────────────────────────────────────────────────
  // Steps with endpointId = "skill:<id>" were substituted by optimizePlan() when
  // no built-in endpoint could satisfy the capability. Execute via the skill proxy.
  if (step.endpointId.startsWith('skill:')) {
    const skillId = step.endpointId.slice(6); // strip "skill:" prefix
    try {
      const { data, costUsd } = await executeAgentService(skillId, step.params);
      logger.info({ endpointId: step.endpointId, skillId, durationMs: Date.now() - start }, 'Agent service step completed');

      // Cross-verify agent service results against known-good sources (best-effort)
      let verifiedData = data;
      try {
        const { crossVerify } = await import('./cross-verify.js');
        const verification = await crossVerify(step.reason || '', data, step.params);
        if (verification) {
          (verifiedData as any).__verification = verification;
          if (!verification.verified) {
            logger.warn({ endpointId: step.endpointId, skillId, deviation: verification.deviation, warning: verification.warning }, 'Cross-verify: agent service flagged');
          }
        }
      } catch { /* cross-verify is best-effort */ }

      return {
        endpointId: step.endpointId,
        success: true,
        cached: false,
        durationMs: Date.now() - start,
        cost: costUsd,
        data: verifiedData,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ endpointId: step.endpointId, skillId, error }, 'Agent service step failed');
      return {
        endpointId: step.endpointId,
        success: false,
        cached: false,
        durationMs: Date.now() - start,
        cost: 0,
        error,
      };
    }
  }

  // ── Built-in Endpoint Steps ─────────────────────────────────────────────────
  const endpoint = findEndpoint(step.endpointId);

  if (!endpoint) {
    return { endpointId: step.endpointId, success: false, cached: false, durationMs: 0, cost: 0, error: 'ENDPOINT_NOT_FOUND' };
  }

  // Agent Context Layer — check per-agent SQLite cache first (sub-1ms)
  // Skip if freshness === 'fresh' (client wants live data)
  if (agentKey && freshness !== 'fresh') {
    const ctxData = getAgentContext(agentKey, step.endpointId, step.params);
    if (ctxData !== null) {
      logger.debug({ endpointId: step.endpointId }, 'Agent context hit');
      return { endpointId: step.endpointId, success: true, cached: true, durationMs: Date.now() - start, cost: 0, data: ctxData };
    }
  }

  // ── Smart Cache Lookup ──────────────────────────────────────────────────
  const key = cacheKey(step.endpointId, step.params);
  const endpointCreditCost = creditCostForEndpoint(endpoint);
  const cacheResult = await smartCacheGet<unknown>(key, freshness, step.endpointId, endpointCreditCost);

  if (cacheResult) {
    // Fresh cache hit — serve directly
    if (cacheResult.fresh) {
      logger.debug({ endpointId: step.endpointId }, 'Smart cache hit (fresh)');
      return { endpointId: step.endpointId, success: true, cached: true, durationMs: Date.now() - start, cost: 0, data: cacheResult.value };
    }

    // Stale cache hit (SWR) — serve stale data immediately, refresh in background
    if (cacheResult.stale && freshness !== 'fresh') {
      logger.debug({ endpointId: step.endpointId }, 'SWR: serving stale, refreshing in background');

      // Enqueue background refresh
      enqueueRefresh(key, async () => {
        if (!isX402Ready()) return mockData(step.endpointId);
        const apiPath = endpoint.path ?? '/solscan/token/meta';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
          const freshData = await x402Call(apiPath, normalizeParams(step.endpointId, step.params), endpoint.baseUrl, controller.signal);
          recordSuccess(step.endpointId);
          // Also update agent context
          if (agentKey) {
            setAgentContext(agentKey, step.endpointId, step.params, freshData, endpoint.category ?? null, endpoint.cacheTtl ?? 300);
          }
          return freshData;
        } finally {
          clearTimeout(timer);
        }
      }, endpoint.cacheTtl ?? 300);

      return {
        endpointId: step.endpointId, success: true, cached: true, staleServed: true,
        durationMs: Date.now() - start, cost: 0, data: cacheResult.value,
      };
    }
  }

  // ── Cache Miss — Live Fetch ─────────────────────────────────────────────

  // Check negative cache — don't retry recently-failed endpoints
  const negError = getNegativeCache(key);
  if (negError) {
    logger.debug({ endpointId: step.endpointId }, 'Negative cache hit — skipping recently-failed endpoint');
    return { endpointId: step.endpointId, success: false, cached: false, durationMs: Date.now() - start, cost: 0, error: `CACHED_FAILURE: ${negError}` };
  }

  if (!isEndpointAvailable(step.endpointId)) {
    return { endpointId: step.endpointId, success: false, cached: false, durationMs: 0, cost: 0, error: 'CIRCUIT_OPEN' };
  }

  // Zauth pre-flight: skip endpoints that zauth reports as FAILING (non-blocking, best-effort)
  if (endpoint.path && isX402Ready()) {
    try {
      const zauthStatus = await checkEndpointViaZauth(endpoint.path);
      if (zauthStatus?.status === 'FAILING') {
        logger.info({ endpointId: step.endpointId, zauthStatus: zauthStatus.status }, 'Zauth pre-flight: endpoint FAILING — skipping');
        return { endpointId: step.endpointId, success: false, cached: false, durationMs: Date.now() - start, cost: 0, error: 'ZAUTH_FAILING' };
      }
    } catch {
      // Zauth check failed — proceed anyway, don't block on zauth availability
    }
  }

  const STEP_TIMEOUT_MS = 15_000;
  try {
    const apiPath = endpoint.path ?? '/solscan/token/meta';
    let data: unknown;

    // Request coalescing: if another request for the same key is in-flight,
    // wait for it instead of making a duplicate upstream call
    data = await coalesceRequest(key, async () => {
      if (isX402Ready()) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
        try {
          return await x402Call(apiPath, normalizeParams(step.endpointId, step.params), endpoint.baseUrl, controller.signal);
        } finally {
          clearTimeout(timer);
        }
      } else {
        return mockData(step.endpointId);
      }
    });

    // YELLOW-8: Reject oversized responses before caching
    const MAX_RESPONSE_BYTES = 1_000_000;
    const serialized = JSON.stringify(data);
    const responseSize = serialized.length;

    let contentChanged: boolean | undefined;
    let diff: DiffResult | null | undefined;

    if (responseSize > MAX_RESPONSE_BYTES) {
      logger.warn({ endpointId: step.endpointId, responseSize }, 'API response exceeds max size — skipping cache');
    } else {
      // Smart cache set — tracks content hash + previous value for diff
      const cacheInfo = await smartCacheSet(key, data, endpoint.cacheTtl, step.endpointId, endpoint.creditCost ?? endpoint.costPerCall);
      contentChanged = cacheInfo.contentChanged;

      // Compute diff if requested and data changed
      if (wantDiff && cacheInfo.previousValue != null) {
        diff = computeDiff(cacheInfo.previousValue, data);
      }

      // Store in agent context
      if (agentKey) {
        setAgentContext(agentKey, step.endpointId, step.params, data, endpoint.category ?? null, endpoint.cacheTtl ?? 300);
      }
    }

    // Post-fetch validation
    if (endpoint.outputFields && endpoint.outputFields.length > 0 && data && typeof data === 'object') {
      const dataKeys = new Set(Object.keys(data as Record<string, unknown>));
      const matchCount = endpoint.outputFields.filter(f => dataKeys.has(f)).length;
      const matchRatio = matchCount / endpoint.outputFields.length;
      if (matchRatio < 0.3 && endpoint.outputFields.length > 1) {
        logger.warn({
          endpointId: step.endpointId,
          expected: endpoint.outputFields.slice(0, 5),
          got: [...dataKeys].slice(0, 5),
          matchRatio,
        }, 'Post-fetch: response schema mismatch (using data but flagging)');
      }
    }

    recordSuccess(step.endpointId);
    const birthCertificate = getLastBirthCertificate() ?? undefined;

    // Verified computation: resolve computationType (explicit or category default)
    let computationCertId: string | undefined;
    const resolvedCompType = resolveComputationType(endpoint);
    if (resolvedCompType && data) {
      try {
        const cert = issueDataFetchCert(step.endpointId, resolvedCompType, step.params, data, birthCertificate);
        if (cert) computationCertId = cert.id;
      } catch {
        // Spot-check is advisory — never block the response
      }
    }

    return {
      endpointId: step.endpointId, success: true, cached: false,
      contentChanged, diff, birthCertificate, computationCertId,
      durationMs: Date.now() - start, cost: endpoint.costPerCall, data,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    // Cache the failure to prevent hammering this endpoint
    cacheNegative(key, isTimeout ? 'TIMEOUT' : error.slice(0, 100));
    logger.error({ endpointId: step.endpointId, error, timeout: isTimeout }, 'Step execution failed');
    recordFailure(step.endpointId);
    return { endpointId: step.endpointId, success: false, cached: false, durationMs: Date.now() - start, cost: 0, error: isTimeout ? 'STEP_TIMEOUT' : error };
  }
}

export interface BudgetConstraint {
  /** Maximum credits to spend. Steps that would exceed this are skipped. */
  maxCredits: number;
  /** Strict mode — if true, return errors instead of falling back to LLM when no endpoint/service exists. */
  strict?: boolean;
}

export async function executePlan(
  intent: ParsedIntent,
  budget?: BudgetConstraint,
  agentKey?: string,
  freshness: CacheFreshness = 'smart',
  wantDiff: boolean = false,
): Promise<ExecutionResult> {
  const start = Date.now();
  const allResults: StepResult[] = new Array(intent.steps.length);
  let runningCostUsd = 0;
  let runningCredits = 0;

  for (const group of intent.parallelGroups) {
    // If budget constraint exists, skip steps that would blow the limit
    const stepsToRun = budget
      ? group.filter((indexStr) => {
          const step = intent.steps[parseInt(indexStr)];
          // Agent service steps carry credit cost directly
          const isAgentService = step?.endpointId?.startsWith('skill:');
          const ep = (!isAgentService && step) ? findEndpoint(step.endpointId) : null;
          const stepCredits = isAgentService
            ? ((step as any).creditCost ?? 1)
            : (ep ? creditCostForEndpoint(ep) : 1);
          // Estimate whether adding this step would exceed the credit budget
          const projectedCredits = runningCredits + stepCredits;
          if (projectedCredits > budget.maxCredits) {
            logger.info({ endpointId: step?.endpointId, projectedCredits, maxCredits: budget.maxCredits }, 'Skipping step — budget exceeded');
            allResults[parseInt(indexStr)] = {
              endpointId: step?.endpointId ?? 'unknown',
              success: false, cached: false, durationMs: 0, cost: 0,
              error: 'BUDGET_EXCEEDED',
            };
            return false;
          }
          return true;
        })
      : group;

    const groupResults = await Promise.allSettled(
      stepsToRun.map((indexStr) => executeStep(parseInt(indexStr), intent, agentKey, freshness, wantDiff))
    );
    groupResults.forEach((result, i) => {
      const stepIndex = parseInt(stepsToRun[i]);
      if (result.status === 'fulfilled') {
        allResults[stepIndex] = result.value;
        runningCostUsd += result.value.cost;
        if (result.value.success && !result.value.cached) {
          if (result.value.endpointId.startsWith('skill:')) {
            // Agent service — credit cost was attached by optimizePlan
            const stepObj = intent.steps.find(s => s.endpointId === result.value.endpointId);
            runningCredits += (stepObj as any)?.creditCost ?? round6(result.value.cost * 1000);
          } else {
            const ep = findEndpoint(result.value.endpointId);
            runningCredits += ep ? creditCostForEndpoint(ep) : 1;
          }
        }
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
  const birthCertificates = steps
    .map(s => s.birthCertificate)
    .filter((c): c is BirthCertificate => c != null);

  // ─── Pulse Tree: append an ACTION leaf for every step (success + failure) ─
  // Failed steps must land on the tree with success=false so
  // trust-oracle.computeReliability sees real failure rates. Previously this
  // loop filtered to successful steps only, which made every agent look 100%
  // reliable regardless of actual outcome.
  if (agentKey) {
    try {
      const agentDid = resolveAgentDid(agentKey);
      for (const step of steps) {
        appendAction(agentDid, {
          endpointId: step.endpointId,
          success: step.success,
          durationMs: step.durationMs,
          cached: step.cached,
        }, step.cost);
      }
    } catch (err) {
      logger.warn({ err }, 'Pulse Tree append failed (non-fatal)');
    }
  }

  return {
    steps, totalCost, totalDurationMs: Date.now() - start,
    ...(birthCertificates.length > 0 && { birthCertificates }),
  };
}

// ─── Verified Computation for Data Fetches ─────────────────────────────────

/**
 * Issue a computation certificate for a data-fetch endpoint.
 * Runs commit-reveal + spot-check based on the endpoint's declared computationType.
 *
 * For raw API data fetches (most endpoints), the spot-check is economic-only since
 * we can't re-execute the upstream call. The certificate still proves:
 *   - Platform committed randomness before the fetch
 *   - Input params and output data are hash-bound
 *   - Birth cert (upstream provenance) is chained in
 *
 * Returns null if the type is unknown or cert creation fails.
 */
export function issueDataFetchCert(
  endpointId: string,
  computationType: string,
  params: Record<string, string>,
  data: unknown,
  birthCertificate?: BirthCertificate,
): ComputationCertificate | null {
  const compType = getComputationType(computationType);
  if (!compType) return null;

  // Step 1: Generate seed commitment (platform commits randomness)
  const { seed, commitment } = generateSeedCommitment();

  // Step 2: Hash input and output
  const inputHash = somaHashJson({ endpointId, params });
  const outputHash = somaHashJson(data);
  const outputCommitment = somaHash(outputHash);

  // Step 3: Run spot-check based on computation class
  // Raw API data fetches are economic-only — we can't re-execute the upstream call.
  // When endpoints perform transformations (sort, aggregate), their dedicated handlers
  // can call runVerifiedComputation() directly with the actual input/output arrays.
  const spotChecks: SpotCheckResult[] = [checkEconomicOnly(computationType)];

  // Step 4: Issue the certificate
  return createComputationCertificate({
    requestId: `fetch:${endpointId}:${Date.now()}`,
    computationType,
    computationClass: compType.class,
    inputHash,
    outputHash,
    seedCommitment: commitment,
    seed,
    outputCommitment,
    spotChecks,
    birthCertHash: birthCertificate?.dataHash ?? null,
  });
}