#!/usr/bin/env node
/**
 * session-report.mjs — Comprehensive session-end summary report.
 *
 * Usage:
 *   node .claude/hooks/session-report.mjs
 *
 * Reads:
 *   .claude/hooks/usage-YYYY-MM-DD.jsonl  — today's usage log
 *   .claude/hooks/usage.jsonl             — legacy usage log (backwards compat)
 *   .claude/orchestrator.json             — config, rates, pricing_verified date
 *
 * Sections:
 *   1. Activity Summary   — calls and estimated cost by tier
 *   2. Routing Compliance — tier_recommendation follow/ignore rates
 *   3. Duplicate Warnings — prompt_hash collisions in today's recommendations
 *   4. Quality Gate       — run quality-gate.mjs and display result
 *   5. Data Quality       — token source breakdown (actual vs heuristic)
 *   6. Drift Warnings     — pricing staleness and config issues
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, '..', 'orchestrator.json');
const QUALITY_GATE = join(__dirname, 'quality-gate.mjs');

// ---------------------------------------------------------------------------
// Box width
// ---------------------------------------------------------------------------
const BOX_W = 52; // inner width (between ║ chars, including 1-space padding each side)
const INNER = BOX_W - 2; // usable text width

// ---------------------------------------------------------------------------
// Box helpers
// ---------------------------------------------------------------------------
function boxTop()    { return '╔' + '═'.repeat(BOX_W) + '╗'; }
function boxBot()    { return '╚' + '═'.repeat(BOX_W) + '╝'; }
function boxDiv()    { return '╠' + '═'.repeat(BOX_W) + '╣'; }
function boxLine(s)  {
  s = String(s ?? '');
  if (s.length > INNER) s = s.slice(0, INNER - 1) + '…';
  return '║ ' + s + ' '.repeat(INNER - s.length) + ' ║';
}
function boxBlank()  { return boxLine(''); }
function boxTitle(s) {
  const padTotal = INNER - s.length;
  const left  = Math.floor(padTotal / 2);
  const right = padTotal - left;
  return '║' + ' '.repeat(left + 1) + s + ' '.repeat(right + 1) + '║';
}

// ---------------------------------------------------------------------------
// Padding helpers
// ---------------------------------------------------------------------------
function padR(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s; }
function fmt$(n) { return '$' + n.toFixed(2); }

// ---------------------------------------------------------------------------
// Load orchestrator config
// ---------------------------------------------------------------------------
function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}

function buildRateMap(config) {
  const rates = {};
  if (!config?.subscriptions) return rates;
  for (const provider of Object.values(config.subscriptions)) {
    for (const [modelKey, data] of Object.entries(provider.models || {})) {
      rates[modelKey] = {
        tier: data.tier,
        input_per_mtok:  data.input_per_mtok,
        output_per_mtok: data.output_per_mtok,
      };
    }
  }
  return rates;
}

// ---------------------------------------------------------------------------
// Token heuristics (mirrors cost-report.mjs)
// ---------------------------------------------------------------------------
const TOKEN_HEURISTICS = {
  search:  { input: 2_000,  output:   500 },
  execute: { input: 4_000,  output: 1_500 },
  think:   { input: 8_000,  output: 3_000 },
};

function estimateCost(tier, model, rateMap, record = {}) {
  const heuristic = TOKEN_HEURISTICS[tier] || TOKEN_HEURISTICS.execute;
  const hasActual = record.input_tokens != null && record.output_tokens != null;
  const inputTok  = hasActual ? record.input_tokens  : heuristic.input;
  const outputTok = hasActual ? record.output_tokens : heuristic.output;
  const rate = rateMap[model] || rateMap['main-session'];
  if (!rate) {
    const fallbackTier = (model === 'main-session' || model === 'unknown') ? 'think' : tier;
    const tierRate =
      Object.values(rateMap).find(r => r.tier === fallbackTier) ||
      Object.values(rateMap).find(r => r.tier === tier);
    if (!tierRate) return 0;
    return (inputTok / 1_000_000) * tierRate.input_per_mtok +
           (outputTok / 1_000_000) * tierRate.output_per_mtok;
  }
  return (inputTok / 1_000_000) * rate.input_per_mtok +
         (outputTok / 1_000_000) * rate.output_per_mtok;
}

// ---------------------------------------------------------------------------
// Load today's usage records
// ---------------------------------------------------------------------------
function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
}

function loadTodayRecords() {
  const today = todayPrefix();
  const files = [];

  // Today's dated file
  const datedFile = join(__dirname, `usage-${today}.jsonl`);
  if (existsSync(datedFile)) files.push(datedFile);

  // Legacy usage.jsonl — include but filter to today
  const legacyFile = join(__dirname, 'usage.jsonl');
  if (existsSync(legacyFile)) files.push(legacyFile);

  const records = [];
  for (const f of files) {
    try {
      const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (r.timestamp?.startsWith(today)) records.push(r);
        } catch { /* skip bad lines */ }
      }
    } catch { /* skip unreadable files */ }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Section 1: Activity Summary
