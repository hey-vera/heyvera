#!/usr/bin/env node
/**
 * cost-report.mjs — Dual-Brain Cost Report CLI
 *
 * Usage:
 *   node .claude/hooks/cost-report.mjs           # show today + all-time
 *   node .claude/hooks/cost-report.mjs --all     # show all-time only
 *   node .claude/hooks/cost-report.mjs --today   # show today only (default)
 *
 * Reads:
 *   .claude/hooks/usage.jsonl       — tool call log written by cost-logger.mjs
 *
 * Reports token-weighted activity scores (0-100), not dollar estimates.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE  = join(__dirname, "..", ".."); // workspace root
// Config and rate maps removed — cost-report no longer estimates dollar costs.
// Activity scores are computed from token counts directly.

// ---------------------------------------------------------------------------
// Load & parse usage log
// ---------------------------------------------------------------------------
function loadUsage() {
  const files = readdirSync(__dirname)
    .filter(f => f.startsWith('usage-') && f.endsWith('.jsonl'))
    .sort();

  // Also check legacy usage.jsonl for backwards compat
  if (existsSync(join(__dirname, 'usage.jsonl'))) {
    files.unshift('usage.jsonl');
  }

  const records = [];
  for (const f of files) {
    try {
      const lines = readFileSync(join(__dirname, f), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { records.push(JSON.parse(line)); } catch {}
      }
    } catch {}
  }
  return records;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

// Tier-based fallback weights when actual token counts are unavailable (legacy entries).
// These are unitless activity weights, NOT dollar costs.
const TIER_ACTIVITY_WEIGHTS = { search: 3, execute: 10, think: 25 };

// Activity formula: (input_tokens * 1) + (output_tokens * 3)
// SESSION_ACTIVITY_CEILING is the raw token-weighted value that maps to score 100.
const SESSION_ACTIVITY_CEILING = 5_000_000;

function computeActivity(tier, record = {}) {
  const hasActual = record.input_tokens != null && record.output_tokens != null;
  if (hasActual) {
    return { raw: (record.input_tokens * 1) + (record.output_tokens * 3), basis: 'actual' };
  }
  return { raw: TIER_ACTIVITY_WEIGHTS[tier] || TIER_ACTIVITY_WEIGHTS.execute, basis: 'estimated' };
}

// ---------------------------------------------------------------------------
// Git log fallback — estimate work volume when usage.jsonl is empty
// ---------------------------------------------------------------------------
function gitFallbackSummary() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const log = execSync(
      `git -C "${WORKSPACE}" log --oneline --since="${today} 00:00" --until="${today} 23:59"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    const commits = log ? log.split("\n").length : 0;
    return commits;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function todayPrefix() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Aggregate records into { [tier]: { model, calls, activityRaw, actualCount } }
 * where model is the most-seen model for that tier.
 */
