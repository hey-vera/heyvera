export interface ApiEndpoint {
  id: string;
  provider: string;
  /** Base URL for the provider. Omit for ClawAPIs (default). */
  baseUrl?: string;
  /** API path on the provider. Omit only for legacy ClawAPIs endpoints. */
  path?: string;
  name: string;
  description: string;
  category: 'solana' | 'social' | 'utility' | 'defi' | 'intelligence' | 'oracle' | 'scraping' | 'discovery';
  costPerCall: number;
  latencyMs: number;
  inputSchema: Record<string, string>;
  outputFields: string[];
  rateLimit?: number;
}

export const apiRegistry: ApiEndpoint[] = [

  // ─── ClawAPIs (primary provider via clawapis.com) ──────────────────────────

  {
    id: 'claw-token-metadata',
    provider: 'ClawAPIs',
    path: '/solscan/token/meta',
    name: 'Token Metadata',
    description: 'Get full metadata for a Solana token: name, symbol, decimals, supply, logo, description, social links.',
    category: 'solana',
    costPerCall: 0.001,
    latencyMs: 300,
    inputSchema: { mintAddress: 'Solana token mint address (base58)' },
    outputFields: ['name', 'symbol', 'decimals', 'totalSupply', 'logoURI', 'description', 'website', 'twitter'],
  },
  {
    id: 'claw-token-price',
    provider: 'ClawAPIs',
    path: '/solscan/token/meta',
    name: 'Token Price',
    description: 'Get current USD price, 24h change, volume, and market cap for a Solana token.',
    category: 'solana',
    costPerCall: 0.001,
    latencyMs: 200,
    inputSchema: { mintAddress: 'Solana token mint address (base58)' },
    outputFields: ['priceUsd', 'change24h', 'volume24h', 'marketCap', 'liquidity'],
  },
  {
    id: 'claw-token-holders',
    provider: 'ClawAPIs',
    path: '/solscan/token/holders',
    name: 'Token Holders',
    description: 'Get top holders of a Solana token, holder count, and concentration metrics. Useful for detecting whale risk.',
    category: 'solana',
    costPerCall: 0.002,
    latencyMs: 500,
    inputSchema: { mintAddress: 'Solana token mint address (base58)', limit: 'Number of top holders to return (default 20)' },
    outputFields: ['totalHolders', 'topHolders', 'top10Concentration', 'top25Concentration'],
  },
  {
    id: 'claw-token-risk',
    provider: 'ClawAPIs',
    path: '/solscan/token/meta',
    name: 'Token Risk Score',
    description: 'AI-powered rug pull risk analysis for a Solana token. Returns risk score 0-100 and specific risk flags.',
    category: 'solana',
    costPerCall: 0.003,
    latencyMs: 800,
    inputSchema: { mintAddress: 'Solana token mint address (base58)' },
    outputFields: ['riskScore', 'riskLevel', 'flags', 'mintAuthority', 'freezeAuthority', 'lpLocked'],
  },
  {
    id: 'claw-wallet-portfolio',
    provider: 'ClawAPIs',
    path: '/solscan/account/portfolio',
    name: 'Wallet Portfolio',
    description: 'Get all token holdings and their USD values for a Solana wallet address.',
    category: 'solana',
    costPerCall: 0.002,
    latencyMs: 600,
    inputSchema: { walletAddress: 'Solana wallet address (base58)' },
    outputFields: ['totalValueUsd', 'tokens', 'nfts', 'solBalance'],
  },
  {
    id: 'claw-tx-history',
    provider: 'ClawAPIs',
    path: '/solscan/account/transactions',
    name: 'Transaction History',
    description: 'Get recent transaction history for a Solana wallet. Shows swaps, transfers, and interactions.',
    category: 'solana',
    costPerCall: 0.002,
    latencyMs: 700,
    inputSchema: { walletAddress: 'Solana wallet address (base58)', limit: 'Number of transactions (default 20)' },
    outputFields: ['transactions', 'totalCount', 'swapCount', 'transferCount'],
  },
  {
    id: 'claw-trending-tokens',
    provider: 'ClawAPIs',
    path: '/solscan/token/trending',
    name: 'Trending Tokens',
    description: 'Get currently trending Solana tokens by volume, new listings, or social mentions. No input required.',
    category: 'solana',
    costPerCall: 0.001,
    latencyMs: 400,
    inputSchema: { sortBy: 'volume | new | social (default: volume)', limit: 'Number of results (default 10)' },
    outputFields: ['tokens', 'timestamp'],
  },
  {
    id: 'claw-x-mentions',
    provider: 'ClawAPIs',
    path: '/x/2/tweets/search/recent',
    name: 'X/Twitter Mentions',
    description: 'Get recent X/Twitter mentions, sentiment score, and engagement metrics for a token or topic.',
    category: 'social',
    costPerCall: 0.002,
    latencyMs: 600,
    inputSchema: { query: 'Token symbol, name, or search query', limit: 'Number of tweets (default 20)' },
    outputFields: ['mentionCount', 'sentimentScore', 'sentimentLabel', 'topTweets', 'engagementTotal'],
  },
  {
    id: 'claw-x-profile',
    provider: 'ClawAPIs',
    path: '/x/2/users/by/username',
    name: 'X/Twitter Profile',
    description: 'Get X/Twitter profile data for a username: followers, following, recent tweets, verification status.',
    category: 'social',
    costPerCall: 0.001,
    latencyMs: 400,
    inputSchema: { username: 'X/Twitter username without @' },
    outputFields: ['displayName', 'followers', 'following', 'verified', 'bio', 'recentTweets'],
  },
  {
    id: 'claw-linkedin-profile',
    provider: 'ClawAPIs',
    path: '/x/2/users/by/username',
    name: 'LinkedIn Profile',
    description: 'Get public LinkedIn profile data for a person: job history, education, skills, connections.',
    category: 'social',
    costPerCall: 0.003,
    latencyMs: 1000,
    inputSchema: { profileUrl: 'LinkedIn profile URL or username' },
    outputFields: ['name', 'headline', 'currentRole', 'company', 'experience', 'education', 'connections'],
  },
  {
    id: 'claw-instagram-check',
    provider: 'ClawAPIs',
    path: '/x/2/users/by/username',
    name: 'Instagram Profile Check',
    description: 'Check if an Instagram account exists and get basic public metrics: followers, posts, verification.',
    category: 'social',
    costPerCall: 0.001,
    latencyMs: 500,
    inputSchema: { username: 'Instagram username without @' },
    outputFields: ['exists', 'followers', 'posts', 'verified', 'bio'],
  },
  {
    id: 'claw-reddit-sentiment',
    provider: 'ClawAPIs',
    path: '/x/2/tweets/search/recent',
    name: 'Reddit Sentiment',
    description: 'Analyze Reddit sentiment for a token or topic across relevant subreddits. Returns sentiment and top posts.',
    category: 'social',
    costPerCall: 0.002,
    latencyMs: 800,
    inputSchema: { query: 'Token symbol or topic to search', subreddits: 'Comma-separated subreddits (optional)' },
    outputFields: ['sentimentScore', 'sentimentLabel', 'postCount', 'topPosts', 'subredditsSearched'],
  },
  {
    id: 'claw-web-scrape',
    provider: 'ClawAPIs',
    path: '/solscan/token/list',
    name: 'Web Scrape',
    description: 'Scrape and extract clean text content from any public URL. Useful for reading whitepapers or project sites.',
    category: 'scraping',
    costPerCall: 0.005,
    latencyMs: 2000,
    inputSchema: { url: 'Full URL to scrape (must be publicly accessible)' },
    outputFields: ['title', 'content', 'links', 'images', 'wordCount'],
  },
  {
    id: 'claw-news-search',
    provider: 'ClawAPIs',
    path: '/x/2/tweets/search/recent',
    name: 'News Search',
    description: 'Search recent crypto and web3 news articles for a token, project, or topic. Returns headlines and summaries.',
    category: 'utility',
    costPerCall: 0.002,
    latencyMs: 600,
    inputSchema: { query: 'Search query (token name, project, topic)', limit: 'Number of articles (default 5)' },
    outputFields: ['articles', 'totalResults', 'query'],
  },
  {
    id: 'claw-wallet-risk',
    provider: 'ClawAPIs',
    path: '/solscan/account/detail',
    name: 'Wallet Risk Score',
    description: 'Analyze a Solana wallet for suspicious activity: wash trading, bot behavior, mixer interactions.',
    category: 'solana',
    costPerCall: 0.003,
    latencyMs: 900,
    inputSchema: { walletAddress: 'Solana wallet address (base58)' },
    outputFields: ['riskScore', 'riskLevel', 'flags', 'botProbability', 'mixerInteractions'],
  },

  // ─── CoinGecko x402 ────────────────────────────────────────────────────────
  // Experimental x402 endpoints — no API key required, pay-per-request
  {
    id: 'coingecko-price',
    provider: 'CoinGecko',
    baseUrl: 'https://pro-api.coingecko.com',
    path: '/api/v3/x402/simple/price',
    name: 'CoinGecko Token Price',
    description: 'Get authoritative crypto prices and market data for any token via CoinGecko x402. Supports multi-currency.',
    category: 'oracle',
    costPerCall: 0.001,
    latencyMs: 300,
    inputSchema: { ids: 'CoinGecko token ID (e.g. bitcoin, ethereum, solana)', vs_currencies: 'Currency codes (e.g. usd,eur)' },
    outputFields: ['price', 'market_cap', 'volume_24h', 'price_change_24h'],
  },
  {
    id: 'coingecko-coin-data',
    provider: 'CoinGecko',
    baseUrl: 'https://pro-api.coingecko.com',
    path: '/api/v3/x402/coins/markets',
    name: 'CoinGecko Market Data',
    description: 'Comprehensive market data for any cryptocurrency: price, volume, market cap, ATH, sparkline from CoinGecko.',
    category: 'oracle',
    costPerCall: 0.002,
    latencyMs: 500,
    inputSchema: { vs_currency: 'Quote currency (usd)', ids: 'CoinGecko IDs (comma-separated)', order: 'market_cap_desc | volume_desc' },
    outputFields: ['id', 'symbol', 'name', 'current_price', 'market_cap', 'total_volume', 'price_change_percentage_24h', 'ath'],
  },

  // ─── Rug Munch Intelligence ────────────────────────────────────────────────
  // 19 x402-paid endpoints for crypto risk intelligence
  {
    id: 'rugmunch-risk',
    provider: 'Rug Munch',
    baseUrl: 'https://cryptorugmunch.app',
    path: '/api/risk',
    name: 'Rug Munch Risk Score',
    description: 'AI-powered rug pull and scam risk score for any crypto token. Analyzes contract, holders, liquidity, and social signals.',
    category: 'intelligence',
    costPerCall: 0.003,
    latencyMs: 1000,
    inputSchema: { address: 'Token contract address', chain: 'Chain (solana | ethereum | base)' },
    outputFields: ['riskScore', 'riskLevel', 'flags', 'recommendation'],
  },
  {
    id: 'rugmunch-honeypot',
    provider: 'Rug Munch',
    baseUrl: 'https://cryptorugmunch.app',
    path: '/api/honeypot',
    name: 'Honeypot Detection',
    description: 'Detect if a token is a honeypot (cannot be sold after purchase). Returns simulation results and buy/sell tax.',
    category: 'intelligence',
    costPerCall: 0.002,
    latencyMs: 800,
    inputSchema: { address: 'Token contract address', chain: 'Chain (ethereum | base | solana)' },
    outputFields: ['isHoneypot', 'buyTax', 'sellTax', 'cannotSell', 'simulationResult'],
  },
  {
    id: 'rugmunch-holder-analysis',
    provider: 'Rug Munch',
    baseUrl: 'https://cryptorugmunch.app',
    path: '/api/holders',
    name: 'Holder Distribution Analysis',
    description: 'Deep holder concentration analysis: whale wallets, dev holdings, bundled wallets, and sybil patterns.',
    category: 'intelligence',
    costPerCall: 0.003,
    latencyMs: 1200,
    inputSchema: { address: 'Token contract address', chain: 'Chain identifier' },
    outputFields: ['holderCount', 'top10Pct', 'devWallets', 'bundledWallets', 'sybilRisk'],
  },

  // ─── Einstein AI ──────────────────────────────────────────────────────────
  // Blockchain intelligence: whale tracking, DEX analytics, MEV
  {
    id: 'einstein-whales',
    provider: 'Einstein AI',
    baseUrl: 'https://emc2ai.io',
    path: '/api/whales',
    name: 'Whale Tracking',
    description: 'Track smart money and whale wallets. See large token movements, accumulation patterns, and notable wallet activity.',
    category: 'intelligence',
    costPerCall: 0.004,
    latencyMs: 1000,
    inputSchema: { address: 'Token or wallet address', chain: 'Chain (ethereum | solana | base)', limit: 'Number of whale txns (default 10)' },
    outputFields: ['whaleMovements', 'netFlow', 'accumulators', 'distributors', 'smartMoneySignal'],
  },
  {
    id: 'einstein-dex',
    provider: 'Einstein AI',
    baseUrl: 'https://emc2ai.io',
    path: '/api/dex',
    name: 'DEX Analytics',
    description: 'Real-time DEX analytics: top pools, swap volumes, liquidity depth, price impact, and MEV activity for any token.',
    category: 'defi',
    costPerCall: 0.003,
    latencyMs: 800,
    inputSchema: { address: 'Token address', chain: 'Chain identifier', dex: 'DEX name (uniswap | raydium | jupiter — optional)' },
    outputFields: ['topPools', 'volume24h', 'liquidity', 'priceImpact', 'mevActivity'],
  },
  {
    id: 'einstein-mev',
    provider: 'Einstein AI',
    baseUrl: 'https://emc2ai.io',
    path: '/api/mev',
    name: 'MEV Detection',
    description: 'Detect MEV (sandwich attacks, frontrunning, arbitrage) targeting a specific token or transaction.',
    category: 'intelligence',
    costPerCall: 0.003,
    latencyMs: 900,
    inputSchema: { address: 'Token address or tx hash', chain: 'Chain identifier' },
    outputFields: ['mevDetected', 'attackType', 'victimLoss', 'attackerProfit', 'recentAttacks'],
  },

  // ─── Apollo Intelligence Network ──────────────────────────────────────────
  // 27 x402 endpoints: crypto prices, OSINT, DeFi yields, X search, proxies
  {
    id: 'apollo-prices',
    provider: 'Apollo Intelligence',
    baseUrl: 'https://apolloai.team',
    path: '/api/prices',
    name: 'Apollo Crypto Prices',
    description: 'Multi-source aggregated crypto prices with confidence scores and source attribution.',
    category: 'oracle',
    costPerCall: 0.001,
    latencyMs: 300,
    inputSchema: { symbols: 'Comma-separated token symbols (e.g. BTC,ETH,SOL)', currency: 'Quote currency (default: usd)' },
    outputFields: ['prices', 'sources', 'confidence', 'timestamp'],
  },
  {
    id: 'apollo-osint',
    provider: 'Apollo Intelligence',
    baseUrl: 'https://apolloai.team',
    path: '/api/osint',
    name: 'Apollo OSINT',
    description: 'OSINT intelligence on wallets, tokens, teams, and projects. Cross-references on-chain data with off-chain sources.',
    category: 'intelligence',
    costPerCall: 0.005,
    latencyMs: 1500,
    inputSchema: { target: 'Wallet address, token symbol, or project name', depth: 'shallow | deep (default: shallow)' },
    outputFields: ['entityType', 'associations', 'riskFlags', 'socialProfiles', 'onChainActivity'],
  },
  {
    id: 'apollo-defi-yields',
    provider: 'Apollo Intelligence',
    baseUrl: 'https://apolloai.team',
    path: '/api/yields',
    name: 'DeFi Yield Scanner',
    description: 'Scan top DeFi protocols for yield opportunities: APY, TVL, risk score, and impermanent loss estimates.',
    category: 'defi',
    costPerCall: 0.002,
    latencyMs: 600,
    inputSchema: { chain: 'Chain (ethereum | solana | base | all)', minApy: 'Minimum APY % filter (default 5)', token: 'Token to include (optional)' },
    outputFields: ['opportunities', 'bestApy', 'totalTvl', 'riskAdjustedYield'],
  },

  // ─── DiamondClaws DeFi Intelligence ───────────────────────────────────────
  // DeFi yield scoring, protocol risk, multi-chain gas oracles
  {
    id: 'diamondclaws-yield',
    provider: 'DiamondClaws',
    baseUrl: 'https://diamondclaws.xyz',
    path: '/api/yield',
    name: 'DeFi Yield Score',
    description: 'Risk-adjusted yield scoring for DeFi positions. Accounts for protocol risk, impermanent loss, and emission sustainability.',
    category: 'defi',
    costPerCall: 0.002,
    latencyMs: 700,
    inputSchema: { protocol: 'Protocol name or address', chain: 'Chain identifier', pool: 'Pool address or name (optional)' },
    outputFields: ['yieldScore', 'apy', 'riskAdjustedApy', 'impermanentLossRisk', 'sustainabilityScore'],
  },
  {
    id: 'diamondclaws-protocol-risk',
    provider: 'DiamondClaws',
    baseUrl: 'https://diamondclaws.xyz',
    path: '/api/protocol-risk',
    name: 'Protocol Risk Analysis',
    description: 'Security and risk analysis for DeFi protocols: audit history, TVL risk, centralization, and exploit probability.',
    category: 'defi',
    costPerCall: 0.003,
    latencyMs: 900,
    inputSchema: { protocol: 'Protocol name or contract address', chain: 'Chain identifier' },
    outputFields: ['riskScore', 'auditStatus', 'tvl', 'centralizationRisk', 'exploitHistory'],
  },
  {
    id: 'diamondclaws-gas',
    provider: 'DiamondClaws',
    baseUrl: 'https://diamondclaws.xyz',
    path: '/api/gas',
    name: 'Multi-Chain Gas Oracle',
    description: 'Real-time gas price oracle across Ethereum, Base, Arbitrum, Solana. Returns slow/standard/fast estimates.',
    category: 'oracle',
    costPerCall: 0.001,
    latencyMs: 200,
    inputSchema: { chain: 'Chain (ethereum | base | arbitrum | solana | all)' },
    outputFields: ['slow', 'standard', 'fast', 'unit', 'blockTime', 'baseFee'],
  },

  // ─── Elsa Finance ─────────────────────────────────────────────────────────
  // DeFi portfolio data, token prices, swap quotes, wallet analytics
  {
    id: 'elsa-portfolio',
    provider: 'Elsa Finance',
    baseUrl: 'https://elsa.finance',
    path: '/api/portfolio',
    name: 'DeFi Portfolio Overview',
    description: 'Complete DeFi portfolio snapshot: token balances, LP positions, staking rewards, and total value across chains.',
    category: 'defi',
    costPerCall: 0.003,
    latencyMs: 800,
    inputSchema: { wallet: 'Wallet address', chains: 'Chains to include (comma-separated, default: all)' },
    outputFields: ['totalValueUsd', 'tokens', 'lpPositions', 'stakingRewards', 'chainBreakdown'],
  },
  {
    id: 'elsa-swap-quote',
    provider: 'Elsa Finance',
    baseUrl: 'https://elsa.finance',
    path: '/api/swap-quote',
    name: 'Swap Quote',
    description: 'Best available swap quote across DEX aggregators. Returns price, slippage, fees, and optimal route.',
    category: 'defi',
    costPerCall: 0.002,
    latencyMs: 600,
    inputSchema: { fromToken: 'Source token address', toToken: 'Destination token address', amount: 'Amount to swap', chain: 'Chain identifier' },
    outputFields: ['expectedOut', 'priceImpact', 'fees', 'route', 'bestDex', 'slippagePct'],
  },

  // ─── SLAMai Smart Money ────────────────────────────────────────────────────
  // Smart-money intelligence on Base and Ethereum with MCP layer
  {
    id: 'slamai-signals',
    provider: 'SLAMai',
    baseUrl: 'https://slamai.io',
    path: '/api/signals',
    name: 'Smart Money Signals',
    description: 'Track smart money wallets and their recent positions. Identifies accumulation, exits, and alpha signals before they hit retail.',
    category: 'intelligence',
    costPerCall: 0.004,
    latencyMs: 900,
    inputSchema: { token: 'Token address or symbol', chain: 'Chain (ethereum | base)', lookback: 'Hours to look back (default 24)' },
    outputFields: ['smartMoneyNet', 'topBuyers', 'topSellers', 'signal', 'confidence'],
  },

  // ─── Automaton Oracle ─────────────────────────────────────────────────────
  // Sovereign crypto intelligence: prices, macro, pump.fun radar, signals
  {
    id: 'automaton-price',
    provider: 'Automaton Oracle',
    baseUrl: 'https://automaton-oracle.xyz',
    path: '/api/price',
    name: 'Automaton Price Feed',
    description: 'Sovereign crypto price feed with macro overlay. Returns price, trend, and macro context for any token.',
    category: 'oracle',
    costPerCall: 0.001,
    latencyMs: 300,
    inputSchema: { symbol: 'Token symbol (e.g. BTC, SOL)', currency: 'Quote currency (default: usd)' },
    outputFields: ['price', 'change24h', 'trend', 'macroContext', 'confidence'],
  },
  {
    id: 'automaton-signals',
    provider: 'Automaton Oracle',
    baseUrl: 'https://automaton-oracle.xyz',
    path: '/api/signals',
    name: 'Trading Signals',
    description: 'AI-generated trading signals with entry/exit points, risk levels, and reasoning for any crypto asset.',
    category: 'intelligence',
    costPerCall: 0.005,
    latencyMs: 1200,
    inputSchema: { symbol: 'Token symbol', timeframe: 'Timeframe (1h | 4h | 1d | 1w)' },
    outputFields: ['signal', 'direction', 'entryPrice', 'targets', 'stopLoss', 'confidence', 'reasoning'],
  },
  {
    id: 'automaton-pump-radar',
    provider: 'Automaton Oracle',
    baseUrl: 'https://automaton-oracle.xyz',
    path: '/api/pump-radar',
    name: 'Pump.fun Radar',
    description: 'Real-time pump.fun token radar: new launches, graduation candidates, and early-stage opportunity scoring.',
    category: 'intelligence',
    costPerCall: 0.002,
    latencyMs: 600,
    inputSchema: { filter: 'all | graduating | new | trending (default: trending)', limit: 'Number of results (default 20)' },
    outputFields: ['tokens', 'graduationCandidates', 'newLaunches', 'trendingNow'],
  },

  // ─── Crysha Price Oracle ──────────────────────────────────────────────────
  // Aggregated crypto price oracle with x402 micropayments
  {
    id: 'crysha-price',
    provider: 'Crysha',
    baseUrl: 'https://api.crysha.com',
    path: '/price',
    name: 'Crysha Aggregated Price',
    description: 'Aggregated crypto price oracle pulling from multiple exchanges. Returns VWAP price with source breakdown.',
    category: 'oracle',
    costPerCall: 0.001,
    latencyMs: 250,
    inputSchema: { symbol: 'Token symbol (e.g. BTC, ETH, SOL)', exchange: 'Exchange filter (optional, default: all)' },
    outputFields: ['price', 'vwap', 'sources', 'spread', 'timestamp'],
  },

  // ─── twit.sh (Real-time X/Twitter) ────────────────────────────────────────
  // Real-time Twitter/X data for AI agents, no signup required
  {
    id: 'twitsh-search',
    provider: 'twit.sh',
    baseUrl: 'https://twit.sh',
    path: '/api/search',
    name: 'Real-time X Search',
    description: 'Real-time Twitter/X search with no API key required. Returns tweets, engagement metrics, and sentiment.',
    category: 'social',
    costPerCall: 0.002,
    latencyMs: 600,
    inputSchema: { query: 'Search query or cashtag (e.g. $SOL or "solana")', limit: 'Max results (default 20)', lang: 'Language filter (optional, e.g. en)' },
    outputFields: ['tweets', 'mentionCount', 'engagementTotal', 'sentimentScore', 'topAccounts'],
  },
  {
    id: 'twitsh-user',
    provider: 'twit.sh',
    baseUrl: 'https://twit.sh',
    path: '/api/user',
    name: 'X User Profile',
    description: 'Real-time X/Twitter user profile data: followers, following, bio, recent tweets, and engagement rate.',
    category: 'social',
    costPerCall: 0.001,
    latencyMs: 400,
    inputSchema: { username: 'X/Twitter username without @' },
    outputFields: ['displayName', 'followers', 'following', 'bio', 'verified', 'recentTweets', 'engagementRate'],
  },

  // ─── Gloria AI (News Intelligence) ────────────────────────────────────────
  // Real-time, structured, high-signal news data for AI agents
  {
    id: 'gloria-news',
    provider: 'Gloria AI',
    baseUrl: 'https://gloriaai.xyz',
    path: '/api/news',
    name: 'Crypto News Feed',
    description: 'High-signal crypto news with AI-generated summaries, sentiment scores, and market impact assessment.',
    category: 'utility',
    costPerCall: 0.002,
    latencyMs: 500,
    inputSchema: { query: 'Topic, token name, or keyword', limit: 'Number of articles (default 10)', sentiment: 'Filter by sentiment: positive | negative | neutral (optional)' },
    outputFields: ['articles', 'topHeadlines', 'sentimentBreakdown', 'marketImpact'],
  },

  // ─── Olostep (Web Scraping + Answers) ─────────────────────────────────────
  // Pay-per-use x402 access for maps, scrapes, crawls, and answers
  {
    id: 'olostep-scrape',
    provider: 'Olostep',
    baseUrl: 'https://api.olostep.com',
    path: '/x402/scrape',
    name: 'Web Page Scrape',
    description: 'Extract clean, LLM-ready content from any web page. Returns markdown text, structured data, and metadata.',
    category: 'scraping',
    costPerCall: 0.003,
    latencyMs: 1500,
    inputSchema: { url: 'Full URL to scrape', format: 'markdown | html | json (default: markdown)', waitFor: 'CSS selector to wait for (optional)' },
    outputFields: ['content', 'title', 'metadata', 'links', 'wordCount'],
  },
  {
    id: 'olostep-answers',
    provider: 'Olostep',
    baseUrl: 'https://api.olostep.com',
    path: '/x402/answers',
    name: 'Web Answers',
    description: 'Ask a question and get an AI answer grounded in live web data. Returns answer with source citations.',
    category: 'utility',
    costPerCall: 0.008,
    latencyMs: 3000,
    inputSchema: { question: 'Question to answer using live web data', context: 'Additional context (optional)' },
    outputFields: ['answer', 'sources', 'confidence', 'relatedQuestions'],
  },

  // ─── Minifetch (Token-efficient Web Summaries) ─────────────────────────────
  // Structured metadata and token-efficient summaries via micropayments
  {
    id: 'minifetch-summary',
    provider: 'Minifetch',
    baseUrl: 'https://minifetch.dev',
    path: '/api/summary',
    name: 'Web Page Summary',
    description: 'Fetch structured metadata and a token-efficient AI summary from any URL. Ideal for whitepapers and project sites.',
    category: 'scraping',
    costPerCall: 0.002,
    latencyMs: 1000,
    inputSchema: { url: 'Full URL to summarize', maxTokens: 'Max summary tokens (default 200)', focus: 'Key aspect to focus on (optional)' },
    outputFields: ['summary', 'title', 'description', 'keywords', 'ogImage', 'publishDate'],
  },

  // ─── Pylon API Gateway ────────────────────────────────────────────────────
  // x402-payable utility gateway: web extraction, search, translation, code
  {
    id: 'pylon-search',
    provider: 'Pylon',
    baseUrl: 'https://pylonapi.com',
    path: '/api/search',
    name: 'Pylon Web Search',
    description: 'Real-time web search with structured results. Returns titles, URLs, snippets, and AI-summarized answer.',
    category: 'utility',
    costPerCall: 0.003,
    latencyMs: 800,
    inputSchema: { query: 'Search query', limit: 'Number of results (default 10)', lang: 'Language (default: en)' },
    outputFields: ['results', 'answer', 'relatedSearches', 'totalResults'],
  },
  {
    id: 'pylon-extract',
    provider: 'Pylon',
    baseUrl: 'https://pylonapi.com',
    path: '/api/extract',
    name: 'Pylon Web Extraction',
    description: 'Structured data extraction from any URL using AI. Returns clean text, tables, prices, and entities.',
    category: 'scraping',
    costPerCall: 0.004,
    latencyMs: 1200,
    inputSchema: { url: 'URL to extract from', schema: 'Data schema to extract (optional JSON schema)', type: 'text | structured | auto (default: auto)' },
    outputFields: ['text', 'structured', 'entities', 'tables', 'confidence'],
  },

  // ─── Browserbase (Pay-per-use Browser Sessions) ────────────────────────────
  // Full browser sessions for JS-heavy sites and dynamic content
  {
    id: 'browserbase-session',
    provider: 'Browserbase',
    baseUrl: 'https://x402.browserbase.com',
    path: '/v1/sessions',
    name: 'Browser Session',
    description: 'Spin up a managed browser session to interact with JS-heavy sites, login walls, and dynamic content.',
    category: 'scraping',
    costPerCall: 0.010,
    latencyMs: 3000,
    inputSchema: { url: 'Starting URL for the browser session', timeout: 'Session timeout in seconds (default 30)', action: 'Action to perform (screenshot | scrape | interact)' },
    outputFields: ['sessionId', 'screenshot', 'content', 'cookies', 'networkRequests'],
  },

  // ─── BlackSwan Risk Intelligence ──────────────────────────────────────────
  // Real-time risk intelligence infrastructure for autonomous AI agents
  {
    id: 'blackswan-risk',
    provider: 'BlackSwan',
    baseUrl: 'https://blackswan.wtf',
    path: '/api/risk',
    name: 'BlackSwan Risk Intelligence',
    description: 'Real-time tail risk and black swan event detection for crypto markets. Returns systemic risk score and early warning signals.',
    category: 'intelligence',
    costPerCall: 0.005,
    latencyMs: 1000,
    inputSchema: { asset: 'Asset symbol or address', timeframe: 'Risk horizon (1h | 24h | 7d)', chain: 'Chain identifier (optional)' },
    outputFields: ['riskScore', 'riskLevel', 'earlyWarnings', 'systemicRisk', 'correlations'],
  },

  // ─── Moltalyzer ───────────────────────────────────────────────────────────
  // Community digests, GitHub trending, Polymarket, token intelligence
  {
    id: 'moltalyzer-token-intel',
    provider: 'Moltalyzer',
    baseUrl: 'https://moltalyzer.xyz',
    path: '/api/token',
    name: 'Moltalyzer Token Intelligence',
    description: 'Aggregated token intelligence: community digest, GitHub activity, Polymarket odds, and AI-generated outlook.',
    category: 'intelligence',
    costPerCall: 0.003,
    latencyMs: 900,
    inputSchema: { token: 'Token symbol or address', include: 'community | github | polymarket | all (default: all)' },
    outputFields: ['communityDigest', 'githubActivity', 'polymarketOdds', 'outlook', 'sentimentScore'],
  },

  // ─── CrossFin (Korean Market Intelligence) ────────────────────────────────
  // Korean market: Kimchi premium, exchanges, FX, headlines, signals
  {
    id: 'crossfin-kimchi',
    provider: 'CrossFin',
    baseUrl: 'https://crossfin.dev',
    path: '/api/kimchi',
    name: 'Kimchi Premium',
    description: 'Korean crypto Kimchi premium index — price differential between Korean exchanges and global market. Key arbitrage signal.',
    category: 'oracle',
    costPerCall: 0.002,
    latencyMs: 400,
    inputSchema: { symbol: 'Token symbol (e.g. BTC, ETH)', exchange: 'Korean exchange (upbit | bithumb | all, default: all)' },
    outputFields: ['kimchiPremium', 'koreanPrice', 'globalPrice', 'spread', 'trend'],
  },

  // ─── Messari ──────────────────────────────────────────────────────────────
  // Pay-per-request Messari data: AI, funds, organizations, projects, markets
  {
    id: 'messari-asset',
    provider: 'Messari',
    baseUrl: 'https://api.messari.io',
    path: '/api/v1/assets',
    name: 'Messari Asset Data',
    description: 'Comprehensive asset data from Messari research: fundamentals, market data, investor info, and qualitative analysis.',
    category: 'intelligence',
    costPerCall: 0.004,
    latencyMs: 800,
    inputSchema: { symbol: 'Token symbol or name', fields: 'Fields to include (optional, comma-separated)' },
    outputFields: ['name', 'symbol', 'category', 'sector', 'marketcap', 'volume', 'fundamentals', 'investors'],
  },

  // ─── x402 Service Discovery ────────────────────────────────────────────────
  // Enriched x402 service directory with trust signals and health scores
  {
    id: 'x402-discover',
    provider: 'x402 Discovery API',
    baseUrl: 'https://x402-discovery-api.onrender.com',
    path: '/services',
    name: 'x402 Service Discovery',
    description: 'Search the x402 service registry for APIs matching a capability. Returns ranked list with uptime, latency, and trust scores.',
    category: 'discovery',
    costPerCall: 0.001,
    latencyMs: 500,
    inputSchema: { query: 'Capability or service type to search (e.g. "price oracle" or "web scraping")', chain: 'Payment chain filter (solana | base | all)' },
    outputFields: ['services', 'totalFound', 'bestMatch', 'averageUptime', 'averageLatency'],
  },
  {
    id: 'x402-route',
    provider: 'x402 RouteNet',
    baseUrl: 'https://x402-routenet.onrender.com',
    path: '/route',
    name: 'x402 Smart Route',
    description: 'Smart routing layer for x402 services. Given a capability, returns the best/cheapest/fastest provider.',
    category: 'discovery',
    costPerCall: 0.001,
    latencyMs: 400,
    inputSchema: { capability: 'Capability needed (e.g. token price, web scrape)', strategy: 'best | cheapest | fastest | most_trusted (default: best)' },
    outputFields: ['selectedProvider', 'endpoint', 'estimatedCost', 'estimatedLatency', 'alternatives'],
  },

  // ─── PayAI Facilitator ────────────────────────────────────────────────────
  // Solana-first, multi-network x402 facilitator and discovery
  {
    id: 'payai-discovery',
    provider: 'PayAI',
    baseUrl: 'https://facilitator.payai.network',
    path: '/discovery/resources',
    name: 'PayAI Resource Discovery',
    description: 'Discover x402-compatible API resources across all supported networks from the PayAI facilitator.',
    category: 'discovery',
    costPerCall: 0.001,
    latencyMs: 500,
    inputSchema: { network: 'Filter by network (solana | base | ethereum | all)', category: 'Resource category filter (optional)' },
    outputFields: ['resources', 'totalCount', 'networks', 'categories'],
  },
];

export function registryToPromptContext(): string {
  const lines: string[] = ['Available API endpoints:\n'];
  for (const ep of apiRegistry) {
    lines.push(`[${ep.id}] ${ep.name} (${ep.category}) — Provider: ${ep.provider}`);
    lines.push(`  Description: ${ep.description}`);
    lines.push(`  Cost: $${ep.costPerCall} | Latency: ~${ep.latencyMs}ms`);
    lines.push(`  Inputs: ${JSON.stringify(ep.inputSchema)}`);
    lines.push(`  Outputs: ${ep.outputFields.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function findEndpoint(id: string): ApiEndpoint | undefined {
  return apiRegistry.find((ep) => ep.id === id);
}

export function findByCategory(category: ApiEndpoint['category']): ApiEndpoint[] {
  return apiRegistry.filter((ep) => ep.category === category);
}

export function findByProvider(provider: string): ApiEndpoint[] {
  return apiRegistry.filter((ep) => ep.provider.toLowerCase().includes(provider.toLowerCase()));
}
