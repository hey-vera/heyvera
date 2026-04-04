/**
 * providers.ts — Provider Umbrella routes
 *
 * x402 providers register to route their endpoints through ClawNet's
 * infrastructure: smart caching, Soma provenance, PQ signatures, EAS receipts,
 * and the shared-cache flywheel.
 *
 * Routes:
 *   POST   /v1/providers              — Register a new provider (admin)
 *   GET    /v1/providers               — List providers (admin)
 *   GET    /v1/providers/:id           — Get provider details
 *   PATCH  /v1/providers/:id           — Update provider (admin)
 *   POST   /v1/providers/:id/activate  — Activate provider (admin)
 *   POST   /v1/providers/:id/endpoints — Register endpoint to provider (admin)
 *   DELETE /v1/providers/:id/endpoints/:eid — Remove endpoint from provider (admin)
 *   GET    /v1/providers/:id/endpoints — List provider's endpoints
 *   GET    /v1/providers/:id/analytics — Provider analytics dashboard
 *   GET    /v1/providers/:id/stats     — Provider summary stats
 *   POST   /v1/providers/:id/keys      — Create provider-scoped API key (admin)
 *   GET    /v1/providers/:id/soma      — Provider Soma config (public key, discovery)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin-auth';
import {
  createProvider,
  getProvider,
  getProviderBySlug,
  listProviders,
  updateProvider,
  registerProviderEndpoint,
  removeProviderEndpoint,
  getProviderEndpoints,
  getProviderAnalytics,
  getProviderStats,
  setApiKeyProvider,
  updateEndpointFreshness,
  getEndpointFreshness,
} from '../db/index';
import { findEndpoint } from '../config/api-registry';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { getDb, logAudit } from '../db/index';
import { cacheIncr } from '../cache/index';
import { getClientIp } from '../middleware/rate-limit';

const providersRouter = new Hono();

// ─── GET /v1/providers/tiers — public tier comparison ──────────────────────

providersRouter.get('/tiers', (c) => {
  return c.json({
    tiers: [
      {
        id: 'open',
        name: 'Open',
        platformFee: '0%',
        liveCallShare: '100% to provider',
        cacheRevenue: 'None',
        features: ['Endpoint listing', 'Basic analytics'],
        bestFor: 'Testing the waters — zero risk, zero cost',
      },
      {
        id: 'standard',
        name: 'Standard',
        platformFee: '5%',
        liveCallShare: '95% to provider',
        cacheRevenue: '50% of cache hits (pure profit)',
        features: ['Cache revenue share', 'Orchestration inclusion', 'Full analytics', 'Soma provenance'],
        bestFor: 'Growing providers who want distribution + trust',
      },
      {
        id: 'verified',
        name: 'Verified',
        platformFee: '10%',
        liveCallShare: '90% to provider',
        cacheRevenue: '50% of cache hits (pure profit)',
        features: ['Everything in Standard', 'Priority orchestration', 'Cache warming', 'PQ signatures', 'Soma Verified badge', 'Trust score boost'],
        bestFor: 'Production providers who want maximum trust + traffic',
      },
    ],
    comparison: {
      note: 'Cache hits are pure profit — your server is never touched. Providers typically earn MORE through ClawNet than direct due to orchestration discovery + cache revenue.',
    },
  });
});

// ─── POST /v1/providers/register — self-service provider registration ──────
// Any API key holder can register as a provider. Starts in 'pending' status.
// Admin activates after review. Rate limited: 3 per IP per hour.

const SelfRegisterBody = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Lowercase alphanumeric with hyphens'),
  email: z.string().email(),
  description: z.string().max(500).optional(),
  websiteUrl: z.string().url().max(500).optional(),
  solanaWallet: z.string().max(64).optional(),
  evmWallet: z.string().max(64).optional(),
  somaPublicKey: z.string().max(128).optional(),
  somaDiscoveryUrl: z.string().url().max(500).optional(),
});

providersRouter.post('/register', checkApiKey, async (c) => {
  const ip = getClientIp(c);
  const count = await cacheIncr(`provider-register:ip:${ip}`, 3600);
  if (count > 3) {
    return c.json({ error: 'Rate limit exceeded. Max 3 registrations per hour.', code: 'RATE_LIMITED' }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = SelfRegisterBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid registration data', code: 'INVALID_DATA', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const existing = getProviderBySlug(parsed.data.slug);
  if (existing) {
    return c.json({ error: 'Provider slug already taken', code: 'DUPLICATE_SLUG' }, 409);
  }

  const provider = createProvider(parsed.data);

  // Link caller's API key to the new provider
  const keyInfo = c.get('apiKeyInfo');
  setApiKeyProvider(keyInfo.key, provider.id);

  logAudit({ entityType: 'provider', entityId: provider.id, action: 'SELF_REGISTERED', data: { name: provider.name, slug: provider.slug, apiKey: keyInfo.key.slice(0, 7) + '...' } });
  logger.info({ providerId: provider.id, slug: provider.slug }, 'Provider self-registered (pending review)');

  return c.json({
    ok: true,
    provider,
    message: 'Provider registered successfully. Status: pending — admin will review and activate.',
    tier: {
      current: 'standard',
      fee: '10%',
      benefits: 'Cache revenue share, orchestration inclusion, analytics, Soma provenance',
      tiers: {
        open: { fee: '0%', benefits: 'Endpoint listing only — no cache, no orchestration priority' },
        standard: { fee: '5%', benefits: 'Cache revenue share (50%), orchestration, analytics' },
        verified: { fee: '10%', benefits: 'Full Soma provenance, cache warming, priority orchestration, PQ signatures, trust badge' },
      },
    },
    nextSteps: [
      'Your API key is now linked to this provider.',
      'Once activated, register your endpoints via POST /v1/providers/:id/endpoints.',
      'You earn 90% of live call revenue + 50% of cache hit revenue (pure profit).',
      'Set freshness declarations: PATCH /v1/providers/:id/endpoints/:eid/freshness.',
      'Enable cache warming for always-fresh responses.',
      'Enable Soma dual-sign by adding your public key for provenance chain-of-custody.',
    ],
  }, 201);
});

// ─── POST /v1/providers — register new provider (admin) ────────────────────

providersRouter.post('/', async (c) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }, 403);
  }

  const body = await c.req.json();
  const { name, slug, email, evmWallet, solanaWallet, somaPublicKey, somaDiscoveryUrl, description, websiteUrl } = body;

  if (!name || !slug || !email) {
    return c.json({ error: 'name, slug, and email are required', code: 'VALIDATION_ERROR' }, 400);
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return c.json({ error: 'slug must be lowercase alphanumeric with hyphens', code: 'VALIDATION_ERROR' }, 400);
  }

  // Check for duplicate slug
  const existing = getProviderBySlug(slug);
  if (existing) {
    return c.json({ error: 'Provider slug already taken', code: 'DUPLICATE_SLUG' }, 409);
  }

  const provider = createProvider({
    name, slug, email, evmWallet, solanaWallet, somaPublicKey, somaDiscoveryUrl, description, websiteUrl,
  });

  logger.info({ providerId: provider.id, slug }, 'Provider registered');
  return c.json({ ok: true, provider });
});

// ─── GET /v1/providers — list providers ─────────────────────────────────────

providersRouter.get('/', async (c) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }, 403);
  }

  const status = c.req.query('status');
  const providers = listProviders(status);
  return c.json({ ok: true, providers, count: providers.length });
});

// ─── GET /v1/providers/:id — get provider details ───────────────────────────

providersRouter.get('/:id', async (c) => {
  const provider = getProvider(c.req.param('id'));
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  // Non-admin callers get a filtered view
  if (!requireAdmin(c)) {
    return c.json({
      ok: true,
      provider: {
        id: provider.id,
        name: provider.name,
        slug: provider.slug,
        description: provider.description,
        websiteUrl: provider.websiteUrl,
        somaEnabled: provider.somaEnabled,
        verified: provider.verified,
        status: provider.status,
        totalCalls: provider.totalCalls,
      },
    });
  }

  return c.json({ ok: true, provider });
});

// ─── PATCH /v1/providers/:id — update provider ─────────────────────────────

providersRouter.patch('/:id', async (c) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }, 403);
  }

  const id = c.req.param('id');
  const body = await c.req.json();
  const updated = updateProvider(id, body);

  if (!updated) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  return c.json({ ok: true, provider: updated });
});

// ─── POST /v1/providers/:id/activate — activate provider ────────────────────

providersRouter.post('/:id/activate', async (c) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }, 403);
  }

  const id = c.req.param('id');
  const updated = updateProvider(id, { status: 'active', verified: true });

  if (!updated) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  logAudit({ entityType: 'provider', entityId: id, action: 'activated' });
  return c.json({ ok: true, provider: updated });
});

// ─── POST /v1/providers/:id/tier — set provider tier (admin) ───────────────

const TIER_CONFIG = {
  open:     { platformFeePct: 0, revenueSharePct: 1.00, cacheRevenueSharePct: 0 },
  standard: { platformFeePct: 0.05, revenueSharePct: 0.95, cacheRevenueSharePct: 0.50 },
  verified: { platformFeePct: 0.10, revenueSharePct: 0.90, cacheRevenueSharePct: 0.50 },
} as const;

providersRouter.post('/:id/tier', async (c) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }, 403);
  }

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const tier = (body as any).tier as string;

  if (!tier || !['open', 'standard', 'verified'].includes(tier)) {
    return c.json({ error: 'tier must be open, standard, or verified', code: 'VALIDATION_ERROR' }, 400);
  }

  const config = TIER_CONFIG[tier as keyof typeof TIER_CONFIG];

  getDb().prepare(`
    UPDATE providers SET tier = ?, platform_fee_pct = ?, revenue_share_pct = ?, cache_revenue_share_pct = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(tier, config.platformFeePct, config.revenueSharePct, config.cacheRevenueSharePct, id);

  logAudit({ entityType: 'provider', entityId: id, action: 'TIER_CHANGED', data: { tier, ...config } });
  const provider = getProvider(id);

  return c.json({ ok: true, provider, tierConfig: config });
});

// ─── POST /v1/providers/:id/endpoints — register endpoint ──────────────────

providersRouter.post('/:id/endpoints', async (c) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }, 403);
  }

  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const { endpointId, endpointIds } = await c.req.json();
  const ids: string[] = endpointIds ?? (endpointId ? [endpointId] : []);

  if (ids.length === 0) {
    return c.json({ error: 'endpointId or endpointIds required', code: 'VALIDATION_ERROR' }, 400);
  }

  const results: { id: string; found: boolean }[] = [];
  for (const eid of ids) {
    const ep = findEndpoint(eid);
    results.push({ id: eid, found: !!ep });
    if (ep) {
      registerProviderEndpoint(providerId, eid);
    }
  }

  const registered = results.filter(r => r.found).length;
  logger.info({ providerId, registered, total: ids.length }, 'Provider endpoints registered');

  return c.json({ ok: true, registered, results });
});

// ─── PATCH /v1/providers/:id/endpoints/:eid/freshness — set freshness declarations ──

providersRouter.patch('/:id/endpoints/:eid/freshness', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const eid = c.req.param('eid');

  // Provider can update their own endpoints, or admin can update any
  const keyInfo = c.get('apiKeyInfo');
  const keyProvider = getDb().prepare('SELECT provider_id FROM api_keys WHERE key = ?').get(keyInfo.key) as any;
  const isOwner = keyProvider?.provider_id === providerId;

  if (!isOwner && !requireAdmin(c)) {
    return c.json({ error: 'Not authorized for this provider', code: 'PROVIDER_SCOPE_DENIED' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const updated = updateEndpointFreshness(providerId, eid, {
    declaredTtlSeconds: body.declaredTtlSeconds,
    cacheWarm: body.cacheWarm,
    updateFrequencySeconds: body.updateFrequencySeconds,
  });

  if (!updated) {
    return c.json({ error: 'Endpoint not found for this provider', code: 'NOT_FOUND' }, 404);
  }

  logAudit({ entityType: 'provider_endpoint', entityId: `${providerId}:${eid}`, action: 'FRESHNESS_UPDATED', data: body });
  return c.json({ ok: true, endpointId: eid, freshness: getEndpointFreshness(eid) });
});

// ─── DELETE /v1/providers/:id/endpoints/:eid — remove endpoint ──────────────

providersRouter.delete('/:id/endpoints/:eid', async (c) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }, 403);
  }

  removeProviderEndpoint(c.req.param('id'), c.req.param('eid'));
  return c.json({ ok: true });
});

// ─── GET /v1/providers/:id/endpoints — list provider's endpoints ────────────

providersRouter.get('/:id/endpoints', async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const endpointIds = getProviderEndpoints(providerId);
  const endpoints = endpointIds.map(id => {
    const ep = findEndpoint(id);
    return ep ? { id, name: ep.name, category: ep.category, costPerCall: ep.costPerCall } : { id, name: null };
  });

  return c.json({ ok: true, provider: { id: providerId, name: provider.name }, endpoints, count: endpoints.length });
});

// ─── GET /v1/providers/:id/analytics — analytics dashboard ──────────────────

providersRouter.get('/:id/analytics', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const days = parseInt(c.req.query('days') ?? '30', 10);
  const analytics = getProviderAnalytics(providerId, Math.min(days, 90));
  const stats = getProviderStats(providerId);

  return c.json({
    ok: true,
    provider: { id: providerId, name: provider.name, somaEnabled: provider.somaEnabled },
    stats,
    analytics,
  });
});

// ─── GET /v1/providers/:id/stats — summary stats ────────────────────────────

providersRouter.get('/:id/stats', async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const stats = getProviderStats(providerId);
  return c.json({ ok: true, provider: { id: providerId, name: provider.name }, stats });
});

// ─── GET /v1/providers/:id/revenue — revenue dashboard (proves "you earn more") ──

providersRouter.get('/:id/revenue', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const stats = getProviderStats(providerId);
  const analytics = getProviderAnalytics(providerId, 30);

  // Calculate revenue breakdown
  const last30 = analytics.reduce((acc, day) => {
    acc.liveCalls += day.calls - day.cacheHits;
    acc.cacheHits += day.cacheHits;
    acc.liveRevenue += day.revenueUsdc;
    acc.cacheRevenue += (day as any).cacheRevenueCredits ?? 0;
    return acc;
  }, { liveCalls: 0, cacheHits: 0, liveRevenue: 0, cacheRevenue: 0 });

  const totalCalls = last30.liveCalls + last30.cacheHits;
  const cacheHitRate = totalCalls > 0 ? last30.cacheHits / totalCalls : 0;

  // Estimate what they'd earn direct (no ClawNet)
  // Direct = only live calls (no cache benefit, no orchestration traffic)
  // Assumption: ~30% of calls are incremental from orchestrated discovery
  const estimatedDirectCalls = Math.round(last30.liveCalls * 0.7);
  const avgRevenuePerLiveCall = last30.liveCalls > 0 ? last30.liveRevenue / last30.liveCalls : 0;
  const estimatedDirectRevenue = estimatedDirectCalls * avgRevenuePerLiveCall / provider.revenueSharePct; // 100% of call price

  const totalClawNetRevenue = last30.liveRevenue + (last30.cacheRevenue / 1000); // cache revenue is in credits, convert

  return c.json({
    ok: true,
    provider: {
      id: providerId,
      name: provider.name,
      tier: provider.tier,
      trustScore: provider.trustScore,
    },
    revenue: {
      last30Days: {
        liveCalls: last30.liveCalls,
        cacheHits: last30.cacheHits,
        cacheHitRate: Math.round(cacheHitRate * 100),
        liveRevenueUsd: last30.liveRevenue,
        cacheRevenueCredits: last30.cacheRevenue,
        totalRevenueUsd: totalClawNetRevenue,
      },
      comparison: {
        estimatedDirectRevenue: estimatedDirectRevenue,
        clawNetRevenue: totalClawNetRevenue,
        uplift: estimatedDirectRevenue > 0
          ? `+${Math.round(((totalClawNetRevenue - estimatedDirectRevenue) / estimatedDirectRevenue) * 100)}%`
          : 'N/A (no data yet)',
        note: 'Estimated direct = your calls without ClawNet orchestration discovery. ClawNet revenue = live share + cache profit.',
      },
      lifetime: {
        totalCalls: stats.totalCalls,
        totalCacheHits: stats.totalCacheHits,
        totalRevenueUsdc: stats.totalRevenueUsdc,
        cacheRevenueCredits: provider.cacheRevenueCredits,
      },
    },
    splits: {
      liveCallShare: `${Math.round(provider.revenueSharePct * 100)}% to you`,
      cacheHitShare: `${Math.round(provider.cacheRevenueSharePct * 100)}% to you (pure profit)`,
      platformFee: `${Math.round(provider.platformFeePct * 100)}%`,
    },
  });
});

// ─── POST /v1/providers/:id/keys — create provider-scoped API key ───────────

providersRouter.post('/:id/keys', async (c) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }, 403);
  }

  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  if (provider.status !== 'active') {
    return c.json({ error: 'Provider must be active to create keys', code: 'PROVIDER_INACTIVE' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const credits = body.credits ?? 10000;

  // Generate a standard cn- API key
  const key = `cn-${crypto.randomBytes(24).toString('hex')}`;

  getDb().prepare(`
    INSERT INTO api_keys (key, email, credits, provider_id) VALUES (?, ?, ?, ?)
  `).run(key, provider.email, credits, providerId);

  logAudit({
    entityType: 'api_key',
    entityId: key.slice(0, 7) + '...',
    action: 'provider_key_created',
    data: { providerId, credits },
  });

  logger.info({ providerId, credits }, 'Provider-scoped API key created');

  return c.json({
    ok: true,
    key,
    providerId,
    credits,
    scope: 'provider — can only call endpoints registered to this provider',
  });
});

// ─── GET /v1/providers/:id/soma — provider Soma configuration ───────────────

providersRouter.get('/:id/soma', async (c) => {
  const provider = getProvider(c.req.param('id'));
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  return c.json({
    ok: true,
    provider: { id: provider.id, name: provider.name },
    soma: {
      enabled: provider.somaEnabled,
      publicKey: provider.somaPublicKey,
      discoveryUrl: provider.somaDiscoveryUrl,
      dualSignSupported: !!provider.somaPublicKey,
      instructions: !provider.somaPublicKey ? {
        message: 'To enable dual-signed Soma verification, integrate soma-heart into your service',
        steps: [
          '1. npm install soma-heart',
          '2. Initialize heart with your signing keypair',
          '3. Wrap upstream API calls with heart.fetchData()',
          '4. Return X-Soma-* headers on responses',
          '5. Register your public key here via PATCH /v1/providers/:id',
        ],
      } : undefined,
    },
  });
});

export { providersRouter };
