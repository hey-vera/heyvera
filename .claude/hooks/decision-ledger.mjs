#!/usr/bin/env node
/**
 * decision-ledger.mjs — Routing outcome tracking for the Dual-Brain Orchestrator.
 *
 * Records every routing decision with its context, and later enriches it with
 * outcome data (duration, success, retries, user overrides, follow-up fixes).
 *
 * Over time, this builds a per-repo knowledge base of which provider/model
 * performs best for which task shapes.
 *
 * Exported API:
 *   recordDecision(decision)     → log a routing decision, returns decision_id
 *   recordOutcome(id, outcome)   → enrich a decision with its outcome
 *   getInsights(opts?)           → aggregate patterns from the ledger
 *
 * CLI:
 *   node .claude/hooks/decision-ledger.mjs                # show insights
 *   node .claude/hooks/decision-ledger.mjs --json         # JSON output
 *   node .claude/hooks/decision-ledger.mjs --recent 20    # last N decisions
 */

import { appendFileSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = join(__dirname, 'decision-ledger.jsonl');

function genId() {
  return randomBytes(6).toString('hex');
}

function recordDecision(decision = {}) {
  const id = genId();
  const entry = JSON.stringify({
    type: 'decision',
    id,
    timestamp: new Date().toISOString(),
    session_id: decision.session_id || process.env.CLAUDE_SESSION_ID || process.ppid?.toString() || null,
    profile: decision.profile || 'balanced',

    // Routing context
    tier: decision.tier || 'execute',
    provider: decision.provider || 'claude',
    model: decision.model || 'unknown',
    recommended_model: decision.recommended_model || null,
    followed: decision.followed ?? null,

    // Task shape
    task_type: decision.task_type || null,
    prompt_hash: decision.prompt_hash || null,
    estimated_duration_ms: decision.estimated_duration_ms || null,
    file_count: decision.file_count || null,
    context_coupling: decision.context_coupling || null,
    isolation: decision.isolation || null,

    // Provider state at decision time
    claude_pressure: decision.claude_pressure || null,
    openai_pressure: decision.openai_pressure || null,
  });

  try {
    appendFileSync(LEDGER_FILE, entry + '\n');
  } catch {}

  return id;
}

function recordOutcome(decisionId, outcome = {}) {
  const entry = JSON.stringify({
    type: 'outcome',
    decision_id: decisionId,
    timestamp: new Date().toISOString(),

    // Timing
    actual_duration_ms: outcome.actual_duration_ms || null,
    codex_startup_ms: outcome.codex_startup_ms || null,

    // Quality signals
    success: outcome.success ?? null,
    tests_passed: outcome.tests_passed ?? null,
    tests_failed: outcome.tests_failed ?? null,
    retries: outcome.retries || 0,
    user_override: outcome.user_override ?? false,
    followup_fix_needed: outcome.followup_fix_needed ?? false,

    // Cost
    actual_input_tokens: outcome.actual_input_tokens || null,
    actual_output_tokens: outcome.actual_output_tokens || null,
    estimated_cost_usd: outcome.estimated_cost_usd || null,

    // Files
    files_changed: outcome.files_changed || null,
    files_read: outcome.files_read || null,
  });

  try {
    appendFileSync(LEDGER_FILE, entry + '\n');
  } catch {}
}

function loadLedger() {
  if (!existsSync(LEDGER_FILE)) return { decisions: [], outcomes: [] };

  let raw;
  try { raw = readFileSync(LEDGER_FILE, 'utf8'); } catch { return { decisions: [], outcomes: [] }; }

  const decisions = [];
  const outcomes = [];

  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'decision') decisions.push(entry);
      else if (entry.type === 'outcome') outcomes.push(entry);
    } catch {}
  }

  return { decisions, outcomes };
}

function mergeDecisionsWithOutcomes(decisions, outcomes) {
  const outcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.decision_id] = o;
  }
  return decisions.map(d => ({
    ...d,
    outcome: outcomeMap[d.id] || null,
  }));
}

