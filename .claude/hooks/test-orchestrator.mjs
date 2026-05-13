#!/usr/bin/env node
/**
 * test-orchestrator.mjs — Self-test harness for all dual-brain orchestrator hooks.
 *
 * Usage:  node .claude/hooks/test-orchestrator.mjs
 *
 * Runs a suite of fast tests against the hook scripts, prints PASS/FAIL per
 * test, and exits with code 0 if all pass, 1 if any fail.
 */

import { execSync, spawnSync } from 'child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS = __dirname;

const ENFORCE_TIER  = resolve(HOOKS, 'enforce-tier.mjs');
const COST_LOGGER   = resolve(HOOKS, 'cost-logger.mjs');
const DUAL_BRAIN    = resolve(HOOKS, 'dual-brain-review.mjs');
const ORCHESTRATOR  = resolve(HOOKS, '..', 'orchestrator.json');
const USAGE_JSONL   = resolve(HOOKS, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run a hook script, passing stdinData through a shell pipe so that
 * readFileSync('/dev/stdin') inside the script can read it correctly.
 *
 * We use `sh -c "echo '<json>' | node <script>"` so that /dev/stdin is a
 * real pipe file descriptor, not a spawnSync input buffer.
 */
function run(scriptPath, stdinData, extraEnv = {}) {
  // Escape single quotes in the JSON payload for use inside single-quoted shell string
  const escaped = (stdinData || '').replace(/'/g, "'\\''");
  const shellCmd = `printf '%s' '${escaped}' | ${process.execPath} ${scriptPath}`;

  const proc = spawnSync('sh', ['-c', shellCmd], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
    timeout: 8_000,
  });

  let parsed = null;
  try { parsed = JSON.parse((proc.stdout || '').trim()); } catch {}
  return { raw: proc.stdout || '', stderr: proc.stderr || '', parsed, status: proc.status };
}

/**
 * Run a hook that reads from a for-await stdin loop (cost-logger style),
 * using spawnSync with the input option (works for stream-based reads).
 */
function runStream(scriptPath, stdinData, extraEnv = {}) {
  const proc = spawnSync(process.execPath, [scriptPath], {
    input: stdinData || '',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
    timeout: 8_000,
  });
  let parsed = null;
  try { parsed = JSON.parse((proc.stdout || '').trim()); } catch {}
  return { raw: proc.stdout || '', stderr: proc.stderr || '', parsed, status: proc.status };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`PASS  ${name}`);
      passed++;
    } else {
      console.log(`FAIL  ${name}${result ? ` — ${result}` : ''}`);
      failed++;
    }
  } catch (err) {
    console.log(`FAIL  ${name} — threw: ${err?.message ?? String(err)}`);
    failed++;
  }
}

// ─── Test 1: enforce-tier: search with opus ───────────────────────────────────
test('enforce-tier: search with opus', () => {
  const payload = JSON.stringify({
    tool_name: 'Agent',
    tool_input: { prompt: 'find auth files', model: 'opus', subagent_type: 'Explore' },
  });
  const { parsed } = run(ENFORCE_TIER, payload);
  if (!parsed) return 'no valid JSON output';
  if (!parsed.systemMessage) return `expected systemMessage, got: ${JSON.stringify(parsed)}`;
  if (!parsed.systemMessage.toLowerCase().includes('haiku'))
    return `expected "haiku" in systemMessage, got: ${parsed.systemMessage}`;
  return true;
});

// ─── Test 2: enforce-tier: correct tier ──────────────────────────────────────
test('enforce-tier: correct tier', () => {
  const payload = JSON.stringify({
    tool_name: 'Agent',
    tool_input: { prompt: `unique test prompt ${Date.now()}`, model: 'sonnet' },
  });
  const { parsed } = run(ENFORCE_TIER, payload);
  if (!parsed) return 'no valid JSON output';
  // Should return {} or at most a drift warning (not a tier mismatch)
  if (parsed.systemMessage && parsed.systemMessage.includes('Tier Enforcer'))
    return `unexpected tier mismatch: ${parsed.systemMessage}`;
  return true;
});

