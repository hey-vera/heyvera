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
 *   POST   /v1/providers/:id/endpoints — Register existing endpoint to provider (admin)
 *   POST   /v1/providers/:id/endpoints/submit — Submit new endpoint (provider self-service)
 *   POST   /v1/providers/:id/endpoints/notify — Instant discovery push (re-fetch or inline)
 *   PATCH  /v1/providers/:id/endpoints/:eid — Update own endpoint (provider/admin)
 *   DELETE /v1/providers/:id/endpoints/:eid — Remove endpoint (provider/admin)
 *   GET    /v1/providers/:id/endpoints — List provider's endpoints
 *   GET    /v1/providers/:id/analytics — Provider analytics dashboard
 *   GET    /v1/providers/:id/stats     — Provider summary stats
 *   GET    /v1/providers/:id/volatility — Volatility dashboard (call/cache/latency variance)
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
  getProviderSomaCheckEarnings,
  getProviderVolatility,
  type SomaCheckWindow,
} from '../db/index';
import { findEndpoint, invalidateEndpointCache, type ApiEndpoint } from '../config/api-registry';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { getDb, logAudit, dbRowToApiEndpoint, safeJsonParse } from '../db/index';
import { cacheIncr } from '../cache/index';
import { getClientIp } from '../middleware/rate-limit';
import { sendAdminAlert } from '../utils/email';
import { awardSignal } from '../db/signal';

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
  awardSignal({ apiKey: keyInfo.key, providerId: provider.id, action: 'provider_register', metadata: { slug: provider.slug } });
  logger.info({ providerId: provider.id, slug: provider.slug }, 'Provider self-registered (pending review)');

  // Fire-and-forget admin notification
  sendAdminAlert({
    subject: `New provider: ${provider.name}`,
    body: `Provider "${provider.name}" (${provider.slug}) registered.\nEmail: ${parsed.data.email}\nID: ${provider.id}\nStatus: pending — activate at /v1/providers/${provider.id}/activate`,
  }).catch(() => {});

  return c.json({
    ok: true,
    provider,
    message: 'Provider registered successfully. Status: pending — admin will review and activate.',
    tier: {
      current: 'standard',
      fee: '5%',
      benefits: 'Cache revenue share, orchestration inclusion, analytics, Soma provenance',
      tiers: {
        open: { fee: '0%', benefits: 'Endpoint listing, 100% live call revenue — no cache revenue' },
        standard: { fee: '5%', benefits: '95% live call revenue, cache revenue share (50%), orchestration, analytics' },
        verified: { fee: '10%', benefits: '90% live call revenue, cache warming, priority orchestration, PQ signatures, trust badge' },
      },
    },
    nextSteps: [
      'Your API key is now linked to this provider.',
      'Status: pending — admin will review and activate (usually within 24h). Contact hello@claw-net.org if urgent.',
      'Once activated, submit endpoints via POST /v1/providers/' + provider.id + '/endpoints/submit.',
      'You earn 95% of live call revenue + 50% of cache hit revenue (pure profit).',
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

// ─── POST /v1/providers/:id/endpoints/submit — self-service endpoint submission ─────

const VALID_CATEGORIES = [
  'solana', 'social', 'utility', 'defi', 'intelligence', 'oracle', 'scraping',
  'discovery', 'infrastructure', 'search', 'media', 'enrichment', 'weather', 'ai-ml', 'security',
] as const;

const EndpointSubmitBody = z.object({
  name: z.string().min(2).max(100),
  description: z.string().min(10).max(500),
  category: z.enum(VALID_CATEGORIES),
  baseUrl: z.string().url().max(500),
  path: z.string().max(200).optional(),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  costPerCall: z.number().min(0).max(10).default(0.001),
  latencyMs: z.number().int().min(0).max(30000).default(1000),
  inputSchema: z.record(z.string()).optional(),
  outputFields: z.array(z.string()).optional(),
  cacheTtl: z.number().int().min(0).max(604800).optional(), // max 7 days
  creditCost: z.number().min(0).max(100).optional(),
});

providersRouter.post('/:id/endpoints/submit', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  // Auth: provider's own API key or admin
  const keyInfo = c.get('apiKeyInfo');
  const keyProvider = getDb().prepare('SELECT provider_id FROM api_keys WHERE key = ?').get(keyInfo.key) as any;
  const isOwner = keyProvider?.provider_id === providerId;
  if (!isOwner && !requireAdmin(c)) {
    return c.json({ error: 'Not authorized for this provider', code: 'PROVIDER_SCOPE_DENIED' }, 403);
  }

  // Provider must be active
  if (provider.status !== 'active') {
    return c.json({ error: 'Provider must be active to submit endpoints. Contact admin for activation.', code: 'PROVIDER_NOT_ACTIVE' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = EndpointSubmitBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid endpoint data', code: 'INVALID_DATA', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const data = parsed.data;

  // Generate deterministic ID from provider slug + name
  const slug = provider.slug || provider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const nameSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const endpointId = `${slug}-${nameSlug}`;

  // Check for duplicate
  const existing = getDb().prepare('SELECT id FROM endpoints WHERE id = ?').get(endpointId);
  if (existing) {
    return c.json({ error: `Endpoint ID "${endpointId}" already exists. Use a different name.`, code: 'DUPLICATE_ENDPOINT' }, 409);
  }

  // Auto-approve all submissions — moderate after the fact for mass adoption.
  // Admin can disable bad actors via POST /v1/admin/endpoints/:id/disable.
  const status = 'active';

  getDb().prepare(`
    INSERT INTO endpoints (
      id, provider, provider_id, base_url, path, name, description, category,
      cost_per_call, latency_ms, input_schema_json, output_fields_json,
      rate_limit, cache_ttl, credit_cost, status, source, http_method, submitted_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provider', ?, ?)
  `).run(
    endpointId,
    provider.name,
    providerId,
    data.baseUrl,
    data.path ?? null,
    data.name,
    data.description,
    data.category,
    data.costPerCall,
    data.latencyMs,
    data.inputSchema ? JSON.stringify(data.inputSchema) : null,
    data.outputFields ? JSON.stringify(data.outputFields) : null,
    null, // rate_limit
    data.cacheTtl ?? null,
    data.creditCost ?? null,
    status,
    data.httpMethod,
    keyInfo.key.slice(0, 7) + '...',
  );

  // Also link in provider_endpoints junction
  registerProviderEndpoint(providerId, endpointId);

  invalidateEndpointCache(endpointId);

  logAudit({
    entityType: 'endpoint',
    entityId: endpointId,
    action: 'ENDPOINT_SUBMITTED',
    actorId: keyInfo.key.slice(0, 7) + '...',
    data: { providerId, name: data.name, category: data.category },
  });

  awardSignal({ apiKey: keyInfo.key, providerId, action: 'endpoint_listed', metadata: { endpointId, name: data.name } });
  logger.info({ endpointId, providerId }, 'Provider endpoint submitted and live');

  // Fire-and-forget admin notification
  sendAdminAlert({
    subject: `New endpoint: ${data.name}`,
    body: `Provider "${provider.name}" submitted endpoint "${data.name}" (${endpointId}).\nCategory: ${data.category}\nURL: ${data.baseUrl}${data.path || ''}\nCost: $${data.costPerCall}/call\nStatus: live`,
  }).catch(() => {});

  return c.json({
    ok: true,
    endpointId,
    status,
    message: 'Endpoint is live. Callers can now use it via POST /v1/endpoints/' + endpointId + '/call.',
    endpoint: {
      id: endpointId,
      name: data.name,
      description: data.description,
      category: data.category,
      baseUrl: data.baseUrl,
      path: data.path,
      costPerCall: data.costPerCall,
      status,
    },
  }, 201);
});

// ─── POST /v1/providers/:id/endpoints/notify — instant discovery push ────────
// Providers call this to tell ClawNet "I have new/updated endpoints, re-fetch now"
// instead of waiting for the next poll cycle. If the provider has a
// soma_discovery_url, we re-fetch it immediately. Otherwise they can pass
// endpoints inline.

const NotifyBody = z.object({
  // Option A: provider tells us to re-fetch their discovery URL
  refetch: z.boolean().optional(),
  // Option B: provider pushes endpoints inline
  endpoints: z.array(z.object({
    name: z.string().min(2).max(100),
    description: z.string().max(500).default(''),
    category: z.enum(VALID_CATEGORIES).default('utility'),
    baseUrl: z.string().url().max(500),
    path: z.string().max(200).optional(),
    httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    costPerCall: z.number().min(0).max(10).default(0.001),
    cacheTtl: z.number().int().min(0).max(604800).optional(),
  })).optional(),
});

providersRouter.post('/:id/endpoints/notify', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const keyInfo = c.get('apiKeyInfo');
  const keyProvider = getDb().prepare('SELECT provider_id FROM api_keys WHERE key = ?').get(keyInfo.key) as any;
  const isOwner = keyProvider?.provider_id === providerId;
  if (!isOwner && !requireAdmin(c)) {
    return c.json({ error: 'Not authorized for this provider', code: 'PROVIDER_SCOPE_DENIED' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = NotifyBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid notify payload', code: 'INVALID_DATA', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { refetch, endpoints: inlineEndpoints } = parsed.data;
  let added = 0;

  // Option A: Re-fetch provider's soma_discovery_url
  if (refetch && provider.somaDiscoveryUrl) {
    try {
      const res = await fetch(provider.somaDiscoveryUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'ClawNet/1.0 (provider-notify)' },
      });
      if (res.ok) {
        const data = await res.json() as { endpoints?: Array<{ name: string; url: string; description?: string; category?: string; method?: string; price?: number }> };
        const eps = data.endpoints ?? (Array.isArray(data) ? data as any[] : []);
        for (const ep of eps) {
          if (!ep.name || !ep.url) continue;
          const slug = provider.slug || provider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const nameSlug = ep.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
          const endpointId = `${slug}-${nameSlug}`;

          const existing = getDb().prepare('SELECT id FROM endpoints WHERE id = ?').get(endpointId);
          if (!existing) {
            getDb().prepare(`
              INSERT INTO endpoints (id, provider, provider_id, base_url, path, name, description, category, cost_per_call, status, source, http_method)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'provider', ?)
            `).run(endpointId, provider.name, providerId, ep.url, null, ep.name, ep.description || '', ep.category || 'utility', ep.price || 0.001, ep.method || 'GET');
            registerProviderEndpoint(providerId, endpointId);
            added++;
          }
        }
        logger.info({ providerId, added, url: provider.somaDiscoveryUrl }, 'Provider discovery URL re-fetched');
      }
    } catch (err) {
      logger.warn({ err, providerId }, 'Failed to re-fetch provider discovery URL');
    }
  }

  // Option B: Inline endpoint push
  if (inlineEndpoints?.length) {
    for (const ep of inlineEndpoints) {
      const slug = provider.slug || provider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const nameSlug = ep.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      const endpointId = `${slug}-${nameSlug}`;

      const existing = getDb().prepare('SELECT id FROM endpoints WHERE id = ?').get(endpointId);
      if (existing) {
        // Update existing endpoint
        getDb().prepare(`
          UPDATE endpoints SET base_url = ?, description = ?, category = ?, cost_per_call = ?, http_method = ?, cache_ttl = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(ep.baseUrl, ep.description, ep.category, ep.costPerCall, ep.httpMethod, ep.cacheTtl ?? null, endpointId);
      } else {
        getDb().prepare(`
          INSERT INTO endpoints (id, provider, provider_id, base_url, path, name, description, category, cost_per_call, status, source, http_method, cache_ttl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'provider', ?, ?)
        `).run(endpointId, provider.name, providerId, ep.baseUrl, ep.path ?? null, ep.name, ep.description, ep.category, ep.costPerCall, ep.httpMethod, ep.cacheTtl ?? null);
        registerProviderEndpoint(providerId, endpointId);
        added++;
      }
      invalidateEndpointCache(endpointId);
    }
  }

  logAudit({
    entityType: 'provider',
    entityId: providerId,
    action: 'ENDPOINTS_NOTIFY',
    actorId: keyInfo.key.slice(0, 7) + '...',
    data: { refetch: !!refetch, inlineCount: inlineEndpoints?.length ?? 0, added },
  });

  return c.json({
    ok: true,
    added,
    updated: (inlineEndpoints?.length ?? 0) - added,
    message: added > 0 ? `${added} new endpoint(s) are live immediately.` : 'All endpoints up to date.',
  });
});

// ─── PATCH /v1/providers/:id/endpoints/:eid — update own endpoint ───────────

const EndpointUpdateBody = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().min(10).max(500).optional(),
  category: z.enum(VALID_CATEGORIES).optional(),
  baseUrl: z.string().url().max(500).optional(),
  path: z.string().max(200).optional(),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  costPerCall: z.number().min(0).max(10).optional(),
  latencyMs: z.number().int().min(0).max(30000).optional(),
  inputSchema: z.record(z.string()).optional(),
  outputFields: z.array(z.string()).optional(),
  cacheTtl: z.number().int().min(0).max(604800).optional(),
  creditCost: z.number().min(0).max(100).optional(),
});

providersRouter.patch('/:id/endpoints/:eid', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const eid = c.req.param('eid');

  // Auth: provider's own API key or admin
  const keyInfo = c.get('apiKeyInfo');
  const keyProvider = getDb().prepare('SELECT provider_id FROM api_keys WHERE key = ?').get(keyInfo.key) as any;
  const isOwner = keyProvider?.provider_id === providerId;
  if (!isOwner && !requireAdmin(c)) {
    return c.json({ error: 'Not authorized for this provider', code: 'PROVIDER_SCOPE_DENIED' }, 403);
  }

  // Verify endpoint belongs to this provider
  const ep = getDb().prepare('SELECT * FROM endpoints WHERE id = ? AND provider_id = ?').get(eid, providerId) as any;
  if (!ep) {
    return c.json({ error: 'Endpoint not found for this provider', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = EndpointUpdateBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid data', code: 'INVALID_DATA', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const updates = parsed.data;
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];

  if (updates.name !== undefined)        { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); vals.push(updates.description); }
  if (updates.category !== undefined)    { sets.push('category = ?'); vals.push(updates.category); }
  if (updates.baseUrl !== undefined)     { sets.push('base_url = ?'); vals.push(updates.baseUrl); }
  if (updates.path !== undefined)        { sets.push('path = ?'); vals.push(updates.path); }
  if (updates.httpMethod !== undefined)  { sets.push('http_method = ?'); vals.push(updates.httpMethod); }
  if (updates.costPerCall !== undefined) { sets.push('cost_per_call = ?'); vals.push(updates.costPerCall); }
  if (updates.latencyMs !== undefined)   { sets.push('latency_ms = ?'); vals.push(updates.latencyMs); }
  if (updates.inputSchema !== undefined) { sets.push('input_schema_json = ?'); vals.push(JSON.stringify(updates.inputSchema)); }
  if (updates.outputFields !== undefined){ sets.push('output_fields_json = ?'); vals.push(JSON.stringify(updates.outputFields)); }
  if (updates.cacheTtl !== undefined)    { sets.push('cache_ttl = ?'); vals.push(updates.cacheTtl); }
  if (updates.creditCost !== undefined)  { sets.push('credit_cost = ?'); vals.push(updates.creditCost); }

  vals.push(eid);
  getDb().prepare(`UPDATE endpoints SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  invalidateEndpointCache(eid);

  logAudit({ entityType: 'endpoint', entityId: eid, action: 'ENDPOINT_UPDATED', actorId: keyInfo.key.slice(0, 7) + '...', data: updates });

  return c.json({ ok: true, endpointId: eid, updated: Object.keys(updates) });
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

providersRouter.delete('/:id/endpoints/:eid', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const eid = c.req.param('eid');

  // Auth: provider's own API key or admin
  const keyInfo = c.get('apiKeyInfo');
  const keyProvider = getDb().prepare('SELECT provider_id FROM api_keys WHERE key = ?').get(keyInfo.key) as any;
  const isOwner = keyProvider?.provider_id === providerId;
  if (!isOwner && !requireAdmin(c)) {
    return c.json({ error: 'Not authorized for this provider', code: 'PROVIDER_SCOPE_DENIED' }, 403);
  }

  // Remove from provider_endpoints junction
  removeProviderEndpoint(providerId, eid);

  // If provider-submitted, also disable in endpoints table
  const ep = getDb().prepare('SELECT source FROM endpoints WHERE id = ? AND provider_id = ?').get(eid, providerId) as any;
  if (ep?.source === 'provider') {
    getDb().prepare("UPDATE endpoints SET status = 'disabled', updated_at = datetime('now') WHERE id = ?").run(eid);
    invalidateEndpointCache(eid);
  }

  logAudit({ entityType: 'endpoint', entityId: eid, action: 'ENDPOINT_REMOVED', actorId: keyInfo.key.slice(0, 7) + '...' });
  return c.json({ ok: true, endpointId: eid });
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

// ─── GET /v1/providers/:id/soma-check — Soma Check earnings dashboard ─────
// Provider-scoped view of If-Soma-Hash activity: cache-hit count, credits
// earned from hits (Tier 1+), projected earnings in shadow mode (Tier 0),
// agent savings, per-endpoint breakdown. window=day|week|month (default day).

providersRouter.get('/:id/soma-check', async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const windowParam = (c.req.query('window') ?? 'day') as string;
  if (!['day', 'week', 'month'].includes(windowParam)) {
    return c.json({
      error: 'Invalid window (must be day|week|month)',
      code: 'INVALID_WINDOW',
    }, 400);
  }

  const earnings = getProviderSomaCheckEarnings(providerId, windowParam as SomaCheckWindow);
  return c.json({
    ok: true,
    provider: { id: providerId, name: provider.name },
    ...earnings,
  });
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

// ─── GET /v1/providers/:id/volatility — volatility dashboard ────────────────
// Shows how stable a provider's metrics are over time: call volume variance,
// cache hit rate swings, latency jitter, error spikes, data freshness churn.
// Overall score 0-100 (higher = more volatile). ?days=7|14|30|60|90

providersRouter.get('/:id/volatility', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '30', 10) || 30, 7), 90);
  const volatility = getProviderVolatility(providerId, days);

  return c.json({
    ok: true,
    provider: { id: providerId, name: provider.name, tier: provider.tier },
    ...volatility,
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

// ─── POST /v1/providers/:id/invalidate — push-based cache invalidation ─────
// Provider tells us their data changed. We immediately invalidate cache entries.
// This eliminates stale data — provider knows best when their data updates.

providersRouter.post('/:id/invalidate', checkApiKey, async (c) => {
  const providerId = c.req.param('id');

  // Verify caller owns this provider
  const keyInfo = c.get('apiKeyInfo');
  const keyProvider = getDb().prepare('SELECT provider_id FROM api_keys WHERE key = ?').get(keyInfo.key) as any;
  const isOwner = keyProvider?.provider_id === providerId;
  if (!isOwner && !requireAdmin(c)) {
    return c.json({ error: 'Not authorized for this provider', code: 'PROVIDER_SCOPE_DENIED' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const endpointIds: string[] = (body as any).endpointIds ?? ((body as any).endpointId ? [(body as any).endpointId] : []);
  const invalidateAll = (body as any).all === true;

  if (endpointIds.length === 0 && !invalidateAll) {
    return c.json({ error: 'Provide endpointIds array, endpointId string, or all:true', code: 'VALIDATION_ERROR' }, 400);
  }

  const { invalidateByEndpoint } = await import('../cache/index');
  let totalInvalidated = 0;

  if (invalidateAll) {
    // Invalidate all endpoints belonging to this provider
    const providerEndpoints = getProviderEndpoints(providerId);
    for (const eid of providerEndpoints) {
      totalInvalidated += await invalidateByEndpoint(eid);
    }
  } else {
    // Verify endpoints belong to this provider, then invalidate
    const providerEndpoints = new Set(getProviderEndpoints(providerId));
    for (const eid of endpointIds) {
      if (providerEndpoints.has(eid)) {
        totalInvalidated += await invalidateByEndpoint(eid);
      }
    }
  }

  logAudit({ entityType: 'provider', entityId: providerId, action: 'CACHE_INVALIDATED', data: { endpointIds, invalidateAll, totalInvalidated } });
  logger.info({ providerId, totalInvalidated, endpointIds: endpointIds.length, all: invalidateAll }, 'Provider cache invalidation');

  return c.json({
    ok: true,
    invalidated: totalInvalidated,
    message: `${totalInvalidated} cache entries invalidated. Fresh data will be fetched on next request.`,
  });
});

// ─── POST /v1/providers/:id/auto-discover — auto-map endpoints from pricing URL ──
// Fetches the provider's /api/pricing endpoint, discovers all endpoints,
// auto-registers them to this provider. One-command onboarding.

providersRouter.post('/:id/auto-discover', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  // Verify caller owns this provider or is admin
  const keyInfo = c.get('apiKeyInfo');
  const keyProvider = getDb().prepare('SELECT provider_id FROM api_keys WHERE key = ?').get(keyInfo.key) as any;
  const isOwner = keyProvider?.provider_id === providerId;
  if (!isOwner && !requireAdmin(c)) {
    return c.json({ error: 'Not authorized for this provider', code: 'PROVIDER_SCOPE_DENIED' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const pricingUrl = (body as any).pricingUrl;
  if (!pricingUrl || typeof pricingUrl !== 'string') {
    return c.json({ error: 'pricingUrl is required (e.g. https://clawapis.com/api/pricing)', code: 'VALIDATION_ERROR' }, 400);
  }

  // Fetch pricing data
  let pricingData: Record<string, any>;
  try {
    const resp = await fetch(pricingUrl, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      return c.json({ error: `Failed to fetch pricing: ${resp.status}`, code: 'FETCH_FAILED' }, 502);
    }
    pricingData = await resp.json();
  } catch (err) {
    return c.json({ error: `Failed to fetch pricing URL: ${err}`, code: 'FETCH_FAILED' }, 502);
  }

  // Parse endpoints from pricing response
  // Expected format: flat object or nested { provider: { endpoint: { price, description } } }
  const discovered: Array<{ id: string; price: string; description?: string }> = [];
  const skipKeys = new Set(['totalEndpoints', 'total', 'meta', 'version', 'updatedAt', 'timestamp']);

  function parseLevel(obj: Record<string, any>, prefix: string = '') {
    for (const [key, val] of Object.entries(obj)) {
      if (skipKeys.has(key)) continue;
      if (val && typeof val === 'object' && val.price) {
        // This is an endpoint entry
        const id = prefix ? `${prefix}/${key}` : key;
        discovered.push({ id, price: String(val.price), description: val.description });
      } else if (val && typeof val === 'object' && !val.price) {
        // Nested provider/category level
        parseLevel(val, prefix ? `${prefix}/${key}` : key);
      }
    }
  }
  parseLevel(pricingData);

  // Register discovered endpoints to this provider
  let mapped = 0;
  const results: Array<{ endpoint: string; found: boolean; mapped: boolean }> = [];

  for (const ep of discovered) {
    // Try to find a matching endpoint in the registry
    const registryMatch = findEndpoint(ep.id) ?? findEndpoint(ep.id.split('/').pop() ?? '');
    if (registryMatch) {
      registerProviderEndpoint(providerId, registryMatch.id);
      mapped++;
      results.push({ endpoint: registryMatch.id, found: true, mapped: true });
    } else {
      results.push({ endpoint: ep.id, found: false, mapped: false });
    }
  }

  logAudit({ entityType: 'provider', entityId: providerId, action: 'AUTO_DISCOVERED', data: { pricingUrl, discovered: discovered.length, mapped } });
  logger.info({ providerId, pricingUrl, discovered: discovered.length, mapped }, 'Provider auto-discovery');

  return c.json({
    ok: true,
    discovered: discovered.length,
    mapped,
    unmapped: discovered.length - mapped,
    results,
    message: mapped > 0
      ? `${mapped} endpoints auto-mapped to your provider. ${discovered.length - mapped} endpoints not found in registry (may need manual registration).`
      : 'No matching endpoints found in registry. Endpoints may need to be added to the ClawNet registry first.',
    nextSteps: [
      mapped > 0 ? `Set freshness: PATCH /v1/providers/${providerId}/endpoints/:eid/freshness` : null,
      mapped > 0 ? `View revenue: GET /v1/providers/${providerId}/revenue` : null,
      'Enable push invalidation: POST /v1/providers/' + providerId + '/invalidate when your data changes',
    ].filter(Boolean),
  });
});

// ─── GET /v1/providers/:id/insights — demand insights for providers ───────
// Shows per-endpoint call volume, cache hit rates, trending endpoints,
// and actionable recommendations. Helps providers optimize their setup.

providersRouter.get('/:id/insights', checkApiKey, async (c) => {
  const providerId = c.req.param('id');
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 404);
  }

  const days = Math.min(parseInt(c.req.query('days') ?? '30', 10), 90);
  const endpoints = getProviderEndpoints(providerId);

  if (endpoints.length === 0) {
    return c.json({
      ok: true,
      provider: { id: providerId, name: provider.name },
      insights: { endpoints: [], recommendations: ['Register endpoints to start seeing demand insights.'] },
    });
  }

  // Per-endpoint demand from cache_access_log
  const placeholders = endpoints.map(() => '?').join(',');
  const endpointDemand = getDb().prepare(`
    SELECT endpoint_id,
           COUNT(*) as total_requests,
           SUM(hit) as cache_hits,
           SUM(CASE WHEN hit = 0 THEN 1 ELSE 0 END) as cache_misses,
           SUM(credits_saved) as total_credits_saved,
           ROUND(AVG(hit) * 100, 1) as cache_hit_rate
    FROM cache_access_log
    WHERE endpoint_id IN (${placeholders})
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY endpoint_id
    ORDER BY total_requests DESC
  `).all(...endpoints, days) as any[];

  // Daily trend (last 7 days vs prior 7 days for growth calc)
  const recentCalls = getDb().prepare(`
    SELECT endpoint_id, COUNT(*) as calls
    FROM cache_access_log
    WHERE endpoint_id IN (${placeholders})
      AND created_at >= datetime('now', '-7 days')
    GROUP BY endpoint_id
  `).all(...endpoints) as any[];

  const priorCalls = getDb().prepare(`
    SELECT endpoint_id, COUNT(*) as calls
    FROM cache_access_log
    WHERE endpoint_id IN (${placeholders})
      AND created_at >= datetime('now', '-14 days')
      AND created_at < datetime('now', '-7 days')
    GROUP BY endpoint_id
  `).all(...endpoints) as any[];

  const recentMap = new Map(recentCalls.map((r: any) => [r.endpoint_id, r.calls]));
  const priorMap = new Map(priorCalls.map((r: any) => [r.endpoint_id, r.calls]));

  // Enrich with registry info + freshness config
  const endpointInsights = endpointDemand.map((ep: any) => {
    const registry = findEndpoint(ep.endpoint_id);
    const recent = recentMap.get(ep.endpoint_id) ?? 0;
    const prior = priorMap.get(ep.endpoint_id) ?? 0;
    const growth = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : (recent > 0 ? 100 : 0);

    return {
      endpointId: ep.endpoint_id,
      name: registry?.name ?? ep.endpoint_id,
      category: registry?.category ?? 'unknown',
      totalRequests: ep.total_requests,
      cacheHits: ep.cache_hits,
      cacheMisses: ep.cache_misses,
      cacheHitRate: `${ep.cache_hit_rate}%`,
      creditsSaved: ep.total_credits_saved,
      weeklyGrowth: `${growth >= 0 ? '+' : ''}${growth}%`,
      trending: growth > 20,
    };
  });

  // Zero-traffic endpoints (registered but no calls)
  const activeEndpointIds = new Set(endpointDemand.map((e: any) => e.endpoint_id));
  const dormant = endpoints.filter(id => !activeEndpointIds.has(id));

  // Recommendations
  const recommendations: string[] = [];
  const highTrafficNoCacheWarm = endpointInsights
    .filter((e: any) => e.totalRequests > 50 && e.cacheHitRate !== '100.0%')
    .map((e: any) => e.endpointId);

  if (highTrafficNoCacheWarm.length > 0) {
    // Check which ones don't have cache warming enabled
    for (const eid of highTrafficNoCacheWarm.slice(0, 3)) {
      const freshness = getEndpointFreshness(eid);
      if (!freshness?.cacheWarm) {
        recommendations.push(`Enable cache warming for "${eid}" — high traffic but not all hits are cached.`);
      }
    }
  }

  const lowCacheRate = endpointInsights.filter((e: any) => parseFloat(e.cacheHitRate) < 50 && e.totalRequests > 10);
  if (lowCacheRate.length > 0) {
    recommendations.push(`${lowCacheRate.length} endpoint(s) have <50% cache hit rate. Set freshness declarations to improve.`);
  }

  if (dormant.length > 0) {
    recommendations.push(`${dormant.length} registered endpoint(s) have zero traffic. Ensure they're in the API registry.`);
  }

  const trending = endpointInsights.filter((e: any) => e.trending);
  if (trending.length > 0) {
    recommendations.push(`${trending.length} endpoint(s) trending up >20% week-over-week — consider enabling cache warming.`);
  }

  if (provider.tier === 'open') {
    recommendations.push('Upgrade to Standard tier to earn 50% of cache hit revenue (pure profit).');
  }

  return c.json({
    ok: true,
    provider: { id: providerId, name: provider.name, tier: provider.tier },
    period: `${days} days`,
    insights: {
      endpoints: endpointInsights,
      dormantEndpoints: dormant,
      summary: {
        totalEndpoints: endpoints.length,
        activeEndpoints: endpointDemand.length,
        dormantEndpoints: dormant.length,
        totalRequests: endpointInsights.reduce((s: number, e: any) => s + e.totalRequests, 0),
        avgCacheHitRate: endpointInsights.length > 0
          ? `${Math.round(endpointInsights.reduce((s: number, e: any) => s + parseFloat(e.cacheHitRate), 0) / endpointInsights.length)}%`
          : '0%',
        trendingCount: trending.length,
      },
      recommendations,
    },
  });
});

export { providersRouter };
