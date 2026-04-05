/**
 * Soma Check reference endpoints — free public data, zero provider cost.
 *
 * These endpoints exercise the Soma Check protocol end-to-end so callers can
 * try conditional payment against real data without signing up for provider
 * API keys. Each endpoint:
 *
 *   1. Fetches fresh data from a free public API (CoinGecko, GitHub, etc.)
 *   2. Computes a JCS-canonicalized SHA-256 hash
 *   3. Emits standard ETag + X-Soma-* headers per soma-check-header-spec.md
 *   4. Honors If-None-Match / If-Soma-Hash → returns 304 on match
 *   5. Logs a soma_check_events row for shadow telemetry
 *
 * No auth. No billing. Rate-limited by upstream free tiers. Cache = in-process
 * LRU keyed by (endpointId, paramsJcs) with per-endpoint TTLs.
 *
 * Endpoints:
 *   GET /v1/soma/demo/crypto-prices?ids=bitcoin,ethereum   (CoinGecko, 60s TTL)
 *   GET /v1/soma/demo/weather?lat=&lon=                     (Open-Meteo, 300s)
 *   GET /v1/soma/demo/fx?base=USD                           (exchangerate.host, 3600s)
 *   GET /v1/soma/demo/github-trending?lang=typescript       (GitHub search, 900s)
 *   GET /v1/soma/demo/chain-stats?chain=ethereum            (Blockchain.info, 60s)
 *   GET /v1/soma/demo/hn-top                                (Hacker News, 120s)
 */
import { Hono } from 'hono';
import { jcsSerialize } from '../utils/jcs';
import { somaHash } from '../utils/crypto-agility';
import { logSomaCheckEvent } from '../db/soma-check';
import { logger } from '../utils/logger';

const somaDemoRouter = new Hono();

interface DemoCacheEntry {
  hash: string;
  etag: string;
  body: unknown;
  fetchedAt: number;
  expiresAt: number;
}

const cache = new Map<string, DemoCacheEntry>();
const MAX_CACHE_ENTRIES = 512;

function cacheKey(endpointId: string, params: Record<string, unknown>): string {
  return `${endpointId}::${jcsSerialize(params)}`;
}

function evictIfNeeded() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop oldest ~64 entries
  const entries: Array<[string, DemoCacheEntry]> = [];
  cache.forEach((v, k) => entries.push([k, v]));
  entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (let i = 0; i < 64 && i < entries.length; i++) cache.delete(entries[i][0]);
}

async function serveSomaCheck(
  c: any,
  endpointId: string,
  params: Record<string, unknown>,
  ttlSeconds: number,
  fetcher: () => Promise<unknown>,
  originPriceCredits: number,
) {
  const key = cacheKey(endpointId, params);
  const now = Date.now();
  let entry = cache.get(key);

  // Refresh if expired
  if (!entry || entry.expiresAt <= now) {
    try {
      const body = await fetcher();
      const canonical = jcsSerialize(body as Record<string, unknown>);
      const hash = somaHash(canonical);
      const etag = `"sha256-${hash}"`;
      entry = {
        hash, etag, body,
        fetchedAt: now,
        expiresAt: now + ttlSeconds * 1000,
      };
      cache.set(key, entry);
      evictIfNeeded();
    } catch (err) {
      logger.warn({ err, endpointId }, 'soma-demo fetch failed');
      return c.json({ error: 'Upstream fetch failed', code: 'UPSTREAM_ERROR' }, 502);
    }
  }

  // Conditional request check (standard ETag + Soma aliases)
  const clientETag =
    c.req.header('If-None-Match') ||
    c.req.header('If-Soma-Hash') ||
    c.req.header('If-Fresh-Hash');

  const matches = !!clientETag && (
    clientETag === entry.etag ||
    clientETag === entry.hash ||
    clientETag === `"sha256-${entry.hash}"`
  );

  // Standard + Soma headers per soma-check-header-spec.md
  c.header('ETag', entry.etag);
  c.header('Cache-Control', `public, max-age=${Math.max(0, Math.floor((entry.expiresAt - now) / 1000))}`);
  c.header('X-Soma-Hash', entry.hash);
  c.header('X-Soma-Protocol', 'soma-check/1.0');
  c.header('X-Soma-Ttl', String(Math.max(0, Math.floor((entry.expiresAt - now) / 1000))));
  c.header('X-Soma-Tier', '0');
  c.header('X-Soma-Freshness-Price', '0');
  c.header('X-Soma-Freshness-Rail', 'free');

  // Telemetry — every demo call
  logSomaCheckEvent({
    endpointId, cacheKey: key,
    hash: entry.hash, clientIfNoneMatch: clientETag ?? null,
    wouldHaveHit: matches, wasHit: matches,
    originPriceCredits, hitPriceCredits: 0,
    rail: 'credits', tier: 0, shadowMode: false,
  });

  if (matches) {
    c.header('X-Soma-Hit', 'true');
    return c.body(null, 304);
  }

  c.header('X-Soma-Hit', 'false');
  return c.json({
    endpointId,
    protocol: 'soma-check/1.0',
    hash: entry.hash,
    etag: entry.etag,
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    data: entry.body,
  });
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ClawNet-SomaCheck-Demo/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. Crypto prices (CoinGecko) ─────────────────────────────────────────────
somaDemoRouter.get('/crypto-prices', (c) => {
  const ids = (c.req.query('ids') ?? 'bitcoin,ethereum,solana').toLowerCase();
  const vs = (c.req.query('vs') ?? 'usd').toLowerCase();
  return serveSomaCheck(c, 'soma-demo-crypto-prices', { ids, vs }, 60,
    () => fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}`),
    10);
});

// ── 2. Weather (Open-Meteo, no key required) ─────────────────────────────────
somaDemoRouter.get('/weather', (c) => {
  const lat = c.req.query('lat') ?? '40.7128';
  const lon = c.req.query('lon') ?? '-74.0060';
  return serveSomaCheck(c, 'soma-demo-weather', { lat, lon }, 300,
    () => fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,wind_speed_10m,relative_humidity_2m`),
    5);
});