function getInsights(opts = {}) {
  const { decisions, outcomes } = loadLedger();
  const merged = mergeDecisionsWithOutcomes(decisions, outcomes);
  const withOutcomes = merged.filter(d => d.outcome);

  // Provider win rates
  const providerStats = {};
  for (const d of withOutcomes) {
    const key = d.provider;
    if (!providerStats[key]) providerStats[key] = { total: 0, success: 0, overrides: 0, followups: 0, totalDuration: 0, counted: 0 };
    providerStats[key].total++;
    if (d.outcome.success) providerStats[key].success++;
    if (d.outcome.user_override) providerStats[key].overrides++;
    if (d.outcome.followup_fix_needed) providerStats[key].followups++;
    if (d.outcome.actual_duration_ms) {
      providerStats[key].totalDuration += d.outcome.actual_duration_ms;
      providerStats[key].counted++;
    }
  }

  // Tier performance
  const tierStats = {};
  for (const d of withOutcomes) {
    const key = `${d.provider}:${d.tier}`;
    if (!tierStats[key]) tierStats[key] = { total: 0, success: 0, avgDuration: 0, counted: 0 };
    tierStats[key].total++;
    if (d.outcome.success) tierStats[key].success++;
    if (d.outcome.actual_duration_ms) {
      tierStats[key].counted++;
      tierStats[key].avgDuration += (d.outcome.actual_duration_ms - tierStats[key].avgDuration) / tierStats[key].counted;
    }
  }

  // Task type patterns
  const taskPatterns = {};
  for (const d of withOutcomes) {
    if (!d.task_type) continue;
    const key = d.task_type;
    if (!taskPatterns[key]) taskPatterns[key] = {};
    const pk = d.provider;
    if (!taskPatterns[key][pk]) taskPatterns[key][pk] = { total: 0, success: 0 };
    taskPatterns[key][pk].total++;
    if (d.outcome.success) taskPatterns[key][pk].success++;
  }

  // Compliance rate
  const total = decisions.length;
  const followedCount = decisions.filter(d => d.followed === true).length;
  const compliance = total > 0 ? Math.round((followedCount / total) * 100) : 0;

  // Recommendations
  const recommendations = [];
  for (const [task, providers] of Object.entries(taskPatterns)) {
    const sorted = Object.entries(providers)
      .map(([p, s]) => ({ provider: p, rate: s.total > 0 ? s.success / s.total : 0, total: s.total }))
      .filter(x => x.total >= 3)
      .sort((a, b) => b.rate - a.rate);
    if (sorted.length >= 2 && sorted[0].rate > sorted[1].rate + 0.1) {
      recommendations.push(`${sorted[0].provider} wins ${task} tasks (${Math.round(sorted[0].rate * 100)}% vs ${Math.round(sorted[1].rate * 100)}%)`);
    }
  }

  return {
    total_decisions: total,
    with_outcomes: withOutcomes.length,
    compliance_rate: compliance,
    provider_stats: providerStats,
    tier_stats: tierStats,
    task_patterns: taskPatterns,
    recommendations,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function printInsights() {
  const insights = getInsights();

  if (insights.total_decisions === 0) {
    console.log('');
    console.log('  No routing decisions recorded yet.');
    console.log('  The decision ledger builds over time as you use Claude Code.');
    console.log('');
    return;
  }

  const W = 52;
  const pad = (s, len = W - 2) => {
    s = String(s);
    return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
  };
  const ln = (s) => `║ ${pad(s)} ║`;
  const br = (l, r) => l + '═'.repeat(W) + r;
  const sep = () => '╠' + '═'.repeat(W) + '╣';

  const lines = [];
  lines.push(br('╔', '╗'));
  lines.push(ln('Decision Ledger Insights'));
  lines.push(sep());
  lines.push(ln(`Total decisions:  ${insights.total_decisions}`));
  lines.push(ln(`With outcomes:    ${insights.with_outcomes}`));
  lines.push(ln(`Compliance rate:  ${insights.compliance_rate}%`));
  lines.push(sep());

  // Provider stats
  lines.push(ln('Provider Performance'));
  for (const [provider, stats] of Object.entries(insights.provider_stats)) {
    const rate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
    const avgMs = stats.counted > 0 ? Math.round(stats.totalDuration / stats.counted / 1000) : '?';
    lines.push(ln(`  ${provider}: ${rate}% success, ${stats.overrides} overrides, avg ${avgMs}s`));
    if (stats.followups > 0) {
      lines.push(ln(`    ${stats.followups} follow-up fixes needed`));
    }
  }

  // Recommendations
  if (insights.recommendations.length > 0) {
    lines.push(sep());
    lines.push(ln('Recommendations'));
    for (const rec of insights.recommendations) {
      lines.push(ln(`  ${rec}`));
    }
  }

  lines.push(br('╚', '╝'));
  console.log('');
  for (const l of lines) console.log(`  ${l}`);
  console.log('');
}

function printRecent(n) {
  const { decisions, outcomes } = loadLedger();
  const merged = mergeDecisionsWithOutcomes(decisions, outcomes);
  const recent = merged.slice(-n);

  if (recent.length === 0) {
    console.log('  No decisions recorded yet.');
    return;
  }

  console.log('');
  for (const d of recent) {
    const time = d.timestamp?.slice(11, 19) || '??:??:??';
    const status = d.outcome?.success ? '✓' : d.outcome ? '✗' : '?';
    const dur = d.outcome?.actual_duration_ms ? `${Math.round(d.outcome.actual_duration_ms / 1000)}s` : '';
    console.log(`  ${status} ${time} ${d.provider}/${d.model} [${d.tier}] ${dur}`);
  }
  console.log('');
}

// CLI entry
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);

  if (args.includes('--json')) {
    console.log(JSON.stringify(getInsights(), null, 2));
  } else if (args.includes('--recent')) {
    const idx = args.indexOf('--recent');
    const n = parseInt(args[idx + 1]) || 20;
    printRecent(n);
  } else {
    printInsights();
  }
}

export { recordDecision, recordOutcome, getInsights, loadLedger };