// ─── Test 3: enforce-tier: think task on haiku ───────────────────────────────
test('enforce-tier: think on haiku', () => {
  const payload = JSON.stringify({
    tool_name: 'Agent',
    tool_input: { prompt: 'review security', model: 'haiku' },
  });
  const { parsed } = run(ENFORCE_TIER, payload);
  if (!parsed) return 'no valid JSON output';
  if (!parsed.systemMessage)
    return `expected systemMessage warning, got: ${JSON.stringify(parsed)}`;
  return true;
});

// ─── Test 4: enforce-tier: non-Agent tool ────────────────────────────────────
test('enforce-tier: non-Agent tool', () => {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  const { parsed } = run(ENFORCE_TIER, payload);
  if (!parsed) return 'no valid JSON output';
  if (Object.keys(parsed).length !== 0)
    return `expected {}, got: ${JSON.stringify(parsed)}`;
  return true;
});

// ─── Test 5: enforce-tier: missing config (bad JSON in config path) ───────────
test('enforce-tier: missing config', () => {
  // enforce-tier catches config read errors and falls back to {} — verify that
  // an Agent payload still exits cleanly when config can't be parsed.
  // We set HOME to /tmp/nonexistent-orch-test so readFileSync of the hardcoded
  // config path will fail (the path is hardcoded, but we can't easily redirect
  // it). Instead, verify that sending a model string that matches no known tier
  // still results in a clean non-crashing exit.
  const payload = JSON.stringify({
    tool_name: 'Agent',
    tool_input: { prompt: 'do something', model: 'unknown-model-xyz' },
  });
  const { parsed, status } = run(ENFORCE_TIER, payload);
  // Should exit 0 and produce valid JSON (either {} or a systemMessage)
  if (status !== 0) return `non-zero exit: ${status}`;
  if (!parsed) return 'no valid JSON output';
  return true;
});

// ─── Test 6: cost-logger: logs entry ─────────────────────────────────────────
test('cost-logger: logs entry', () => {
  // Record current line count of usage.jsonl before the test.
  let linesBefore = 0;
  if (existsSync(USAGE_JSONL)) {
    linesBefore = readFileSync(USAGE_JSONL, 'utf8').split('\n').filter(Boolean).length;
  }

  const payload = JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: '/some/file.ts' },
  });
  // cost-logger uses for-await on process.stdin → use runStream (spawnSync input pipe)
  const { parsed, status } = runStream(COST_LOGGER, payload);

  if (status !== 0) return `non-zero exit: ${status}`;
  if (!parsed || Object.keys(parsed).length !== 0)
    return `expected {}, got: ${JSON.stringify(parsed)}`;

  if (!existsSync(USAGE_JSONL)) return 'daily usage log was not created';

  const lines = readFileSync(USAGE_JSONL, 'utf8').split('\n').filter(Boolean);
  const linesAfter = lines.length;
  if (linesAfter <= linesBefore) return 'no new line was appended to daily usage log';

  // Validate the new entry is valid JSON with expected fields
  const lastLine = lines[linesAfter - 1];
  let entry;
  try { entry = JSON.parse(lastLine); } catch { return `last line not valid JSON: ${lastLine}`; }
  if (!entry.timestamp) return 'entry missing timestamp';
  if (!entry.tier)      return 'entry missing tier';
  if (!entry.tool)      return 'entry missing tool';

  // Clean up the test line we just added
  try {
    const kept = lines.slice(0, linesBefore).join('\n');
    writeFileSync(USAGE_JSONL, kept ? kept + '\n' : '', 'utf8');
  } catch {
    // Best-effort cleanup; don't fail the test over it
  }

  return true;
});

