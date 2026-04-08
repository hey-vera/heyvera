/**
 * trust-oracle.ts — Unified Trust Query Engine (Revenue Layer)
 *
 * Combines ALL trust signals into a single query interface:
 *   - Pulse Tree state (heartbeats, leaf count, credit activity)
 *   - Soma verdicts (GREEN/AMBER/RED from independent observers)
 *   - Behavioral scoring (success rate, latency, disputes)
 *   - Checkpoints (periodic behavioral summaries)
 *   - Vouch graph (agent-to-agent trust staking, Layer 4)
 *
 * Six trust dimensions: reliability, economic, verification, longevity,
 * consistency, social (vouch graph).
 *
 * Three query tiers:
 *   BASIC       — trust score + level + confidence (cheapest)
 *   DIMENSIONAL — score + per-dimension breakdown (mid)
 *   FULL        — everything + Merkle proof + behavioral summary (premium)
 *
 * This is ClawNet's primary revenue engine per revenue-architecture v2.
 * All Soma proofs and identity are free; trust QUERIES are paid.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/connection';
import { somaHash, somaHashJson } from '../utils/crypto-agility';
import { getAgentPulseState, getRecentLeaves } from './soma-heartbeat';
import { getSomaVerdictStats } from '../db/soma-verdicts';
import { getVouchScore } from './vouch-graph';
import { getNovaBridge } from './nova-bridge';
import { round6 } from './credits';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export type TrustTier = 'basic' | 'dimensional' | 'full';

export type TrustVerdict = 'sovereign' | 'verified' | 'trusted' | 'building' | 'new' | 'unknown';

export type ProofTier = 'zk-verified' | 'ivc-folded' | 'signed-only';

export type IdentityTier = 'biometric' | 'kyc-attested' | 'passport' | 'anonymous';

/** Identity tier multiplier — scales effective trust by operator verification strength. */
export const IDENTITY_TIER_MULTIPLIER: Record<IdentityTier, number> = {
  'biometric': 1.0,       // Iris-verified unique human (World AgentKit / Orb)
  'kyc-attested': 0.9,    // Verified Coinbase trading account (EAS on Base)
  'passport': 0.8,        // ML humanity score (Human Passport)
  'anonymous': 0.65,      // No identity verification — default
};

/**
 * Proof tier multiplier — scales effective trust by cryptographic proof strength.
 * Blended formula: effectiveTrust = score * (0.5 + 0.5 * multiplier)
 * This prevents cliff effects where mediocre zk-verified agents outrank excellent signed-only ones.
 *   zk-verified:  score * 1.0  (full trust)
 *   ivc-folded:   score * 0.925  (half of the 0.85 gap)
 *   signed-only:  score * 0.8  (not 0.6 — excellent agents still rank well)
 */
export const PROOF_TIER_MULTIPLIER: Record<ProofTier, number> = {
  'zk-verified': 1.0,   // Groth16 proof — EVM-verifiable, full trust
  'ivc-folded': 0.85,   // Nova IVC folds running — strong but not compressed
  'signed-only': 0.6,   // Pulse tree + signatures — baseline trust
};

export interface TrustDimension {
  score: number;       // 0-100
  confidence: number;  // 0-1
  sampleSize: number;
}

export interface TrustDimensions {
  reliability: TrustDimension;
  economic: TrustDimension;
  verification: TrustDimension;
  longevity: TrustDimension;
  consistency: TrustDimension;
  social: TrustDimension;  // vouch graph — who trusts this agent
}

export interface PulseSnapshot {
  root: string;
  heartbeatIndex: number;
  leafCount: number;
  totalCredits: number;
}

export interface TrustQueryResult {
  queryId: string;
  agentDid: string;
  tier: TrustTier;

  // Always present (all tiers)
  trustScore: number;       // 0-100
  trustVerdict: TrustVerdict;
  confidence: number;       // 0-1
  riskFlags: string[];

  // Dimensional + Full tiers
  dimensions?: TrustDimensions;

