#!/usr/bin/env node
/**
 * budget-balancer.mjs — Core budget balancing module for the Dual-Brain Orchestrator.
 *
 * Tracks rolling usage pressure across Claude and OpenAI providers and recommends
 * which provider should handle incoming work.
 *
 * Exported API:
 *   getProviderStatus()          → current pressure per provider/tier
 *   chooseProvider(taskProfile)  → recommended provider + model + rationale
 *   recordUsageEvent(event)      → append a usage event to today's log
 *
 * Also works as a standalone CLI: node .claude/hooks/budget-balancer.mjs
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_CONFIG = join(__dirname, "..", "orchestrator.json");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rolling window for pressure calculation (milliseconds) */
const WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours

/**
 * Rough per-tier token budgets per 5-hour window.
 * Based on $100/month Claude Max 5x and OpenAI Pro subscription estimates.
 * These are approximations — the real limit is monthly, distributed evenly.
 */
const WINDOW_BUDGETS = {
  claude: {
    think:   500_000,   // Opus — costly, use sparingly
    execute: 2_000_000, // Sonnet — primary workhorse
    search:  5_000_000, // Haiku — cheap, generous budget
  },
  openai: {
    think:   500_000,   // gpt-5.5
    execute: 2_000_000, // gpt-5.4
    search:  5_000_000, // gpt-4.1-mini
  },
};

/** Estimated tokens consumed per call, by tier */
const TOKENS_PER_CALL = {
  search:  2_500,
  execute: 5_500,
  think:  11_000,
};

/** Default pressure thresholds (fraction 0–1) */
const DEFAULT_THRESHOLDS = {
  warm:      0.65,
  hot:       0.82,
  throttled: 0.95,
};

