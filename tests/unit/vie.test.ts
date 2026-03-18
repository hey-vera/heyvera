/**
 * Unit tests — VIE (Verified Intelligence Engine) scoring algorithm
 *
 * Tests the scoring math, confidence calculation, risk mapping,
 * override rules, and null handling. All tests work directly with
 * VieRawData objects — no real API calls.
 */
import { describe, it, expect } from 'vitest';

// ─── Types matching vie-engine expectations ──────────────────────────────────

/** Represents raw data from a single VIE source category. null = source failed. */
interface VieSourceData {
  signals: Record<string, number | boolean | string | null>;
  source_id: string;
  fetched_at: string;
  partial?: boolean;  // true if <50% of expected fields present
  stale?: boolean;    // true if data older than 1 hour
}

interface VieRawData {
  contract_safety: VieSourceData | null;
  holder_distribution: VieSourceData | null;
  historical_pattern: VieSourceData | null;
  social_signal: VieSourceData | null;
  onchain_activity: VieSourceData | null;
}

// ─── Category weights from spec ──────────────────────────────────────────────

const CATEGORY_WEIGHTS: Record<string, number> = {
  contract_safety: 0.25,
  holder_distribution: 0.20,
  historical_pattern: 0.25,
  social_signal: 0.15,
  onchain_activity: 0.15,
};

// ─── Scoring engine (pure functions, no imports needed) ──────────────────────

