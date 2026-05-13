#!/usr/bin/env node
/**
 * health-check.mjs — Dual-Brain Orchestrator Health Check
 *
 * Usage:
 *   node .claude/hooks/health-check.mjs
 *
 * Validates that all hooks are wired, configs are valid, and the system
 * is functioning in a live session. Always exits 0 and outputs valid JSON.
 *
 * Checks:
 *   1. orchestrator.json    — exists and parses as valid JSON
 *   2. pricing_verified     — exists, warn if >30 days, fail if >90 days
 *   3. model_intelligence   — exists and covers all subscription models
 *   4. hook scripts         — enforce-tier, cost-logger, quality-gate, dual-brain-review readable
 *   5. usage.jsonl active   — recent entries (last 15 min) indicate PostToolUse hook is wired
 *   6. codex CLI            — found on PATH or known locations; auth status checked
 *   7. git repo             — working directory is inside a git repo
 */

import { existsSync, accessSync, readFileSync, constants } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR     = __dirname;
const CONFIG_FILE   = join(__dirname, "..", "orchestrator.json");
const USAGE_FILE_LEGACY = join(__dirname, "usage.jsonl");
const USAGE_FILE_TODAY  = join(__dirname, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
const WORKSPACE     = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
const STATUS = { pass: "pass", warn: "warn", fail: "fail" };

function check(name, status, detail) {
  return { name, status, detail };
}

// ---------------------------------------------------------------------------
// Check implementations
// ---------------------------------------------------------------------------

/** 1. orchestrator.json — exists and parses as valid JSON */
function checkOrchestratorJson() {
  if (!existsSync(CONFIG_FILE)) {
    return check("orchestrator.json", STATUS.fail, "file not found");
  }
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch (err) {
    return check("orchestrator.json", STATUS.fail, `invalid JSON: ${err.message}`);
  }
  if (!config.subscriptions || !config.tiers) {
    return check("orchestrator.json", STATUS.warn, "parsed but missing expected keys");
  }
  return check("orchestrator.json", STATUS.pass, "valid");
}

/** 2. pricing_verified — exists in config, warn if >30 days, fail if >90 days */
function checkPricingVerified() {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return check("pricing_verified", STATUS.fail, "cannot read config");
  }

  const val = config.pricing_verified;
  if (!val) {
    return check("pricing_verified", STATUS.fail, "field missing from config");
  }

  const ts = Date.parse(val);
  if (isNaN(ts)) {
    return check("pricing_verified", STATUS.fail, `not a valid date: ${val}`);
  }

  const ageMs   = Date.now() - ts;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (ageDays > 90) {
    return check("pricing_verified", STATUS.fail, `${ageDays} days ago — update pricing`);
  }
  if (ageDays > 30) {
    return check("pricing_verified", STATUS.warn, `${ageDays} days ago — consider refreshing`);
  }
  return check("pricing_verified", STATUS.pass, `${ageDays} days ago`);
}

/** 3. model_intelligence — exists and has entries for at least the subscription models */
function checkModelIntelligence() {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return check("model_intelligence", STATUS.fail, "cannot read config");
  }

  const mi = config.model_intelligence;
  if (!mi || typeof mi !== "object") {
    return check("model_intelligence", STATUS.fail, "key missing from config");
  }

  // Collect model keys from subscriptions
  const subscriptionModels = new Set();
  for (const provider of Object.values(config.subscriptions || {})) {
    for (const key of Object.keys(provider.models || {})) {
      subscriptionModels.add(key);
    }
  }

  const miKeys     = Object.keys(mi);
  const missing    = [...subscriptionModels].filter((m) => !mi[m]);
  const entryCount = miKeys.length;

  if (missing.length > 0) {
    return check(
      "model_intelligence",
      STATUS.warn,
      `${entryCount} models, missing: ${missing.join(", ")}`
    );
  }
  return check("model_intelligence", STATUS.pass, `${entryCount} models`);
}

/** 4. Hook scripts readable */
function checkHookScripts() {
  const hooks = [
    "enforce-tier.mjs",
    "cost-logger.mjs",
    "quality-gate.mjs",
    "dual-brain-review.mjs",
  ];

  const results = hooks.map((name) => {
    const p = join(HOOKS_DIR, name);
    try {
      accessSync(p, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  });

  const readableCount = results.filter(Boolean).length;
  const total         = hooks.length;

  if (readableCount === total) {
    return check("hook scripts", STATUS.pass, `${readableCount}/${total} readable`);
  }
  if (readableCount === 0) {
    return check("hook scripts", STATUS.fail, `0/${total} readable`);
  }

  const missing = hooks.filter((_, i) => !results[i]);
  return check(
    "hook scripts",
    STATUS.warn,
    `${readableCount}/${total} readable, missing: ${missing.join(", ")}`
  );
}

/** 5. usage log active — check dated files and legacy for entries from last 15 minutes */
function checkUsageJsonl() {
  const usageFile = existsSync(USAGE_FILE_TODAY) ? USAGE_FILE_TODAY
    : existsSync(USAGE_FILE_LEGACY) ? USAGE_FILE_LEGACY
    : null;

  if (!usageFile) {
    return check("usage log", STATUS.warn, "no usage files found — PostToolUse hook may not be wired");
  }

  let lines;
  try {
    lines = readFileSync(usageFile, "utf8").split("\n").filter(Boolean);
  } catch {
    return check("usage log", STATUS.warn, "file unreadable");
  }

  if (lines.length === 0) {
    return check("usage log", STATUS.warn, "file empty — PostToolUse hook may not be wired");
  }

  const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
  let recentCount     = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.timestamp && Date.parse(entry.timestamp) >= fifteenMinAgo) {
        recentCount++;
      }
    } catch {}
  }

  if (recentCount === 0) {
    return check(
      "usage log",
      STATUS.warn,
      `${lines.length} entries, none in last 15 min — PostToolUse hook may not be wired`
    );
  }

  return check("usage log", STATUS.pass, `${recentCount} recent entries`);
}

