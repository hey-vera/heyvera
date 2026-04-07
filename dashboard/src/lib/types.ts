// --- Customer types (from /v1/dashboard/me) ---

export interface DashboardMe {
  hasKey: boolean;
  maskedKey?: string;
  email?: string;
  credits?: number;
  creditsUsed?: number;
  memberSince?: string;
  stats?: KeyStats;
  cacheStats?: CacheStats;
  signal?: SignalData;
}

export interface KeyStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  creditsSpent: number;
  skillPurchases: number;
  skillCreditsSpent: number;
}

export interface CacheStats {
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  creditsSaved: number;
  savingsUsd: number;
}

export interface SignalData {
  balance: number;
  history: Array<{ action: string; amount: number; createdAt: string }>;
  vault: { totalLocked: number; locks: VaultLock[] };
}

export interface VaultLock {
  id: string;
  creditsLocked: number;
  lockDays: number;
  multiplier: number;
  status: string;
  createdAt: string;
  unlocksAt: string;
}

export interface TaskRow {
  id: string;
  skill_name?: string;
  status: string;
  credits_cost: number;
  duration_ms?: number;
  created_at: string;
}

export interface UsageBreakdown {
  tasks: { total: number; completed: number; failed: number; creditsSpent: number };
  skills: { purchases: number; creditsSpent: number };
}

export interface SomaReceipt {
  id: string;
  paymentMethod: string;
  creditsPurchased: number;
  createdAt: string;
  anchored: boolean;
  somaVerified: boolean;
}

// --- Admin types ---

export interface AdminStats {
  period: string;
  stats: {
    totalCalls: number;
    totalRevenue: number;
    profit: number;
    activeUsers: number;
    skills: number;
  };
  chart: Array<{ date: string; calls: number }>;
  revenue: Record<string, number>;
  reconciliation: Record<string, number>;
  treasury: Record<string, number>;
  cacheStats: {
    totalHits: number;
    hitRate: number;
    creditsSaved: number;
  };
}

export interface AdminLogs {
  period: string;
  callLogs: Array<{
    id: string;
    createdAt: string;
    query: string;
    skillName?: string;
    creditsCost: number;
    maskedKey: string;
    status: string;
  }>;
  skillLogs: Array<{
    skillName: string;
    invocations: number;
    creditsEarned: number;
  }>;
}

// --- Signal types ---

export interface SignalDetail {
  signal: number;
  rank: number | null;
  recentActivity: Array<{ action: string; amount: number; createdAt: string }>;
  vault: { totalLocked: number; locks: VaultLock[] };
  leaderboard: Array<{
    rank: number;
    totalSignal: number;
    keyHint: string;
    isYou: boolean;
  }>;
  network: { totalSignal: number; participants: number };
}

// --- Referral types ---

export interface ReferralInfo {
  code: string;
  uses: number;
  shareUrl: string;
  bonusCreditsForFriend: number;
  bonusCreditsForYou: number;
  hint: string;
}

// --- Provider types ---

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
