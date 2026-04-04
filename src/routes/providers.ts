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
} from '../db/index';
import { findEndpoint } from '../config/api-registry';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { getDb, logAudit } from '../db/index';
import { cacheIncr } from '../cache/index';
import { getClientIp } from '../middleware/rate-limit';

const providersRouter = new Hono();

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
    nextSteps: [
      'Your API key is now linked to this provider.',
      'Once activated, register your endpoints via POST /v1/providers/:id/endpoints.',
      'You earn 90% of endpoint revenue on live calls through ClawNet.',
      'Cache hits = $0 cost for you (your server is not touched).',
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
