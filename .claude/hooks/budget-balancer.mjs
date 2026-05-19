#!/usr/bin/env node
/**
 * budget-balancer.mjs — Session-level provider balance tracker for the Dual-Brain Orchestrator.
 *
 * Tracks relative usage of Claude vs OpenAI within the current session (5-hour window)
 * and recommends which provider to use next based on imbalance — not fake subscription math.
 *
 * Exported API:
 *   getProviderStatus()          → session call counts and lean direction per provider/tier
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

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

/** Fallback tokens-per-call when usage log has no real token data for an entry */
const TOKENS_PER_CALL_FALLBACK = {
  search:  2_500,
  execute: 8_000,
  think:  15_000,
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
  if (m.includes("gpt-5.5"))     return { provider: "openai", tier: "think" };
  if (m === "gpt-4.1-mini")      return { provider: "openai", tier: "search" };
  if (m === "gpt-4.1")           return { provider: "openai", tier: "execute" };
  if (m.includes("gpt-5.") || m.includes("gpt-4.")) return { provider: "openai", tier: "execute" };
  if (m.includes("mini"))         return { provider: "openai", tier: "search" };

  return null;
}

/**
 * Return models available for a subscription tier.
 * Pro ($20) → no opus, limited models. Max ($100/$200) → full access.
 */
function getAvailableModels(provider, plan) {
  if (provider === 'claude') {
    if (plan === '$20') return ['haiku', 'sonnet'];
    return ['haiku', 'sonnet', 'opus'];
  }
  if (provider === 'openai') {
    if (plan === '$20') return ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5.2', 'gpt-5.4-mini'];
    return ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5.2', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.5'];
  }
  return [];
}

function isModelAvailable(model, provider, config) {
  const plan = config?.subscriptions?.[provider]?.plan || (provider === 'claude' ? '$100' : '$20');
  const available = getAvailableModels(provider, plan);
  return available.includes(model);
}

function downgradeModel(model, provider, config) {
  const plan = config?.subscriptions?.[provider]?.plan || (provider === 'claude' ? '$100' : '$20');
  const available = getAvailableModels(provider, plan);
  if (available.includes(model)) return model;

  if (provider === 'claude') {
    if (model === 'opus') return available.includes('sonnet') ? 'sonnet' : 'haiku';
    return 'haiku';
  }
  const rank = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5.2', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.5'];
  const idx = rank.indexOf(model);
  for (let i = idx - 1; i >= 0; i--) {
    if (available.includes(rank[i])) return rank[i];
  }
  return available[0] || 'gpt-4.1-mini';
}

// ---------------------------------------------------------------------------
// Usage log helpers
// ---------------------------------------------------------------------------

function usageFilePath(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return join(__dirname, `usage-${d}.jsonl`);
}

/**
 * Read usage entries within a time window.
 * Scans log files covering the window range.
 */