// ---------------------------------------------------------------------------
const TIER_ORDER  = ['search', 'execute', 'think'];
const TIER_LABELS = { search: 'Search ', execute: 'Execute', think: 'Think  ' };

function buildActivitySection(records, rateMap) {
  // Aggregate by tier — only non-recommendation records
  const activity = records.filter(r => r.type !== 'tier_recommendation');

  const buckets = {};
  for (const r of activity) {
    const tier  = r.tier  || 'execute';
    const model = r.model || 'unknown';
    if (!buckets[tier]) buckets[tier] = { calls: 0, cost: 0, actualCount: 0 };
    buckets[tier].calls += 1;
    buckets[tier].cost  += estimateCost(tier, model, rateMap, r);
    if (r.input_tokens != null && r.output_tokens != null) buckets[tier].actualCount += 1;
  }

  const lines = [];
  lines.push(boxLine('Activity Summary'));
  lines.push(boxLine('─'.repeat(INNER)));

  // Column widths: Tier(8) │ Calls(6) │ Est. Cost(10)
  const header = padR('Tier', 8) + ' │ ' + padL('Calls', 5) + ' │ ' + padL('Est. Cost', 10);
  const divRow = '─'.repeat(8) + '─┼─' + '─'.repeat(5) + '─┼─' + '─'.repeat(10);
  lines.push(boxLine(header));
  lines.push(boxLine(divRow));

  let totalCalls = 0;
  let totalCost  = 0;

  for (const tier of TIER_ORDER) {
    const b = buckets[tier];
    if (!b) continue;
    const label = padR(TIER_LABELS[tier] || tier, 8);
    const calls = padL(String(b.calls), 5);
    const cost  = padL(fmt$(b.cost), 10);
    lines.push(boxLine(`${label} │ ${calls} │ ${cost}`));
    totalCalls += b.calls;
    totalCost  += b.cost;
  }

  lines.push(boxLine(divRow));
  lines.push(boxLine(padR('Total', 8) + ' │ ' + padL(String(totalCalls), 5) + ' │ ' + padL(fmt$(totalCost), 10)));

  if (totalCalls === 0) {
    lines.push(boxLine('  (no usage data recorded today)'));
  }

  return { lines, totalCalls, totalCost, buckets };
}

// ---------------------------------------------------------------------------
// Section 1b: Provider Balance
// ---------------------------------------------------------------------------
function detectProvider(record) {
  if (record.provider) return record.provider;
  const m = (record.model || '').toLowerCase();
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3')) return 'openai';
  if (m.includes('opus') || m.includes('sonnet') || m.includes('haiku')) return 'claude';
  return 'unknown';
}

function buildProviderBalanceSection(records) {
  const activity = records.filter(r => r.type !== 'tier_recommendation');

  // Count calls per provider
  const providerCounts = {};
  for (const r of activity) {
    const provider = detectProvider(r);
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;
  }

  const totalCalls = Object.values(providerCounts).reduce((s, n) => s + n, 0);

  // Special event counts
  const gptDispatches   = records.filter(r => r.dispatcher === 'gpt-work-dispatcher').length;
  const dualThinkEvents = records.filter(r => r.tool === 'dual-brain-think').length;

  const lines = [];
  lines.push(boxLine('Provider Balance'));
  lines.push(boxLine('─'.repeat(INNER)));

  if (totalCalls === 0) {
    lines.push(boxLine('  (no usage data recorded today)'));
  } else {
    // Render each provider sorted by count descending
    const sorted = Object.entries(providerCounts).sort((a, b) => b[1] - a[1]);
    for (const [provider, count] of sorted) {
      const pct    = Math.round((count / totalCalls) * 100);
      const label  = padR(provider.charAt(0).toUpperCase() + provider.slice(1) + ':', 9);
      lines.push(boxLine(`${label} ${padL(pct + '%', 3)} of work (${count} calls)`));
    }
  }

  lines.push(boxBlank());
  lines.push(boxLine(`GPT Dispatches: ${gptDispatches}`));
  lines.push(boxLine(`Dual-Think Events: ${dualThinkEvents}`));

  // Recommendation line when imbalance is significant (one provider >70%)
  if (totalCalls > 0) {
    for (const [provider, count] of Object.entries(providerCounts)) {
      const pct = (count / totalCalls) * 100;
      if (pct > 70) {
        const other = provider === 'claude' ? 'OpenAI' : 'Claude';
        lines.push(boxBlank());
        lines.push(boxLine(`Next session: Route more execution work to ${other}`));
        break;
      }
    }
  }

  return { lines };
}

