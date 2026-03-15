/**
 * @clawnet/sdk -- TypeScript client for ClawNet API
 *
 * Usage:
 *   import { ClawNet } from '@clawnet/sdk';
 *   const claw = new ClawNet({ apiKey: 'cn-xxxx' });
 *   const result = await claw.orchestrate('What is the price of SOL?');
 */

// ─── Error class ────────────────────────────────────────────────────────────────

export class ClawNetError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ClawNetError';
    this.status = status;
    this.code = code ?? 'UNKNOWN';
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ClawNetOptions {
  apiKey: string;
  baseUrl?: string;
  cache?: 'prefer' | 'fresh' | 'smart';
  diff?: boolean;
}

export interface OrchestrateResult {
  answer: string;
  steps: Array<{ endpoint: string; cached: boolean; creditCost: number }>;
  totalCredits: number;
  cached: boolean;
}

export interface EstimateResult {
  estimatedCredits: number;
  steps: Array<{ endpoint: string; creditCost: number }>;
  strategy: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  skill_type: string;
  credit_cost: number;
  tags: string[];
  avg_rating: number | null;
  invoke_count: number;
}

export interface InvokeResult {
  result: unknown;
  creditCost: number;
  cached: boolean;
  provider?: {
    verified: boolean;
    successRate: number;
    avgRating: number;
    reputationScore: number;
  };
}

export interface DiscoverResult {
  skills: Skill[];
  source: string;
}

export interface Recommendation {
  skillId: string;
  name: string;
  reason: string;
  score: number;
}

export interface Receipt {
  id: string;
  txId: string;
  amount: number;
  type: string;
  createdAt: string;
  requestHash?: string;
  resultHash?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  keyCount: number;
}

export interface TTLSuggestion {
  endpoint: string;
  currentTtl: number;
  suggestedTtl: number;
  reason: string;
}

export interface OnboardResult {
  apiKey: string;
  credits: number;
  message: string;
}

export interface Manifest {
  name: string;
  version: string;
  endpoints: Array<{ method: string; path: string; description: string }>;
}

// ─── Client ─────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://claw-net.org';

export class ClawNet {
  private apiKey: string;
  private baseUrl: string;
  private cache: 'prefer' | 'fresh' | 'smart';
  private diff: boolean;

  constructor(opts: ClawNetOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.cache = opts.cache ?? 'smart';
    this.diff = opts.diff ?? false;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string };
      throw new ClawNetError(res.status, err.error ?? 'Unknown error', err.code);
    }
    return res.json() as Promise<T>;
  }

  // ─── Core ───────────────────────────────────────────────────────────────────

  async orchestrate(
    query: string,
    pricing?: { maxCredits?: number; strategy?: string },
  ): Promise<OrchestrateResult> {
    return this.request<OrchestrateResult>('POST', '/v1/orchestrate', {
      query,
      pricing: { ...pricing, cache: this.cache, diff: this.diff },
    });
  }

  async estimate(query: string): Promise<EstimateResult> {
    return this.request<EstimateResult>('GET', `/v1/estimate?query=${encodeURIComponent(query)}`);
  }

  async getBalance(): Promise<{ credits: number; creditsUsed: number }> {
    return this.request<{ credits: number; creditsUsed: number }>('GET', '/v1/balance');
  }

  // ─── Skills ─────────────────────────────────────────────────────────────────

  async listSkills(filters?: { tag?: string; type?: string }): Promise<Skill[]> {
    const params = new URLSearchParams();
    if (filters?.tag) params.set('tag', filters.tag);
    if (filters?.type) params.set('type', filters.type);
    const qs = params.toString();
    return this.request<Skill[]>('GET', `/v1/skills${qs ? `?${qs}` : ''}`);
  }

  async invokeSkill(skillId: string, variables?: Record<string, string>): Promise<InvokeResult> {
    return this.request<InvokeResult>('POST', `/v1/skills/${encodeURIComponent(skillId)}/invoke`, {
      variables,
    });
  }

  async queryDataSkill(skillId: string, params?: Record<string, string>): Promise<unknown> {
    return this.request<unknown>('POST', `/v1/skills/${encodeURIComponent(skillId)}/query`, {
      params,
    });
  }

  // ─── Discovery ──────────────────────────────────────────────────────────────

  async discover(query: string): Promise<DiscoverResult> {
    return this.request<DiscoverResult>('GET', `/v1/discover?query=${encodeURIComponent(query)}`);
  }

  async getRecommendations(): Promise<Recommendation[]> {
    return this.request<Recommendation[]>('GET', '/v1/recommendations');
  }

  async getTrending(): Promise<Skill[]> {
    return this.request<Skill[]>('GET', '/v1/skills/trending');
  }

  // ─── Economy ────────────────────────────────────────────────────────────────

  async getReceipts(limit?: number): Promise<Receipt[]> {
    const qs = limit ? `?limit=${limit}` : '';
    return this.request<Receipt[]>('GET', `/v1/economy/receipts${qs}`);
  }

  async transferCredits(toKey: string, amount: number): Promise<void> {
    await this.request<unknown>('POST', '/v1/economy/transfer', { toKey, amount });
  }

  // ─── Cache ──────────────────────────────────────────────────────────────────

  async getCacheStats(): Promise<CacheStats> {
    return this.request<CacheStats>('GET', '/v1/cache/stats');
  }

  async getCacheOptimizer(): Promise<TTLSuggestion[]> {
    return this.request<TTLSuggestion[]>('GET', '/v1/cache/optimizer');
  }

  // ─── Static (no auth) ──────────────────────────────────────────────────────

  static async onboard(
    opts?: { name?: string; email?: string; referredBy?: string },
    baseUrl?: string,
  ): Promise<OnboardResult> {
    const url = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${url}/v1/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts ?? {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string };
      throw new ClawNetError(res.status, err.error ?? 'Unknown error', err.code);
    }
    return res.json() as Promise<OnboardResult>;
  }

  static async getManifest(baseUrl?: string): Promise<Manifest> {
    const url = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${url}/v1/manifest`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string };
      throw new ClawNetError(res.status, err.error ?? 'Unknown error', err.code);
    }
    return res.json() as Promise<Manifest>;
  }
}
