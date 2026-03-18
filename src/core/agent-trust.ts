/**
 * Agent Trust Score Engine — ClawNet Intelligence Skill #3
 *
 * Scores wallets, deployers, and ClawNet agents using PROPRIETARY platform data:
 *   - Transaction history & success rates
 *   - Platform tenure & credit health
 *   - Skill usage diversity
 *   - Dispute history
 *   - VIE query patterns (do they check before acting?)
 *
 * Produces a 0-100 trust score with behavioral signals, risk flags,
 * and a clear recommendation (TRUST / VERIFY / CAUTION / AVOID).
 *
 * All math uses round6() to prevent floating-point drift.
 */

import { round6 } from './credits';
import { getDb } from '../db/connection';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrustLevel = 'TRUSTED' | 'FAVORABLE' | 'MIXED' | 'POOR' | 'UNTRUSTED';
export type TrustRecommendation = 'TRUST' | 'VERIFY' | 'CAUTION' | 'AVOID';

export interface BehavioralSignal {
  score: number; // 0-100
}

export interface TransactionVolumeSignal extends BehavioralSignal {
  count: number;
}

export interface SuccessRateSignal extends BehavioralSignal {
  pct: number;
}

export interface PlatformTenureSignal extends BehavioralSignal {
  days: number;
}

export interface SkillUsageDiversitySignal extends BehavioralSignal {
  unique_skills: number;
}

export interface DisputeHistorySignal extends BehavioralSignal {
  count: number;
}

export interface CreditHealthSignal extends BehavioralSignal {
  balance: number;
  total_spent: number;
}

export interface VieQueryPatternSignal extends BehavioralSignal {
  tokens_checked: number;
  avg_score_of_checked: number;
}

export interface BehavioralSignals {
  transaction_volume: TransactionVolumeSignal;
  success_rate: SuccessRateSignal;
  platform_tenure: PlatformTenureSignal;
  skill_usage_diversity: SkillUsageDiversitySignal;
  dispute_history: DisputeHistorySignal;
  credit_health: CreditHealthSignal;
  vie_query_pattern: VieQueryPatternSignal;
}

