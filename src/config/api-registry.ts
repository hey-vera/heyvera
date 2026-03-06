export interface ApiEndpoint {
  id: string;
  provider: string;
  name: string;
  description: string;
  category: 'solana' | 'social' | 'utility';
  costPerCall: number;
  latencyMs: number;
  inputSchema: Record<string, string>;
  outputFields: string[];
  rateLimit?: number;
}

export const apiRegistry: ApiEndpoint[] = [
  // Solana/Crypto
  {
    id: 'claw-token-metadata',
    provider: 'ClawAPIs',
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
    name: 'Trending Tokens',
    description: 'Get currently trending Solana tokens by volume, new listings, or social mentions. No input required.',
    category: 'solana',
    costPerCall: 0.001,
    latencyMs: 400,
    inputSchema: { sortBy: 'volume | new | social (default: volume)', limit: 'Number of results (default 10)' },
    outputFields: ['tokens', 'timestamp'],
  },
  // Social/Sentiment
  {
    id: 'claw-x-mentions',
    provider: 'ClawAPIs',
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
    name: 'Reddit Sentiment',
    description: 'Analyze Reddit sentiment for a token or topic across relevant subreddits. Returns sentiment and top posts.',
    category: 'social',
    costPerCall: 0.002,
    latencyMs: 800,
    inputSchema: { query: 'Token symbol or topic to search', subreddits: 'Comma-separated subreddits (optional)' },
    outputFields: ['sentimentScore', 'sentimentLabel', 'postCount', 'topPosts', 'subredditsSearched'],
  },
  // Utility
  {
    id: 'claw-web-scrape',
    provider: 'ClawAPIs',
    name: 'Web Scrape',
    description: 'Scrape and extract clean text content from any public URL. Useful for reading whitepapers or project sites.',
    category: 'utility',
    costPerCall: 0.005,
    latencyMs: 2000,
    inputSchema: { url: 'Full URL to scrape (must be publicly accessible)' },
    outputFields: ['title', 'content', 'links', 'images', 'wordCount'],
  },
  {
    id: 'claw-news-search',
    provider: 'ClawAPIs',
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
    name: 'Wallet Risk Score',
    description: 'Analyze a Solana wallet for suspicious activity: wash trading, bot behavior, mixer interactions.',
    category: 'solana',
    costPerCall: 0.003,
    latencyMs: 900,
    inputSchema: { walletAddress: 'Solana wallet address (base58)' },
    outputFields: ['riskScore', 'riskLevel', 'flags', 'botProbability', 'mixerInteractions'],
  },
];

export function registryToPromptContext(): string {
  const lines: string[] = ['Available API endpoints:\n'];
  for (const ep of apiRegistry) {
    lines.push(`[${ep.id}] ${ep.name} (${ep.category})`);
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