  // Full tier only
  pulse?: PulseSnapshot;
  verdictSummary?: {
    total: number;
    greenRate: number;
    uniqueObservers: number;
    avgConfidence: number;
    lastVerdict: string | null;
    lastVerdictAt: string | null;
  };
  recentActivity?: {
    actionsLast24h: number;
    actionsLast7d: number;
    successRate: number;
    avgCreditDelta: number;
  };

  // Proof tier (all tiers) — cryptographic proof strength
  proofTier: ProofTier;
  identityTier: IdentityTier;
  effectiveTrust: number;  // trustScore * proofBlended * identityBlended

  // Metadata (all tiers)
  validUntil: string;  // TTL — trust is perishable
  proofHash: string;   // H(all data) for offline verification
  computedAt: string;
}

// ─── Credit costs per tier ──────────────────────────────────────────────────

export const TRUST_QUERY_COSTS: Record<TrustTier, number> = {
  basic: 0.01,        // ~$0.0001
  dimensional: 0.05,  // ~$0.0005
  full: 0.10,         // ~$0.001
};

// TTL per tier (minutes)
const TTL_MINUTES: Record<TrustTier, number> = {
  basic: 60,
  dimensional: 30,
  full: 15,
};

/** Cost for Groth16 proof generation (separate from trust query costs). */
export const PROOF_GENERATION_COST = 50; // ~$0.50

// ─── Proof Tier Detection ──────────────────────────────────────────────────

/**
 * Determine the cryptographic proof tier for an agent.
 *   zk-verified: has a Groth16 proof generated within the last 90 days
 *   ivc-folded:  Nova bridge running + agent has pulse leaves (folds happening)
 *   signed-only: pulse tree entries exist but no cryptographic proofs
 */
export function getProofTier(agentDid: string): ProofTier {
  // Check for recent Groth16 proof (not just any ZK_PROOF leaf — Nova folds also use type=4)
  const state = getDb().prepare(
    'SELECT last_groth16_at FROM agent_pulse_state WHERE agent_did = ?'
  ).get(agentDid) as { last_groth16_at: string | null } | undefined;

  if (state?.last_groth16_at) {
    const proofAge = Date.now() - new Date(state.last_groth16_at + 'Z').getTime();
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    if (proofAge < NINETY_DAYS) return 'zk-verified';
    // Proof expired — fall through to ivc-folded or signed-only
  }

  const bridge = getNovaBridge();
  const leafCount = (getDb().prepare(
    'SELECT COUNT(*) as n FROM pulse_tree_leaves WHERE agent_did = ?'
  ).get(agentDid) as { n: number }).n;

  if (bridge.ready && leafCount > 0) return 'ivc-folded';

  return 'signed-only';
}

/**
 * Get the identity verification tier for an agent.
 * Checks agent_identity_verification table, respects expiry.
 */
export function getIdentityTier(agentDid: string): IdentityTier {
  const row = getDb().prepare(
    'SELECT identity_tier, expires_at FROM agent_identity_verification WHERE agent_did = ?'
  ).get(agentDid) as { identity_tier: string; expires_at: string | null } | undefined;

  if (!row) return 'anonymous';

  // Check expiry
  if (row.expires_at) {
    const expired = Date.now() > new Date(row.expires_at + 'Z').getTime();
    if (expired) return 'anonymous';
  }

  return row.identity_tier as IdentityTier;
}

// ─── Dimension Computation ──────────────────────────────────────────────────