// ── 3. FX rates (exchangerate.host) ──────────────────────────────────────────
somaDemoRouter.get('/fx', (c) => {
  const base = (c.req.query('base') ?? 'USD').toUpperCase();
  return serveSomaCheck(c, 'soma-demo-fx', { base }, 3600,
    () => fetchJson(`https://api.exchangerate.host/latest?base=${encodeURIComponent(base)}`),
    3);
});

// ── 4. GitHub trending (public search API) ───────────────────────────────────
somaDemoRouter.get('/github-trending', (c) => {
  const lang = (c.req.query('lang') ?? 'typescript').toLowerCase();
  const since = c.req.query('since') ?? 'daily';
  const daysAgo = since === 'weekly' ? 7 : since === 'monthly' ? 30 : 1;
  const date = new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);
  return serveSomaCheck(c, 'soma-demo-github-trending', { lang, since }, 900,
    () => fetchJson(`https://api.github.com/search/repositories?q=language:${encodeURIComponent(lang)}+created:>${date}&sort=stars&order=desc&per_page=10`),
    15);
});

// ── 5. Chain stats (Blockchain.info) ─────────────────────────────────────────
somaDemoRouter.get('/chain-stats', (c) => {
  const chain = (c.req.query('chain') ?? 'bitcoin').toLowerCase();
  return serveSomaCheck(c, 'soma-demo-chain-stats', { chain }, 60,
    () => fetchJson('https://api.blockchain.info/stats'),
    5);
});

// ── 6. Hacker News top stories ───────────────────────────────────────────────
somaDemoRouter.get('/hn-top', (c) => {
  return serveSomaCheck(c, 'soma-demo-hn-top', {}, 120,
    async () => {
      const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json') as number[];
      const top10 = ids.slice(0, 10);
      const stories = await Promise.all(
        top10.map((id) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)),
      );
      return { stories };
    },
    8);
});

// ── Catalog ──────────────────────────────────────────────────────────────────
somaDemoRouter.get('/', (c) => {
  return c.json({
    protocol: 'soma-check/1.0',
    description: 'Free reference endpoints for exercising Soma Check conditional payment.',
    endpoints: [
      { id: 'soma-demo-crypto-prices',   path: '/v1/soma/demo/crypto-prices',   ttl: 60,   upstream: 'CoinGecko' },
      { id: 'soma-demo-weather',         path: '/v1/soma/demo/weather',         ttl: 300,  upstream: 'Open-Meteo' },
      { id: 'soma-demo-fx',              path: '/v1/soma/demo/fx',              ttl: 3600, upstream: 'exchangerate.host' },
      { id: 'soma-demo-github-trending', path: '/v1/soma/demo/github-trending', ttl: 900,  upstream: 'GitHub' },
      { id: 'soma-demo-chain-stats',     path: '/v1/soma/demo/chain-stats',     ttl: 60,   upstream: 'Blockchain.info' },
      { id: 'soma-demo-hn-top',          path: '/v1/soma/demo/hn-top',          ttl: 120,  upstream: 'Hacker News' },
    ],
    usage: {
      firstCall: 'GET the endpoint — response includes ETag header and X-Soma-Hash.',
      subsequent: 'Send If-None-Match: <etag> on next call. If data unchanged, server returns 304 (no body, no charge).',
    },
  });
});

export default somaDemoRouter;
