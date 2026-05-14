#!/usr/bin/env node
/**
 * summary-checkpoint.mjs — Fast derived state for the hot path.
 *
 * Maintains a summary file (usage-summary-YYYY-MM-DD.json) that hooks
 * can read in O(1) instead of scanning the full JSONL log.
 *
 * The summary is rebuilt from JSONL truth if missing or corrupt.
 *
 * Exported API:
 *   readSummary(date?)           → current summary object
 *   updateSummary(newEntry)      → incrementally update summary with one entry
 *   rebuildSummary(date?)        → full rebuild from JSONL
 *   getRecentPromptHashes()      → last 10min of prompt hashes (for dupe detection)
 *   getPressureBuckets()         → provider/tier call counts for rolling window
 *   getTokenAverages()           → moving averages of actual tokens by tier
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function summaryPath(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return join(__dirname, `usage-summary-${d}.json`);
}

function usagePath(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return join(__dirname, `usage-${d}.jsonl`);
}

function emptySummary() {
  return {
    version: 1,
    date: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
    last_offset: 0,

    totals: {
      calls: 0,
      cost_estimate: 0,
      by_tier: {},
      by_provider: {},
      by_model: {},
    },

    pressure: {
      claude: { think: [], execute: [], search: [] },
      openai: { think: [], execute: [], search: [] },
    },

    recent_hashes: [],

    token_averages: {},

    codex_latencies: [],
  };
}

const COST_PER_CALL = { search: 0.003, execute: 0.012, think: 0.055 };

function atomicWrite(path, data) {
  const tmp = path + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

function readSummary(date) {
  const path = summaryPath(date);
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data.version === 1) return data;
  } catch {}
  return rebuildSummary(date);
}

function rebuildSummary(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  const logPath = usagePath(d);
  const summary = emptySummary();
  summary.date = d;

  if (!existsSync(logPath)) {
    atomicWrite(summaryPath(d), summary);
    return summary;
  }

  let raw;
  try { raw = readFileSync(logPath, 'utf8'); } catch { return summary; }

  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      applyEntry(summary, entry);
    } catch {}
  }

  summary.last_offset = Buffer.byteLength(raw, 'utf8');
  summary.updated_at = new Date().toISOString();
  atomicWrite(summaryPath(d), summary);
  return summary;
}

function applyEntry(summary, entry) {
  const tier = entry.tier || 'execute';
  const provider = entry.provider || 'claude';
  const model = entry.model || 'unknown';
  const cost = COST_PER_CALL[tier] || COST_PER_CALL.execute;

  summary.totals.calls++;
  summary.totals.cost_estimate += cost;

  summary.totals.by_tier[tier] = (summary.totals.by_tier[tier] || 0) + 1;
  summary.totals.by_provider[provider] = (summary.totals.by_provider[provider] || 0) + 1;
  summary.totals.by_model[model] = (summary.totals.by_model[model] || 0) + 1;

  // Pressure: store timestamps for rolling window lookups
  const ts = entry.timestamp || new Date().toISOString();
  if (summary.pressure[provider]?.[tier]) {
    summary.pressure[provider][tier].push(ts);
    // Keep only last 5 hours of timestamps to bound size
    const cutoff = Date.now() - 5 * 60 * 60 * 1000;
    summary.pressure[provider][tier] = summary.pressure[provider][tier].filter(
      t => Date.parse(t) >= cutoff
    );
  }

  // Recent prompt hashes (for duplicate detection)
  if (entry.type === 'tier_recommendation' && entry.prompt_hash) {
    summary.recent_hashes.push({ hash: entry.prompt_hash, ts });
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    summary.recent_hashes = summary.recent_hashes.filter(
      h => Date.parse(h.ts) >= tenMinAgo
    );
  }

  // Token moving averages
  if (entry.input_tokens != null && entry.output_tokens != null) {
    const key = `${provider}:${tier}`;
    if (!summary.token_averages[key]) {
      summary.token_averages[key] = { count: 0, avg_input: 0, avg_output: 0 };
    }
    const avg = summary.token_averages[key];
    avg.count++;
    avg.avg_input += (entry.input_tokens - avg.avg_input) / avg.count;
    avg.avg_output += (entry.output_tokens - avg.avg_output) / avg.count;
  }

  // Codex latencies
  if (entry.codex_startup_ms != null) {
    summary.codex_latencies.push({
      startup_ms: entry.codex_startup_ms,
      total_ms: entry.codex_total_ms || null,
      model: model,
      ts,
    });
    // Keep last 50
    if (summary.codex_latencies.length > 50) {
      summary.codex_latencies = summary.codex_latencies.slice(-50);
    }
  }
}

function updateSummary(newEntry, date) {
  const summary = readSummary(date);
  applyEntry(summary, newEntry);
  summary.updated_at = new Date().toISOString();
  atomicWrite(summaryPath(date), summary);
  return summary;
}

function getRecentPromptHashes(date) {
  const summary = readSummary(date);
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  return summary.recent_hashes.filter(h => Date.parse(h.ts) >= tenMinAgo);
}

function getPressureBuckets(date) {
  const summary = readSummary(date);
  const cutoff = Date.now() - 5 * 60 * 60 * 1000;
  const result = {};

  for (const provider of ['claude', 'openai']) {
    result[provider] = {};
    for (const tier of ['think', 'execute', 'search']) {
      const timestamps = summary.pressure[provider]?.[tier] || [];
      result[provider][tier] = timestamps.filter(t => Date.parse(t) >= cutoff).length;
    }
  }
  return result;
}

function getTokenAverages(date) {
  const summary = readSummary(date);
  return summary.token_averages;
}

function getAdaptiveCodexThreshold(date) {
  const summary = readSummary(date);
  const latencies = summary.codex_latencies || [];
  if (latencies.length < 5) return { threshold_ms: 180_000, confidence: 'low', samples: latencies.length };

  const startups = latencies.map(l => l.startup_ms).filter(Boolean).sort((a, b) => a - b);
  if (startups.length < 3) return { threshold_ms: 180_000, confidence: 'low', samples: startups.length };

  const p75idx = Math.floor(startups.length * 0.75);
  const p75 = startups[p75idx];
  const threshold = Math.max(90_000, p75 * 4);

  return {
    threshold_ms: Math.round(threshold),
    p75_startup_ms: Math.round(p75),
    confidence: startups.length >= 20 ? 'high' : 'medium',
    samples: startups.length,
  };
}

export {
  readSummary,
  updateSummary,
  rebuildSummary,
  getRecentPromptHashes,
  getPressureBuckets,
  getTokenAverages,
  getAdaptiveCodexThreshold,
  atomicWrite,
};