function computeReliability(agentDid: string): TrustDimension {
  // Action leaves with success data
  const rows = getDb().prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN credit_delta >= 0 THEN 1 ELSE 0 END) as successful
    FROM pulse_tree_leaves
    WHERE agent_did = ? AND type = 1
  `).get(agentDid) as { total: number; successful: number } | undefined;

  if (!rows || rows.total === 0) {
    return { score: 50, confidence: 0, sampleSize: 0 };
  }

  const rate = rows.successful / rows.total;
  const score = Math.round(rate * 100);
  const confidence = Math.min(rows.total / 100, 1);

  return { score, confidence: round6(confidence), sampleSize: rows.total };
}

function computeEconomic(agentDid: string): TrustDimension {
  const pulse = getAgentPulseState(agentDid);
  if (!pulse) return { score: 50, confidence: 0, sampleSize: 0 };

  // Economic leaves
  const econ = getDb().prepare(`
    SELECT COUNT(*) as total,
           SUM(ABS(credit_delta)) as volume
    FROM pulse_tree_leaves
    WHERE agent_did = ? AND type = 2
  `).get(agentDid) as { total: number; volume: number | null } | undefined;

  const volume = econ?.volume ?? 0;
  const txCount = econ?.total ?? 0;

  // Score: combination of activity volume and positive balance
  let score = 0;
  if (pulse.totalCredits > 0) score += 20;
  if (volume >= 10) score += 20;
  else if (volume > 0) score += 10;
  if (txCount >= 50) score += 30;
  else if (txCount >= 10) score += 20;
  else if (txCount > 0) score += 10;
  // No disputes or negative events
  const negatives = getDb().prepare(`
    SELECT COUNT(*) as n FROM pulse_tree_leaves
    WHERE agent_did = ? AND type = 6 AND credit_delta < 0
  `).get(agentDid) as { n: number } | undefined;
  if (!negatives?.n) score += 30;
  else score += Math.max(0, 30 - negatives.n * 10);

  return {
    score: Math.min(100, score),
    confidence: Math.min(txCount / 50, 1),
    sampleSize: txCount,
  };
}

function computeVerification(agentDid: string): TrustDimension {
  const stats = getSomaVerdictStats(agentDid);
  if (!stats || stats.totalVerdicts === 0) {
    return { score: 50, confidence: 0, sampleSize: 0 };
  }

  const greenRate = stats.greenCount / stats.totalVerdicts;

  // Anti-sybil: require minimum 3 distinct observers for full score.
  // Single-observer verdicts are discounted — too easy to self-verify.
  const observerDiversityFactor = Math.min(stats.uniqueObservers / 3, 1);
  const observerBonus = Math.round(observerDiversityFactor * 10);

  // Green rate scaled by observer diversity — 1 observer can only contribute 33% of green score
  let score = Math.round(greenRate * 80 * Math.max(observerDiversityFactor, 0.33)) + observerBonus;
  if (stats.redCount > 0) score -= stats.redCount * 15;
  score = Math.max(0, Math.min(100, score));

  // Confidence: observer diversity weighted higher (anti-sybil)
  const verdictConf = Math.min(stats.totalVerdicts / 20, 1);
  const observerConf = Math.min(stats.uniqueObservers / 5, 1);
  const confidence = round6((verdictConf * 0.4 + observerConf * 0.6));

  return { score, confidence, sampleSize: stats.totalVerdicts };
}

function computeLongevity(agentDid: string): TrustDimension {
  // First leaf timestamp
  const first = getDb().prepare(`
    SELECT timestamp FROM pulse_tree_leaves
    WHERE agent_did = ? ORDER BY leaf_index ASC LIMIT 1
  `).get(agentDid) as { timestamp: string } | undefined;

  if (!first) return { score: 0, confidence: 0, sampleSize: 0 };

  const ageMs = Date.now() - new Date(first.timestamp).getTime();
  const ageDays = ageMs / 86_400_000;

  // Score: 180+ days = max
  const score = Math.round(Math.min(ageDays / 180, 1) * 100);
  const confidence = Math.min(ageDays / 30, 1); // confident after 30 days

  const pulse = getAgentPulseState(agentDid);

  return { score, confidence: round6(confidence), sampleSize: pulse?.heartbeatIndex ?? 0 };
}

function computeConsistency(agentDid: string): TrustDimension {
  // Check behavioral consistency via checkpoints
  const checkpoints = getDb().prepare(`
    SELECT action_count, success_count, total_credits_delta
    FROM soma_checkpoints
    WHERE agent_did = ?
    ORDER BY checkpoint_index DESC
    LIMIT 10
  `).all(agentDid) as Array<{
    action_count: number;
    success_count: number;
    total_credits_delta: number;
  }>;

  if (checkpoints.length < 2) {
    // Not enough checkpoints — fall back to overall leaf consistency
    const pulse = getAgentPulseState(agentDid);
    if (!pulse || pulse.leafCount === 0) return { score: 50, confidence: 0, sampleSize: 0 };
    return { score: 50, confidence: 0.1, sampleSize: pulse.leafCount };
  }

  // Compute variance in success rates across checkpoints
  const rates = checkpoints
    .filter(cp => cp.action_count > 0)
    .map(cp => cp.success_count / cp.action_count);

  if (rates.length < 2) return { score: 50, confidence: 0.1, sampleSize: checkpoints.length };

  const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
  const variance = rates.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / rates.length;
  const cv = Math.sqrt(variance) / Math.max(mean, 0.01); // coefficient of variation

  // Lower CV = more consistent = higher score
  const score = Math.round(Math.max(0, 1 - cv) * 100);
  const confidence = Math.min(checkpoints.length / 5, 1);

  return { score, confidence: round6(confidence), sampleSize: checkpoints.length };
}

function computeSocial(agentDid: string): TrustDimension {
  const vouch = getVouchScore(agentDid);

  if (vouch.uniqueVouchers === 0) {
    return { score: 0, confidence: 0, sampleSize: 0 };
  }

  // Score: combination of voucher count, total staked, and slash history
  // Hardened thresholds: MIN_STAKE=10, need 10+ vouchers and 500+ staked for max
  let score = 0;

  // Unique vouchers (up to 40 points — 10+ vouchers = max, harder to Sybil)
  score += Math.round(Math.min(vouch.uniqueVouchers / 10, 1) * 40);

  // Total staked (up to 40 points — 500+ credits staked = max)
  score += Math.round(Math.min(vouch.totalStaked / 500, 1) * 40);

  // Average stake strength (up to 20 points — 25+ avg = max)
  score += Math.round(Math.min(vouch.avgStake / 25, 1) * 20);

  // Slash penalty: each slash reduces score by 20
  score = Math.max(0, score - vouch.slashCount * 20);

  const confidence = Math.min(vouch.uniqueVouchers / 5, 1);

  return {
    score: Math.min(100, score),
    confidence: round6(confidence),
    sampleSize: vouch.uniqueVouchers,
  };
}

// ─── Risk Flag Detection ────────────────────────────────────────────────────

function detectRiskFlags(agentDid: string, dimensions: TrustDimensions): string[] {
  const flags: string[] = [];
  const pulse = getAgentPulseState(agentDid);

  if (!pulse || pulse.heartbeatIndex === 0) {
    flags.push('NO_HISTORY');
    return flags;
  }

  if (pulse.heartbeatIndex < 10) flags.push('LOW_ACTIVITY');

  // Check for death leaf
  const death = getDb().prepare(
    'SELECT 1 FROM pulse_tree_leaves WHERE agent_did = ? AND type = 7 LIMIT 1'
  ).get(agentDid);
  if (death) flags.push('AGENT_DEAD');

  // Recent red verdicts
  const stats = getSomaVerdictStats(agentDid);
  if (stats && stats.redCount > 0) flags.push('RED_VERDICTS');
  if (stats && stats.totalVerdicts > 0 && stats.redCount / stats.totalVerdicts > 0.2) flags.push('HIGH_RED_RATE');

  // Negative economic trend
  if (pulse.totalCredits < -100) flags.push('NEGATIVE_BALANCE');

  // Dimension-specific flags
  if (dimensions.reliability.score < 30 && dimensions.reliability.sampleSize >= 10) flags.push('LOW_RELIABILITY');
  if (dimensions.verification.score < 30 && dimensions.verification.sampleSize >= 5) flags.push('LOW_VERIFICATION');

  // Vouch-specific flags
  const vouchData = getVouchScore(agentDid);
  if (vouchData.slashCount > 0) flags.push('SLASHED_VOUCHES');
  if (vouchData.uniqueVouchers === 0 && pulse.heartbeatIndex >= 50) flags.push('NO_VOUCHERS');

  // Staleness — no activity in 7+ days
  const latest = getDb().prepare(`
    SELECT timestamp FROM pulse_tree_leaves
    WHERE agent_did = ? ORDER BY leaf_index DESC LIMIT 1
  `).get(agentDid) as { timestamp: string } | undefined;
  if (latest) {
    const daysSince = (Date.now() - new Date(latest.timestamp).getTime()) / 86_400_000;
    if (daysSince > 7) flags.push('STALE');
    if (daysSince > 30) flags.push('DORMANT');
  }

  return flags;
}

// ─── Composite Scoring ──────────────────────────────────────────────────────

// Dimension weights (6 dimensions, sum = 1.0)
const WEIGHTS = {
  reliability: 0.25,
  economic: 0.10,
  verification: 0.20,
  longevity: 0.10,
  consistency: 0.15,
  social: 0.20,       // vouch graph — who trusts this agent
};

function computeCompositeScore(dims: TrustDimensions): number {
  let weighted = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const dim = dims[key as keyof TrustDimensions];
    weighted += dim.score * weight;
  }
  return Math.round(weighted);
}

function computeCompositeConfidence(dims: TrustDimensions): number {
  let weighted = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const dim = dims[key as keyof TrustDimensions];
    weighted += dim.confidence * weight;
  }
  return round6(weighted);
}

function mapVerdict(score: number, confidence: number): TrustVerdict {
  if (confidence < 0.1) return 'unknown';
  if (score >= 90 && confidence >= 0.7) return 'sovereign';
  if (score >= 75 && confidence >= 0.5) return 'verified';
  if (score >= 55) return 'trusted';
  if (score >= 30) return 'building';
  return 'new';
}

// ─── Recent Activity (Full tier) ────────────────────────────────────────────

function getRecentActivity(agentDid: string): {
  actionsLast24h: number;
  actionsLast7d: number;
  successRate: number;
  avgCreditDelta: number;
} {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const last24h = getDb().prepare(`
    SELECT COUNT(*) as n FROM pulse_tree_leaves
    WHERE agent_did = ? AND type = 1 AND timestamp > ?
  `).get(agentDid, oneDayAgo) as { n: number };

  const last7d = getDb().prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN credit_delta >= 0 THEN 1 ELSE 0 END) as successful,
           AVG(credit_delta) as avg_delta
    FROM pulse_tree_leaves
    WHERE agent_did = ? AND type = 1 AND timestamp > ?
  `).get(agentDid, sevenDaysAgo) as { total: number; successful: number; avg_delta: number | null };

  return {
    actionsLast24h: last24h.n,
    actionsLast7d: last7d.total,
    successRate: last7d.total > 0 ? round6(last7d.successful / last7d.total) : 0,
    avgCreditDelta: round6(last7d.avg_delta ?? 0),
  };
}