/** Default model mapping when orchestrator.json is missing provider config */
const DEFAULT_MODELS = {
  claude: { think: "opus", execute: "sonnet", search: "haiku" },
  openai: { think: "gpt-5.5", execute: "gpt-5.4", search: "gpt-4.1-mini" },
};

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function loadConfig() {
  try {
    return JSON.parse(readFileSync(ORCHESTRATOR_CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function getThresholds(config, provider) {
  return (
    config?.providers?.[provider]?.pressure_thresholds || DEFAULT_THRESHOLDS
  );
}

function getProviderModels(config, provider) {
  return config?.providers?.[provider]?.models || DEFAULT_MODELS[provider];
}

// ---------------------------------------------------------------------------
// Provider / tier detection from model name
// ---------------------------------------------------------------------------

/**
 * Given a model string, return { provider, tier } or null if unrecognised.
 */
function classifyModel(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();

  if (m.includes("opus"))         return { provider: "claude", tier: "think" };
  if (m.includes("sonnet"))       return { provider: "claude", tier: "execute" };
  if (m.includes("haiku"))        return { provider: "claude", tier: "search" };
  if (m.includes("gpt-5.5") || m.includes("gpt4.5")) return { provider: "openai", tier: "think" };
  if (m.includes("gpt-5.4") || (m.includes("gpt-4.1") && !m.includes("mini"))) return { provider: "openai", tier: "execute" };
  if (m.includes("mini"))         return { provider: "openai", tier: "search" };

  return null;
}

// ---------------------------------------------------------------------------
// Usage log helpers
// ---------------------------------------------------------------------------

function usageFilePath(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return join(__dirname, `usage-${d}.jsonl`);
}

/**
 * Read all usage entries from the last `WINDOW_MS` milliseconds.
 * Scans today's (and optionally yesterday's) log file.
 */
function readRecentEntries() {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  const entries = [];

  // Check today's and yesterday's files to cover the rolling window boundary
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);

  for (const date of [yesterday, today]) {
    const file = usageFilePath(date);
    if (!existsSync(file)) continue;
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = Date.parse(record.timestamp);
      if (!isNaN(ts) && ts >= cutoff) {
        entries.push(record);
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Exported: getProviderStatus()
// ---------------------------------------------------------------------------

/**
 * Compute rolling 5-hour pressure for each provider/tier combination.
 *
 * @returns {object} Status keyed by provider → tier → { pressure, state, calls, estTokens }
 */
function getProviderStatus() {
  const config = loadConfig();

  const entries = readRecentEntries();

  // Accumulate call counts per provider/tier
  const counts = {
    claude: { think: 0, execute: 0, search: 0 },
    openai: { think: 0, execute: 0, search: 0 },
  };

  for (const entry of entries) {
    // Determine provider/tier either from stored `provider` field or by classifying model
    let provider = entry.provider;
    let tier = entry.tier;

    if (!provider && entry.model) {
      const classified = classifyModel(entry.model);
      if (classified) {
        provider = classified.provider;
        tier = classified.tier;
      }
    }

    if (provider && tier && counts[provider] && counts[provider][tier] !== undefined) {
      counts[provider][tier]++;
    }
  }

  // Build status object
  const status = {};

  for (const provider of ["claude", "openai"]) {
    const thresholds = getThresholds(config, provider);
    status[provider] = {};

    for (const tier of ["think", "execute", "search"]) {
      const calls = counts[provider][tier];
      const estTokens = calls * TOKENS_PER_CALL[tier];
      const budget = WINDOW_BUDGETS[provider][tier];
      const pressure = budget > 0 ? estTokens / budget : 0;

      let state;
      if (pressure >= (thresholds.throttled ?? DEFAULT_THRESHOLDS.throttled)) {
        state = "throttled";
      } else if (pressure >= (thresholds.hot ?? DEFAULT_THRESHOLDS.hot)) {
        state = "hot";
      } else if (pressure >= (thresholds.warm ?? DEFAULT_THRESHOLDS.warm)) {
        state = "warm";
      } else {
        state = "healthy";
      }

      status[provider][tier] = { pressure, state, calls, estTokens };
    }
  }

  return status;
}

// ---------------------------------------------------------------------------
// Exported: chooseProvider(taskProfile)
// ---------------------------------------------------------------------------

/**
 * Recommend a provider for an incoming task.
 *
 * @param {object} taskProfile
 * @param {string} taskProfile.tier                  - search | execute | think
 * @param {number} [taskProfile.estimatedDurationMs] - expected task duration
 * @param {string} [taskProfile.contextCoupling]     - low | medium | high
 * @param {string} [taskProfile.isolation]           - low | medium | high
 * @returns {{ provider, model, reason, scores }}
 */
function chooseProvider(taskProfile = {}) {
  const {
    tier = "execute",
    estimatedDurationMs = 0,
    contextCoupling = "low",
    isolation = "low",
  } = taskProfile;

  const config = loadConfig();
  const status = getProviderStatus();

  const PRESSURE_PENALTY = {
    healthy:   0,
    warm:     15,
    hot:      40,
    throttled: 100,
  };

  const scores = {};

  for (const provider of ["claude", "openai"]) {
    const tierStatus = status[provider]?.[tier] || { pressure: 0, state: "healthy" };
    const otherProvider = provider === "claude" ? "openai" : "claude";
    const otherTierStatus = status[otherProvider]?.[tier] || { pressure: 0, state: "healthy" };

    // Base score
    let score = 50;

    // Task-fit score
    if (provider === "claude") {
      if (contextCoupling === "high")   score += 20;
      else if (contextCoupling === "medium") score += 10;
    } else {
      // openai
      if (isolation === "high")   score += 20;
      else if (isolation === "medium") score += 10;
    }

    // Pressure penalty
    score -= PRESSURE_PENALTY[tierStatus.state] ?? 0;

    // Latency penalty (OpenAI only — Codex has higher startup overhead)
    if (provider === "openai") {
      if (estimatedDurationMs < 180_000) {
        score -= 25; // < 3 min: overhead not worth it
      } else if (estimatedDurationMs < 600_000) {
        score -= 10; // < 10 min: minor penalty
      }
      // >= 10 min: no penalty
    }

    // Underused bonus
    if (
      tierStatus.pressure < 0.3 &&
      otherTierStatus.pressure > 0.5
    ) {
      score += 20;
    }

    scores[provider] = Math.round(score);
  }

  const winner = scores.claude >= scores.openai ? "claude" : "openai";
  const loser  = winner === "claude" ? "openai" : "claude";

  // Resolve model name
  const models = getProviderModels(config, winner);
  const model = models?.[tier] || DEFAULT_MODELS[winner][tier];

  // Build human reason string
  const winnerPressure = (status[winner]?.[tier]?.pressure ?? 0).toFixed(2);
  const loserPressure  = (status[loser]?.[tier]?.pressure ?? 0).toFixed(2);

  let reasonParts = [];
  if (winner === "claude" && contextCoupling !== "low") {
    reasonParts.push(`high session context coupling`);
  }
  if (winner === "openai" && isolation !== "low") {
    reasonParts.push(`isolated task`);
  }
  if (parseFloat(winnerPressure) < parseFloat(loserPressure)) {
    reasonParts.push(`${winner} pressure lower (${winnerPressure} vs ${loserPressure})`);
  }
  if (!reasonParts.length) {
    reasonParts.push(`${winner} scored higher (${scores[winner]} vs ${scores[loser]})`);
  }

  return {
    provider: winner,
    model,
    reason: reasonParts.join(", "),
    scores,
  };
}

// ---------------------------------------------------------------------------
// Exported: recordUsageEvent(event)
// ---------------------------------------------------------------------------

/**
 * Append a usage event to today's daily log file.
 * Automatically adds `provider` field if not present.
 *
 * @param {object} event - Usage event (see cost-logger.mjs schema)
 */
function recordUsageEvent(event = {}) {
  // Infer provider from model name if not supplied
  let provider = event.provider;
  if (!provider && event.model) {
    const classified = classifyModel(event.model);
    provider = classified?.provider || "claude";
  }
  if (!provider) provider = "claude";

  const entry = JSON.stringify({
    schema_version: 2,
    timestamp: event.timestamp || new Date().toISOString(),
    provider,
    ...event,
  });

  const file = usageFilePath();
  mkdirSync(dirname(file), { recursive: true });

  try {
    appendFileSync(file, entry + "\n", { encoding: "utf8", flag: "a" });
  } catch (err) {
    // Non-fatal — log to stderr but don't crash callers
    process.stderr.write(`[budget-balancer] Failed to write usage event: ${err.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// CLI rendering helpers
// ---------------------------------------------------------------------------

function pressureBar(pressure, width = 10) {
  const filled = Math.min(width, Math.round(pressure * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function stateLabel(state) {
  return state.padEnd(8);
}

function formatPercent(pressure) {
  return String(Math.round(pressure * 100)).padStart(3) + "%";
}

function printStatusTable(status) {
  const LINE_WIDTH = 50;
  const border = "═".repeat(LINE_WIDTH - 2);
  const blank  = " ".repeat(LINE_WIDTH - 4);

  const h = (text) => {
    const padded = ` ${text}`.padEnd(LINE_WIDTH - 4);
    return `║ ${padded} ║`;
  };
  const row = (label, tier) => {
    const s = status[label]?.[tier] || { pressure: 0, state: "healthy" };
    const bar = pressureBar(s.pressure);
    const pct = formatPercent(s.pressure);
    const lbl = stateLabel(s.state);
    const line = `  ${tier.charAt(0).toUpperCase() + tier.slice(1).padEnd(7)}: ${bar}  ${pct} ${lbl}`;
    return h(line);
  };

  const config = loadConfig();
  const claudePlan  = config?.subscriptions?.claude?.plan  ? `Claude Max ${config.subscriptions.claude.plan}` : "Claude Max $100";
  const openaiPlan  = config?.subscriptions?.openai?.plan  ? `OpenAI Pro ${config.subscriptions.openai.plan}` : "OpenAI Pro $100";

  // Recommendation
  const rec = chooseProvider({ tier: "execute", estimatedDurationMs: 300_000, isolation: "high", contextCoupling: "low" });
  const recText = `Route execution to ${rec.provider === "openai" ? "OpenAI" : "Claude"}`;

  const lines = [
    `╔${border}╗`,
    h("         Provider Balance Status                "),
    `╠${border}╣`,
    h(claudePlan),
    row("claude", "think"),
    row("claude", "execute"),
    row("claude", "search"),
    h(blank),
    h(openaiPlan),
    row("openai", "think"),
    row("openai", "execute"),
    row("openai", "search"),
    `╠${border}╣`,
    h(`Recommendation: ${recText}`),
    `╚${border}╝`,
  ];

  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const status = getProviderStatus();
  printStatusTable(status);
}

// Run as CLI only when invoked directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`[budget-balancer] ${err.message}\n`);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export { getProviderStatus, chooseProvider, recordUsageEvent };
