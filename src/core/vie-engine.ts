/**
 * VIE Scoring Engine — Verified Intelligence Engine
 *
 * Takes raw category data from vie-sources.ts and computes:
 *   - Per-category scores (0-100)
 *   - Composite trust score (0-100)
 *   - Confidence (0.0-1.0)
 *   - Risk level and recommendation
 *
 * All math uses round6() to prevent floating-point drift.
 */

import { round6 } from './credits';

// ---------------------------------------------------------------------------
// Types — will move to vie-sources.ts once that file exists
// ---------------------------------------------------------------------------

export interface NormalizedSignal {
  signal_name: string;
  value: number;            // 0.0-1.0 (1.0 = maximally favorable)
  weight: number;           // Relative importance within category (sum to 1.0)
  direction: 'positive' | 'negative' | 'neutral';
  raw_data: unknown;
  source_id: string;
  fetched_at: string;       // ISO 8601
}

export interface CategoryData {
  category: string;
  signals: NormalizedSignal[];
}

export interface VieRawData {
  contract_safety: CategoryData | null;
  holder_distribution: CategoryData | null;
  historical_pattern: CategoryData | null;
  social_signal: CategoryData | null;
  onchain_activity: CategoryData | null;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CategoryScore {
  category: string;
  score: number;            // 0-100
  signals_used: number;
  override_applied?: string;
}

export type RiskLevel = 'VERIFIED' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Recommendation = 'PROCEED' | 'CAUTION' | 'AVOID' | 'BLOCK';

export interface VieResult {
  trust_score: number;      // 0-100
  risk_level: RiskLevel;
  recommendation: Recommendation;
  confidence: number;       // 0.0-1.0
  factors: {
    contract_safety: CategoryScore | null;
    holder_distribution: CategoryScore | null;
    historical_pattern: CategoryScore | null;
    social_signal: CategoryScore | null;
    onchain_activity: CategoryScore | null;
  };
  overrides_applied: string[];
}

// ---------------------------------------------------------------------------
// Category weights for the composite score
// ---------------------------------------------------------------------------

const CATEGORY_WEIGHTS: Record<string, number> = {
  contract_safety: 0.25,
  holder_distribution: 0.20,
  historical_pattern: 0.25,
  social_signal: 0.15,
  onchain_activity: 0.15,
};

const CATEGORY_KEYS = Object.keys(CATEGORY_WEIGHTS) as Array<keyof typeof CATEGORY_WEIGHTS>;

// ---------------------------------------------------------------------------
// 1. Score a single category
// ---------------------------------------------------------------------------

export function scoreCategory(data: CategoryData | null): CategoryScore | null {
  if (!data) return null;

  const signals = data.signals;
  if (signals.length === 0) return { category: data.category, score: 0, signals_used: 0 };

  // Sum signal.value * signal.weight * 100 — weights within a category should sum to 1.0
  let raw = 0;
  for (const s of signals) {
    raw = round6(raw + round6(s.value * s.weight * 100));
  }

  // Clamp 0-100
  const score = Math.round(clamp(raw, 0, 100));

  return { category: data.category, score, signals_used: signals.length };
}

// ---------------------------------------------------------------------------
// 2. Compute composite trust score (weighted average with redistribution)
// ---------------------------------------------------------------------------

interface CompositeInput {
  contract_safety: CategoryScore | null;
  holder_distribution: CategoryScore | null;
  historical_pattern: CategoryScore | null;
  social_signal: CategoryScore | null;
  onchain_activity: CategoryScore | null;
}

function computeComposite(factors: CompositeInput): number {
  // Determine which categories are present
  let totalAvailableWeight = 0;
  const scored: Array<{ key: string; score: number; weight: number }> = [];

  for (const key of CATEGORY_KEYS) {
    const f = factors[key as keyof CompositeInput];
    if (f !== null) {
      totalAvailableWeight = round6(totalAvailableWeight + CATEGORY_WEIGHTS[key]);
      scored.push({ key, score: f.score, weight: CATEGORY_WEIGHTS[key] });
    }
  }

  if (totalAvailableWeight === 0) return 0;

  // Redistribute weights proportionally among non-null categories
  let composite = 0;
  for (const entry of scored) {
    const adjustedWeight = round6(entry.weight / totalAvailableWeight);
    composite = round6(composite + round6(entry.score * adjustedWeight));
  }

  return Math.round(clamp(composite, 0, 100));
}

// ---------------------------------------------------------------------------
// 3. Apply override rules (in priority order)
// ---------------------------------------------------------------------------

interface OverrideResult {
  composite: number;
  risk_override: RiskLevel | null;
  overrides: string[];
}

function applyOverrides(
  composite: number,
  factors: CompositeInput,
  rawData: VieRawData,
): OverrideResult {
  let score = composite;
  let riskOverride: RiskLevel | null = null;
  const overrides: string[] = [];

  // (a) Honeypot detection — check contract_safety signals for "honeypot" with value 0.0
  if (rawData.contract_safety) {
    const honeypot = rawData.contract_safety.signals.find(
      (s) => s.signal_name === 'honeypot' || s.signal_name === 'honeypot_check',
    );
    if (honeypot && honeypot.value === 0.0) {
      score = 0;
      overrides.push('HONEYPOT_DETECTED');
    }
  }

  // (b) Any non-null factor scores exactly 0 → cap at 25
  for (const key of CATEGORY_KEYS) {
    const f = factors[key as keyof CompositeInput];
    if (f !== null && f.score === 0) {
      score = Math.min(score, 25);
      if (!overrides.includes('CRITICAL_FACTOR_ZERO')) {
        overrides.push('CRITICAL_FACTOR_ZERO');
      }
      break;
    }
  }

  // (c) Contract safety < 30 → cap at 40
  if (factors.contract_safety !== null && factors.contract_safety.score < 30) {
    score = Math.min(score, 40);
    overrides.push('UNSAFE_CONTRACT');
  }

  // (d) Holder distribution < 20 → cap at 35
  if (factors.holder_distribution !== null && factors.holder_distribution.score < 20) {
    score = Math.min(score, 35);
    overrides.push('EXTREME_CONCENTRATION');
  }

  // (e) 3+ non-null factors below 40 → force CRITICAL
  let weakCount = 0;
  for (const key of CATEGORY_KEYS) {
    const f = factors[key as keyof CompositeInput];
    if (f !== null && f.score < 40) weakCount++;
  }
  if (weakCount >= 3) {
    riskOverride = 'CRITICAL';
    overrides.push('MULTIPLE_WEAK_FACTORS');
  }

  return { composite: score, risk_override: riskOverride, overrides };
}

// ---------------------------------------------------------------------------
// 4. Compute confidence
// ---------------------------------------------------------------------------

function computeConfidence(rawData: VieRawData, factors: CompositeInput): number {
  const keys = CATEGORY_KEYS;
  const now = Date.now();
  const ONE_HOUR_MS = 60 * 60 * 1000;

  let confidence = 0;

  // +0.2 per non-null category
  const nonNullKeys: string[] = [];
  for (const key of keys) {
    const data = rawData[key as keyof VieRawData];
    if (data !== null) {
      confidence = round6(confidence + 0.2);
      nonNullKeys.push(key);
    }
  }

  // -0.1 per category with stale data (any signal fetched_at > 1 hour ago)
  for (const key of nonNullKeys) {
    const data = rawData[key as keyof VieRawData]!;
    const isStale = data.signals.some((s) => {
      const fetchedMs = new Date(s.fetched_at).getTime();
      return now - fetchedMs > ONE_HOUR_MS;
    });
    if (isStale) {
      confidence = round6(confidence - 0.1);
    }
  }

  // -0.15 per category that returned null (failed)
  for (const key of keys) {
    const data = rawData[key as keyof VieRawData];
    if (data === null) {
      confidence = round6(confidence - 0.15);
    }
  }

  // +0.05 per pair of non-null categories that agree
  // "agree" = both above 60 or both below 40
  const scores: Array<{ key: string; score: number }> = [];
  for (const key of nonNullKeys) {
    const f = factors[key as keyof CompositeInput];
    if (f !== null) scores.push({ key, score: f.score });
  }

  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      const a = scores[i].score;
      const b = scores[j].score;
      if ((a > 60 && b > 60) || (a < 40 && b < 40)) {
        confidence = round6(confidence + 0.05);
      }
    }
  }

  // Clamp and round to 2 decimal places
  return Math.round(clamp(confidence, 0, 1) * 100) / 100;
}

