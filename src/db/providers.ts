/**
 * providers.ts — DB operations for the Provider Umbrella system.
 *
 * x402 providers register their endpoints with ClawNet and get:
 *   - Smart caching (L1 memory + L2 Redis, 90% credit savings)
 *   - Soma provenance on every response (birth certs, PQ signatures, EAS receipts)
 *   - Provider-scoped API keys (can only call their own endpoints)
 *   - Analytics dashboard (calls, cache hits, revenue, latency)
 *   - Flywheel effects (shared cache warms across all consumers)
 */

import { getDb, logAudit } from './connection';
import { nanoid } from 'nanoid';
import { round6 } from '../core/credits';
import type { SomaCheckTier } from '../core/soma-check-billing';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Provider {
  id: string;
  name: string;
  slug: string;
  email: string;
  clerkUserId: string | null;
  evmWallet: string | null;
  solanaWallet: string | null;
  somaPublicKey: string | null;
  somaDiscoveryUrl: string | null;
  description: string | null;
  websiteUrl: string | null;
  revenueSharePct: number;
  cacheRevenueSharePct: number;
  tier: 'open' | 'standard' | 'verified' | 'flat';
  somaCheckTier: SomaCheckTier;
  platformFeePct: number;
  trustScore: number;
  cacheRevenueCredits: number;
  status: 'pending' | 'active' | 'suspended';
  verified: boolean;
  somaEnabled: boolean;
  totalCalls: number;
  totalCacheHits: number;
  totalRevenueUsdc: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderEndpoint {
  providerId: string;
  endpointId: string;
  registeredAt: string;
}

export interface ProviderAnalyticsRow {
  providerId: string;
  date: string;
  calls: number;
  cacheHits: number;
  cacheSavingsCredits: number;
  revenueUsdc: number;
  avgLatencyMs: number;
  errors: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampSomaCheckTier(n: number): SomaCheckTier {
  const i = Math.trunc(Number(n) || 0);
  if (i <= 0) return 0;
  if (i >= 3) return 3;
  return i as SomaCheckTier;
}

function rowToProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    email: row.email,
    clerkUserId: row.clerk_user_id,
    evmWallet: row.evm_wallet,
    solanaWallet: row.solana_wallet,
    somaPublicKey: row.soma_public_key,
    somaDiscoveryUrl: row.soma_discovery_url,
    description: row.description,
    websiteUrl: row.website_url,
    revenueSharePct: row.revenue_share_pct,
    cacheRevenueSharePct: row.cache_revenue_share_pct ?? 0.50,
    tier: row.tier ?? 'flat',
    somaCheckTier: clampSomaCheckTier(row.soma_check_tier ?? 0),
    platformFeePct: row.platform_fee_pct ?? 0.10,
    trustScore: row.trust_score ?? 50.0,
    cacheRevenueCredits: row.cache_revenue_credits ?? 0,
    status: row.status,
    verified: !!row.verified,
    somaEnabled: !!row.soma_enabled,
    totalCalls: row.total_calls,
    totalCacheHits: row.total_cache_hits,
    totalRevenueUsdc: row.total_revenue_usdc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function createProvider(opts: {
  name: string;
  slug: string;
  email: string;
  clerkUserId?: string;
  evmWallet?: string;
  solanaWallet?: string;
  somaPublicKey?: string;
  somaDiscoveryUrl?: string;
  description?: string;
  websiteUrl?: string;
}): Provider {
  const id = `prov-${nanoid(16)}`;
  // Flat fee: 10% platform fee, 90% live revenue, 50% cache revenue
  getDb().prepare(`
    INSERT INTO providers (id, name, slug, email, clerk_user_id, evm_wallet, solana_wallet,
      soma_public_key, soma_discovery_url, description, website_url,
      platform_fee_pct, revenue_share_pct, cache_revenue_share_pct, tier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.10, 0.90, 0.50, 'flat')
  `).run(
    id, opts.name, opts.slug, opts.email,
    opts.clerkUserId ?? null, opts.evmWallet ?? null, opts.solanaWallet ?? null,
    opts.somaPublicKey ?? null, opts.somaDiscoveryUrl ?? null,
    opts.description ?? null, opts.websiteUrl ?? null,
  );

  logAudit({ entityType: 'provider', entityId: id, action: 'created', data: { name: opts.name, slug: opts.slug } });
  return getProvider(id)!;
}

export function getProvider(id: string): Provider | null {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
  return row ? rowToProvider(row) : null;
}

export function getProviderBySlug(slug: string): Provider | null {
  const row = getDb().prepare('SELECT * FROM providers WHERE slug = ?').get(slug) as any;
  return row ? rowToProvider(row) : null;
}

export function getProviderByClerkUser(clerkUserId: string): Provider | null {
  const row = getDb().prepare('SELECT * FROM providers WHERE clerk_user_id = ?').get(clerkUserId) as any;
  return row ? rowToProvider(row) : null;
}

export function listProviders(status?: string): Provider[] {
  const rows = status
    ? getDb().prepare('SELECT * FROM providers WHERE status = ? ORDER BY created_at DESC').all(status) as any[]
    : getDb().prepare('SELECT * FROM providers ORDER BY created_at DESC').all() as any[];
  return rows.map(rowToProvider);
}

export function updateProvider(id: string, updates: Partial<{
  name: string;
  email: string;
  evmWallet: string;
  solanaWallet: string;
  somaPublicKey: string;
  somaDiscoveryUrl: string;
  description: string;
  websiteUrl: string;
  status: string;
  verified: boolean;
  somaEnabled: boolean;
}>): Provider | null {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.email !== undefined) { sets.push('email = ?'); vals.push(updates.email); }
  if (updates.evmWallet !== undefined) { sets.push('evm_wallet = ?'); vals.push(updates.evmWallet); }
  if (updates.solanaWallet !== undefined) { sets.push('solana_wallet = ?'); vals.push(updates.solanaWallet); }
  if (updates.somaPublicKey !== undefined) { sets.push('soma_public_key = ?'); vals.push(updates.somaPublicKey); }
  if (updates.somaDiscoveryUrl !== undefined) { sets.push('soma_discovery_url = ?'); vals.push(updates.somaDiscoveryUrl); }
  if (updates.description !== undefined) { sets.push('description = ?'); vals.push(updates.description); }
  if (updates.websiteUrl !== undefined) { sets.push('website_url = ?'); vals.push(updates.websiteUrl); }
  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
  if (updates.verified !== undefined) { sets.push('verified = ?'); vals.push(updates.verified ? 1 : 0); }
  if (updates.somaEnabled !== undefined) { sets.push('soma_enabled = ?'); vals.push(updates.somaEnabled ? 1 : 0); }

  if (sets.length === 0) return getProvider(id);

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  getDb().prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  logAudit({ entityType: 'provider', entityId: id, action: 'updated', data: updates });
  return getProvider(id);
}

// ─── Provider Endpoints ─────────────────────────────────────────────────────

export function registerProviderEndpoint(providerId: string, endpointId: string, opts?: {
  declaredTtlSeconds?: number;
  cacheWarm?: boolean;
  updateFrequencySeconds?: number;
}): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO provider_endpoints (provider_id, endpoint_id, declared_ttl_seconds, cache_warm, update_frequency_seconds)
    VALUES (?, ?, ?, ?, ?)
  `).run(providerId, endpointId, opts?.declaredTtlSeconds ?? null, opts?.cacheWarm ? 1 : 0, opts?.updateFrequencySeconds ?? null);
}

export function updateEndpointFreshness(providerId: string, endpointId: string, opts: {
  declaredTtlSeconds?: number;
  cacheWarm?: boolean;
  updateFrequencySeconds?: number;
}): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (opts.declaredTtlSeconds !== undefined) { sets.push('declared_ttl_seconds = ?'); vals.push(opts.declaredTtlSeconds); }
  if (opts.cacheWarm !== undefined) { sets.push('cache_warm = ?'); vals.push(opts.cacheWarm ? 1 : 0); }
  if (opts.updateFrequencySeconds !== undefined) { sets.push('update_frequency_seconds = ?'); vals.push(opts.updateFrequencySeconds); }
  if (sets.length === 0) return false;
  vals.push(providerId, endpointId);
  const result = getDb().prepare(`UPDATE provider_endpoints SET ${sets.join(', ')} WHERE provider_id = ? AND endpoint_id = ?`).run(...vals);
  return result.changes > 0;
}

export function getEndpointFreshness(endpointId: string): { declaredTtlSeconds: number | null; cacheWarm: boolean; updateFrequencySeconds: number | null } | null {
  const row = getDb().prepare(
    'SELECT declared_ttl_seconds, cache_warm, update_frequency_seconds FROM provider_endpoints WHERE endpoint_id = ? LIMIT 1'
  ).get(endpointId) as any;
  if (!row) return null;
  return { declaredTtlSeconds: row.declared_ttl_seconds, cacheWarm: !!row.cache_warm, updateFrequencySeconds: row.update_frequency_seconds };
}

export function removeProviderEndpoint(providerId: string, endpointId: string): void {
  getDb().prepare('DELETE FROM provider_endpoints WHERE provider_id = ? AND endpoint_id = ?')
    .run(providerId, endpointId);
}

export function getProviderEndpoints(providerId: string): string[] {
  const rows = getDb().prepare('SELECT endpoint_id FROM provider_endpoints WHERE provider_id = ?')
    .all(providerId) as any[];
  return rows.map(r => r.endpoint_id);
}

export function getEndpointProvider(endpointId: string): string | null {
  const row = getDb().prepare('SELECT provider_id FROM provider_endpoints WHERE endpoint_id = ? LIMIT 1')
    .get(endpointId) as any;
  return row?.provider_id ?? null;
}

export function isProviderEndpoint(providerId: string, endpointId: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM provider_endpoints WHERE provider_id = ? AND endpoint_id = ?'
  ).get(providerId, endpointId);
  return !!row;
}

// ─── Provider-scoped API key helpers ────────────────────────────────────────

export function getProviderForApiKey(apiKey: string): string | null {
  const row = getDb().prepare('SELECT provider_id FROM api_keys WHERE key = ?').get(apiKey) as any;
  return row?.provider_id ?? null;
}

export function setApiKeyProvider(apiKey: string, providerId: string): void {
  getDb().prepare('UPDATE api_keys SET provider_id = ? WHERE key = ?').run(providerId, apiKey);
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export function recordProviderCall(providerId: string, opts: {
  cacheHit: boolean;
  cacheSavingsCredits?: number;
  cacheRevenueCredits?: number;
  revenueUsdc?: number;
  latencyMs: number;
  error?: boolean;
}): void {
  const today = new Date().toISOString().slice(0, 10);

  getDb().prepare(`
    INSERT INTO provider_analytics (provider_id, date, calls, cache_hits, cache_savings_credits, cache_revenue_credits, revenue_usdc, avg_latency_ms, errors)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, date) DO UPDATE SET
      calls = calls + 1,
      cache_hits = cache_hits + ?,
      cache_savings_credits = cache_savings_credits + ?,
      cache_revenue_credits = cache_revenue_credits + ?,
      revenue_usdc = revenue_usdc + ?,
      avg_latency_ms = (avg_latency_ms * calls + ?) / (calls + 1),
      errors = errors + ?
  `).run(
    providerId, today,
    opts.cacheHit ? 1 : 0,
    opts.cacheSavingsCredits ?? 0,
    opts.cacheRevenueCredits ?? 0,
    opts.revenueUsdc ?? 0,
    opts.latencyMs,
    opts.error ? 1 : 0,
    // ON CONFLICT values:
    opts.cacheHit ? 1 : 0,
    opts.cacheSavingsCredits ?? 0,
    opts.cacheRevenueCredits ?? 0,
    opts.revenueUsdc ?? 0,
    opts.latencyMs,
    opts.error ? 1 : 0,
  );

  // Update lifetime counters on providers table
  getDb().prepare(`
    UPDATE providers SET
      total_calls = total_calls + 1,
      total_cache_hits = total_cache_hits + ?,
      total_revenue_usdc = total_revenue_usdc + ?
    WHERE id = ?
  `).run(opts.cacheHit ? 1 : 0, opts.revenueUsdc ?? 0, providerId);
}

export function getProviderAnalytics(providerId: string, days = 30): ProviderAnalyticsRow[] {
  const rows = getDb().prepare(`
    SELECT * FROM provider_analytics
    WHERE provider_id = ? AND date >= date('now', ?)
    ORDER BY date DESC
  `).all(providerId, `-${days} days`) as any[];

  return rows.map(r => ({
    providerId: r.provider_id,
    date: r.date,
    calls: r.calls,
    cacheHits: r.cache_hits,
    cacheSavingsCredits: r.cache_savings_credits,
    revenueUsdc: r.revenue_usdc,
    avgLatencyMs: r.avg_latency_ms,
    errors: r.errors,
  }));
}

export function getProviderStats(providerId: string): {
  totalCalls: number;
  totalCacheHits: number;
  cacheHitRate: number;
  totalRevenueUsdc: number;
  endpointCount: number;
  avgLatencyMs: number;
} {
  const provider = getProvider(providerId);
  if (!provider) return { totalCalls: 0, totalCacheHits: 0, cacheHitRate: 0, totalRevenueUsdc: 0, endpointCount: 0, avgLatencyMs: 0 };

  const endpoints = getProviderEndpoints(providerId);
  const latency = getDb().prepare(`
    SELECT AVG(avg_latency_ms) as avg_ms FROM provider_analytics WHERE provider_id = ? AND date >= date('now', '-30 days')
  `).get(providerId) as any;

  return {
    totalCalls: provider.totalCalls,
    totalCacheHits: provider.totalCacheHits,
    cacheHitRate: provider.totalCalls > 0 ? provider.totalCacheHits / provider.totalCalls : 0,
    totalRevenueUsdc: provider.totalRevenueUsdc,
    endpointCount: endpoints.length,
    avgLatencyMs: latency?.avg_ms ?? 0,
  };
}

// ─── Soma Check Tier ───────────────────────────────────────────────────────

/**
 * Get the Soma Check onboarding tier for the provider that owns an endpoint.
 * Returns 0 (shadow mode) if the endpoint has no provider or the provider is
 * inactive. See internal/soma-onboarding-ladder.md for the 4-tier definition.
 */
export function getProviderSomaCheckTier(endpointId: string): SomaCheckTier {
  const providerId = getEndpointProvider(endpointId);
  if (!providerId) return 0;
  const row = getDb().prepare(
    "SELECT soma_check_tier, status FROM providers WHERE id = ?"
  ).get(providerId) as { soma_check_tier: number; status: string } | undefined;
  if (!row || row.status !== 'active') return 0;
  return clampSomaCheckTier(row.soma_check_tier ?? 0);
}

/** Promote (or demote) a provider's Soma Check tier. Caller is responsible for policy. */
export function setProviderSomaCheckTier(providerId: string, tier: SomaCheckTier): void {
  getDb().prepare('UPDATE providers SET soma_check_tier = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(clampSomaCheckTier(tier), providerId);
  logAudit({ entityType: 'provider', entityId: providerId, action: 'soma_check_tier_set', data: { tier } });
}

// ─── Revenue Share ─────────────────────────────────────────────────────────

/**
 * Credit a provider's account with their revenue share from an endpoint call.
 *
 * Live calls:  Provider gets `revenue_share_pct` (default 90%) of credits charged.
 * Cache hits:  Provider gets `cache_revenue_share_pct` (default 50%) of cache credits.
 *              Their server wasn't touched, so cache revenue is pure profit for them.
 *
 * Flat 10% platform fee for all providers. The `platform_fee_pct` field on the
 * provider record controls the actual take rate (token staking will replace tiers).
 *
 * Returns the provider's credited amount, or 0 if no provider owns this endpoint.
 */
export function creditProviderShare(endpointId: string, creditsCharged: number, opts: {
  cacheHit: boolean;
  latencyMs: number;
  error?: boolean;
  /**
   * When set, bypasses the provider's default revenue_share_pct /
   * cache_revenue_share_pct and credits this fraction of `creditsCharged`.
   * Used by Soma Check (RFC 9111 ETag 304 path) where the caller has
   * already applied the 10% hit-price ratio + tier-aware 90/10 or 95/5 split.
   */
  providerSharePctOverride?: number;
}): number {
  const providerId = getEndpointProvider(endpointId);
  if (!providerId) return 0;

  const provider = getProvider(providerId);
  if (!provider || provider.status !== 'active') return 0;

  // Live calls: provider gets revenue_share_pct (90%)
  // Cache hits: provider gets cache_revenue_share_pct (50%) — pure profit, server not touched
  // Soma Check hits: caller passes providerSharePctOverride (0.90 T0-2 / 0.95 T3).
  const providerCredits = opts.providerSharePctOverride !== undefined
    ? round6(creditsCharged * opts.providerSharePctOverride)
    : opts.cacheHit
      ? round6(creditsCharged * provider.cacheRevenueSharePct)
      : round6(creditsCharged * provider.revenueSharePct);

  // Credit provider's API key balance (if they have one linked)
  if (providerCredits > 0) {
    const providerKey = getDb().prepare(
      'SELECT key FROM api_keys WHERE provider_id = ? AND active = 1 LIMIT 1'
    ).get(providerId) as { key: string } | undefined;

    if (providerKey) {
      getDb().prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?')
        .run(providerCredits, providerKey.key);
    }

    // Track lifetime cache revenue on provider record
    if (opts.cacheHit) {
      getDb().prepare('UPDATE providers SET cache_revenue_credits = cache_revenue_credits + ? WHERE id = ?')
        .run(providerCredits, providerId);
    }
  }

  // Always record analytics
  const creditsPerUsd = 1000; // env.CREDITS_PER_USD default
  recordProviderCall(providerId, {
    cacheHit: opts.cacheHit,
    cacheSavingsCredits: opts.cacheHit ? creditsCharged : 0,
    revenueUsdc: providerCredits / creditsPerUsd,
    latencyMs: opts.latencyMs,
    error: opts.error,
    cacheRevenueCredits: opts.cacheHit ? providerCredits : 0,
  });

  return providerCredits;
}

// ─── Volatility Dashboard ─────────────────────────────────────────────────

export interface ProviderVolatility {
  providerId: string;
  window: string;
  period: { from: string; to: string };
  callVolatility: {
    dailyMean: number;
    dailyStddev: number;
    coefficientOfVariation: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  cacheHitVolatility: {
    dailyMean: number;
    dailyStddev: number;
    min: number;
    max: number;
  };
  latencyVolatility: {
    meanMs: number;
    stddevMs: number;
    minMs: number;
    maxMs: number;
  };
  errorRate: {
    mean: number;
    max: number;
    totalErrors: number;
  };
  dataFreshness: {
    avgChangeRate: number;
    endpointCount: number;
  };
  overallScore: number;
}

/**
 * Compute volatility metrics from provider_analytics daily rows.
 * Pure SQL aggregation — no new tables needed.
 */
export function getProviderVolatility(providerId: string, days = 30): ProviderVolatility {
  const dayStr = `-${Math.min(days, 90)} days`;

  // Daily aggregates for the window
  const rows = getDb().prepare(`
    SELECT date, calls, cache_hits, avg_latency_ms, errors
    FROM provider_analytics
    WHERE provider_id = ? AND date >= date('now', ?)
    ORDER BY date ASC
  `).all(providerId, dayStr) as any[];

  // Data freshness from cache_volatility (provider's endpoints)
  const freshness = getDb().prepare(`
    SELECT AVG(CASE WHEN check_count > 0 THEN CAST(change_count AS REAL) / check_count ELSE 0 END) as avg_change_rate,
           COUNT(*) as endpoint_count
    FROM cache_volatility cv
    JOIN provider_endpoints pe ON cv.endpoint_id = pe.endpoint_id
    WHERE pe.provider_id = ?
  `).get(providerId) as any;

  const n = rows.length;
  if (n === 0) {
    return {
      providerId,
      window: `${days}d`,
      period: { from: '', to: '' },
      callVolatility: { dailyMean: 0, dailyStddev: 0, coefficientOfVariation: 0, trend: 'stable' },
      cacheHitVolatility: { dailyMean: 0, dailyStddev: 0, min: 0, max: 0 },
      latencyVolatility: { meanMs: 0, stddevMs: 0, minMs: 0, maxMs: 0 },
      errorRate: { mean: 0, max: 0, totalErrors: 0 },
      dataFreshness: { avgChangeRate: 0, endpointCount: 0 },
      overallScore: 0,
    };
  }

  // ── Call volatility ──
  const calls = rows.map(r => r.calls as number);
  const callMean = calls.reduce((a, b) => a + b, 0) / n;
  const callStddev = Math.sqrt(calls.reduce((s, v) => s + (v - callMean) ** 2, 0) / n);
  const callCv = callMean > 0 ? callStddev / callMean : 0;

  // Trend: compare last 7 days avg vs prior
  const recentCalls = calls.slice(-7);
  const priorCalls = calls.slice(0, -7);
  const recentAvg = recentCalls.length > 0 ? recentCalls.reduce((a, b) => a + b, 0) / recentCalls.length : 0;
  const priorAvg = priorCalls.length > 0 ? priorCalls.reduce((a, b) => a + b, 0) / priorCalls.length : recentAvg;
  const trendDelta = priorAvg > 0 ? (recentAvg - priorAvg) / priorAvg : 0;
  const trend: 'increasing' | 'decreasing' | 'stable' =
    trendDelta > 0.15 ? 'increasing' : trendDelta < -0.15 ? 'decreasing' : 'stable';

  // ── Cache hit rate volatility ──
  const hitRates = rows.map(r => r.calls > 0 ? (r.cache_hits as number) / (r.calls as number) : 0);
  const hitMean = hitRates.reduce((a, b) => a + b, 0) / n;
  const hitStddev = Math.sqrt(hitRates.reduce((s, v) => s + (v - hitMean) ** 2, 0) / n);

  // ── Latency volatility ──
  const latencies = rows.map(r => r.avg_latency_ms as number);
  const latMean = latencies.reduce((a, b) => a + b, 0) / n;
  const latStddev = Math.sqrt(latencies.reduce((s, v) => s + (v - latMean) ** 2, 0) / n);

  // ── Error rate ──
  const errorRates = rows.map(r => r.calls > 0 ? (r.errors as number) / (r.calls as number) : 0);
  const errMean = errorRates.reduce((a, b) => a + b, 0) / n;
  const totalErrors = rows.reduce((s, r) => s + (r.errors as number), 0);

  // ── Overall volatility score (0-100) ──
  const callVol = Math.min(100, callCv * 100);
  const cacheVol = Math.min(100, hitRates.length > 0 ? ((Math.max(...hitRates) - Math.min(...hitRates)) / Math.max(Math.max(...hitRates), 0.01)) * 100 : 0);
  const latVol = Math.min(100, latMean > 0 ? (latStddev / latMean) * 100 : 0);
  const errVol = Math.min(100, Math.max(...errorRates) * 1000); // scale: 0.1% error → 100
  const freshVol = (freshness?.avg_change_rate ?? 0) * 100;

  const overall = Math.round(
    callVol * 0.25 + cacheVol * 0.25 + latVol * 0.20 + errVol * 0.15 + freshVol * 0.15
  );

  return {
    providerId,
    window: `${days}d`,
    period: { from: rows[0].date, to: rows[n - 1].date },
    callVolatility: {
      dailyMean: round6(callMean),
      dailyStddev: round6(callStddev),
      coefficientOfVariation: round6(callCv),
      trend,
    },
    cacheHitVolatility: {
      dailyMean: round6(hitMean),
      dailyStddev: round6(hitStddev),
      min: round6(Math.min(...hitRates)),
      max: round6(Math.max(...hitRates)),
    },
    latencyVolatility: {
      meanMs: round6(latMean),
      stddevMs: round6(latStddev),
      minMs: round6(Math.min(...latencies)),
      maxMs: round6(Math.max(...latencies)),
    },
    errorRate: {
      mean: round6(errMean),
      max: round6(Math.max(...errorRates)),
      totalErrors,
    },
    dataFreshness: {
      avgChangeRate: round6(freshness?.avg_change_rate ?? 0),
      endpointCount: freshness?.endpoint_count ?? 0,
    },
    overallScore: Math.min(100, Math.max(0, overall)),
  };
}
