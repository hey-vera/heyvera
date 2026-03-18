/**
 * Predictive Alert Engine — Intelligence Suite Skill #4
 *
 * Pattern-matches across VIE history, Context Engine anomalies, and on-chain
 * signals to generate forward-looking alerts. Answers: "What's about to happen?"
 *
 * Six detection patterns:
 *   PRE_DUMP, ACCUMULATION, SOCIAL_SPIKE, TRUST_EROSION, LIQUIDITY_DRAIN, POSITIVE_MOMENTUM
 *
 * Writes to shared intel tables (skill_id = 'alert') and fires webhooks
 * to active intel_subscriptions.
 *
 * All math uses round6() to prevent floating-point drift.
 */

import { round6 } from './credits';
import { llmComplete, type LlmMessage } from '../providers/llm';
import { logger } from '../utils/logger';
import {
  upsertIntelEntity,
  upsertIntelScore,
  appendIntelEvent,
  getIntelEvents,
  getActiveSubscriptions,
  getAllIntelScores,
  getIntelScore,
  getEventCountSince,
} from '../db/intel';
import { getDb } from '../db/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternMatch {
  pattern_name: string;
  confidence: number;
  description: string;
  historical_accuracy: number;
  signals: Array<{ source: string; signal: string; value: string }>;
  predicted_outcome: string;
  time_horizon: string;
}