function readEntriesInWindow(windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const entries = [];

  const daysBack = Math.ceil(windowMs / 86_400_000) + 1;
  const seen = new Set();
  for (let i = 0; i < daysBack; i++) {
    const date = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    if (seen.has(date)) continue;
    seen.add(date);
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
// Session usage aggregation
// ---------------------------------------------------------------------------

/**
 * Count calls and tokens per provider/tier from usage entries.
 * Returns raw counts only — no percentage math against unknowable quota.
 */
function aggregateUsage(entries) {
  const calls = {
    claude: { think: 0, execute: 0, search: 0, total: 0 },
    openai: { think: 0, execute: 0, search: 0, total: 0 },
  };
  const tokens = {
    claude: { think: 0, execute: 0, search: 0, total: 0 },
    openai: { think: 0, execute: 0, search: 0, total: 0 },
  };

  for (const entry of entries) {
    let provider = entry.provider;
    let tier = entry.tier;

    if (!provider && entry.model) {
      const classified = classifyModel(entry.model);
      if (classified) {
        provider = classified.provider;
        tier = classified.tier;
      }
    }

    if (!provider || !calls[provider]) continue;
    const t = (tier && calls[provider][tier] !== undefined) ? tier : null;

    calls[provider].total++;
    if (t) calls[provider][t]++;

    const inp = entry.input_tokens;
    const out = entry.output_tokens;
    const tokCount = (inp != null && out != null && (inp > 0 || out > 0))
      ? inp + out
      : TOKENS_PER_CALL_FALLBACK[t] || 8_000;

    tokens[provider].total += tokCount;
    if (t) tokens[provider][t] += tokCount;
  }

  return { calls, tokens };
}

/**
 * Determine lean direction: which provider has been used more this session.
 * Returns "claude", "openai", or "balanced".
 */
function sessionLean(calls) {
  const c = calls.claude.total;
  const o = calls.openai.total;
  const total = c + o;
  if (total === 0) return "balanced";
  const claudeShare = c / total;
  if (claudeShare > 0.65) return "claude";
  if (claudeShare < 0.35) return "openai";
  return "balanced";
}

// ---------------------------------------------------------------------------
// Exported: getProviderStatus()
// ---------------------------------------------------------------------------

/**
 * Return session-level usage summary per provider/tier.
 * No subscription quota math — just raw counts from the 5-hour window.
 *
 * @returns {object} { claude: { calls, tokens, lean }, openai: { calls, tokens, lean }, sessionLean }
 */
function getProviderStatus() {
  const entries = readEntriesInWindow(FIVE_HOURS_MS);
  const { calls, tokens } = aggregateUsage(entries);
  const lean = sessionLean(calls);

  return {
    claude: { calls: calls.claude, tokens: tokens.claude },
    openai: { calls: calls.openai, tokens: tokens.openai },
    sessionLean: lean,
    totalCalls: calls.claude.total + calls.openai.total,
  };
}

// ---------------------------------------------------------------------------
// Exported: chooseProvider(taskProfile)
// ---------------------------------------------------------------------------

/**
 * Recommend a provider for an incoming task based on session imbalance,
 * task characteristics, and profile bias.
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

  let profileBias = 0;
  try {
    const profilePath = join(__dirname, '..', 'dual-brain.profile.json');
    if (existsSync(profilePath)) {
      const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
      const active = profile.active || 'balanced';
      if (active === 'cost-saver') profileBias = -20;
      else if (active === 'quality-first') profileBias = 10;
    }
  } catch {}

  const claudeCalls = status.claude.calls.total;
  const openaiCalls = status.openai.calls.total;
  const totalCalls  = claudeCalls + openaiCalls;

  const scores = {};

  for (const provider of ["claude", "openai"]) {
    let score = 50;

    // Context coupling: Claude handles tightly-coupled context better
    if (provider === "claude") {
      if (contextCoupling === "high")   score += 20;
      else if (contextCoupling === "medium") score += 10;
    } else {
      // OpenAI better for isolated tasks
      if (isolation === "high")   score += 20;
      else if (isolation === "medium") score += 10;
    }

    // Session imbalance: reward the underused provider
    if (totalCalls >= 4) {
      const thisShare = provider === "claude"
        ? claudeCalls / totalCalls
        : openaiCalls / totalCalls;
      // If heavily overused (>65% share), penalise; if underused (<35%), reward
      if (thisShare > 0.65) score -= 20;
      else if (thisShare < 0.35) score += 15;
    }

    // Profile bias applies to openai (positive = prefer openai more)
    if (provider === 'openai') score += profileBias;

    // Penalise OpenAI for short tasks (startup overhead not worth it)
    if (provider === "openai") {
      let minTaskMs = 180_000;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const summaryPath = join(__dirname, `usage-summary-${today}.json`);
        const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
        const latencies = (summary.codex_latencies || []).map(l => l.startup_ms).filter(Boolean);
        if (latencies.length >= 5) {
          const sorted = latencies.sort((a, b) => a - b);
          const p75 = sorted[Math.floor(sorted.length * 0.75)];
          minTaskMs = Math.max(90_000, p75 * 4);
        }
      } catch {}

      if (estimatedDurationMs < minTaskMs) {
        score -= 25;
      } else if (estimatedDurationMs < 600_000) {
        score -= 10;
      }
    }

    scores[provider] = Math.round(score);
  }

  const winner = scores.claude >= scores.openai ? "claude" : "openai";
  const loser  = winner === "claude" ? "openai" : "claude";

  const models = getProviderModels(config, winner);
  let model = models?.[tier] || DEFAULT_MODELS[winner][tier];

  // Gate model by subscription tier
  if (!isModelAvailable(model, winner, config)) {
    model = downgradeModel(model, winner, config);
  }

  const winnerCalls = winner === "claude" ? claudeCalls : openaiCalls;
  const loserCalls  = winner === "claude" ? openaiCalls : claudeCalls;

  let reasonParts = [];
  if (winner === "claude" && contextCoupling !== "low") {
    reasonParts.push(`high session context coupling`);
  }
  if (winner === "openai" && isolation !== "low") {
    reasonParts.push(`isolated task`);
  }
  if (totalCalls >= 4 && winnerCalls < loserCalls) {
    reasonParts.push(`${winner} less used this session (${winnerCalls} vs ${loserCalls} calls)`);
  }
  if (!reasonParts.length) {
    reasonParts.push(`${winner} scored ${scores[winner]} vs ${scores[loser]}`);
  }

  return {
    provider: winner,
    model,
    reason: reasonParts.join(", "),
    scores,
  };
}

// ---------------------------------------------------------------------------
// Exported: estimateTokensForTask(task)
// ---------------------------------------------------------------------------

function estimateTokensForTask(task) {
  const tier = task?.tier || 'execute';
  const fileCount = Math.max(1, (task?.files?.length || 0));
  const base = TOKENS_PER_CALL_FALLBACK[tier] || 8_000;
  const effortMultiplier = { low: 0.5, medium: 1, high: 1.5, xhigh: 2.5 };
  const mult = effortMultiplier[task?.effort] || 1;
  return Math.round(base * mult * Math.sqrt(fileCount));
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
// CLI rendering
// ---------------------------------------------------------------------------

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function printStatus(status, rec) {
  const LINE_WIDTH = 62;
  const border = "═".repeat(LINE_WIDTH - 2);

  const h = (text) => {
    const padded = ` ${text}`.padEnd(LINE_WIDTH - 4);
    return `║ ${padded} ║`;
  };

  const providerRow = (provider) => {
    const s = status[provider];
    const total = s.calls.total;
    const toks  = formatTokens(s.tokens.total);
    const breakdown = ["think", "execute", "search"]
      .filter(t => s.calls[t] > 0)
      .map(t => `${t}: ${s.calls[t]}`)
      .join(", ");
    const label = provider === "claude" ? "Claude" : "OpenAI";
    const detail = breakdown ? ` (${breakdown})` : "";
    return h(`  ${label.padEnd(7)}: ${total} calls, ~${toks} tokens${detail}`);
  };

  const lean = status.sessionLean;
  const leanText = lean === "balanced"
    ? "Balanced — either provider fine"
    : `Leaning on ${lean} — consider routing more to ${lean === "claude" ? "OpenAI" : "Claude"}`;

  const recText = `Route execution to ${rec.provider === "openai" ? "OpenAI" : "Claude"}`;

  const lines = [
    `╔${border}╗`,
    h("           Provider Balance Status"),
    h("           (session-relative, last 5 hours)"),
    `╠${border}╣`,
    h("Session usage:"),
    providerRow("claude"),
    providerRow("openai"),
    `╠${border}╣`,
    h(`Session lean: ${leanText}`),
    h(`Recommendation: ${recText}`),
    h(`Reason: ${rec.reason}`),
    `╚${border}╝`,
  ];

  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const status = getProviderStatus();
  const rec = chooseProvider({ tier: "execute", estimatedDurationMs: 300_000, isolation: "high", contextCoupling: "low" });
  printStatus(status, rec);
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
export { getProviderStatus, chooseProvider, recordUsageEvent, estimateTokensForTask, isModelAvailable, downgradeModel, classifyModel };