/** 6. Codex CLI available and authenticated */
function checkCodexCli() {
  // Try which first
  const whichResult = spawnSync("which", ["codex"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5_000,
  });

  const knownPaths = [
    "/usr/local/bin/codex",
    "/usr/bin/codex",
    join(process.env.HOME || "/root", ".local/bin/codex"),
    join(process.env.HOME || "/root", "bin/codex"),
  ];

  let codexPath = null;

  if (whichResult.status === 0 && whichResult.stdout.trim()) {
    codexPath = whichResult.stdout.trim();
  } else {
    codexPath = knownPaths.find((p) => existsSync(p)) || null;
  }

  if (!codexPath) {
    return check(
      "codex CLI",
      STATUS.warn,
      "not found — dual-brain review won't work without Codex CLI"
    );
  }

  // Try `codex login status` with 5s timeout
  const loginResult = spawnSync(codexPath, ["login", "status"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5_000,
  });

  if (loginResult.signal === "SIGTERM" || loginResult.status == null) {
    return check("codex CLI", STATUS.warn, `found at ${codexPath} — auth check timed out`);
  }

  const output = (loginResult.stdout + loginResult.stderr).toLowerCase();

  if (loginResult.status === 0 || output.includes("logged in") || output.includes("authenticated")) {
    return check("codex CLI", STATUS.pass, "authenticated");
  }

  if (output.includes("not logged") || output.includes("unauthenticated") || output.includes("login")) {
    return check("codex CLI", STATUS.warn, `found at ${codexPath} — not authenticated`);
  }

  // Unknown output — still found, just can't confirm auth
  return check("codex CLI", STATUS.warn, `found at ${codexPath} — auth status unknown`);
}

/** 7. Git repo — verify we're in a git repo */
function checkGitRepo() {
  const result = spawnSync("git", ["-C", WORKSPACE, "status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5_000,
  });

  if (result.status !== 0) {
    return check("git repo", STATUS.fail, "not a git repository — quality gate needs this");
  }

  const dirty = (result.stdout || "").trim().length > 0;
  return check("git repo", STATUS.pass, dirty ? "dirty" : "clean");
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

const ICON = {
  pass: "✓",
  warn: "⚠",
  fail: "✗",
};

const W = 54; // inner width between ║ chars

function pad(str, len, align = "left") {
  str = String(str);
  if (str.length >= len) return str.slice(0, len);
  const spaces = " ".repeat(len - str.length);
  return align === "right" ? spaces + str : str + spaces;
}

function boxLine(content) {
  return `║ ${pad(content, W - 2)} ║`;
}

function boxSep() {
  return "╠" + "═".repeat(W) + "╣";
}

function boxTop() {
  return "╔" + "═".repeat(W) + "╗";
}

function boxBot() {
  return "╚" + "═".repeat(W) + "╝";
}

function renderTable(checks) {
  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;

  const nameWidth   = 20;
  const detailWidth = W - 2 - 2 - nameWidth - 1; // icon + space + name + space + detail

  const rows = checks.map((c) => {
    const icon   = ICON[c.status] || "?";
    const name   = pad(c.name, nameWidth);
    const detail = pad(c.detail, detailWidth);
    return boxLine(`${icon} ${name} ${detail}`);
  });

  const summary = `${passCount} pass, ${warnCount} warn, ${failCount} fail`;

  const lines = [
    boxTop(),
    boxLine(pad("Orchestrator Health Check", W - 2)),
    boxSep(),
    ...rows,
    boxSep(),
    boxLine(summary),
    boxBot(),
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const checks = [
    checkOrchestratorJson(),
    checkPricingVerified(),
    checkModelIntelligence(),
    checkHookScripts(),
    checkUsageJsonl(),
    checkCodexCli(),
    checkGitRepo(),
  ];

  // Print formatted table
  console.log(renderTable(checks));
  console.log();

  // Build JSON summary
  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const healthy   = failCount === 0;

  const output = {
    healthy,
    pass: passCount,
    warn: warnCount,
    fail: failCount,
    checks: checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail })),
  };

  console.log(JSON.stringify(output, null, 2));

  process.exit(0);
}

main();