// ─── Main Query Function ────────────────────────────────────────────────────

/**
 * Execute a trust query for an agent DID at the specified tier.
 * This is the core revenue-generating function.
 */
export function queryTrust(agentDid: string, tier: TrustTier): TrustQueryResult {
  const queryId = `tq-${nanoid(12)}`;
  const computedAt = new Date().toISOString();

  // Compute all 6 dimensions (needed for composite even at basic tier)
  const dimensions: TrustDimensions = {
    reliability: computeReliability(agentDid),
    economic: computeEconomic(agentDid),
    verification: computeVerification(agentDid),
    longevity: computeLongevity(agentDid),
    consistency: computeConsistency(agentDid),
    social: computeSocial(agentDid),
  };

  const trustScore = computeCompositeScore(dimensions);
  const confidence = computeCompositeConfidence(dimensions);
  const trustVerdict = mapVerdict(trustScore, confidence);
  const riskFlags = detectRiskFlags(agentDid, dimensions);

  // Proof tier — cryptographic proof strength affects effective trust
  // Blended formula prevents cliff effects: 0.5 + 0.5 * multiplier
  const proofTier = getProofTier(agentDid);
  const proofBlended = 0.5 + 0.5 * PROOF_TIER_MULTIPLIER[proofTier];

  // Identity tier — operator verification strength
  const identityTier = getIdentityTier(agentDid);
  const identityBlended = 0.5 + 0.5 * IDENTITY_TIER_MULTIPLIER[identityTier];

  const effectiveTrust = Math.round(trustScore * proofBlended * identityBlended);

  // TTL
  const ttl = TTL_MINUTES[tier];
  const validUntil = new Date(Date.now() + ttl * 60_000).toISOString();

  // Build result based on tier
  const result: TrustQueryResult = {
    queryId,
    agentDid,
    tier,
    trustScore,
    trustVerdict,
    confidence,
    riskFlags,
    proofTier,
    identityTier,
    effectiveTrust,
    validUntil,
    proofHash: '', // computed below
    computedAt,
  };

  // Dimensional + Full: include dimension breakdown
  if (tier === 'dimensional' || tier === 'full') {
    result.dimensions = dimensions;
  }

  // Full: include pulse snapshot, verdict summary, recent activity
  if (tier === 'full') {
    const pulse = getAgentPulseState(agentDid);
    if (pulse) {
      result.pulse = {
        root: pulse.root,
        heartbeatIndex: pulse.heartbeatIndex,
        leafCount: pulse.leafCount,
        totalCredits: pulse.totalCredits,
      };
    }

    const verdictStats = getSomaVerdictStats(agentDid);
    if (verdictStats) {
      result.verdictSummary = {
        total: verdictStats.totalVerdicts,
        greenRate: verdictStats.totalVerdicts > 0
          ? round6(verdictStats.greenCount / verdictStats.totalVerdicts)
          : 0,
        uniqueObservers: verdictStats.uniqueObservers,
        avgConfidence: round6(verdictStats.avgConfidence),
        lastVerdict: verdictStats.lastVerdict ?? null,
        lastVerdictAt: verdictStats.lastVerdictAt ?? null,
      };
    }

    result.recentActivity = getRecentActivity(agentDid);
  }

  // Proof hash — H(all result data) for offline verification
  result.proofHash = somaHash(somaHashJson({
    queryId,
    agentDid,
    trustScore,
    trustVerdict,
    confidence,
    riskFlags,
    proofTier,
    identityTier,
    effectiveTrust,
    dimensions: tier !== 'basic' ? dimensions : undefined,
    computedAt,
  }));

  return result;
}

