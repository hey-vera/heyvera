export interface Provider {
  id: string;
  name: string;
  slug: string;
  email: string;
  description?: string;
  websiteUrl?: string;
  status: string;
  tier: string;
  somaCheckTier: number;
  solanaWallet?: string;
  payoutWalletVerified?: boolean;
  somaPublicKey?: string;
  somaDiscoveryUrl?: string;
  createdAt: string;
}

export interface ProviderStats {
  totalCalls: number;
  totalCacheHits: number;
  totalRevenueUsdc: number;
  cacheHitRate: number;
  avgLatency: number;
}

export interface AnalyticsRow {
  date: string;
  calls: number;
  cacheHits: number;
  revenueCredits: number;
}

export interface ProviderEndpoint {
  id: string;
  name: string;
  description?: string;
  category: string;
  baseUrl?: string;
  path?: string;
  httpMethod: string;
  costPerCall: number;
  creditCost: number;
  cacheTtl?: number;
  enabled: boolean;
}

export interface SomaCheckEarnings {
  totals: {
    totalCalls: number;
    liveCalls: number;
    cacheHits: number;
    hitRate: number;
  };
  earnings: {
    liveCreditsEarned: number;
    cacheCreditsEarned: number;
    totalCreditsEarned: number;
  };
  savings: {
    agentCreditsSaved: number;
  };
  endpoints: Array<{
    endpointId: string;
    name: string;
    calls: number;
    cacheHits: number;
    hitRate: number;
    cacheCreditsEarned: number;
  }>;
}

export interface RevenueData {
  last30Days: {
    totalCredits: number;
    liveCredits: number;
    cacheCredits: number;
    platformFee: number;
  };
  lifetime: {
    totalCredits: number;
    liveCredits: number;
    cacheCredits: number;
  };
}

export interface WithdrawalRequest {
  id: string;
  providerId: string;
  amountCredits: number;
  amountUsd: number;
  status: 'pending' | 'approved' | 'completed' | 'rejected' | 'failed';
  txHash?: string;
  createdAt: string;
  completedAt?: string;
  reason?: string;
}

export interface WithdrawalsResponse {
  withdrawableCredits: number;
  payoutWallet: string | null;
  payoutWalletVerified: boolean;
  withdrawals: WithdrawalRequest[];
}