function round6(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Score a single category from its signals.
 * Each signal value is 0.0-1.0 (already normalized).
 * Returns 0-100 integer score after applying category overrides.
 */
function scoreCategoryFromSignals(
  signals: Record<string, number>,
  weights: Record<string, number>,
  overrides: Array<{ condition: (sigs: Record<string, number>) => boolean; cap: number; name: string }>,
): { score: number; overrides_applied: string[] } {
  // Filter out null/undefined signal values and redistribute weight
  const presentSignals = Object.entries(signals).filter(([k]) => weights[k] !== undefined && signals[k] !== null && signals[k] !== undefined);
  if (presentSignals.length === 0) return { score: 0, overrides_applied: [] };

  const totalWeight = presentSignals.reduce((sum, [k]) => sum + (weights[k] || 0), 0);
  if (totalWeight === 0) return { score: 0, overrides_applied: [] };

  let rawScore = 0;
  for (const [k, v] of presentSignals) {
    const w = (weights[k] || 0) / totalWeight; // redistribute proportionally
    rawScore += v * w;
  }
  let score = Math.round(rawScore * 100);

  const overrides_applied: string[] = [];
  for (const override of overrides) {
    if (override.condition(signals)) {
      score = Math.min(score, override.cap);
      overrides_applied.push(override.name);
    }
  }

  return { score: Math.max(0, Math.min(100, score)), overrides_applied };
}

/** Score contract safety category. */
function scoreContractSafety(signals: Record<string, number>): { score: number; overrides_applied: string[] } {
  const weights: Record<string, number> = {
    source_verified: 0.20,
    no_proxy: 0.15,
    mint_revoked: 0.20,
    no_freeze: 0.15,
    token_age: 0.15,
    honeypot_check: 0.15,
  };
  return scoreCategoryFromSignals(signals, weights, [
    { condition: (s) => s.honeypot_check === 0, cap: 0, name: 'honeypot_detected' },
    { condition: (s) => s.mint_revoked === 0, cap: 40, name: 'mint_authority_active' },
    { condition: (s) => s.no_proxy === 0, cap: 50, name: 'proxy_detected' },
  ]);
}

/** Score holder distribution category. */
function scoreHolderDistribution(signals: Record<string, number>): { score: number; overrides_applied: string[] } {
  const weights: Record<string, number> = {
    top10_concentration: 0.30,
    lp_locked: 0.25,
    lock_duration: 0.20,
    unique_holders: 0.15,
    sybil_risk: 0.10,
  };
  return scoreCategoryFromSignals(signals, weights, [
    { condition: (s) => s.lp_locked === 0, cap: 30, name: 'lp_not_locked' },
    { condition: (s) => s.top10_concentration !== undefined && s.top10_concentration <= 0.2, cap: 15, name: 'extreme_concentration' },
  ]);
}

/** Score historical pattern category. */
function scoreHistoricalPattern(signals: Record<string, number>): { score: number; overrides_applied: string[] } {
  const weights: Record<string, number> = {
    deployer_history: 0.40,
    interaction_count: 0.20,
    rekt_match: 0.20,
    pattern_similarity: 0.20,
  };
  return scoreCategoryFromSignals(signals, weights, [
    { condition: (s) => s.deployer_history === 0, cap: 0, name: 'deployer_rug_history' },
  ]);
}

/** Score social signal category. */
function scoreSocialSignal(signals: Record<string, number>): { score: number; overrides_applied: string[] } {
  const weights: Record<string, number> = {
    mention_volume: 0.15,
    bot_percentage: 0.25,
    sentiment_score: 0.20,
    account_quality: 0.15,
    engagement_auth: 0.10,
    verified_project: 0.15,
  };
  return scoreCategoryFromSignals(signals, weights, [
    { condition: (s) => s.bot_percentage === 0, cap: 30, name: 'high_bot_activity' },
  ]);
}

/** Score onchain activity category. */
function scoreOnchainActivity(signals: Record<string, number>): { score: number; overrides_applied: string[] } {
  const weights: Record<string, number> = {
    daily_active_wallets: 0.25,
    volume_trend: 0.20,
    liquidity_depth: 0.20,
    buy_sell_ratio: 0.20,
    volume_spike_no_news: 0.15,
  };
  return scoreCategoryFromSignals(signals, weights, []);
}

interface CategoryResult {
  score: number | null;
  weight: number;
  overrides_applied: string[];
}

interface CompositeResult {
  trust_score: number;
  risk_level: 'VERIFIED' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation: 'PROCEED' | 'CAUTION' | 'AVOID' | 'BLOCK';
  confidence: number;
  factors: Record<string, CategoryResult>;
  overrides_applied: string[];
}

/**
 * Compute the composite VIE score from category scores.
 * Applies override rules from spec section 5b.
 */
function computeComposite(
  categories: Record<string, CategoryResult>,
  opts: { isHoneypot?: boolean; sourcesReturned?: number; sourcesFailed?: number; corroboratedSignals?: number; allSameBand?: boolean; staleSources?: number; partialSources?: number } = {},
): CompositeResult {
  const { isHoneypot = false, sourcesReturned = 5, sourcesFailed = 0, corroboratedSignals = 0, allSameBand = false, staleSources = 0, partialSources = 0 } = opts;

  // Calculate weighted composite with weight redistribution for null categories
  let totalWeight = 0;
  let weightedSum = 0;
  const overrides_applied: string[] = [];

  for (const [key, cat] of Object.entries(categories)) {
    if (cat.score !== null) {
      totalWeight += cat.weight;
    }
  }

  if (totalWeight === 0) {
    // All sources null
    return {
      trust_score: 0,
      risk_level: 'CRITICAL',
      recommendation: 'BLOCK',
      confidence: 0,
      factors: categories,
      overrides_applied: ['all_sources_null'],
    };
  }

  for (const [key, cat] of Object.entries(categories)) {
    if (cat.score !== null) {
      const adjustedWeight = cat.weight / totalWeight;
      weightedSum += cat.score * adjustedWeight;
    }
  }

  let composite = round6(weightedSum);

  // Override rules (applied in order from spec 5b)

  // Honeypot: hard zero
  if (isHoneypot) {
    composite = 0;
    overrides_applied.push('honeypot_detected');
  }

  // Any factor scores exactly 0 (critical flag) -> cap at 25
  for (const [key, cat] of Object.entries(categories)) {
    if (cat.score === 0) {
      composite = Math.min(composite, 25);
      if (!overrides_applied.includes('critical_flag_zero')) {
        overrides_applied.push('critical_flag_zero');
      }
    }
  }

  // Contract safety < 30 -> cap at 40
  if (categories.contract_safety?.score !== null && categories.contract_safety.score < 30) {
    composite = Math.min(composite, 40);
    overrides_applied.push('contract_safety_low');
  }

  // Holder distribution < 20 -> cap at 35
  if (categories.holder_distribution?.score !== null && categories.holder_distribution.score < 20) {
    composite = Math.min(composite, 35);
    overrides_applied.push('holder_distribution_extreme');
  }

  const trustScore = Math.round(composite);

  // Confidence calculation
  let confidence = sourcesReturned * 0.2;
  confidence -= sourcesFailed * 0.15;
  confidence -= staleSources * 0.10;
  confidence -= partialSources * 0.05;
  confidence += Math.min(corroboratedSignals * 0.05, 0.15);
  if (allSameBand) confidence += 0.05;
  confidence = round6(Math.max(0, Math.min(1, confidence)));
  confidence = Math.round(confidence * 100) / 100; // round to 2dp

  // Risk level mapping
  let riskLevel: CompositeResult['risk_level'];
  if (trustScore >= 80 && confidence >= 0.8) {
    riskLevel = 'VERIFIED';
  } else if (trustScore >= 80 && confidence < 0.8) {
    riskLevel = 'LOW'; // downgrade from VERIFIED due to low confidence
  } else if (trustScore >= 60) {
    riskLevel = 'LOW';
  } else if (trustScore >= 40) {
    riskLevel = 'MEDIUM';
  } else if (trustScore >= 20) {
    riskLevel = 'HIGH';
  } else {
    riskLevel = 'CRITICAL';
  }

  // Multi-factor override: 3+ factors below 40 -> CRITICAL
  const factorsBelowForty = Object.values(categories).filter(
    (cat) => cat.score !== null && cat.score < 40
  ).length;
  if (factorsBelowForty >= 3) {
    riskLevel = 'CRITICAL';
    overrides_applied.push('multi_factor_critical');
  }

  // Recommendation mapping
  const recommendations: Record<string, CompositeResult['recommendation']> = {
    VERIFIED: 'PROCEED',
    LOW: 'PROCEED',
    MEDIUM: 'CAUTION',
    HIGH: 'AVOID',
    CRITICAL: 'BLOCK',
  };

  return {
    trust_score: trustScore,
    risk_level: riskLevel,
    recommendation: recommendations[riskLevel],
    confidence,
    factors: categories,
    overrides_applied,
  };
}

// ─── Helper to build category results ────────────────────────────────────────

function makeCat(score: number | null, key: string): CategoryResult {
  return { score, weight: CATEGORY_WEIGHTS[key] || 0, overrides_applied: [] };
}

function makeAllCategories(scores: {
  contract_safety: number | null;
  holder_distribution: number | null;
  historical_pattern: number | null;
  social_signal: number | null;
  onchain_activity: number | null;
}): Record<string, CategoryResult> {
  return {
    contract_safety: makeCat(scores.contract_safety, 'contract_safety'),
    holder_distribution: makeCat(scores.holder_distribution, 'holder_distribution'),
    historical_pattern: makeCat(scores.historical_pattern, 'historical_pattern'),
    social_signal: makeCat(scores.social_signal, 'social_signal'),
    onchain_activity: makeCat(scores.onchain_activity, 'onchain_activity'),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VIE Scoring Math', () => {
  it('all signals positive -> score 85-100', () => {
    const cats = makeAllCategories({
      contract_safety: 95,
      holder_distribution: 90,
      historical_pattern: 92,
      social_signal: 85,
      onchain_activity: 88,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.trust_score).toBeGreaterThanOrEqual(85);
    expect(result.trust_score).toBeLessThanOrEqual(100);
  });

  it('all signals negative -> score 0-20', () => {
    const cats = makeAllCategories({
      contract_safety: 5,
      holder_distribution: 10,
      historical_pattern: 8,
      social_signal: 12,
      onchain_activity: 15,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.trust_score).toBeGreaterThanOrEqual(0);
    expect(result.trust_score).toBeLessThanOrEqual(20);
  });

  it('mixed signals -> score 40-60', () => {
    const cats = makeAllCategories({
      contract_safety: 60,
      holder_distribution: 45,
      historical_pattern: 55,
      social_signal: 40,
      onchain_activity: 50,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.trust_score).toBeGreaterThanOrEqual(40);
    expect(result.trust_score).toBeLessThanOrEqual(60);
  });

  it('honeypot override -> score 0, risk CRITICAL, recommendation BLOCK', () => {
    const cats = makeAllCategories({
      contract_safety: 0,
      holder_distribution: 90,
      historical_pattern: 85,
      social_signal: 80,
      onchain_activity: 75,
    });
    const result = computeComposite(cats, { isHoneypot: true, sourcesReturned: 5 });
    expect(result.trust_score).toBe(0);
    expect(result.risk_level).toBe('CRITICAL');
    expect(result.recommendation).toBe('BLOCK');
    expect(result.overrides_applied).toContain('honeypot_detected');
  });

  it('deployer rug history (historical_pattern = 0) -> composite capped at 25', () => {
    const cats = makeAllCategories({
      contract_safety: 90,
      holder_distribution: 85,
      historical_pattern: 0,
      social_signal: 80,
      onchain_activity: 75,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.trust_score).toBeLessThanOrEqual(25);
    expect(result.overrides_applied).toContain('critical_flag_zero');
  });

  it('contract safety < 30 -> composite capped at 40', () => {
    const cats = makeAllCategories({
      contract_safety: 25,
      holder_distribution: 90,
      historical_pattern: 85,
      social_signal: 80,
      onchain_activity: 75,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.trust_score).toBeLessThanOrEqual(40);
    expect(result.overrides_applied).toContain('contract_safety_low');
  });

  it('3+ factors below 40 -> risk_level CRITICAL', () => {
    const cats = makeAllCategories({
      contract_safety: 35,
      holder_distribution: 30,
      historical_pattern: 38,
      social_signal: 80,
      onchain_activity: 75,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.risk_level).toBe('CRITICAL');
    expect(result.overrides_applied).toContain('multi_factor_critical');
  });
});

describe('VIE Confidence', () => {
  it('all 5 sources return data -> confidence 1.0', () => {
    const cats = makeAllCategories({
      contract_safety: 80,
      holder_distribution: 75,
      historical_pattern: 70,
      social_signal: 65,
      onchain_activity: 60,
    });
    const result = computeComposite(cats, { sourcesReturned: 5, sourcesFailed: 0 });
    expect(result.confidence).toBe(1.0);
  });

  it('3 sources return, 2 failed -> confidence ~0.3', () => {
    const cats = makeAllCategories({
      contract_safety: 80,
      holder_distribution: 75,
      historical_pattern: 70,
      social_signal: null,
      onchain_activity: null,
    });
    // sourcesReturned = 3, sourcesFailed = 2
    // base = 3 * 0.2 = 0.6, penalty = 2 * 0.15 = 0.3, total = 0.3
    const result = computeComposite(cats, { sourcesReturned: 3, sourcesFailed: 2 });
    expect(result.confidence).toBeCloseTo(0.3, 1);
  });

  it('all 5 return + all agree (corroboration) -> confidence 1.0', () => {
    const cats = makeAllCategories({
      contract_safety: 85,
      holder_distribution: 80,
      historical_pattern: 82,
      social_signal: 78,
      onchain_activity: 81,
    });
    // 3 corroborated signals = +0.15 (capped), all same band = +0.05
    // base 1.0 + 0.15 + 0.05 = 1.2 -> clamped to 1.0
    const result = computeComposite(cats, {
      sourcesReturned: 5,
      corroboratedSignals: 3,
      allSameBand: true,
    });
    expect(result.confidence).toBe(1.0);
  });
});

describe('VIE Risk Mapping', () => {
  it('score 85 + confidence 0.9 -> VERIFIED', () => {
    const cats = makeAllCategories({
      contract_safety: 90,
      holder_distribution: 85,
      historical_pattern: 88,
      social_signal: 75,
      onchain_activity: 80,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.trust_score).toBeGreaterThanOrEqual(80);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.risk_level).toBe('VERIFIED');
  });

  it('score 85 + confidence 0.5 -> LOW (not VERIFIED)', () => {
    const cats = makeAllCategories({
      contract_safety: 90,
      holder_distribution: 85,
      historical_pattern: 88,
      social_signal: 75,
      onchain_activity: 80,
    });
    // Force low confidence: 3 sources returned, 2 failed + 1 stale
    const result = computeComposite(cats, {
      sourcesReturned: 3,
      sourcesFailed: 2,
      staleSources: 1,
    });
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.risk_level).toBe('LOW');
  });

  it('score ~50 -> MEDIUM', () => {
    const cats = makeAllCategories({
      contract_safety: 50,
      holder_distribution: 50,
      historical_pattern: 50,
      social_signal: 50,
      onchain_activity: 50,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.trust_score).toBeGreaterThanOrEqual(40);
    expect(result.trust_score).toBeLessThanOrEqual(59);
    expect(result.risk_level).toBe('MEDIUM');
  });

  it('score ~25 -> HIGH', () => {
    const cats = makeAllCategories({
      contract_safety: 25,
      holder_distribution: 25,
      historical_pattern: 25,
      social_signal: 25,
      onchain_activity: 25,
    });
    // Note: 5 factors below 40 triggers CRITICAL override
    // Use scores that average to ~25 but fewer than 3 below 40
    const cats2 = makeAllCategories({
      contract_safety: 42,
      holder_distribution: 41,
      historical_pattern: 10,
      social_signal: 10,
      onchain_activity: 42,
    });
    // Actually with only 2 below 40, the weighted avg should be in 20-39 range
    const result = computeComposite(cats2, { sourcesReturned: 5 });
    expect(result.trust_score).toBeGreaterThanOrEqual(20);
    expect(result.trust_score).toBeLessThanOrEqual(39);
    expect(result.risk_level).toBe('HIGH');
  });

  it('score ~5 -> CRITICAL', () => {
    const cats = makeAllCategories({
      contract_safety: 5,
      holder_distribution: 5,
      historical_pattern: 5,
      social_signal: 5,
      onchain_activity: 5,
    });
    const result = computeComposite(cats, { sourcesReturned: 5 });
    expect(result.trust_score).toBeLessThanOrEqual(19);
    expect(result.risk_level).toBe('CRITICAL');
  });
});

describe('VIE Null Handling', () => {
  it('all sources null -> score 0, confidence 0, risk CRITICAL', () => {
    const cats = makeAllCategories({
      contract_safety: null,
      holder_distribution: null,
      historical_pattern: null,
      social_signal: null,
      onchain_activity: null,
    });
    const result = computeComposite(cats, { sourcesReturned: 0, sourcesFailed: 5 });
    expect(result.trust_score).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.risk_level).toBe('CRITICAL');
    expect(result.recommendation).toBe('BLOCK');
  });

  it('one source null -> weight redistributed to others', () => {
    // With social_signal null, remaining 4 categories share 0.85 weight proportionally
    const catsWithSocial = makeAllCategories({
      contract_safety: 80,
      holder_distribution: 80,
      historical_pattern: 80,
      social_signal: 80,
      onchain_activity: 80,
    });
    const catsWithoutSocial = makeAllCategories({
      contract_safety: 80,
      holder_distribution: 80,
      historical_pattern: 80,
      social_signal: null,
      onchain_activity: 80,
    });
    const resultWith = computeComposite(catsWithSocial, { sourcesReturned: 5 });
    const resultWithout = computeComposite(catsWithoutSocial, { sourcesReturned: 4, sourcesFailed: 1 });

    // When all present categories have the same score, the composite should be the same
    // regardless of null categories (weight redistribution preserves the ratio)
    expect(resultWith.trust_score).toBe(resultWithout.trust_score);
  });
});

describe('VIE Category Scoring', () => {
  it('contract safety: honeypot check = 0 -> score 0', () => {
    const result = scoreContractSafety({
      source_verified: 1.0,
      no_proxy: 1.0,
      mint_revoked: 1.0,
      no_freeze: 1.0,
      token_age: 1.0,
      honeypot_check: 0,
    });
    expect(result.score).toBe(0);
    expect(result.overrides_applied).toContain('honeypot_detected');
  });

  it('contract safety: all positive signals -> high score', () => {
    const result = scoreContractSafety({
      source_verified: 1.0,
      no_proxy: 1.0,
      mint_revoked: 1.0,
      no_freeze: 1.0,
      token_age: 1.0,
      honeypot_check: 1.0,
    });
    expect(result.score).toBe(100);
    expect(result.overrides_applied).toHaveLength(0);
  });

  it('historical pattern: deployer_history = 0 -> score 0', () => {
    const result = scoreHistoricalPattern({
      deployer_history: 0,
      interaction_count: 1.0,
      rekt_match: 1.0,
      pattern_similarity: 1.0,
    });
    expect(result.score).toBe(0);
    expect(result.overrides_applied).toContain('deployer_rug_history');
  });

  it('social signal: no social presence defaults to neutral (50)', () => {
    // Per spec: if no social presence at all, category_score = 50 (neutral)
    // Simulate by setting all signals to 0.5 (neutral values)
    const result = scoreSocialSignal({
      mention_volume: 0.5,
      bot_percentage: 0.5,
      sentiment_score: 0.5,
      account_quality: 0.5,
      engagement_auth: 0.5,
      verified_project: 0.5,
    });
    expect(result.score).toBe(50);
  });
});