// ─── Metering ───────────────────────────────────────────────────────────────

/** Record a trust query for metering and analytics. */
export function recordTrustQuery(
  querierKey: string,
  subjectDid: string,
  tier: TrustTier,
  creditsCharged: number,
): string {
  const id = `tqm-${nanoid(12)}`;
  getDb().prepare(`
    INSERT INTO trust_queries (id, querier_key, subject_did, tier, credits_charged, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(id, querierKey, subjectDid, tier, creditsCharged);
  return id;
}

/** Get trust query count for analytics. */
export function getTrustQueryStats(): {
  total: number;
  last24h: number;
  last7d: number;
  byTier: Record<string, number>;
  totalRevenue: number;
} {
  const total = (getDb().prepare('SELECT COUNT(*) as n FROM trust_queries').get() as { n: number }).n;

  const last24h = (getDb().prepare(
    "SELECT COUNT(*) as n FROM trust_queries WHERE created_at > datetime('now', '-1 day')"
  ).get() as { n: number }).n;

  const last7d = (getDb().prepare(
    "SELECT COUNT(*) as n FROM trust_queries WHERE created_at > datetime('now', '-7 days')"
  ).get() as { n: number }).n;

  const tiers = getDb().prepare(
    'SELECT tier, COUNT(*) as n FROM trust_queries GROUP BY tier'
  ).all() as Array<{ tier: string; n: number }>;
  const byTier: Record<string, number> = {};
  for (const row of tiers) byTier[row.tier] = row.n;

  const rev = (getDb().prepare(
    'SELECT COALESCE(SUM(credits_charged), 0) as total FROM trust_queries'
  ).get() as { total: number }).total;

  return { total, last24h, last7d, byTier, totalRevenue: round6(rev) };
}