// ---------------------------------------------------------------------------
// Section 2: Routing Compliance
// ---------------------------------------------------------------------------
function buildComplianceSection(records, rateMap) {
  const recs = records.filter(r => r.type === 'tier_recommendation');

  const total     = recs.length;
  const followed  = recs.filter(r => r.followed === true).length;
  const ignored   = total - followed;
  const followPct = total > 0 ? Math.round((followed / total) * 100) : 0;
  const ignorePct = total > 0 ? 100 - followPct : 0;

  // Overspend: for each ignored rec, diff between actual-tier cost and recommended-tier cost
  let overspend = 0;
  for (const r of recs) {
    if (r.followed === true) continue;
    if (!r.recommended_tier || !r.actual_tier) continue;
    const recommended = TOKEN_HEURISTICS[r.recommended_tier] || TOKEN_HEURISTICS.execute;
    const actual      = TOKEN_HEURISTICS[r.actual_tier]      || TOKEN_HEURISTICS.execute;

    const recRate = Object.values(rateMap).find(x => x.tier === r.recommended_tier);
    const actRate = Object.values(rateMap).find(x => x.tier === r.actual_tier);
    if (!recRate || !actRate) continue;

    const recCost = (recommended.input / 1_000_000) * recRate.input_per_mtok +
                    (recommended.output / 1_000_000) * recRate.output_per_mtok;
    const actCost = (actual.input / 1_000_000) * actRate.input_per_mtok +
                    (actual.output / 1_000_000) * actRate.output_per_mtok;
    const delta = actCost - recCost;
    if (delta > 0) overspend += delta;
  }

  const lines = [];
  lines.push(boxLine('Routing Compliance'));
  lines.push(boxLine('─'.repeat(INNER)));
  lines.push(boxLine(`Recommendations: ${total}`));
  lines.push(boxLine(`Followed:        ${followed} (${followPct}%)`));
  lines.push(boxLine(`Ignored:          ${ignored} (${ignorePct}%)`));
  lines.push(boxLine(`Estimated overspend: ~${fmt$(overspend)}`));

  return { lines };
}

// ---------------------------------------------------------------------------
// Section 3: Duplicate Warnings
// ---------------------------------------------------------------------------
function buildDuplicateSection(records) {
  const recs = records.filter(r => r.type === 'tier_recommendation' && r.prompt_hash);

  const hashCounts = {};
  for (const r of recs) {
    hashCounts[r.prompt_hash] = (hashCounts[r.prompt_hash] || 0) + 1;
  }
  const dups = Object.values(hashCounts).filter(c => c > 1).length;

  const lines = [];
  lines.push(boxLine('Duplicate Dispatches'));
  lines.push(boxLine('─'.repeat(INNER)));
  lines.push(boxLine(`Duplicate Dispatches: ${dups}`));
  if (dups > 0) {
    lines.push(boxLine('  (same prompt dispatched to multiple tiers)'));
  }

  return { lines };
}

// ---------------------------------------------------------------------------
// Section 4: Quality Gate
// ---------------------------------------------------------------------------
function buildQualityGateSection() {
  const lines = [];
  lines.push(boxLine('Quality Gate'));
  lines.push(boxLine('─'.repeat(INNER)));

  if (!existsSync(QUALITY_GATE)) {
    lines.push(boxLine('Quality Gate: unavailable (quality-gate.mjs not found)'));
    return { lines };
  }

  const proc = spawnSync(process.execPath, [QUALITY_GATE], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  });

  let result = {};
  try {
    const stdout = (proc.stdout || '').trim();
    if (stdout) result = JSON.parse(stdout);
  } catch { /* leave result empty */ }

  const gate   = result.gate || 'error';
  const files  = Array.isArray(result.files) ? result.files : [];
  const count  = files.length;

  let statusLine;
  if (gate === 'pass') {
    statusLine = count > 0
      ? `Quality Gate: pass (${count} file${count !== 1 ? 's' : ''} reviewed)`
      : `Quality Gate: pass (${result.reason || 'no qualifying changes'})`;
  } else if (gate === 'issues_found') {
    statusLine = 'Quality Gate: issues_found (see .claude/reviews/)';
  } else if (gate === 'needs_human_review') {
    statusLine = 'Quality Gate: needs_human_review (GPT unavailable)';
  } else if (gate === 'disabled') {
    statusLine = 'Quality Gate: disabled';
  } else {
    statusLine = `Quality Gate: ${gate}`;
  }

  lines.push(boxLine(statusLine));

  if (result.review_path) {
    lines.push(boxLine(`  Review: ${result.review_path}`));
  }

  return { lines };
}

