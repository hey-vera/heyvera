/**
 * Unit tests — Vouch ranking formula
 *
 * Validates the weighted scoring:
 *   score = (0.40*trust + 0.20*volume + 0.20*tenure + 0.10*freshness + 0.10*hits) * somaBonus
 */
import { describe, expect, it } from 'vitest';
import { rankProvider } from '../../src/core/vouch-ranking';

const NOW = Date.now();
const DAY_MS = 86_400_000;

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

describe('rankProvider', () => {
  it('uses trust=50 default for brand-new providers (no signals)', () => {
    // A provider that just registered with no calls, no tenure, default trust
    // should still show a baseline 20% score (0.40 weight * 0.5 trust default).
    // Floor > 0 ensures discovery works at launch before any reputation exists.
    const r = rankProvider({
      trustScore: 0,           // treated as null / use default 50
      totalCalls: 0,
      totalCacheHits: 0,
      createdAt: daysAgo(0),
      lastCallAt: null,
      somaEnabled: false,
      verified: false,
      somaCheckTier: 0,
    });
    expect(r.score).toBe(20);
    expect(r.factors.trust).toBe(0.5);
  });

  it('rewards high trust + volume + tenure', () => {
    const r = rankProvider({
      trustScore: 100,
      totalCalls: 100_000, // saturates volume
      totalCacheHits: 50_000,
      createdAt: daysAgo(180), // saturates tenure
      lastCallAt: daysAgo(0), // saturates freshness
      somaEnabled: false,
      verified: false,
      somaCheckTier: 0,
    });
    // All 5 factors pegged at 1.0, bonus = 1.0 → score = 100
    expect(r.score).toBe(100);
    expect(r.factors.trust).toBe(1);
    expect(r.factors.volume).toBe(1);
    expect(r.factors.tenure).toBe(1);
    expect(r.factors.freshness).toBe(1);
  });

  it('applies verified bonus (1.25x)', () => {
    const base = rankProvider({
      trustScore: 50, totalCalls: 1000, totalCacheHits: 100,
      createdAt: daysAgo(30), lastCallAt: daysAgo(1),
      somaEnabled: false, verified: false, somaCheckTier: 0,
    });
    const verified = rankProvider({
      trustScore: 50, totalCalls: 1000, totalCacheHits: 100,
      createdAt: daysAgo(30), lastCallAt: daysAgo(1),
      somaEnabled: true, verified: true, somaCheckTier: 0,
    });
    expect(verified.factors.somaBonus).toBe(1.25);
    expect(verified.score).toBeGreaterThan(base.score);
  });

  it('applies champion tier bonus (1.30x) over verified', () => {
    const r = rankProvider({
      trustScore: 80, totalCalls: 5000, totalCacheHits: 1000,
      createdAt: daysAgo(60), lastCallAt: daysAgo(0),
      somaEnabled: true, verified: true, somaCheckTier: 3,
    });
    expect(r.factors.somaBonus).toBe(1.30);
  });

  it('freshness decays over 14 days', () => {
    const fresh = rankProvider({
      trustScore: 50, totalCalls: 100, totalCacheHits: 0,
      createdAt: daysAgo(30), lastCallAt: daysAgo(0),
      somaEnabled: false, verified: false, somaCheckTier: 0,
    });
    const stale = rankProvider({
      trustScore: 50, totalCalls: 100, totalCacheHits: 0,
      createdAt: daysAgo(30), lastCallAt: daysAgo(20),
      somaEnabled: false, verified: false, somaCheckTier: 0,
    });
    expect(fresh.factors.freshness).toBeGreaterThan(stale.factors.freshness);
    expect(stale.factors.freshness).toBe(0);
  });

  it('hit-rate factor saturates at 50%', () => {
    const low = rankProvider({
      trustScore: 50, totalCalls: 1000, totalCacheHits: 100, // 10% hit rate
      createdAt: daysAgo(10), lastCallAt: daysAgo(0),
      somaEnabled: false, verified: false, somaCheckTier: 0,
    });
    const high = rankProvider({
      trustScore: 50, totalCalls: 1000, totalCacheHits: 500, // 50% hit rate
      createdAt: daysAgo(10), lastCallAt: daysAgo(0),
      somaEnabled: false, verified: false, somaCheckTier: 0,
    });
    expect(high.factors.hits).toBe(1);
    expect(low.factors.hits).toBeCloseTo(0.2, 2);
  });

  it('score never exceeds 100 even with max bonus', () => {
    const r = rankProvider({
      trustScore: 100, totalCalls: 1_000_000, totalCacheHits: 900_000,
      createdAt: daysAgo(365), lastCallAt: daysAgo(0),
      somaEnabled: true, verified: true, somaCheckTier: 3,
    });
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