// ---------------------------------------------------------------------------
// 5. Map risk level
// ---------------------------------------------------------------------------

function mapRiskLevel(trustScore: number, confidence: number): RiskLevel {
  if (trustScore >= 80) {
    return confidence >= 0.8 ? 'VERIFIED' : 'LOW';
  }
  if (trustScore >= 60) return 'LOW';
  if (trustScore >= 40) return 'MEDIUM';
  if (trustScore >= 20) return 'HIGH';
  return 'CRITICAL';
}

// ---------------------------------------------------------------------------
// 6. Map recommendation
// ---------------------------------------------------------------------------

function mapRecommendation(riskLevel: RiskLevel): Recommendation {
  switch (riskLevel) {
    case 'VERIFIED': return 'PROCEED';
    case 'LOW':      return 'PROCEED';
    case 'MEDIUM':   return 'CAUTION';
    case 'HIGH':     return 'AVOID';
    case 'CRITICAL': return 'BLOCK';
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeVieScore(rawData: VieRawData): VieResult {
  // 1. Score each category
  const factors: CompositeInput = {
    contract_safety: scoreCategory(rawData.contract_safety),
    holder_distribution: scoreCategory(rawData.holder_distribution),
    historical_pattern: scoreCategory(rawData.historical_pattern),
    social_signal: scoreCategory(rawData.social_signal),
    onchain_activity: scoreCategory(rawData.onchain_activity),
  };

  // 2. Compute composite
  const rawComposite = computeComposite(factors);

  // 3. Apply overrides
  const { composite, risk_override, overrides } = applyOverrides(rawComposite, factors, rawData);

  // 4. Compute confidence
  const confidence = computeConfidence(rawData, factors);

  // 5. Map risk level (override may force CRITICAL)
  let riskLevel = risk_override ?? mapRiskLevel(composite, confidence);

  // 6. Map recommendation
  const recommendation = mapRecommendation(riskLevel);

  return {
    trust_score: composite,
    risk_level: riskLevel,
    recommendation,
    confidence,
    factors,
    overrides_applied: overrides,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
