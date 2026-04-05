/**
 * Soma Vouch — trust-weighted provider discovery API.
 *
 * The trust layer that sits on top of any agent directory (A2A, MCP bazaar,
 * x402 self-propagation). Discovery is the commodity; trust is the moat.
 *
 *   GET /v1/soma/vouch/search
 *     ?q=<keyword>
 *     &category=<category>
 *     &verified=1
 *     &somaEnabled=1
 *     &minTier=<0..3>
 *     &limit=<1..100>
 *     &offset=<0+>
 *
 *   GET /v1/soma/vouch/providers/:slug           — single provider detail + rank
 *   GET /v1/soma/vouch/providers/:slug/agent-card.json — A2A-compatible card
 *
 * Positioning: A2A Protocol (Google + LF) ships capability-matching only.
 * We differentiate on trust-weighted ranking using signals A2A doesn't have
 * (trust_score, cache-hit history, Soma tier, verification status).
 */
import { Hono } from 'hono';
import { searchVouch, getVouchEntryBySlug } from '../db/vouch';
import { getProviderEndpoints } from '../db/providers';
import { env } from '../config/index';

const router = new Hono();

router.get('/search', (c) => {
  const url = new URL(c.req.url);
  const result = searchVouch({
    q: url.searchParams.get('q') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    verifiedOnly: url.searchParams.get('verified') === '1',
    somaEnabledOnly: url.searchParams.get('somaEnabled') === '1',
    minTier: url.searchParams.get('minTier') !== null
      ? parseInt(url.searchParams.get('minTier')!, 10)
      : undefined,
    limit: url.searchParams.get('limit') !== null
      ? parseInt(url.searchParams.get('limit')!, 10)
      : undefined,
    offset: url.searchParams.get('offset') !== null
      ? parseInt(url.searchParams.get('offset')!, 10)
      : undefined,
  });
  return c.json({
    protocol: 'soma-vouch/0.1',
    ...result,
  });
});

router.get('/providers/:slug', (c) => {
  const slug = c.req.param('slug');
  const entry = getVouchEntryBySlug(slug);
  if (!entry) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND', slug }, 404);
  }
  return c.json({ protocol: 'soma-vouch/0.1', entry });
});

router.get('/providers/:slug/agent-card.json', (c) => {
  const slug = c.req.param('slug');
  const entry = getVouchEntryBySlug(slug);
  if (!entry) {
    return c.json({ error: 'Provider not found', code: 'PROVIDER_NOT_FOUND', slug }, 404);
  }

  // A2A-compatible agent-card format. Extended with Soma Vouch fields.
  // Spec: https://a2a-protocol.org/latest/specification/
  const endpoints = getProviderEndpoints(entry.providerId);
  const baseUrl = env.CLAWNET_BASE_URL.replace(/\/$/, '');

  return c.json({
    schemaVersion: '0.2',
    name: entry.name,
    description: entry.description ?? '',
    url: entry.websiteUrl ?? `${baseUrl}/v1/providers/${slug}`,
    provider: {
      organization: entry.name,
      url: entry.websiteUrl,
    },
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: endpoints.map(epId => ({
      id: epId,
      name: epId,
      tags: ['api', 'x402'],
    })),
    // Vouch extensions (non-A2A-standard, prefixed x-vouch-*).
    'x-vouch': {
      protocol: 'soma-vouch/0.1',
      providerId: entry.providerId,
      verified: entry.verified,
      somaEnabled: entry.somaEnabled,
      somaCheckTier: entry.somaCheckTier,
      rank: entry.rank,
      endpointCount: entry.endpointCount,
      totalCalls: entry.totalCalls,
      totalCacheHits: entry.totalCacheHits,
      createdAt: entry.createdAt,
      lastCallAt: entry.lastCallAt,
      invokeUrl: `${baseUrl}/v1/endpoints/{endpointId}/call`,
    },
  });
});

export default router;
