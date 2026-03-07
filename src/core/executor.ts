import { isEndpointAvailable, recordSuccess, recordFailure } from './circuit-breaker';
import { ParsedIntent } from './intent-parser';
import { findEndpoint } from '../config/api-registry';
import { cacheGet, cacheSet, cacheKey } from '../cache/index';
import { env, isSimulationMode } from '../config/index';
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
    'claw-token-price': { priceUsd: 0.0234, change24h: 5.2, volume24h: 1200000, marketCap: 23400000, liquidity: 450000 },
    'claw-token-metadata': { name: 'Bonk', symbol: 'BONK', decimals: 5, totalSupply: 93700000000000, description: 'The first Solana dog coin' },
    'claw-token-holders': { totalHolders: 847293, top10Concentration: 23.4, top25Concentration: 38.1, topHolders: [] },
    'claw-token-risk': { riskScore: 28, riskLevel: 'low', flags: [], mintAuthority: false, freezeAuthority: false, lpLocked: true },
    'claw-wallet-portfolio': { totalValueUsd: 4823.12, solBalance: 12.4, tokens: [], nfts: [] },
    'claw-tx-history': { transactions: [], totalCount: 142, swapCount: 67, transferCount: 75 },
    'claw-trending-tokens': { tokens: [{ symbol: 'BONK', mintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', priceUsd: 0.0234 }], timestamp: new Date().toISOString() },
    'claw-x-mentions': { mentionCount: 1243, sentimentScore: 0.72, sentimentLabel: 'positive', topTweets: [], engagementTotal: 48200 },
    'claw-x-profile': { displayName: 'BONK', followers: 89200, following: 142, verified: false, bio: 'The first Solana dog coin', recentTweets: [] },
    'claw-linkedin-profile': { name: 'Founder Name', headline: 'Building in Web3', currentRole: 'CEO', company: 'SimToken', experience: [], education: [], connections: 500 },
    'claw-instagram-check': { exists: true, followers: 12400, posts: 89, verified: false, bio: 'Crypto project' },
    'claw-reddit-sentiment': { sentimentScore: 0.65, sentimentLabel: 'positive', postCount: 234, topPosts: [], subredditsSearched: ['solana', 'CryptoMoonShots'] },
    'claw-web-scrape': { title: 'Project Homepage', content: 'Sample scraped content...', links: [], images: [], wordCount: 842 },
    'claw-news-search': { articles: [{ title: 'BONK surges 50%', summary: 'The Solana meme coin saw massive gains...', url: '#' }], totalResults: 12, query: 'BONK' },
    'claw-wallet-risk': { riskScore: 15, riskLevel: 'low', flags: [], botProbability: 0.05, mixerInteractions: 0 },
  };
  return mocks[endpointId] ?? { result: 'mock data', endpointId };
}

async function callClawApi(endpointId: string, params: Record<string, string>): Promise<unknown> {
  const url = `${env.CLAWAPIS_BASE_URL}/${endpointId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CLAWAPIS_API_KEY}` },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`ClawAPIs error: ${response.status}`);
  return response.json();
}

function endpointToPath(endpointId: string): string {
  const map: Record<string, string> = {
    'claw-token-price':      '/solscan/token/price',
    'claw-token-metadata':   '/solscan/token/meta',
    'claw-token-holders':    '/solscan/token/holders',
    'claw-token-risk':       '/solscan/token/defi/activities',
    'claw-wallet-portfolio': '/solscan/account/token-accounts',
    'claw-tx-history':       '/solscan/account/transactions',
    'claw-trending-tokens':  '/solscan/token/trending',
    'claw-x-mentions':       '/x/2/tweets/search/recent',
    'claw-x-profile':        '/x/2/users/by/username',
    'claw-linkedin-profile': '/x/2/users/by/username',
    'claw-instagram-check':  '/x/2/users/by/username',
    'claw-reddit-sentiment': '/x/2/tweets/search/recent',
    'claw-web-scrape':       '/helius/v0/addresses',
    'claw-news-search':      '/x/2/tweets/search/recent',
    'claw-wallet-risk':      '/solscan/account/risk',
  };
  return map[endpointId] ?? '/solscan/token/meta';
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
    const data = isClawApisReady()
      ? await clawApiCall(endpointToPath(step.endpointId), step.params)
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