function aggregate(records, datePrefix = null) {
  const filtered = datePrefix
    ? records.filter((r) => r.timestamp?.startsWith(datePrefix))
    : records;

  // tier → { calls, activityRaw, actualCount, modelCounts }
  const buckets = {};

  for (const record of filtered) {
    const tier = record.tier || "execute";
    const model = record.model || "unknown";
    if (!buckets[tier]) {
      buckets[tier] = { calls: 0, activityRaw: 0, actualCount: 0, modelCounts: {} };
    }
    buckets[tier].calls += 1;
    const { raw } = computeActivity(tier, record);
    buckets[tier].activityRaw += raw;
    buckets[tier].modelCounts[model] = (buckets[tier].modelCounts[model] || 0) + 1;
    if (record.input_tokens != null && record.output_tokens != null) {
      buckets[tier].actualCount += 1;
    }
  }

  // Compute total raw for percentage breakdown
  const totalRaw = Object.values(buckets).reduce((s, b) => s + b.activityRaw, 0);

  // Resolve dominant model per tier
  const result = {};
  for (const [tier, data] of Object.entries(buckets)) {
    const dominantModel = Object.entries(data.modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
    result[tier] = {
      model: dominantModel,
      calls: data.calls,
      activityRaw: data.activityRaw,
      activityPct: totalRaw > 0 ? Math.round((data.activityRaw / totalRaw) * 100) : 0,
      actualCount: data.actualCount,
    };
  }
  return result;
}

/**
 * Classify overall activity level from score.
 */
function activityLabel(score) {
  if (score <= 10) return 'minimal';
  if (score <= 30) return 'light';
  if (score <= 60) return 'moderate';
  if (score <= 85) return 'heavy';
  return 'intense';
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const W = 50;

const TIER_ORDER = ["search", "execute", "think"];

const TIER_LABELS = {
  search:  "Search ",
  execute: "Execute",
  think:   "Think  ",
};

function pad(str, len, align = "left") {
  str = String(str);
  if (str.length >= len) return str.slice(0, len);
  const spaces = " ".repeat(len - str.length);
  return align === "right" ? spaces + str : str + spaces;
}

function renderTable(title, aggregated, records = []) {
  const totalRaw   = Object.values(aggregated).reduce((s, v) => s + v.activityRaw, 0);
  const totalScore = Math.min(100, Math.round((totalRaw / SESSION_ACTIVITY_CEILING) * 100));
  const label      = activityLabel(totalScore);

  const line   = (s)      => `║ ${pad(s, W - 2)} ║`;
  const border = (l, r) => l + "═".repeat(W) + r;
  const sep    = ()        => "╠" + "═".repeat(W) + "╣";

  const rows = TIER_ORDER
    .filter((t) => aggregated[t])
    .map((t) => {
      const { model, calls, activityPct } = aggregated[t];
      const tierLbl  = pad(TIER_LABELS[t] || t, 8);
      const modelLbl = pad(model,               10);
      const callsLbl = pad(String(calls), 5, "right");
      const pctLbl   = pad(`${activityPct}%`, 10, "right");
      return line(`${tierLbl} │ ${modelLbl} │ ${callsLbl} │ ${pctLbl}`);
    });

  const header = line(`Tier     │ Model      │ Calls │ Activity % `);
  const hline  = line(`─────────┼────────────┼───────┼────────────`);

  const totalCalls = Object.values(aggregated).reduce((s, v) => s + v.calls, 0);
  const actualCalls = Object.values(aggregated).reduce((s, v) => s + (v.actualCount || 0), 0);
  const basis = actualCalls === 0 ? 'estimated (no token data)' :
    actualCalls === totalCalls ? 'actual token counts' :
    `mixed (${Math.round(actualCalls/totalCalls*100)}% actual)`;

  // Data quality stats
  const unknownModels = records.filter(r => !r.model || r.model === 'unknown').length;
  const errorRecords = records.filter(r => r.status === 'error').length;

  const lines = [
    border("╔", "╗"),
    line(pad(title, W - 2)),
    sep(),
    header,
    hline,
    ...rows,
    sep(),
    line(`Session activity: ${totalScore}/100 (${label})`),
    line(`Basis: ${basis}`),
    line(`Activity score based on token usage, not billing`),
    border("╚", "╝"),
  ];

  if (unknownModels > 0 || errorRecords > 0) {
    lines.splice(-1, 0,
      line(`Unknown models: ${unknownModels}/${totalCalls} entries`),
      line(`Errors: ${errorRecords} tool calls failed`),
    );
  }

  return lines.join("\n");
}

function renderEmpty() {
  const border = (l, r) => l + "═".repeat(W) + r;
  const ln = (s) => `║ ${pad(s, W - 2)} ║`;
  return [
    border("╔", "╗"),
    ln("Session Activity Report"),
    border("╠", "╣"),
    ln("No usage data yet."),
    ln(""),
    ln("Install cost-logger.mjs as a PostToolUse hook"),
    ln("to start tracking usage."),
    border("╚", "╝"),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args    = process.argv.slice(2);
  const showAll = args.includes("--all");

  const records = loadUsage();

  if (records.length === 0) {
    // Try git log fallback for a rough mention
    const commits = gitFallbackSummary();
    console.log(renderEmpty());
    if (commits > 0) {
      console.log(`\n  (Git log shows ${commits} commit(s) today — no tool-level data available.)`);
    }
    return;
  }

  const today = todayPrefix();

  if (!showAll) {
    // Today's report
    const todayAgg  = aggregate(records, today);
    const todayRecords = records.filter(r => r.timestamp?.startsWith(today));
    const hasTodayData = Object.keys(todayAgg).length > 0;

    if (hasTodayData) {
      console.log(renderTable("Session Activity — Today", todayAgg, todayRecords));
    } else {
      console.log("  No activity recorded for today yet.");
    }

    console.log(); // blank line separator
  }

  // All-time report
  const allAgg  = aggregate(records);
  console.log(renderTable("Session Activity — All Time", allAgg, records));
}

main();
