/**
 * Vouch search — trust-weighted provider discovery queries.
 *
 * Data sources: providers + provider_endpoints + provider_analytics.
 * Joined at the app layer (not via SQL) to keep the ranking formula in one
 * place and composable with indexed_endpoints / apiRegistry lookups.
 */
import { getDb } from './connection';
import { rankProvider, type VouchRankResult } from '../core/vouch-ranking';

export interface VouchEntry {
  providerId: string;
  slug: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  verified: boolean;
  somaEnabled: boolean;
  somaCheckTier: number;
  endpointCount: number;
  totalCalls: number;
  totalCacheHits: number;
  createdAt: string;
  lastCallAt: string | null;
  rank: VouchRankResult;
}

export interface VouchSearchOpts {
  q?: string;              // keyword match on name/description/slug
  category?: string;       // matches provider_endpoints joined against indexed_endpoints.category
  verifiedOnly?: boolean;
  somaEnabledOnly?: boolean;
  minTier?: number;        // min soma_check_tier
  limit?: number;          // default 20, max 100
  offset?: number;         // default 0
}

export interface VouchSearchResult {
  total: number;
  results: VouchEntry[];
  query: VouchSearchOpts;
}

/** Rank and filter active providers. Returns newest-first by default for tie-breaks. */
export function searchVouch(opts: VouchSearchOpts = {}): VouchSearchResult {
  const db = getDb();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const offset = Math.max(0, opts.offset ?? 0);

  const where: string[] = ["status = 'active'"];
  const args: unknown[] = [];

  if (opts.q) {
    where.push('(name LIKE ? OR description LIKE ? OR slug LIKE ?)');
    const like = `%${opts.q}%`;
    args.push(like, like, like);
  }
  if (opts.verifiedOnly) where.push('verified = 1');
  if (opts.somaEnabledOnly) where.push('soma_enabled = 1');
  if (typeof opts.minTier === 'number') {
    where.push('soma_check_tier >= ?');
    args.push(opts.minTier);
  }

  const whereSql = where.join(' AND ');
  const total = (db
    .prepare(`SELECT COUNT(*) AS n FROM providers WHERE ${whereSql}`)
    .get(...args) as { n: number }).n;

  const providers = db
    .prepare(`SELECT * FROM providers WHERE ${whereSql} ORDER BY trust_score DESC, created_at DESC`)
    .all(...args) as Array<{
      id: string; slug: string; name: string; description: string | null; website_url: string | null;
      verified: number; soma_enabled: number; soma_check_tier: number; trust_score: number;
      total_calls: number; total_cache_hits: number; created_at: string;
    }>;

  // Category filter is done via provider_endpoints → indexed_endpoints join.
  let categoryFiltered: Set<string> | null = null;
  if (opts.category) {
    const rows = db
      .prepare(`
        SELECT DISTINCT pe.provider_id AS pid
        FROM provider_endpoints pe
        JOIN indexed_endpoints ie ON ie.id = pe.endpoint_id
        WHERE ie.category = ?
      `)
      .all(opts.category) as { pid: string }[];
    categoryFiltered = new Set(rows.map(r => r.pid));
  }

  // Per-provider enrichment: endpoint count + last-call-at.
  const entries: VouchEntry[] = [];
  for (const p of providers) {
    if (categoryFiltered && !categoryFiltered.has(p.id)) continue;

    const { n: endpointCount } = db
      .prepare('SELECT COUNT(*) AS n FROM provider_endpoints WHERE provider_id = ?')
      .get(p.id) as { n: number };

    const lastRow = db
      .prepare('SELECT MAX(date) AS d FROM provider_analytics WHERE provider_id = ?')
      .get(p.id) as { d: string | null };

    const rank = rankProvider({
      trustScore: p.trust_score,
      totalCalls: p.total_calls,
      totalCacheHits: p.total_cache_hits,
      createdAt: p.created_at,
      lastCallAt: lastRow.d ? `${lastRow.d}T00:00:00Z` : null,
      somaEnabled: !!p.soma_enabled,
      verified: !!p.verified,
      somaCheckTier: p.soma_check_tier ?? 0,
    });

    entries.push({
      providerId: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      websiteUrl: p.website_url,
      verified: !!p.verified,
      somaEnabled: !!p.soma_enabled,
      somaCheckTier: p.soma_check_tier ?? 0,
      endpointCount,
      totalCalls: p.total_calls,
      totalCacheHits: p.total_cache_hits,
      createdAt: p.created_at,
      lastCallAt: lastRow.d ? `${lastRow.d}T00:00:00Z` : null,
      rank,
    });
  }

  // Sort by rank score descending, tie-break by endpoint count.
  entries.sort((a, b) => b.rank.score - a.rank.score || b.endpointCount - a.endpointCount);

  return {
    total: categoryFiltered ? entries.length : total,
    results: entries.slice(offset, offset + limit),
    query: opts,
  };
}

/** Fetch a single provider's Vouch entry by slug (used by agent-card route). */
export function getVouchEntryBySlug(slug: string): VouchEntry | null {
  const r = searchVouch({ q: slug, limit: 10 });
  return r.results.find(e => e.slug === slug) ?? null;
}