export interface TrustResult {
  entity: { address: string; type: string; chain: string };
  trust_score: number;
  trust_level: TrustLevel;
  confidence: number;
  behavioral_signals: BehavioralSignals;
  risk_flags: string[];
  recommendation: TrustRecommendation;
  related_vie_score?: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Signal weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const SIGNAL_WEIGHTS: Record<keyof BehavioralSignals, number> = {
  success_rate: 0.25,
  dispute_history: 0.20,
  platform_tenure: 0.15,
  transaction_volume: 0.15,
  credit_health: 0.10,
  skill_usage_diversity: 0.10,
  vie_query_pattern: 0.05,
};

// ---------------------------------------------------------------------------
// DB data gathering
// ---------------------------------------------------------------------------

interface KeyData {
  key: string;
  credits: number;
  credits_used: number;
  created_at: string;
  last_used_at: string | null;
  active: number;
}

function lookupKeyData(target: string): KeyData | null {
  // Try exact match first (API key or well-known identifier)
  const exact = getDb().prepare(
    'SELECT key, credits, credits_used, created_at, last_used_at, active FROM api_keys WHERE key = ?'
  ).get(target) as KeyData | undefined;
  if (exact) return exact;

  // Try by email
  const byEmail = getDb().prepare(
    'SELECT key, credits, credits_used, created_at, last_used_at, active FROM api_keys WHERE email = ? ORDER BY created_at DESC LIMIT 1'
  ).get(target) as KeyData | undefined;
  if (byEmail) return byEmail;

  // Try by clerk_user_id
  const byClerk = getDb().prepare(
    'SELECT key, credits, credits_used, created_at, last_used_at, active FROM api_keys WHERE clerk_user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(target) as KeyData | undefined;
  if (byClerk) return byClerk;

  return null;
}

interface TxStats {
  total: number;
  successful: number;
  failed: number;
}

function getTransactionStats(agentKey: string): TxStats {
  const db = getDb();

  // Count transactions from this agent
  const outgoing = db.prepare(
    'SELECT COUNT(*) as total FROM transactions WHERE from_agent = ?'
  ).get(agentKey) as { total: number };

  // Count incoming (sales/receipts)
  const incoming = db.prepare(
    'SELECT COUNT(*) as total FROM transactions WHERE to_agent = ?'
  ).get(agentKey) as { total: number };

  const total = outgoing.total + incoming.total;

  // Successful = completed tasks + successful orchestrations
  const completedTasks = db.prepare(
    "SELECT COUNT(*) as cnt FROM tasks WHERE requester_key = ? AND status = 'COMPLETED'"
  ).get(agentKey) as { cnt: number };

  const failedTasks = db.prepare(
    "SELECT COUNT(*) as cnt FROM tasks WHERE requester_key = ? AND status = 'FAILED'"
  ).get(agentKey) as { cnt: number };

  // Also count successful orchestrations
  const successOrch = db.prepare(
    'SELECT COUNT(*) as cnt FROM orchestrations WHERE api_key = ? AND success = 1'
  ).get(agentKey) as { cnt: number };

  const failOrch = db.prepare(
    'SELECT COUNT(*) as cnt FROM orchestrations WHERE api_key = ? AND success = 0'
  ).get(agentKey) as { cnt: number };

  const successful = completedTasks.cnt + successOrch.cnt;
  const failed = failedTasks.cnt + failOrch.cnt;

  return { total: Math.max(total, successful + failed), successful, failed };
}

function getUniqueSkillsUsed(agentKey: string): number {
  const row = getDb().prepare(
    "SELECT COUNT(DISTINCT skill_id) as cnt FROM transactions WHERE from_agent = ? AND skill_id IS NOT NULL"
  ).get(agentKey) as { cnt: number };
  return row.cnt;
}

function getDisputeCount(agentKey: string): number {
  const db = getDb();

  // Disputes as hirer or worker in escrow
  const asHirer = db.prepare(
    "SELECT COUNT(*) as cnt FROM escrows WHERE hirer_id = ? AND state = 'DISPUTED'"
  ).get(agentKey) as { cnt: number };

  const asWorker = db.prepare(
    "SELECT COUNT(*) as cnt FROM escrows WHERE worker_id = ? AND state = 'DISPUTED'"
  ).get(agentKey) as { cnt: number };

  // Also count refunds initiated against this agent
  const refunds = db.prepare(
    "SELECT COUNT(*) as cnt FROM transactions WHERE to_agent = ? AND type = 'SKILL_REFUND'"
  ).get(agentKey) as { cnt: number };

  return asHirer.cnt + asWorker.cnt + refunds.cnt;
}

function getVieQueryPattern(agentKey: string): { tokens_checked: number; avg_score: number } {
  // Check how many VIE reports were generated for this agent's key
  // We look at audit_log for VIE usage by this agent
  const db = getDb();

  const vieUsage = db.prepare(
    "SELECT COUNT(*) as cnt FROM audit_log WHERE entity_type = 'vie' AND action = 'REPORT' AND actor_id = ?"
  ).get(agentKey) as { cnt: number };

  // Average VIE score of tokens this agent checked
  const avgScore = db.prepare(
    `SELECT AVG(trust_score) as avg_score FROM vie_reports WHERE id IN (
       SELECT entity_id FROM audit_log WHERE entity_type = 'vie' AND action = 'REPORT' AND actor_id = ? LIMIT 100
     )`
  ).get(agentKey) as { avg_score: number | null };

  return {
    tokens_checked: vieUsage.cnt,
    avg_score: avgScore.avg_score ?? 0,
  };
}

function getRelatedVieScore(target: string, chain: string): number | null {
  const row = getDb().prepare(
    "SELECT score_value FROM intel_scores WHERE entity_address = ? AND entity_chain = ? AND skill_id = 'vie' ORDER BY scored_at DESC LIMIT 1"
  ).get(target, chain) as { score_value: number } | undefined;
  return row?.score_value ?? null;
}

// ---------------------------------------------------------------------------
// Signal scorers (each returns 0-100)
// ---------------------------------------------------------------------------

function scoreTransactionVolume(count: number): number {
  // More transactions = more data = higher confidence
  // 100+ transactions = max score
  return Math.round(clamp(Math.min(count / 100, 1.0) * 100, 0, 100));
}

function scoreSuccessRate(successful: number, failed: number): { pct: number; score: number } {
  const total = successful + failed;
  if (total === 0) return { pct: 0, score: 50 }; // No data = neutral
  const pct = round6(successful / total);
  return { pct: round6(pct * 100), score: Math.round(clamp(pct * 100, 0, 100)) };
}

function scorePlatformTenure(createdAt: string): { days: number; score: number } {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
  // 180+ days = max score
  const score = Math.round(clamp(Math.min(days / 180, 1.0) * 100, 0, 100));
  return { days, score };
}

function scoreSkillUsageDiversity(uniqueSkills: number): number {
  // 10+ unique skills = max score
  return Math.round(clamp(Math.min(uniqueSkills / 10, 1.0) * 100, 0, 100));
}

function scoreDisputeHistory(disputeCount: number): number {
  // Each dispute drops score by 20 (from 100)
  return Math.round(clamp(Math.max(0, 100 - disputeCount * 20), 0, 100));
}

function scoreCreditHealth(balance: number, totalSpent: number): number {
  // Combination of current balance and spending pattern
  // Active spender with reasonable balance = high score
  let score = 0;

  // Balance component (0-50): having credits means the agent is funded
  if (balance >= 1000) score += 50;
  else if (balance >= 100) score += 40;
  else if (balance >= 10) score += 25;
  else if (balance > 0) score += 10;

  // Spending component (0-50): active usage signals legitimacy
  if (totalSpent >= 5000) score += 50;
  else if (totalSpent >= 1000) score += 40;
  else if (totalSpent >= 100) score += 30;
  else if (totalSpent >= 10) score += 15;
  else if (totalSpent > 0) score += 5;

  return Math.round(clamp(score, 0, 100));
}

function scoreVieQueryPattern(tokensChecked: number, avgScore: number): number {
  // Agents that check VIE before trading are safer
  if (tokensChecked === 0) return 30; // No VIE checks = slightly below neutral

  let score = 40; // Base for any VIE usage

  // More checks = better due diligence (up to +30)
  score += Math.min(tokensChecked / 20, 1.0) * 30;

  // If the average score of checked tokens is high, the agent trades safe assets (+30)
  if (avgScore >= 60) score += 30;
  else if (avgScore >= 40) score += 15;

  return Math.round(clamp(score, 0, 100));
}

// ---------------------------------------------------------------------------
// Risk flag detection
// ---------------------------------------------------------------------------

function detectRiskFlags(
  keyData: KeyData | null,
  signals: BehavioralSignals,
  txStats: TxStats,
): string[] {
  const flags: string[] = [];

  if (keyData) {
    // NEW_ACCOUNT: less than 7 days
    const created = new Date(keyData.created_at).getTime();
    const daysSinceCreation = (Date.now() - created) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation < 7) flags.push('NEW_ACCOUNT');

    // LOW_BALANCE: less than 10 credits
    if (keyData.credits < 10) flags.push('LOW_BALANCE');

    // DORMANT: no activity in 30+ days
    if (keyData.last_used_at) {
      const lastUsed = new Date(keyData.last_used_at).getTime();
      const daysSinceUse = (Date.now() - lastUsed) / (1000 * 60 * 60 * 24);
      if (daysSinceUse >= 30) flags.push('DORMANT');
    } else if (daysSinceCreation >= 30) {
      flags.push('DORMANT');
    }

    // INACTIVE_KEY
    if (keyData.active === 0) flags.push('INACTIVE_KEY');
  } else {
    flags.push('UNKNOWN_ENTITY');
  }

  // HIGH_DISPUTE_RATE: >10% dispute rate relative to transactions
  if (txStats.total > 0 && signals.dispute_history.count > 0) {
    const disputeRate = signals.dispute_history.count / txStats.total;
    if (disputeRate > 0.10) flags.push('HIGH_DISPUTE_RATE');
  }

  // NO_VIE_CHECKS: never used VIE safety tools
  if (signals.vie_query_pattern.tokens_checked === 0) flags.push('NO_VIE_CHECKS');

  // ZERO_TRANSACTIONS: no platform activity
  if (txStats.total === 0) flags.push('ZERO_TRANSACTIONS');

  // HIGH_FAILURE_RATE: >25% failure rate
  const totalOps = txStats.successful + txStats.failed;
  if (totalOps >= 5 && txStats.failed / totalOps > 0.25) flags.push('HIGH_FAILURE_RATE');

  return flags;
}

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

function computeComposite(signals: BehavioralSignals): number {
  let composite = 0;
  const keys = Object.keys(SIGNAL_WEIGHTS) as Array<keyof BehavioralSignals>;

  for (const key of keys) {
    const weight = SIGNAL_WEIGHTS[key];
    const score = signals[key].score;
    composite = round6(composite + round6(score * weight));
  }

  return Math.round(clamp(composite, 0, 100));
}

function computeConfidence(keyData: KeyData | null, txStats: TxStats, signals: BehavioralSignals): number {
  let confidence = 0;

  // Known entity on the platform
  if (keyData) {
    confidence += 0.3;

    // Has transaction history
    if (txStats.total >= 10) confidence += 0.25;
    else if (txStats.total >= 3) confidence += 0.15;
    else if (txStats.total > 0) confidence += 0.05;

    // Has been around a while
    if (signals.platform_tenure.days >= 90) confidence += 0.2;
    else if (signals.platform_tenure.days >= 30) confidence += 0.1;
    else if (signals.platform_tenure.days >= 7) confidence += 0.05;

    // Diverse skill usage provides more data points
    if (signals.skill_usage_diversity.unique_skills >= 5) confidence += 0.15;
    else if (signals.skill_usage_diversity.unique_skills >= 2) confidence += 0.08;

    // VIE checks provide additional behavioral signal
    if (signals.vie_query_pattern.tokens_checked >= 3) confidence += 0.1;
  } else {
    // Unknown entity — very low confidence
    confidence += 0.05;
  }

  return Math.round(clamp(confidence, 0, 1) * 100) / 100;
}

function mapTrustLevel(score: number): TrustLevel {
  if (score >= 80) return 'TRUSTED';
  if (score >= 60) return 'FAVORABLE';
  if (score >= 40) return 'MIXED';
  if (score >= 20) return 'POOR';
  return 'UNTRUSTED';
}

function mapRecommendation(level: TrustLevel, riskFlags: string[]): TrustRecommendation {
  // Hard overrides
  if (riskFlags.includes('UNKNOWN_ENTITY')) return 'CAUTION';
  if (riskFlags.includes('HIGH_DISPUTE_RATE') && riskFlags.includes('LOW_BALANCE')) return 'AVOID';

  switch (level) {
    case 'TRUSTED': return 'TRUST';
    case 'FAVORABLE': return 'VERIFY';
    case 'MIXED': return 'CAUTION';
    case 'POOR': return 'AVOID';
    case 'UNTRUSTED': return 'AVOID';
  }
}

// ---------------------------------------------------------------------------
// Summary generation (algorithmic — no LLM for quick/standard)
// ---------------------------------------------------------------------------

function buildSummary(
  trust_score: number,
  trust_level: TrustLevel,
  signals: BehavioralSignals,
  riskFlags: string[],
  confidence: number,
): string {
  const parts: string[] = [];

  parts.push(`Trust score: ${trust_score}/100 (${trust_level}).`);

  // Highlight strongest signal
  const signalKeys = Object.keys(SIGNAL_WEIGHTS) as Array<keyof BehavioralSignals>;
  let bestKey: keyof BehavioralSignals = 'success_rate';
  let bestScore = 0;
  let worstKey: keyof BehavioralSignals = 'success_rate';
  let worstScore = 100;
  for (const k of signalKeys) {
    if (signals[k].score > bestScore) { bestScore = signals[k].score; bestKey = k; }
    if (signals[k].score < worstScore) { worstScore = signals[k].score; worstKey = k; }
  }

  const labelMap: Record<keyof BehavioralSignals, string> = {
    transaction_volume: 'transaction volume',
    success_rate: 'success rate',
    platform_tenure: 'platform tenure',
    skill_usage_diversity: 'skill usage diversity',
    dispute_history: 'dispute history',
    credit_health: 'credit health',
    vie_query_pattern: 'safety check habits',
  };

  if (bestScore >= 70) parts.push(`Strongest signal: ${labelMap[bestKey]} (${bestScore}/100).`);
  if (worstScore <= 30) parts.push(`Weakest signal: ${labelMap[worstKey]} (${worstScore}/100).`);

  if (riskFlags.length > 0) {
    parts.push(`Risk flags: ${riskFlags.join(', ')}.`);
  }

  if (confidence < 0.3) {
    parts.push('Low confidence — limited platform data available.');
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// LLM synthesis for deep tier
// ---------------------------------------------------------------------------

async function synthesizeTrustVerdict(
  target: string,
  targetType: string,
  signals: BehavioralSignals,
  trustScore: number,
  riskFlags: string[],
): Promise<string | null> {
  try {
    const { llmComplete } = await import('../providers/llm');

    const signalSummary = Object.entries(signals).map(
      ([k, v]) => `- ${k}: score=${v.score}/100`
    ).join('\n');

    const messages = [
      {
        role: 'user' as const,
        content: `You are ClawNet's intelligence analyst. Synthesize a 2-3 sentence trust assessment.

Entity: ${target} (${targetType})
Trust Score: ${trustScore}/100
Risk Flags: ${riskFlags.length > 0 ? riskFlags.join(', ') : 'None'}

Behavioral Signals:
${signalSummary}

Write a concise, professional assessment explaining why this entity received this score. Focus on the most impactful signals. Do NOT use markdown or bullet points.`,
      },
    ];

    const response = await llmComplete(messages, 'synthesis');
    return response?.content ?? null;
  } catch (err) {
    logger.warn({ err, target }, 'Agent Trust LLM synthesis failed — using algorithmic summary');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function computeAgentTrust(
  target: string,
  targetType: string,
  chain: string,
  tier: 'quick' | 'standard' | 'deep',
): Promise<TrustResult> {
  // 1. Look up the target in ClawNet's internal tables
  const keyData = lookupKeyData(target);
  const agentKey = keyData?.key ?? target;

  // 2. Gather raw data from platform tables
  const txStats = keyData ? getTransactionStats(agentKey) : { total: 0, successful: 0, failed: 0 };
  const uniqueSkills = keyData ? getUniqueSkillsUsed(agentKey) : 0;
  const disputeCount = keyData ? getDisputeCount(agentKey) : 0;
  const viePattern = keyData ? getVieQueryPattern(agentKey) : { tokens_checked: 0, avg_score: 0 };

  // 3. Score each behavioral signal
  const { pct: successPct, score: successScore } = scoreSuccessRate(txStats.successful, txStats.failed);
  const { days: tenureDays, score: tenureScore } = keyData
    ? scorePlatformTenure(keyData.created_at)
    : { days: 0, score: 0 };

  const signals: BehavioralSignals = {
    transaction_volume: {
      count: txStats.total,
      score: scoreTransactionVolume(txStats.total),
    },
    success_rate: {
      pct: successPct,
      score: successScore,
    },
    platform_tenure: {
      days: tenureDays,
      score: tenureScore,
    },
    skill_usage_diversity: {
      unique_skills: uniqueSkills,
      score: scoreSkillUsageDiversity(uniqueSkills),
    },
    dispute_history: {
      count: disputeCount,
      score: scoreDisputeHistory(disputeCount),
    },
    credit_health: {
      balance: keyData?.credits ?? 0,
      total_spent: keyData?.credits_used ?? 0,
      score: scoreCreditHealth(keyData?.credits ?? 0, keyData?.credits_used ?? 0),
    },
    vie_query_pattern: {
      tokens_checked: viePattern.tokens_checked,
      avg_score_of_checked: round6(viePattern.avg_score),
      score: scoreVieQueryPattern(viePattern.tokens_checked, viePattern.avg_score),
    },
  };

  // 4. Compute composite trust score
  const trust_score = computeComposite(signals);

  // 5. Detect risk flags
  const risk_flags = detectRiskFlags(keyData, signals, txStats);

  // 6. Map trust level and recommendation
  const trust_level = mapTrustLevel(trust_score);
  const recommendation = mapRecommendation(trust_level, risk_flags);

  // 7. Compute confidence
  const confidence = computeConfidence(keyData, txStats, signals);

  // 8. Cross-reference VIE score if available
  const related_vie_score = getRelatedVieScore(target, chain) ?? undefined;

  // 9. Build summary
  let summary = buildSummary(trust_score, trust_level, signals, risk_flags, confidence);

  // 10. For standard/deep: attempt LLM synthesis
  if (tier === 'deep' || tier === 'standard') {
    const llmSummary = await synthesizeTrustVerdict(target, targetType, signals, trust_score, risk_flags);
    if (llmSummary) summary = llmSummary;
  }

  return {
    entity: { address: target, type: targetType, chain },
    trust_score,
    trust_level,
    confidence,
    behavioral_signals: signals,
    risk_flags,
    recommendation,
    related_vie_score,
    summary,
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