// ---------------------------------------------------------------------------
// Section 5: Data Quality
// ---------------------------------------------------------------------------
function buildDataQualitySection(records) {
  // Only tool-call records (not recommendations)
  const activity = records.filter(r => r.type !== 'tier_recommendation');
  const total     = activity.length;
  const actual    = activity.filter(r => r.input_tokens != null && r.output_tokens != null).length;
  const heuristic = total - actual;
  const actPct    = total > 0 ? Math.round((actual / total) * 100) : 0;
  const heuPct    = total > 0 ? 100 - actPct : 100;
  const unknownModels = activity.filter(r => !r.model || r.model === 'unknown').length;

  const confidence =
    total === 0         ? 'n/a' :
    actPct >= 80        ? 'high' :
    actPct >= 40        ? 'medium' :
                          'low';

  const lines = [];
  lines.push(boxLine('Data Quality'));
  lines.push(boxLine('─'.repeat(INNER)));
  lines.push(boxLine(`Token data: ${actPct}% actual, ${heuPct}% heuristic`));
  lines.push(boxLine(`Confidence: ${confidence}`));
  lines.push(boxLine(`Unknown models: ${unknownModels} entries`));

  return { lines };
}

// ---------------------------------------------------------------------------
// Section 6: Drift Warnings
// ---------------------------------------------------------------------------
function buildDriftSection(config) {
  const lines = [];
  lines.push(boxLine('Drift Warnings'));
  lines.push(boxLine('─'.repeat(INNER)));

  const warnings = [];

  // Pricing staleness
  const verified = config?.pricing_verified;
  if (!verified) {
    warnings.push('pricing_verified missing from orchestrator.json');
  } else {
    const verifiedMs = new Date(verified).getTime();
    const nowMs      = Date.now();
    const ageDays    = Math.floor((nowMs - verifiedMs) / (1000 * 60 * 60 * 24));
    if (ageDays > 30) {
      warnings.push(`Pricing data is ${ageDays} days old (last verified: ${verified})`);
    } else {
      warnings.push(`Pricing verified ${ageDays} day${ageDays !== 1 ? 's' : ''} ago (${verified}) — OK`);
    }
  }

  // Check subscriptions populated
  if (!config?.subscriptions || Object.keys(config.subscriptions).length === 0) {
    warnings.push('No subscriptions configured in orchestrator.json');
  }

  // Check quality gate enabled
  if (config?.quality_gate?.enabled === false) {
    warnings.push('Quality gate is DISABLED in orchestrator.json');
  }

  if (warnings.length === 0) {
    lines.push(boxLine('No drift warnings.'));
  } else {
    for (const w of warnings) {
      lines.push(boxLine(`• ${w}`));
    }
  }

  return { lines };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const config  = loadConfig();
  const rateMap = buildRateMap(config);
  const records = loadTodayRecords();

  const output = [];

  output.push(boxTop());
  output.push(boxTitle('Session Summary Report'));
  output.push(boxDiv());

  // --- Section 1: Activity Summary ---
  const { lines: actLines } = buildActivitySection(records, rateMap);
  output.push(...actLines);
  output.push(boxBlank());

  // --- Section 1b: Provider Balance ---
  const { lines: provLines } = buildProviderBalanceSection(records);
  output.push(...provLines);
  output.push(boxBlank());

  // --- Section 2: Routing Compliance ---
  const { lines: compLines } = buildComplianceSection(records, rateMap);
  output.push(...compLines);
  output.push(boxBlank());

  // --- Section 3: Duplicate Warnings ---
  const { lines: dupLines } = buildDuplicateSection(records);
  output.push(...dupLines);
  output.push(boxBlank());

  // --- Section 4: Quality Gate ---
  const { lines: gateLines } = buildQualityGateSection();
  output.push(...gateLines);
  output.push(boxBlank());

  // --- Section 5: Data Quality ---
  const { lines: dqLines } = buildDataQualitySection(records);
  output.push(...dqLines);
  output.push(boxBlank());

  // --- Section 6: Drift Warnings ---
  const { lines: driftLines } = buildDriftSection(config || {});
  output.push(...driftLines);

  output.push(boxBot());

  console.log(output.join('\n'));
}

main();
