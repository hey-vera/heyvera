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
 *   .claude/orchestrator.json       — cost rates per model
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
const CONFIG_FILE = join(__dirname, "..", "orchestrator.json");

// ---------------------------------------------------------------------------
// Load orchestrator config
// ---------------------------------------------------------------------------
function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Build a flat map: { "haiku": { input_per_mtok, output_per_mtok, tier }, … }
 * from orchestrator.json's subscriptions block.
 */
function buildRateMap(config) {
  const rates = {};
  if (!config?.subscriptions) return rates;
  for (const provider of Object.values(config.subscriptions)) {
    for (const [modelKey, data] of Object.entries(provider.models || {})) {
      rates[modelKey] = {
        tier: data.tier,
        input_per_mtok: data.input_per_mtok,
        output_per_mtok: data.output_per_mtok,
      };
    }
  }
  return rates;
}

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

/**
 * Very rough token estimate per tool call.
 * Without actual token counts from the session files, we use a conservative
 * heuristic based on typical Claude Code usage patterns.
 */
const TOKEN_HEURISTICS = {
  // { input_tok, output_tok }
  search:  { input: 2_000,  output:   500 },
  execute: { input: 4_000,  output: 1_500 },
  think:   { input: 8_000,  output: 3_000 },
};

function estimateCost(tier, model, rateMap, record = {}) {
  const heuristic = TOKEN_HEURISTICS[tier] || TOKEN_HEURISTICS.execute;
  // Use actual tokens if logged, otherwise fall back to heuristics
  const hasActual = record.input_tokens != null && record.output_tokens != null;
  const inputTok = hasActual ? record.input_tokens : heuristic.input;
  const outputTok = hasActual ? record.output_tokens : heuristic.output;
  const rate = rateMap[model] || rateMap["main-session"];
  if (!rate) {
    // Fallback: use tier-matched rate from whatever model we know about
    // "main-session" and "unknown" map to think-tier (Opus) since that's the session model
    const fallbackTier = (model === "main-session" || model === "unknown") ? "think" : tier;
    const tierRate = Object.values(rateMap).find((r) => r.tier === fallbackTier)
      || Object.values(rateMap).find((r) => r.tier === tier);
    if (!tierRate) return 0;
    return (
      (inputTok  / 1_000_000) * tierRate.input_per_mtok +
      (outputTok / 1_000_000) * tierRate.output_per_mtok
    );
  }
  return (
    (inputTok  / 1_000_000) * rate.input_per_mtok +
    (outputTok / 1_000_000) * rate.output_per_mtok
  );
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
 * Aggregate records into { [tier]: { model, calls, cost } }
 * where model is the most-seen model for that tier.
 */
function aggregate(records, rateMap, datePrefix = null) {
  const filtered = datePrefix
    ? records.filter((r) => r.timestamp?.startsWith(datePrefix))
    : records;

  // tier → { calls: number, costSum: number, modelCounts: { model: count } }
  const buckets = {};

  for (const record of filtered) {
    const tier = record.tier || "execute";
    const model = record.model || "unknown";
    if (!buckets[tier]) {
      buckets[tier] = { calls: 0, costSum: 0, modelCounts: {} };
    }
    buckets[tier].calls += 1;
    buckets[tier].costSum += estimateCost(tier, model, rateMap, record);
    buckets[tier].modelCounts[model] = (buckets[tier].modelCounts[model] || 0) + 1;
    if (record.input_tokens != null && record.output_tokens != null) buckets[tier].actualCount = (buckets[tier].actualCount || 0) + 1;
  }

  // Resolve dominant model per tier
  const result = {};
  for (const [tier, data] of Object.entries(buckets)) {
    const dominantModel = Object.entries(data.modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
    result[tier] = {
      model: dominantModel,
      calls: data.calls,
      cost: data.costSum,
      actualCount: data.actualCount || 0,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Opus all-in cost (for savings calculation)
// ---------------------------------------------------------------------------
function allOpusCost(records, rateMap, datePrefix = null) {
  const filtered = datePrefix
    ? records.filter((r) => r.timestamp?.startsWith(datePrefix))
    : records;

  return filtered.reduce((sum, record) => {
    return sum + estimateCost("think", "opus", rateMap, record);
  }, 0);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const TIER_ORDER = ["search", "execute", "think"];

const TIER_LABELS = {
  search:  "Search ",
  execute: "Execute",
  think:   "Think  ",
};

function fmt$(n) {
  return "$" + n.toFixed(2);
}

function pad(str, len, align = "left") {
  str = String(str);
  if (str.length >= len) return str.slice(0, len);
  const spaces = " ".repeat(len - str.length);
  return align === "right" ? spaces + str : str + spaces;
}

function renderTable(title, aggregated, allOpus, records = []) {
  const totalCost  = Object.values(aggregated).reduce((s, v) => s + v.cost, 0);
  const savings    = allOpus - totalCost;
  const savingsPct = allOpus > 0 ? Math.round((savings / allOpus) * 100) : 0;

  const W = 50; // total inner width (between ║ chars)

  const line   = (s)      => `║ ${pad(s, W - 2)} ║`;
  const border = (l, r, m) => l + "═".repeat(W) + r;
  const sep    = ()        => "╠" + "═".repeat(W) + "╣";

  const rows = TIER_ORDER
    .filter((t) => aggregated[t])
    .map((t) => {
      const { model, calls, cost } = aggregated[t];
      const tierLbl  = pad(TIER_LABELS[t] || t, 8);
      const modelLbl = pad(model,               10);
      const callsLbl = pad(String(calls), 5, "right");
      const costLbl  = pad(fmt$(cost), 12, "right");
      return line(`${tierLbl} │ ${modelLbl} │ ${callsLbl} │ ${costLbl}`);
    });

  const header = line(`Tier     │ Model      │ Calls │ Est. Cost  `);
  const hline  = line(`─────────┼────────────┼───────┼────────────`);

  const totalCalls = Object.values(aggregated).reduce((s, v) => s + v.calls, 0);
  const actualCalls = Object.values(aggregated).reduce((s, v) => s + (v.actualCount || 0), 0);
  const confidence = actualCalls === 0 ? 'low (heuristic only)' :
    actualCalls === totalCalls ? 'high (actual tokens)' :
    `medium (${Math.round(actualCalls/totalCalls*100)}% actual)`;

  // Data quality stats
  const totalRecords = Object.values(aggregated).reduce((s, v) => s + v.calls, 0);
  const unknownModels = records.filter(r => !r.model || r.model === 'unknown').length;
  const v2Records = records.filter(r => r.schema_version >= 2).length;
  const errorRecords = records.filter(r => r.status === 'error').length;

  const lines = [
    border("╔", "╗"),
    line(pad(title, W - 2)),
    sep(),
    header,
    hline,
    ...rows,
    sep(),
    line(`Total estimated: ${fmt$(totalCost)}`),
    line(`Savings vs all-Opus: ~${fmt$(Math.max(0, savings))} (${savingsPct}%)`),
    line(`Confidence: ${confidence}`),
    border("╚", "╝"),
  ];

  if (unknownModels > 0 || errorRecords > 0) {
    lines.splice(-1, 0,
      line(`Unknown models: ${unknownModels}/${totalRecords} entries`),
      line(`Errors: ${errorRecords} tool calls failed`),
    );
  }

  return lines.join("\n");
}

function renderEmpty() {
  return [
    "╔══════════════════════════════════════════════════╗",
    "║         Activity & Cost Estimate                  ║",
    "╠══════════════════════════════════════════════════╣",
    "║  No usage data yet.                              ║",
    "║                                                  ║",
    "║  Install cost-logger.mjs as a PostToolUse hook   ║",
    "║  to start tracking usage.                        ║",
    "╚══════════════════════════════════════════════════╝",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args    = process.argv.slice(2);
  const showAll = args.includes("--all");

  const config  = loadConfig();
  const rateMap = buildRateMap(config);
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
    const todayAgg  = aggregate(records, rateMap, today);
    const todayOpus = allOpusCost(records, rateMap, today);
    const todayRecords = records.filter(r => r.timestamp?.startsWith(today));
    const hasTodayData = Object.keys(todayAgg).length > 0;

    if (hasTodayData) {
      console.log(renderTable("Activity & Cost Estimate — Today", todayAgg, todayOpus, todayRecords));
    } else {
      console.log("  No activity recorded for today yet.");
    }

    console.log(); // blank line separator
  }

  // All-time report
  const allAgg  = aggregate(records, rateMap);
  const allOpus = allOpusCost(records, rateMap);
  console.log(renderTable("Activity & Cost Estimate — All Time", allAgg, allOpus, records));
}

main();