// ─── Test 7: dual-brain: valid output ────────────────────────────────────────
test('dual-brain: valid output', () => {
  // Run dual-brain-review.mjs in a temp git repo with no changes so the test
  // is deterministic and never triggers codex/API calls on a dirty working tree.
  const tmpDir = spawnSync('mktemp', ['-d'], { encoding: 'utf8' }).stdout.trim();
  try {
    execSync(
      `git init -q "${tmpDir}" && git -C "${tmpDir}" commit --allow-empty -m init -q`,
      { stdio: 'pipe' }
    );
    const proc = spawnSync(process.execPath, [DUAL_BRAIN], {
      cwd: tmpDir,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // status null means the process was killed (timeout/signal) — treat as fail
    if (proc.status == null) return `process killed or timed out (signal/null status)`;
    if (proc.status !== 0) return `non-zero exit: ${proc.status}`;
    let parsed = null;
    try { parsed = JSON.parse((proc.stdout || '').trim()); } catch {}
    if (!parsed) return `no valid JSON output; raw: ${(proc.stdout || '').slice(0, 200)}`;
    if (typeof parsed.review !== 'string') return `expected review string, got: ${JSON.stringify(parsed)}`;
    return true;
  } finally {
    spawnSync('rm', ['-rf', tmpDir], { stdio: 'pipe' });
  }
});

// ─── Test 8: orchestrator.json: valid JSON ────────────────────────────────────
test('orchestrator.json: valid JSON', () => {
  if (!existsSync(ORCHESTRATOR)) return 'orchestrator.json not found';
  let config;
  try {
    config = JSON.parse(readFileSync(ORCHESTRATOR, 'utf8'));
  } catch (err) {
    return `invalid JSON: ${err.message}`;
  }
  if (!config.quality_gate)  return 'missing quality_gate section';
  if (!config.tiers)         return 'missing tiers section';
  if (!config.subscriptions) return 'missing subscriptions section';
  return true;
});

// ─── Test 9: enforce-tier: think on gpt-4.1-mini ─────────────────────────────
test('enforce-tier: think on gpt-4.1-mini', () => {
  const input = JSON.stringify({ tool_name: 'Agent', tool_input: { description: 'review security architecture', prompt: 'audit auth', model: 'gpt-4.1-mini' } });
  const { parsed } = run(ENFORCE_TIER, input);
  if (!parsed) return 'no valid JSON output';
  if (!parsed.systemMessage) return `expected systemMessage warning, got: ${JSON.stringify(parsed)}`;
  if (!parsed.systemMessage.toLowerCase().includes('think'))
    return `expected "think" in systemMessage, got: ${parsed.systemMessage}`;
  return true;
});

// ─── Test 10: orchestrator.json: model_intelligence ──────────────────────────
test('orchestrator.json: model_intelligence', () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '..', 'orchestrator.json'), 'utf8'));
  const mi = config.model_intelligence;
  if (!mi) return 'model_intelligence key missing';
  if (!mi.opus)   return 'model_intelligence missing opus entry';
  if (!mi.sonnet) return 'model_intelligence missing sonnet entry';
  if (!mi.haiku)  return 'model_intelligence missing haiku entry';
  return true;
});

// ─── Test 11: orchestrator.json: pricing_verified ────────────────────────────
test('orchestrator.json: pricing_verified', () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '..', 'orchestrator.json'), 'utf8'));
  if (!config.pricing_verified) return 'pricing_verified field missing';
  if (isNaN(Date.parse(config.pricing_verified))) return `pricing_verified is not a valid date: ${config.pricing_verified}`;
  return true;
});

// ─── Test 12: budget-balancer: loads and runs ────────────────────────────────
test('budget-balancer: loads and runs', () => {
  const proc = spawnSync('node', [resolve(__dirname, 'budget-balancer.mjs')], {
    encoding: 'utf8',
    timeout: 10000,
    cwd: resolve(__dirname, '..', '..'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (proc.status !== 0) return `exit code ${proc.status}: ${proc.stderr}`;
  if (!proc.stdout.includes('Provider Balance')) return 'missing output header';
  return true;
});

// ─── Test 13: orchestrator.json: providers configured ────────────────────────
test('orchestrator.json: providers configured', () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '..', 'orchestrator.json'), 'utf8'));
  if (!config.providers?.claude?.enabled) return 'claude provider not enabled';
  if (!config.providers?.openai?.enabled) return 'openai provider not enabled';
  if (!config.routing?.strategy) return 'routing strategy missing';
  return true;
});

// ─── Test 14: orchestrator.json: dual_thinking configured ────────────────────
test('orchestrator.json: dual_thinking configured', () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '..', 'orchestrator.json'), 'utf8'));
  if (!config.dual_thinking?.enabled) return 'dual_thinking not enabled';
  if (!config.dual_thinking?.auto_triggers?.length) return 'no auto_triggers';
  if (!config.dual_thinking?.sensitive_paths?.length) return 'no sensitive_paths';
  return true;
});

// ─── Summary ─────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${passed}/${total} tests passed`);
process.exit(failed > 0 ? 1 : 0);