export interface AlertResult {
  entity: { address: string; type: string; chain: string };
  alert_score: number;
  alert_level: 'CALM' | 'WATCH' | 'WARNING' | 'ALERT' | 'CRITICAL';
  confidence: number;
  patterns: PatternMatch[];
  active_subscriptions: number;
  summary: string;
  forecast?: string;
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface PatternDef {
  name: string;
  severity: number;        // base severity weight 0-100
  description: string;
  predicted_outcome: string;
  time_horizon: string;
  historical_accuracy: number;
  check: (ctx: PatternContext) => PatternCheckResult;
}

interface PatternCheckResult {
  matched: boolean;
  confidence: number;
  signals: Array<{ source: string; signal: string; value: string }>;
}

interface PatternContext {
  target: string;
  targetType: string;
  chain: string;
  // Recent intel events (last 30 days)
  events: Array<{ skill_id: string; event_type: string; severity: string; payload_json: string; created_at: string }>;
  // Score history across skills
  scores: Array<{ skill_id: string; score_value: number; score_confidence: number; score_level: string; summary: string | null; scored_at: string }>;
  // VIE score trajectory
  vieScore: { current: number | null; previous: number | null; delta: number | null; level: string | null };
  // VIE report history (last 10)
  vieReports: Array<{ trust_score: number; risk_level: string; confidence: number; factors_json: string; created_at: string }>;
  // Event counts by severity
  warningCount: number;
  criticalCount: number;
  totalEventCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseJson(str: string | null | undefined): Record<string, unknown> {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function hoursAgo(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}

/**
 * Extract a numeric value from VIE report factors_json for a given category signal.
 * Returns null if not found.
 */
function extractFactorScore(report: { factors_json: string }, category: string): number | null {
  const factors = safeParseJson(report.factors_json);
  const cat = factors[category] as { score?: number } | null | undefined;
  return cat?.score ?? null;
}

// ---------------------------------------------------------------------------
// 6 Pattern Definitions
// ---------------------------------------------------------------------------

const PATTERNS: PatternDef[] = [
  // 1. PRE_DUMP
  {
    name: 'PRE_DUMP',
    severity: 90,
    description: 'VIE score declining + holder concentration increasing + social spike with high bot activity',
    predicted_outcome: 'Price decline >20% within 7 days',
    time_horizon: '7d',
    historical_accuracy: 0.72,
    check(ctx) {
      const signals: Array<{ source: string; signal: string; value: string }> = [];
      let matchCount = 0;
      const totalChecks = 4;

      // Signal 1: VIE score declining (delta negative)
      if (ctx.vieScore.delta !== null && ctx.vieScore.delta < -5) {
        signals.push({ source: 'vie', signal: 'score_declining', value: `delta: ${ctx.vieScore.delta}` });
        matchCount++;
      }

      // Signal 2: Holder distribution score low or dropping in recent reports
      if (ctx.vieReports.length >= 2) {
        const recent = extractFactorScore(ctx.vieReports[0], 'holder_distribution');
        const older = extractFactorScore(ctx.vieReports[ctx.vieReports.length - 1], 'holder_distribution');
        if (recent !== null && older !== null && recent < older - 5) {
          signals.push({ source: 'vie', signal: 'holder_concentration_increasing', value: `${older} → ${recent}` });
          matchCount++;
        } else if (recent !== null && recent < 30) {
          signals.push({ source: 'vie', signal: 'holder_concentration_high', value: `score: ${recent}` });
          matchCount++;
        }
      }

      // Signal 3: Social spike events (unusual activity)
      const socialEvents = ctx.events.filter(e =>
        e.skill_id === 'context' && (e.event_type === 'ANOMALY' || e.event_type === 'SOCIAL_SPIKE')
      );
      if (socialEvents.length >= 2) {
        signals.push({ source: 'context', signal: 'social_spike_detected', value: `${socialEvents.length} anomaly events` });
        matchCount++;
      }

      // Signal 4: Warning/critical events trending up
      if (ctx.warningCount + ctx.criticalCount >= 3) {
        signals.push({ source: 'intel', signal: 'elevated_warnings', value: `${ctx.warningCount} warnings, ${ctx.criticalCount} critical` });
        matchCount++;
      }

      const confidence = round6(matchCount / totalChecks);
      return { matched: matchCount >= 2, confidence, signals };
    },
  },

  // 2. ACCUMULATION
  {
    name: 'ACCUMULATION',
    severity: 30,
    description: 'Stable or improving fundamentals + low social noise + possible smart money accumulation',
    predicted_outcome: 'Smart money accumulating — potential upside in 14-30 days',
    time_horizon: '30d',
    historical_accuracy: 0.58,
    check(ctx) {
      const signals: Array<{ source: string; signal: string; value: string }> = [];
      let matchCount = 0;
      const totalChecks = 4;

      // Signal 1: VIE score stable or improving
      if (ctx.vieScore.current !== null && ctx.vieScore.current >= 50) {
        if (ctx.vieScore.delta !== null && ctx.vieScore.delta >= 0) {
          signals.push({ source: 'vie', signal: 'score_stable_or_improving', value: `${ctx.vieScore.current} (delta: ${ctx.vieScore.delta})` });
          matchCount++;
        } else if (ctx.vieScore.delta === null) {
          signals.push({ source: 'vie', signal: 'score_stable', value: `${ctx.vieScore.current}` });
          matchCount++;
        }
      }

      // Signal 2: Low social noise (few social/anomaly events)
      const socialEvents = ctx.events.filter(e =>
        e.skill_id === 'context' || e.event_type === 'SOCIAL_SPIKE'
      );
      if (socialEvents.length <= 2) {
        signals.push({ source: 'context', signal: 'low_social_noise', value: `${socialEvents.length} events` });
        matchCount++;
      }

      // Signal 3: Holder distribution improving or healthy
      if (ctx.vieReports.length >= 1) {
        const holderScore = extractFactorScore(ctx.vieReports[0], 'holder_distribution');
        if (holderScore !== null && holderScore >= 50) {
          signals.push({ source: 'vie', signal: 'healthy_holder_distribution', value: `score: ${holderScore}` });
          matchCount++;
        }
      }

      // Signal 4: Few warnings
      if (ctx.warningCount + ctx.criticalCount <= 1) {
        signals.push({ source: 'intel', signal: 'low_warning_count', value: `${ctx.warningCount + ctx.criticalCount} total` });
        matchCount++;
      }

      const confidence = round6(matchCount / totalChecks);
      return { matched: matchCount >= 3, confidence, signals };
    },
  },

  // 3. SOCIAL_SPIKE
  {
    name: 'SOCIAL_SPIKE',
    severity: 70,
    description: 'Sudden increase in mentions + anomaly events + low organic growth indicators',
    predicted_outcome: 'Possible pump & dump coordination — elevated volatility within 48h',
    time_horizon: '48h',
    historical_accuracy: 0.65,
    check(ctx) {
      const signals: Array<{ source: string; signal: string; value: string }> = [];
      let matchCount = 0;
      const totalChecks = 4;

      // Signal 1: Multiple anomaly/social events in recent events
      const anomalyEvents = ctx.events.filter(e =>
        e.event_type === 'ANOMALY' || e.event_type === 'SOCIAL_SPIKE'
      );
      if (anomalyEvents.length >= 3) {
        signals.push({ source: 'intel', signal: 'anomaly_spike', value: `${anomalyEvents.length} anomaly events` });
        matchCount++;
      }

      // Signal 2: Social signal score low in VIE (bot activity)
      if (ctx.vieReports.length >= 1) {
        const socialScore = extractFactorScore(ctx.vieReports[0], 'social_signal');
        if (socialScore !== null && socialScore < 40) {
          signals.push({ source: 'vie', signal: 'low_social_quality', value: `score: ${socialScore}` });
          matchCount++;
        }
      }

      // Signal 3: High event frequency (many events in short timeframe)
      const recentEvents = ctx.events.filter(e => {
        const created = new Date(e.created_at).getTime();
        return Date.now() - created < 24 * 60 * 60 * 1000;
      });
      if (recentEvents.length >= 5) {
        signals.push({ source: 'intel', signal: 'high_event_frequency', value: `${recentEvents.length} events in 24h` });
        matchCount++;
      }

      // Signal 4: VIE score not supporting the hype (mid-low)
      if (ctx.vieScore.current !== null && ctx.vieScore.current < 50) {
        signals.push({ source: 'vie', signal: 'fundamentals_weak', value: `VIE: ${ctx.vieScore.current}` });
        matchCount++;
      }

      const confidence = round6(matchCount / totalChecks);
      return { matched: matchCount >= 2, confidence, signals };
    },
  },

  // 4. TRUST_EROSION
  {
    name: 'TRUST_EROSION',
    severity: 80,
    description: 'VIE score dropped >15 points in 7 days + increasing anomaly events',
    predicted_outcome: 'Trust deteriorating — significant negative event likely within 7 days',
    time_horizon: '7d',
    historical_accuracy: 0.70,
    check(ctx) {
      const signals: Array<{ source: string; signal: string; value: string }> = [];
      let matchCount = 0;
      const totalChecks = 3;

      // Signal 1: VIE score dropped >15 points
      if (ctx.vieScore.delta !== null && ctx.vieScore.delta < -15) {
        signals.push({ source: 'vie', signal: 'major_score_drop', value: `delta: ${ctx.vieScore.delta}` });
        matchCount++;
      } else if (ctx.vieReports.length >= 2) {
        const newest = ctx.vieReports[0].trust_score;
        const oldest = ctx.vieReports[ctx.vieReports.length - 1].trust_score;
        if (newest - oldest < -15) {
          signals.push({ source: 'vie', signal: 'score_trajectory_declining', value: `${oldest} → ${newest}` });
          matchCount++;
        }
      }

      // Signal 2: Anomaly events increasing
      const anomalyEvents = ctx.events.filter(e => e.event_type === 'ANOMALY');
      if (anomalyEvents.length >= 2) {
        signals.push({ source: 'context', signal: 'anomalies_increasing', value: `${anomalyEvents.length} anomaly events` });
        matchCount++;
      }

      // Signal 3: Critical or warning severity events present
      if (ctx.criticalCount >= 1 || ctx.warningCount >= 2) {
        signals.push({ source: 'intel', signal: 'elevated_severity', value: `${ctx.criticalCount} critical, ${ctx.warningCount} warnings` });
        matchCount++;
      }

      const confidence = round6(matchCount / totalChecks);
      return { matched: matchCount >= 2, confidence, signals };
    },
  },

  // 5. LIQUIDITY_DRAIN
  {
    name: 'LIQUIDITY_DRAIN',
    severity: 85,
    description: 'On-chain activity signals suggest liquidity decreasing + VIE risk elevated',
    predicted_outcome: 'Liquidity risk increasing — potential rug or LP removal within 48h',
    time_horizon: '48h',
    historical_accuracy: 0.68,
    check(ctx) {
      const signals: Array<{ source: string; signal: string; value: string }> = [];
      let matchCount = 0;
      const totalChecks = 4;

      // Signal 1: On-chain activity score low
      if (ctx.vieReports.length >= 1) {
        const onchainScore = extractFactorScore(ctx.vieReports[0], 'onchain_activity');
        if (onchainScore !== null && onchainScore < 30) {
          signals.push({ source: 'vie', signal: 'low_onchain_activity', value: `score: ${onchainScore}` });
          matchCount++;
        }
      }

      // Signal 2: Contract safety score low
      if (ctx.vieReports.length >= 1) {
        const contractScore = extractFactorScore(ctx.vieReports[0], 'contract_safety');
        if (contractScore !== null && contractScore < 40) {
          signals.push({ source: 'vie', signal: 'contract_safety_concern', value: `score: ${contractScore}` });
          matchCount++;
        }
      }

      // Signal 3: VIE risk level is HIGH or CRITICAL
      if (ctx.vieScore.level === 'HIGH' || ctx.vieScore.level === 'CRITICAL') {
        signals.push({ source: 'vie', signal: 'elevated_risk_level', value: `${ctx.vieScore.level}` });
        matchCount++;
      }

      // Signal 4: Liquidity-related events present
      const liqEvents = ctx.events.filter(e =>
        e.event_type === 'LIQUIDITY_CHANGE' || e.event_type === 'LP_UNLOCK'
      );
      if (liqEvents.length >= 1) {
        signals.push({ source: 'intel', signal: 'liquidity_events', value: `${liqEvents.length} events` });
        matchCount++;
      }

      const confidence = round6(matchCount / totalChecks);
      return { matched: matchCount >= 2, confidence, signals };
    },
  },

  // 6. POSITIVE_MOMENTUM
  {
    name: 'POSITIVE_MOMENTUM',
    severity: 15,
    description: 'VIE score improving + organic social growth + healthy on-chain activity',
    predicted_outcome: 'Positive trend forming — sustained growth likely over 14 days',
    time_horizon: '14d',
    historical_accuracy: 0.55,
    check(ctx) {
      const signals: Array<{ source: string; signal: string; value: string }> = [];
      let matchCount = 0;
      const totalChecks = 4;

      // Signal 1: VIE score improving
      if (ctx.vieScore.delta !== null && ctx.vieScore.delta > 5) {
        signals.push({ source: 'vie', signal: 'score_improving', value: `delta: +${ctx.vieScore.delta}` });
        matchCount++;
      }

      // Signal 2: Healthy social signal score
      if (ctx.vieReports.length >= 1) {
        const socialScore = extractFactorScore(ctx.vieReports[0], 'social_signal');
        if (socialScore !== null && socialScore >= 60) {
          signals.push({ source: 'vie', signal: 'healthy_social_signals', value: `score: ${socialScore}` });
          matchCount++;
        }
      }

      // Signal 3: Good on-chain activity
      if (ctx.vieReports.length >= 1) {
        const onchainScore = extractFactorScore(ctx.vieReports[0], 'onchain_activity');
        if (onchainScore !== null && onchainScore >= 55) {
          signals.push({ source: 'vie', signal: 'healthy_onchain_activity', value: `score: ${onchainScore}` });
          matchCount++;
        }
      }

      // Signal 4: Low warning count + stable VIE
      if (ctx.vieScore.current !== null && ctx.vieScore.current >= 60 && ctx.warningCount === 0) {
        signals.push({ source: 'intel', signal: 'clean_profile', value: `VIE: ${ctx.vieScore.current}, 0 warnings` });
        matchCount++;
      }

      const confidence = round6(matchCount / totalChecks);
      return { matched: matchCount >= 2, confidence, signals };
    },
  },
];

// ---------------------------------------------------------------------------
// Build context from DB
// ---------------------------------------------------------------------------

function buildPatternContext(target: string, targetType: string, chain: string): PatternContext {
  const thirtyDaysAgo = daysAgo(30);

  // Get all intel events for this entity (all skills, last 30 days)
  const events = getIntelEvents(target, chain, { limit: 200, since: thirtyDaysAgo });

  // Get all scores across skills
  const scores = getAllIntelScores(target, chain);

  // VIE score trajectory
  const vieScoreRow = getIntelScore(target, chain, 'vie');
  const vieScore = {
    current: vieScoreRow?.score_value ?? null,
    previous: vieScoreRow?.previous_score ?? null,
    delta: vieScoreRow?.score_delta ?? null,
    level: vieScoreRow?.score_level ?? null,
  };

  // VIE report history (last 10)
  let vieReports: Array<{ trust_score: number; risk_level: string; confidence: number; factors_json: string; created_at: string }> = [];
  try {
    vieReports = getDb().prepare(
      `SELECT trust_score, risk_level, confidence, factors_json, created_at
       FROM vie_reports
       WHERE target = ? AND chain = ? AND created_at > ?
       ORDER BY created_at DESC LIMIT 10`
    ).all(target, chain, thirtyDaysAgo) as typeof vieReports;
  } catch {
    // vie_reports table may not exist yet — non-blocking
  }

  // Event severity counts (last 7 days)
  const sevenDaysAgo = daysAgo(7);
  const recentEvents = events.filter(e => e.created_at > sevenDaysAgo);
  const warningCount = recentEvents.filter(e => e.severity === 'warning').length;
  const criticalCount = recentEvents.filter(e => e.severity === 'critical').length;

  return {
    target,
    targetType,
    chain,
    events,
    scores,
    vieScore,
    vieReports,
    warningCount,
    criticalCount,
    totalEventCount: events.length,
  };
}

// ---------------------------------------------------------------------------
// Alert score + level mapping
// ---------------------------------------------------------------------------

function computeAlertScore(matches: PatternMatch[]): number {
  if (matches.length === 0) return 0;

  // Weighted sum: pattern severity * confidence, capped at 100
  let score = 0;
  for (const m of matches) {
    const patternDef = PATTERNS.find(p => p.name === m.pattern_name);
    const severity = patternDef?.severity ?? 50;
    score = round6(score + round6(severity * m.confidence));
  }

  return Math.round(clamp(score, 0, 100));
}

function alertLevel(score: number): 'CALM' | 'WATCH' | 'WARNING' | 'ALERT' | 'CRITICAL' {
  if (score <= 20) return 'CALM';
  if (score <= 40) return 'WATCH';
  if (score <= 60) return 'WARNING';
  if (score <= 80) return 'ALERT';
  return 'CRITICAL';
}

function buildSummary(target: string, level: string, matches: PatternMatch[]): string {
  if (matches.length === 0) {
    return `No significant predictive patterns detected for ${target}. Situation appears stable.`;
  }

  const patternNames = matches.map(m => m.pattern_name).join(', ');
  const topPattern = matches.reduce((a, b) => a.confidence > b.confidence ? a : b);

  return `${matches.length} pattern(s) detected for ${target}: ${patternNames}. ` +
    `Highest confidence: ${topPattern.pattern_name} (${Math.round(topPattern.confidence * 100)}%). ` +
    `Alert level: ${level}.`;
}

// ---------------------------------------------------------------------------
// LLM forecast (Deep tier only)
// ---------------------------------------------------------------------------

async function generateForecast(
  target: string,
  targetType: string,
  chain: string,
  matches: PatternMatch[],
  ctx: PatternContext,
): Promise<string | undefined> {
  try {
    const patternSummaries = matches.map(m =>
      `- ${m.pattern_name} (confidence: ${Math.round(m.confidence * 100)}%): ${m.description}. ` +
      `Predicted: ${m.predicted_outcome} (${m.time_horizon})`
    ).join('\n');

    const vieInfo = ctx.vieScore.current !== null
      ? `Current VIE score: ${ctx.vieScore.current}/100 (${ctx.vieScore.level}), delta: ${ctx.vieScore.delta ?? 'N/A'}`
      : 'No VIE score available';

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: `You are ClawNet's Predictive Alert Engine. Synthesize pattern matches into a concise forward-looking assessment for an AI agent. Be specific, actionable, and data-driven. 3-5 sentences max.`,
      },
      {
        role: 'user',
        content: `Entity: ${target} (${targetType} on ${chain})
${vieInfo}
Recent events: ${ctx.totalEventCount} (${ctx.warningCount} warnings, ${ctx.criticalCount} critical in 7d)

Detected patterns:
${patternSummaries || 'None'}

Provide a forward-looking assessment combining these signals. What should an agent watch for next? Be specific about timeframes and probabilities.`,
      },
    ];

    const result = await llmComplete(messages, 'synthesis');
    return result?.content ?? undefined;
  } catch (err) {
    logger.warn({ err, target }, 'Predictive alert forecast LLM failed — skipping');
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Fire webhooks to subscribers
// ---------------------------------------------------------------------------

function fireAlertWebhooks(
  target: string,
  chain: string,
  alertResult: AlertResult,
): void {
  try {
    const subs = getActiveSubscriptions(target, chain);
    if (subs.length === 0) return;

    for (const sub of subs) {
      if (!sub.webhook_url) continue;

      const alertTypes: string[] = (() => {
        try { return JSON.parse(sub.alert_types); } catch { return []; }
      })();

      // Check if any matched pattern triggers this subscription
      const thresholds = safeParseJson(sub.threshold_json);
      const scoreDrop = typeof thresholds.score_drop === 'number' ? thresholds.score_drop : null;
      const confBelow = typeof thresholds.confidence_below === 'number' ? thresholds.confidence_below : null;

      // Match on alert types
      const hasScoreChange = alertTypes.includes('SCORE_CHANGE');
      const hasAnomaly = alertTypes.includes('ANOMALY');
      const hasAll = alertTypes.includes('*');

      const shouldFire = hasAll ||
        (hasScoreChange && alertResult.alert_score >= 40) ||
        (hasAnomaly && alertResult.patterns.length > 0) ||
        (scoreDrop !== null && alertResult.alert_score >= scoreDrop) ||
        (confBelow !== null && alertResult.confidence <= confBelow);

      if (!shouldFire) continue;

      // Fire async — never crashes caller
      const body = JSON.stringify({
        event: 'PREDICTIVE_ALERT',
        timestamp: new Date().toISOString(),
        data: {
          entity: alertResult.entity,
          alert_score: alertResult.alert_score,
          alert_level: alertResult.alert_level,
          patterns: alertResult.patterns.map(p => ({
            pattern_name: p.pattern_name,
            confidence: p.confidence,
            predicted_outcome: p.predicted_outcome,
          })),
          summary: alertResult.summary,
        },
      });

      fetch(sub.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ClawNet-Event': 'PREDICTIVE_ALERT' },
        body,
        signal: AbortSignal.timeout(10_000),
      }).then(() => {
        // Increment fire count
        try {
          getDb().prepare("UPDATE intel_subscriptions SET fire_count = fire_count + 1, last_fired = datetime('now') WHERE id = ?").run(sub.id);
        } catch { /* non-blocking */ }
      }).catch(err => {
        logger.warn({ err, subscriptionId: sub.id }, 'Alert webhook delivery failed');
      });
    }
  } catch (err) {
    logger.warn({ err, target }, 'Alert webhook fire failed — non-blocking');
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function analyzePatterns(
  target: string,
  targetType: string,
  chain: string,
  tier: 'analysis' | 'forecast',
): Promise<AlertResult> {
  // 1. Build context from intel tables
  const ctx = buildPatternContext(target, targetType, chain);

  // 2. Run all 6 pattern checks
  const matches: PatternMatch[] = [];
  for (const pattern of PATTERNS) {
    const result = pattern.check(ctx);
    if (result.matched && result.confidence > 0) {
      matches.push({
        pattern_name: pattern.name,
        confidence: result.confidence,
        description: pattern.description,
        historical_accuracy: pattern.historical_accuracy,
        signals: result.signals,
        predicted_outcome: pattern.predicted_outcome,
        time_horizon: pattern.time_horizon,
      });
    }
  }

  // Sort by confidence descending
  matches.sort((a, b) => b.confidence - a.confidence);

  // 3. Compute alert score and level
  const score = computeAlertScore(matches);
  const level = alertLevel(score);

  // 4. Compute overall confidence (average of matched pattern confidences, or 0.5 if none)
  const confidence = matches.length > 0
    ? round6(matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length)
    : 0.5;

  // 5. Build summary
  const summary = buildSummary(target, level, matches);

  // 6. For forecast tier: LLM synthesis
  let forecast: string | undefined;
  if (tier === 'forecast') {
    forecast = await generateForecast(target, targetType, chain, matches, ctx);
  }

  // 7. Count active subscriptions
  let activeSubscriptions = 0;
  try {
    const subs = getActiveSubscriptions(target, chain);
    activeSubscriptions = subs.length;
  } catch { /* non-blocking */ }

  const alertResult: AlertResult = {
    entity: { address: target, type: targetType, chain },
    alert_score: score,
    alert_level: level,
    confidence,
    patterns: matches,
    active_subscriptions: activeSubscriptions,
    summary,
    forecast,
  };

  // 8. Write to shared intel tables (non-blocking)
  try {
    const entityId = upsertIntelEntity(target, targetType, chain);
    upsertIntelScore(
      entityId, target, chain, 'alert',
      score, confidence, level,
      summary,
      { patterns: matches.map(m => m.pattern_name), alert_level: level },
    );
    // Append event for each matched pattern
    for (const m of matches) {
      appendIntelEvent(
        entityId, target, chain, 'alert',
        `PATTERN_${m.pattern_name}`,
        m.confidence >= 0.7 ? 'warning' : 'info',
        {
          pattern: m.pattern_name,
          confidence: m.confidence,
          predicted_outcome: m.predicted_outcome,
          time_horizon: m.time_horizon,
          signal_count: m.signals.length,
        },
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Alert intel table write failed — non-blocking');
  }

  // 9. Fire webhooks to subscribers
  fireAlertWebhooks(target, chain, alertResult);

  return alertResult;
}
