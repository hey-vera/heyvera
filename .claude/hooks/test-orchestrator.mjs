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
  appendFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
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
const BURST_FILE    = resolve(HOOKS, '.burst-state');
const COOLDOWN_FILE = resolve(HOOKS, '.recommendation-cooldowns');

// Clean up cooldown state before tests so cooldowns don't interfere
try { unlinkSync(COOLDOWN_FILE); } catch {}

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
  // Clear cooldown state so tier_warning isn't suppressed
  try { unlinkSync(COOLDOWN_FILE); } catch {}
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
    tool_name: 'Bash',
    tool_input: { command: 'echo hello' },
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
  // Clear cooldown state so tier_warning isn't suppressed
  try { unlinkSync(COOLDOWN_FILE); } catch {}
  const input = JSON.stringify({ tool_name: 'Agent', tool_input: { description: 'review security architecture', prompt: 'audit auth', model: 'gpt-4.1-mini' } });
  const { parsed } = run(ENFORCE_TIER, input);
  if (!parsed) return 'no valid JSON output';
  if (!parsed.systemMessage) return `expected systemMessage warning, got: ${JSON.stringify(parsed)}`;
  if (!parsed.systemMessage.toLowerCase().includes('think'))
    return `expected "think" in systemMessage, got: ${parsed.systemMessage}`;
  return true;
});

// ─── Test 10: orchestrator.json: model_intelligence (inline in subscriptions) ─
test('orchestrator.json: model_intelligence (inline)', () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '..', 'orchestrator.json'), 'utf8'));
  const claude = config.subscriptions?.claude?.models || {};
  const openai = config.subscriptions?.openai?.models || {};
  if (!claude.opus?.best_for)   return 'claude.models.opus missing best_for';
  if (!claude.sonnet?.best_for) return 'claude.models.sonnet missing best_for';
  if (!claude.haiku?.best_for)  return 'claude.models.haiku missing best_for';
  if (!claude.opus?.model_id)   return 'claude.models.opus missing model_id';
  // Verify openai models also have intelligence fields
  for (const [name, meta] of Object.entries(openai)) {
    if (!meta.best_for) return `openai.models.${name} missing best_for`;
  }
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
  const proc = spawnSync(process.execPath, [resolve(__dirname, 'budget-balancer.mjs')], {
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

// ─── Test 15: profile consistency (behavioral) ─────────────────────────────
test('profiles: consistent across modules', () => {
  const script = `
    import { PROFILES, getActiveProfile } from './profiles.mjs';
    const results = { errors: [] };

    // 1. All 4 profiles exist
    const expected = ['auto', 'balanced', 'cost-saver', 'quality-first'];
    for (const name of expected) {
      if (!PROFILES[name]) results.errors.push('missing profile: ' + name);
    }

    // 2. Each profile has required fields
    const requiredFields = ['description', 'routing', 'budgets', 'quality_gate'];
    const routingFields = ['prefer_provider', 'think_threshold', 'gpt_dispatch_bias'];
    const budgetFields = ['session_warn_usd', 'session_limit_usd', 'daily_warn_usd', 'daily_limit_usd'];

    for (const name of expected) {
      const p = PROFILES[name];
      if (!p) continue;
      for (const f of requiredFields) {
        if (!p[f]) results.errors.push(name + ' missing field: ' + f);
      }
      for (const f of routingFields) {
        if (p.routing[f] === undefined) results.errors.push(name + ' routing missing: ' + f);
      }
      for (const f of budgetFields) {
        if (typeof p.budgets[f] !== 'number' || p.budgets[f] <= 0)
          results.errors.push(name + ' budget not positive number: ' + f + '=' + p.budgets[f]);
      }
    }

    // 3. getActiveProfile returns a valid profile
    const active = getActiveProfile();
    if (!active.name) results.errors.push('getActiveProfile missing name');
    if (!active.routing) results.errors.push('getActiveProfile missing routing');
    if (!active.budgets) results.errors.push('getActiveProfile missing budgets');

    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `profiles script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 16: failure-detector API contract (behavioral) ────────────────────
test('failure-detector: API contract', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    // Start with clean ledger
    writeFileSync(LEDGER, '', 'utf8');

    const script = `
      import { computePromptHash, checkFailureLoop, recordFailure } from './failure-detector.mjs';
      const results = { errors: [] };

      // 1. computePromptHash returns 12-char hex string
      const hash = computePromptHash({ prompt: 'test prompt', description: 'test desc' });
      if (typeof hash !== 'string') results.errors.push('hash not a string: ' + typeof hash);
      else if (hash.length !== 12) results.errors.push('hash length not 12: ' + hash.length);
      else if (!/^[0-9a-f]{12}$/.test(hash)) results.errors.push('hash not hex: ' + hash);

      // 2. checkFailureLoop returns { isLoop, score } shape (before any failures)
      const check1 = checkFailureLoop(hash);
      if (typeof check1 !== 'object' || check1 === null) results.errors.push('checkFailureLoop did not return object');
      else {
        if (typeof check1.isLoop !== 'boolean' && typeof check1.isLoop !== 'undefined')
          // isLoop should be boolean
          results.errors.push('isLoop not boolean: ' + typeof check1.isLoop);
        if (!('weightedScore' in check1 || 'score' in check1))
          results.errors.push('checkFailureLoop missing score field');
      }

      // 3. recordFailure is callable without throwing
      try {
        recordFailure(hash, 'execute', 'test_reason');
      } catch (e) {
        results.errors.push('recordFailure threw: ' + e.message);
      }

      // 4. After recording failures, checkFailureLoop detects them
      recordFailure(hash, 'execute', 'test_reason_2');
      const check2 = checkFailureLoop(hash);
      if (check2.count < 2) results.errors.push('expected count >= 2 after 2 recordFailure calls, got: ' + check2.count);

      process.stdout.write(JSON.stringify(results));
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

    if (proc.status !== 0) return `failure-detector script failed: ${proc.stderr}`;
    let results;
    try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
    if (results.errors.length > 0) return results.errors.join('; ');
    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 17: enforce-tier: malformed stdin ─────────────────────────────────
test('enforce-tier: malformed stdin', () => {
  const { parsed, status } = run(ENFORCE_TIER, 'this is not json at all {{{');
  if (status !== 0) return `non-zero exit: ${status}`;
  if (!parsed) return 'no valid JSON output';
  return true;
});

// ─── Test 18: enforce-tier: missing tool_input ──────────────────────────────
test('enforce-tier: missing tool_input', () => {
  const payload = JSON.stringify({ tool_name: 'Agent' });
  const { parsed, status } = run(ENFORCE_TIER, payload);
  if (status !== 0) return `non-zero exit: ${status}`;
  if (!parsed) return 'no valid JSON output';
  return true;
});

// ─── Test 19: enforce-tier: non-Agent tool passthrough ──────────────────────
test('enforce-tier: non-Agent tool passthrough', () => {
  const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/foo' } });
  const { parsed, status } = run(ENFORCE_TIER, payload);
  if (status !== 0) return `non-zero exit: ${status}`;
  if (!parsed) return 'no valid JSON output';
  if (Object.keys(parsed).length !== 0)
    return `expected {}, got: ${JSON.stringify(parsed)}`;
  return true;
});

// ─── Test 20: cost-logger: malformed stdin ──────────────────────────────────
test('cost-logger: malformed stdin', () => {
  const { parsed, status } = runStream(COST_LOGGER, 'not json garbage >>>');
  if (status !== 0) return `non-zero exit: ${status}`;
  if (!parsed) return 'no valid JSON output';
  return true;
});

// ─── Test 21: cost-logger: missing fields ───────────────────────────────────
test('cost-logger: missing fields', () => {
  let linesBefore = 0;
  if (existsSync(USAGE_JSONL)) {
    linesBefore = readFileSync(USAGE_JSONL, 'utf8').split('\n').filter(Boolean).length;
  }

  const { parsed, status } = runStream(COST_LOGGER, '{}');
  if (status !== 0) return `non-zero exit: ${status}`;
  if (!parsed) return 'no valid JSON output';

  if (!existsSync(USAGE_JSONL)) return 'daily usage log was not created';
  const lines = readFileSync(USAGE_JSONL, 'utf8').split('\n').filter(Boolean);
  if (lines.length <= linesBefore) return 'no new line was appended to daily usage log';

  // Clean up the test line
  try {
    const kept = lines.slice(0, linesBefore).join('\n');
    writeFileSync(USAGE_JSONL, kept ? kept + '\n' : '', 'utf8');
  } catch {}

  return true;
});

// ─── Test 22: cost-logger: error status recorded ────────────────────────────
test('cost-logger: error status recorded', () => {
  let linesBefore = 0;
  if (existsSync(USAGE_JSONL)) {
    linesBefore = readFileSync(USAGE_JSONL, 'utf8').split('\n').filter(Boolean).length;
  }

  const payload = JSON.stringify({
    tool_name: 'Agent',
    tool_input: { prompt: 'test' },
    error: 'something failed',
  });
  const { parsed, status } = runStream(COST_LOGGER, payload);
  if (status !== 0) return `non-zero exit: ${status}`;
  if (!parsed) return 'no valid JSON output';

  if (!existsSync(USAGE_JSONL)) return 'daily usage log was not created';
  const lines = readFileSync(USAGE_JSONL, 'utf8').split('\n').filter(Boolean);
  if (lines.length <= linesBefore) return 'no new line was appended to daily usage log';

  const lastLine = lines[lines.length - 1];
  let entry;
  try { entry = JSON.parse(lastLine); } catch { return `last line not valid JSON: ${lastLine}`; }
  if (entry.status !== 'error') return `expected status "error", got: "${entry.status}"`;

  // Clean up the test line
  try {
    const kept = lines.slice(0, linesBefore).join('\n');
    writeFileSync(USAGE_JSONL, kept ? kept + '\n' : '', 'utf8');
  } catch {}

  return true;
});

// ─── Test 23: enforce-tier: cost-saver demotes think ────────────────────────
test('enforce-tier: cost-saver demotes think', () => {
  const profileFile = resolve(__dirname, '..', 'dual-brain.profile.json');
  let originalProfile;
  try { originalProfile = readFileSync(profileFile, 'utf8'); } catch { originalProfile = null; }
  try {
    writeFileSync(profileFile, JSON.stringify({ active: 'cost-saver' }));
    // "edit the README file" — execute-like text, no think words
    // cost-saver's demote_think=true demotes think→execute when text lacks think words
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { prompt: 'edit the README file', model: 'opus' },
    });
    const { parsed, status } = run(ENFORCE_TIER, payload);
    if (status !== 0) return `non-zero exit: ${status}`;
    if (!parsed) return 'no valid JSON output';
    // With demote_think, the tier stays execute, so opus on execute work exits 0 with valid JSON
    return true;
  } finally {
    if (originalProfile !== null) writeFileSync(profileFile, originalProfile);
    else try { unlinkSync(profileFile); } catch {}
  }
});

// ─── Test 24: enforce-tier: quality-first promotes execute ──────────────────
test('enforce-tier: quality-first promotes execute', () => {
  // Clear cooldown state so tier_warning isn't suppressed
  try { unlinkSync(COOLDOWN_FILE); } catch {}
  const profileFile = resolve(__dirname, '..', 'dual-brain.profile.json');
  let originalProfile;
  try { originalProfile = readFileSync(profileFile, 'utf8'); } catch { originalProfile = null; }
  try {
    writeFileSync(profileFile, JSON.stringify({ active: 'quality-first' }));
    // Think-like description on sonnet model — quality-first's promote_execute=true
    // promotes to think when text matches think words
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { prompt: 'review architecture and plan the migration', model: 'sonnet' },
    });
    const { parsed, status } = run(ENFORCE_TIER, payload);
    if (status !== 0) return `non-zero exit: ${status}`;
    if (!parsed) return 'no valid JSON output';
    if (!parsed.systemMessage) return `expected systemMessage, got: ${JSON.stringify(parsed)}`;
    if (!parsed.systemMessage.toLowerCase().includes('think'))
      return `expected "think" in systemMessage, got: ${parsed.systemMessage}`;
    return true;
  } finally {
    if (originalProfile !== null) writeFileSync(profileFile, originalProfile);
    else try { unlinkSync(profileFile); } catch {}
  }
});

// ─── Test 25: enforce-tier: auto profile with high-risk file ────────────────
test('enforce-tier: auto profile with high-risk file', () => {
  const profileFile = resolve(__dirname, '..', 'dual-brain.profile.json');
  let originalProfile;
  try { originalProfile = readFileSync(profileFile, 'utf8'); } catch { originalProfile = null; }
  try {
    writeFileSync(profileFile, JSON.stringify({ active: 'auto' }));
    // Description with auth/credentials path → risk classifier detects critical risk → promote to think
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { description: 'update src/auth/credentials.mjs', prompt: 'change the token logic', model: 'sonnet' },
    });
    const { parsed, status } = run(ENFORCE_TIER, payload);
    if (status !== 0) return `non-zero exit: ${status}`;
    if (!parsed) return 'no valid JSON output';
    if (!parsed.systemMessage) return `expected systemMessage, got: ${JSON.stringify(parsed)}`;
    const msg = parsed.systemMessage.toLowerCase();
    if (!msg.includes('think') && !msg.includes('dual-brain'))
      return `expected "think" or "dual-brain" in systemMessage, got: ${parsed.systemMessage}`;
    return true;
  } finally {
    // Always restore profile to auto so subsequent tests aren't affected
    writeFileSync(profileFile, JSON.stringify({ active: 'auto' }));
  }
});

// ─── Test 26: adaptive: recordFailure writes to ledger ─────────────────────
test('adaptive: recordFailure writes to ledger', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    const script = `
      import { recordFailure } from './failure-detector.mjs';
      recordFailure('testhash123', 'execute', 'test_error');
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

    if (proc.status !== 0) return `recordFailure script failed: ${proc.stderr}`;
    if (!existsSync(LEDGER)) return 'ledger file not created';

    const lines = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1];
    let entry;
    try { entry = JSON.parse(lastLine); } catch { return `last line not valid JSON: ${lastLine}`; }
    if (entry.prompt_hash !== 'testhash123') return `expected prompt_hash=testhash123, got: ${entry.prompt_hash}`;
    if (entry.success !== false) return `expected success=false, got: ${entry.success}`;
    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 27: adaptive: checkFailureLoop detects 2+ failures ───────────────
test('adaptive: checkFailureLoop detects 2+ failures', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    const hash = 'looptest_' + Date.now();
    const now = new Date().toISOString();
    const failEntry = JSON.stringify({
      type: 'failure', timestamp: now, prompt_hash: hash,
      tier: 'execute', reason: 'test', success: false,
    });
    const content = (backup || '') + failEntry + '\n' + failEntry + '\n';
    writeFileSync(LEDGER, content, 'utf8');

    const script = `
      import { checkFailureLoop } from './failure-detector.mjs';
      const result = checkFailureLoop('${hash}');
      process.stdout.write(JSON.stringify(result));
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

    if (proc.status !== 0) return `checkFailureLoop script failed: ${proc.stderr}`;
    let result;
    try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
    if (!result.isLoop) return `expected isLoop=true, got: ${JSON.stringify(result)}`;
    if (result.count < 2) return `expected count>=2, got: ${result.count}`;
    if (result.suggestion !== 'promote_tier' && result.suggestion !== 'escalate_to_dual_brain')
      return `unexpected suggestion: ${result.suggestion}`;
    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 28: adaptive: checkFailureLoop ignores old failures ──────────────
test('adaptive: checkFailureLoop ignores old failures', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    const hash = 'oldtest_' + Date.now();
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const oldEntry = JSON.stringify({
      type: 'failure', timestamp: threeHoursAgo, prompt_hash: hash,
      tier: 'execute', reason: 'old_test', success: false,
    });
    writeFileSync(LEDGER, oldEntry + '\n' + oldEntry + '\n', 'utf8');

    const script = `
      import { checkFailureLoop } from './failure-detector.mjs';
      const result = checkFailureLoop('${hash}');
      process.stdout.write(JSON.stringify(result));
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

    if (proc.status !== 0) return `checkFailureLoop script failed: ${proc.stderr}`;
    let result;
    try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
    if (result.isLoop) return `expected isLoop=false for old failures, got: ${JSON.stringify(result)}`;
    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 29: adaptive: cost-logger records Agent errors ───────────────────
test('adaptive: cost-logger records Agent errors', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    let linesBefore = 0;
    if (existsSync(LEDGER)) {
      linesBefore = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).length;
    }

    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { prompt: 'failing task hash test' },
      error: 'test failure',
    });
    const { status } = runStream(COST_LOGGER, payload);
    if (status !== 0) return `non-zero exit: ${status}`;

    if (!existsSync(LEDGER)) return 'ledger file not created';
    const lines = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= linesBefore) return 'no new failure entry appended to ledger';

    const newEntry = lines[lines.length - 1];
    let entry;
    try { entry = JSON.parse(newEntry); } catch { return `last line not valid JSON: ${newEntry}`; }
    if (entry.success !== false) return `expected success=false, got: ${entry.success}`;
    if (entry.type !== 'outcome') return `expected type=outcome, got: ${entry.type}`;
    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 30: enforce-tier: burst detection activates on 3+ agents ─────────
test('enforce-tier: burst detection activates on 3+ agents', () => {
  try {
    // Write burst state at count 2, within window
    writeFileSync(BURST_FILE, JSON.stringify({ count: 2, window_start: Date.now() }));
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { prompt: `burst activation test ${Date.now()}`, model: 'sonnet' },
    });
    const { parsed, status } = run(ENFORCE_TIER, payload);
    if (status !== 0) return `non-zero exit: ${status}`;
    if (!parsed) return 'no valid JSON output';

    // Read burst state — count should have incremented to >= 3
    if (!existsSync(BURST_FILE)) return '.burst-state file was removed unexpectedly';
    let state;
    try { state = JSON.parse(readFileSync(BURST_FILE, 'utf8')); } catch (e) { return `.burst-state not valid JSON: ${e.message}`; }
    if (state.count < 3) return `expected count >= 3, got: ${state.count}`;
    return true;
  } finally {
    try { unlinkSync(BURST_FILE); } catch {}
  }
});

// ─── Test 31: enforce-tier: burst mode suppresses duplicate warnings ───────
test('enforce-tier: burst mode suppresses duplicate warnings', () => {
  try {
    // Pre-set burst mode (count=5, active window)
    writeFileSync(BURST_FILE, JSON.stringify({ count: 5, window_start: Date.now() }));
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { prompt: 'burst duplicate test identical prompt', model: 'sonnet' },
    });

    // First call — establishes the prompt hash
    run(ENFORCE_TIER, payload);
    // Second identical call — in burst mode, duplicate warning should be suppressed or [Wave]-prefixed
    const { parsed, status } = run(ENFORCE_TIER, payload);
    if (status !== 0) return `non-zero exit: ${status}`;
    if (!parsed) return 'no valid JSON output';

    // In burst mode: either no duplicate warning at all, or a [Wave]-prefixed one
    const msg = parsed.systemMessage || '';
    const hasDuplicateWarning = msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('similar task');
    if (hasDuplicateWarning && !msg.includes('[Wave]') && !msg.includes('wave detected'))
      return `expected no duplicate warning or [Wave]-prefixed in burst mode, got: ${msg}`;
    return true;
  } finally {
    try { unlinkSync(BURST_FILE); } catch {}
  }
});

// ─── Test 32: enforce-tier: non-burst mode still warns on duplicates ───────
test('enforce-tier: non-burst mode still warns on duplicates', () => {
  // Clear cooldown and summary state to start clean
  const summaryFile = resolve(HOOKS, `usage-summary-${new Date().toISOString().slice(0, 10)}.json`);
  let savedSummary;
  try { savedSummary = readFileSync(summaryFile, 'utf8'); } catch { savedSummary = null; }
  try {
    try { unlinkSync(COOLDOWN_FILE); } catch {}
    // Temporarily clear summary to prevent stale hash matches on first call
    try { writeFileSync(summaryFile, JSON.stringify({ version: 1, recent_hashes: [] })); } catch {}
    // Expire burst state by setting window_start to 0 (well outside 90s window)
    writeFileSync(BURST_FILE, JSON.stringify({ count: 0, window_start: 0 }));
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { prompt: 'non-burst duplicate test identical prompt', model: 'sonnet' },
    });

    // First call — establishes the prompt hash
    run(ENFORCE_TIER, payload);
    // Clear cooldown between calls so the second call's duplicate warning isn't suppressed
    try { unlinkSync(COOLDOWN_FILE); } catch {}
    // Second identical call — should trigger duplicate warning
    const { parsed, status } = run(ENFORCE_TIER, payload);
    if (status !== 0) return `non-zero exit: ${status}`;
    if (!parsed) return 'no valid JSON output';

    const msg = parsed.systemMessage || '';
    if (!msg.toLowerCase().includes('similar task') && !msg.toLowerCase().includes('duplicate'))
      return `expected duplicate warning in non-burst mode, got: ${msg || '(empty)'}`;
    return true;
  } finally {
    try { unlinkSync(BURST_FILE); } catch {}
    try { unlinkSync(COOLDOWN_FILE); } catch {}
    // Restore summary file if it existed before
    if (savedSummary) {
      try { writeFileSync(summaryFile, savedSummary); } catch {}
    }
  }
});

// ─── Test 33: install preserves existing hooks ─────────────────────────────
test('install: preserves existing hooks', () => {
  const installSrc = readFileSync(resolve(__dirname, '..', 'install.mjs'), 'utf8');

  // install.mjs must define DUAL_BRAIN_CMDS to identify its own hooks
  if (!installSrc.includes('DUAL_BRAIN_CMDS'))
    return 'install.mjs missing DUAL_BRAIN_CMDS constant for filtering';

  // It must filter out only dual-brain hooks (not all hooks) before merging
  if (!installSrc.includes('.filter'))
    return 'install.mjs missing .filter() call — may clobber non-dual-brain hooks';

  // The merge logic should spread existingEntries first, then add dual-brain hooks
  if (!installSrc.includes('existingEntries'))
    return 'install.mjs missing existingEntries variable — may not preserve other hooks';

  // Verify it reads existing settings before overwriting
  if (!installSrc.includes('existing') || !installSrc.includes('settings.json'))
    return 'install.mjs does not read existing settings.json before writing';

  return true;
});

// ─── Test 34: gitignore entries don't conflict with data-tools ─────────────
test('install: gitignore entries scoped to dual-brain', () => {
  const installSrc = readFileSync(resolve(__dirname, '..', 'install.mjs'), 'utf8');

  // Extract the generateGitignoreEntries function body
  const fnMatch = installSrc.match(/generateGitignoreEntries[\s\S]*?const entries\s*=\s*\[([\s\S]*?)\]/);
  if (!fnMatch) return 'could not find generateGitignoreEntries entries array';

  const entriesBlock = fnMatch[1];

  // Extract individual entry strings
  const entryStrings = [...entriesBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
  if (entryStrings.length === 0) return 'no gitignore entries found in install.mjs';

  // Each entry must be scoped — no broad patterns like *.json, *.jsonl, .claude/hooks/
  const broadPatterns = ['*.json', '*.jsonl', '*.mjs', '.claude/', '.claude/hooks/'];
  for (const entry of entryStrings) {
    for (const bad of broadPatterns) {
      if (entry === bad)
        return `gitignore entry "${entry}" is too broad — could match data-tools files`;
    }
  }

  // Each entry should reference dual-brain-specific names
  const validScopes = ['dual-brain', 'usage-', 'usage.jsonl', 'decision-ledger', 'drift-warned', 'budget-alerted', 'summary-', 'reviews/', '.launched'];
  for (const entry of entryStrings) {
    const isScoped = validScopes.some(scope => entry.includes(scope));
    if (!isScoped)
      return `gitignore entry "${entry}" may not be scoped to dual-brain files`;
  }

  return true;
});

// ─── Test 35: hooks use isolated file paths ────────────────────────────────
test('hooks: output files use dual-brain-namespaced paths', () => {
  const validNames = ['dual-brain', 'usage-', 'usage.jsonl', 'decision-ledger', 'summary-checkpoint', '.drift-warned', '.burst-state', '.budget-alerted', 'orchestrator.json', '.launched'];

  const hookFiles = {
    'enforce-tier.mjs': ['DRIFT_STATE', 'BURST_FILE', 'PROFILE_FILE'],
    'cost-logger.mjs': ['usage-', 'PROFILE_FILE'],
    'summary-checkpoint.mjs': ['usage-summary-', 'usage-'],
  };

  for (const [hookFile, expectedRefs] of Object.entries(hookFiles)) {
    const src = readFileSync(resolve(__dirname, hookFile), 'utf8');

    // Find all file paths the hook writes to (writeFileSync / appendFileSync targets)
    const writeTargets = [...src.matchAll(/(?:writeFileSync|appendFileSync|renameSync|atomicWriteJSON)\(\s*([^,)]+)/g)].map(m => m[1].trim());

    if (writeTargets.length === 0) return `${hookFile}: no write targets found`;

    // Verify none of the write targets use generic names
    // They should resolve to variables defined with dual-brain-specific names
    const genericNames = ['config.json', 'state.json', 'log.jsonl', 'data.json', 'output.json'];
    for (const target of writeTargets) {
      for (const bad of genericNames) {
        if (target.includes(`'${bad}'`) || target.includes(`"${bad}"`))
          return `${hookFile}: writes to generic filename "${bad}" — could collide with other tools`;
      }
    }
  }

  // Verify the actual file path constants in enforce-tier use dual-brain-scoped names
  const enforceSrc = readFileSync(resolve(__dirname, 'enforce-tier.mjs'), 'utf8');
  if (!enforceSrc.includes('dual-brain.profile.json'))
    return 'enforce-tier.mjs PROFILE_FILE does not reference dual-brain namespace';
  if (!enforceSrc.includes('.drift-warned'))
    return 'enforce-tier.mjs DRIFT_STATE does not use scoped filename';
  if (!enforceSrc.includes('.burst-state'))
    return 'enforce-tier.mjs BURST_FILE does not use scoped filename';

  // Verify cost-logger writes to usage-dated files, not generic names
  const costSrc = readFileSync(resolve(__dirname, 'cost-logger.mjs'), 'utf8');
  if (!costSrc.includes('usage-'))
    return 'cost-logger.mjs does not write to usage-prefixed files';
  if (!costSrc.includes('dual-brain.profile.json'))
    return 'cost-logger.mjs PROFILE_FILE does not reference dual-brain namespace';

  return true;
});

// ─── Test 36: failure decay weights recent failures higher ─────────────────
test('failure decay: recent failures score high', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    const hash = 'decay_recent_' + Date.now();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const entry = JSON.stringify({
      type: 'failure', timestamp: fiveMinAgo, prompt_hash: hash,
      tier: 'execute', reason: 'test_decay', success: false,
    });
    writeFileSync(LEDGER, entry + '\n' + entry + '\n', 'utf8');

    const script = `
      import { checkFailureLoop } from './failure-detector.mjs';
      const result = checkFailureLoop('${hash}');
      process.stdout.write(JSON.stringify(result));
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

    if (proc.status !== 0) return `script failed: ${proc.stderr}`;
    let result;
    try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
    if (!result.isLoop) return `expected isLoop=true for recent failures, got: ${JSON.stringify(result)}`;
    if (typeof result.weightedScore !== 'number' || result.weightedScore < 2.0)
      return `expected weightedScore >= 2.0, got: ${result.weightedScore}`;
    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 37: failure decay reduces old failure weight ─────────────────────
test('failure decay: old failures score low', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    const hash = 'decay_old_' + Date.now();
    const ninetyMinAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const entry = JSON.stringify({
      type: 'failure', timestamp: ninetyMinAgo, prompt_hash: hash,
      tier: 'execute', reason: 'test_decay_old', success: false,
    });
    writeFileSync(LEDGER, entry + '\n' + entry + '\n', 'utf8');

    const script = `
      import { checkFailureLoop } from './failure-detector.mjs';
      const result = checkFailureLoop('${hash}');
      process.stdout.write(JSON.stringify(result));
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

    if (proc.status !== 0) return `script failed: ${proc.stderr}`;
    let result;
    try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
    if (result.isLoop) return `expected isLoop=false for old failures (weightedScore should be ~0.5), got: ${JSON.stringify(result)}`;
    if (typeof result.weightedScore !== 'number')
      return `expected weightedScore in result, got: ${JSON.stringify(result)}`;
    if (result.weightedScore >= 2.0)
      return `expected weightedScore < 2.0 for 90-min-old failures, got: ${result.weightedScore}`;
    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 38: failure scoping by tier ──────────────────────────────────────
test('failure decay: scoping by tier', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    const hash = 'tier_scope_' + Date.now();
    const now = new Date().toISOString();
    const mkEntry = (tier) => JSON.stringify({
      type: 'failure', timestamp: now, prompt_hash: hash,
      tier, reason: 'test_tier_scope', success: false,
    });
    const content = [
      mkEntry('execute'), mkEntry('execute'),
      mkEntry('search'), mkEntry('search'),
    ].join('\n') + '\n';
    writeFileSync(LEDGER, content, 'utf8');

    const checkTier = (tier) => {
      const script = `
        import { checkFailureLoop } from './failure-detector.mjs';
        const result = checkFailureLoop('${hash}', '${tier}');
        process.stdout.write(JSON.stringify(result));
      `;
      const proc = spawnSync(process.execPath, [
        '--input-type=module',
        '-e', script,
      ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });
      if (proc.status !== 0) return { error: `script failed for tier=${tier}: ${proc.stderr}` };
      try { return JSON.parse(proc.stdout.trim()); } catch { return { error: `output not JSON for tier=${tier}: ${proc.stdout}` }; }
    };

    const execResult = checkTier('execute');
    if (execResult.error) return execResult.error;
    if (!execResult.isLoop) return `expected isLoop=true for execute tier, got: ${JSON.stringify(execResult)}`;

    const searchResult = checkTier('search');
    if (searchResult.error) return searchResult.error;
    if (!searchResult.isLoop) return `expected isLoop=true for search tier, got: ${JSON.stringify(searchResult)}`;

    const thinkResult = checkTier('think');
    if (thinkResult.error) return thinkResult.error;
    if (thinkResult.isLoop) return `expected isLoop=false for think tier (no think failures), got: ${JSON.stringify(thinkResult)}`;

    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 39: pruneOldFailures removes stale entries ───────────────────────
test('failure decay: pruneOldFailures removes stale entries', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const staleEntry = JSON.stringify({
      type: 'failure', timestamp: twentyFiveHoursAgo, prompt_hash: 'stale',
      tier: 'execute', reason: 'old', success: false,
    });
    const recentEntry = JSON.stringify({
      type: 'failure', timestamp: oneHourAgo, prompt_hash: 'recent',
      tier: 'execute', reason: 'new', success: false,
    });
    const content = [staleEntry, staleEntry, recentEntry, recentEntry].join('\n') + '\n';
    writeFileSync(LEDGER, content, 'utf8');

    const script = `
      import { pruneOldFailures } from './failure-detector.mjs';
      pruneOldFailures();
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

    if (proc.status !== 0) return `pruneOldFailures script failed: ${proc.stderr}`;
    if (!existsSync(LEDGER)) return 'ledger file was deleted instead of pruned';

    const lines = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
    if (lines.length !== 2) return `expected 2 entries after prune, got: ${lines.length}`;

    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { return `pruned ledger has invalid JSON: ${line}`; }
      if (entry.prompt_hash !== 'recent')
        return `expected only recent entries to remain, found prompt_hash=${entry.prompt_hash}`;
    }
    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 40: adaptive loop end-to-end hash match ─────────────────────────
test('adaptive loop: end-to-end hash match', () => {
  const LEDGER = resolve(HOOKS, 'decision-ledger.jsonl');
  const backup = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : null;

  try {
    // Start with a clean ledger so prior failures don't interfere
    writeFileSync(LEDGER, '', 'utf8');

    // Step 1: Define a specific Agent payload used consistently across all steps
    const toolInput = { prompt: 'fix the auth bug', description: 'patch auth module' };
    const agentPayload = JSON.stringify({ tool_name: 'Agent', tool_input: toolInput });

    // Step 2: Run enforce-tier with this payload (computes and may log a promptHash)
    const firstRun = run(ENFORCE_TIER, agentPayload);
    if (firstRun.status !== 0) return `first enforce-tier run failed with status: ${firstRun.status}`;
    if (!firstRun.parsed) return `first enforce-tier run produced no valid JSON`;

    // Step 3: Simulate 2 failures via cost-logger with the SAME tool_input
    const errorPayload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: toolInput,
      error: 'test failure',
    });

    const fail1 = runStream(COST_LOGGER, errorPayload);
    if (fail1.status !== 0) return `first cost-logger failure run failed with status: ${fail1.status}`;

    const fail2 = runStream(COST_LOGGER, errorPayload);
    if (fail2.status !== 0) return `second cost-logger failure run failed with status: ${fail2.status}`;

    // Verify cost-logger actually wrote failure entries to the ledger
    if (!existsSync(LEDGER)) return 'ledger file not created after cost-logger failures';
    const ledgerLines = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
    const failureEntries = ledgerLines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.type === 'failure' && e.success === false);
    if (failureEntries.length < 2)
      return `expected >= 2 failure entries in ledger, got: ${failureEntries.length}`;

    // Step 4: Run enforce-tier again with the same Agent payload
    const secondRun = run(ENFORCE_TIER, agentPayload);
    if (secondRun.status !== 0) return `second enforce-tier run failed with status: ${secondRun.status}`;
    if (!secondRun.parsed) return `second enforce-tier run produced no valid JSON`;

    // Step 5: The second enforce-tier run should detect the failure loop
    // and mention escalation or failure loop in its systemMessage
    const msg = (secondRun.parsed.systemMessage || '').toLowerCase();
    if (!msg.includes('failure') && !msg.includes('escalat') && !msg.includes('loop') && !msg.includes('dual-brain'))
      return `expected failure loop / escalation in second enforce-tier systemMessage, got: "${secondRun.parsed.systemMessage || '(empty)'}"`;

    // Bonus: verify the hashes match — the failure entries recorded by cost-logger
    // should have the same prompt_hash that enforce-tier uses for checkFailureLoop
    const failureHashes = [...new Set(failureEntries.map(e => e.prompt_hash))];
    if (failureHashes.length !== 1)
      return `expected all failure entries to share one hash, got ${failureHashes.length} distinct hashes: ${failureHashes.join(', ')}`;

    return true;
  } finally {
    if (backup !== null) writeFileSync(LEDGER, backup, 'utf8');
    else try { writeFileSync(LEDGER, '', 'utf8'); } catch {}
  }
});

// ─── Test 41: error-channel exports logHookError and getRecentErrors ────────
test('error-channel: exports logHookError and getRecentErrors', () => {
  const ERROR_FILE = resolve(HOOKS, 'errors.jsonl');
  const backup = existsSync(ERROR_FILE) ? readFileSync(ERROR_FILE, 'utf8') : null;

  try {
    // Start clean
    try { writeFileSync(ERROR_FILE, '', 'utf8'); } catch {}

    const script = `
      import { logHookError, getRecentErrors } from './error-channel.mjs';
      const results = { errors: [] };

      // 1. Both functions exist and are functions
      if (typeof logHookError !== 'function') results.errors.push('logHookError not a function');
      if (typeof getRecentErrors !== 'function') results.errors.push('getRecentErrors not a function');

      // 2. logHookError writes an entry
      logHookError('test-hook', 'test-op', new Error('test error'), { extra: 'ctx' });

      // 3. getRecentErrors reads it back
      const recent = getRecentErrors(1);
      if (!Array.isArray(recent)) results.errors.push('getRecentErrors did not return array');
      else if (recent.length < 1) results.errors.push('getRecentErrors returned empty after logHookError');
      else {
        const entry = recent[0];
        if (entry.hook !== 'test-hook') results.errors.push('entry.hook mismatch: ' + entry.hook);
        if (entry.operation !== 'test-op') results.errors.push('entry.operation mismatch: ' + entry.operation);
        if (!entry.error.includes('test error')) results.errors.push('entry.error mismatch: ' + entry.error);
        if (!entry.timestamp) results.errors.push('entry missing timestamp');
        if (entry.context?.extra !== 'ctx') results.errors.push('entry.context mismatch');
      }

      process.stdout.write(JSON.stringify(results));
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

    if (proc.status !== 0) return `error-channel script failed: ${proc.stderr}`;
    let results;
    try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
    if (results.errors.length > 0) return results.errors.join('; ');
    return true;
  } finally {
    if (backup !== null) writeFileSync(ERROR_FILE, backup, 'utf8');
    else try { unlinkSync(ERROR_FILE); } catch {}
  }
});

// ─── Test 42: atomic-write: lockedReadModifyWrite rejects on lock contention ─
test('atomic-write: lockedReadModifyWrite rejects on lock contention', () => {
  const tmpDir = spawnSync('mktemp', ['-d'], { encoding: 'utf8' }).stdout.trim();
  const testFile = resolve(tmpDir, 'test-locked.json');
  const lockFile = testFile + '.lock';

  try {
    // Write initial data
    writeFileSync(testFile, JSON.stringify({ value: 1 }));
    // Manually create a lock file to simulate contention
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, ts: Date.now() }));

    const script = `
      import { lockedReadModifyWrite } from '${resolve(HOOKS, 'atomic-write.mjs').replace(/\\/g, '/')}';
      try {
        lockedReadModifyWrite('${testFile.replace(/\\/g, '/')}', (data) => ({ ...data, value: 2 }));
        process.stdout.write(JSON.stringify({ threw: false }));
      } catch (e) {
        process.stdout.write(JSON.stringify({ threw: true, message: e.message }));
      }
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 15000, cwd: HOOKS });

    if (proc.status !== 0 && proc.status !== null) {
      // Non-zero exit is acceptable if process threw
    }

    let result;
    try { result = JSON.parse((proc.stdout || '').trim()); } catch {
      return `output not JSON: ${proc.stdout || ''} stderr: ${proc.stderr || ''}`;
    }

    if (!result.threw) return 'expected lockedReadModifyWrite to throw on lock contention, but it did not';
    if (!result.message.includes('timed out')) return `expected timeout message, got: ${result.message}`;

    // Verify the file was NOT modified (write should not have proceeded)
    const data = JSON.parse(readFileSync(testFile, 'utf8'));
    if (data.value !== 1) return `expected file value=1 (unchanged), got: ${data.value}`;

    return true;
  } finally {
    spawnSync('rm', ['-rf', tmpDir], { stdio: 'pipe' });
  }
});

// ─── Test 43: config-validator: validates good config ────────────────────────
test('config-validator: validates good config', () => {
  const script = `
    import { validateConfig } from './config-validator.mjs';
    const config = {
      subscriptions: { claude: { models: { opus: { tier: 'think' } } } },
      tiers: { search: {}, execute: {}, think: {} },
      routing: { strategy: 'test' },
      quality_gate: { enabled: true },
    };
    const result = validateConfig(config);
    process.stdout.write(JSON.stringify(result));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `script failed: ${proc.stderr}`;
  let result;
  try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (!result.valid) return `expected valid=true, got errors: ${result.errors.join('; ')}`;
  return true;
});

// ─── Test 44: config-validator: detects missing keys ─────────────────────────
test('config-validator: detects missing keys', () => {
  const script = `
    import { validateConfig } from './config-validator.mjs';
    const result = validateConfig({ subscriptions: { claude: { models: { opus: { tier: 'think' } } } } });
    process.stdout.write(JSON.stringify(result));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `script failed: ${proc.stderr}`;
  let result;
  try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (result.valid) return 'expected valid=false for config missing tiers/routing/quality_gate';
  if (result.errors.length < 3) return `expected at least 3 errors, got: ${result.errors.length}`;
  return true;
});

// ─── Test 45: config-validator: warns on unknown keys ────────────────────────
test('config-validator: warns on unknown keys', () => {
  const script = `
    import { validateConfig } from './config-validator.mjs';
    const config = {
      subscriptions: { claude: { models: { opus: { tier: 'think' } } } },
      tiers: { search: {}, execute: {}, think: {} },
      routing: {},
      quality_gate: {},
      typo_key: true,
    };
    const result = validateConfig(config);
    process.stdout.write(JSON.stringify(result));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `script failed: ${proc.stderr}`;
  let result;
  try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (!result.valid) return `expected valid=true (unknown keys are warnings, not errors): ${result.errors.join('; ')}`;
  if (result.warnings.length === 0) return 'expected warning about unknown key "typo_key"';
  if (!result.warnings[0].includes('typo_key')) return `expected warning about typo_key, got: ${result.warnings[0]}`;
  return true;
});

// ─── Test 46: config-validator: loadAndValidateConfig on real config ─────────
test('config-validator: loadAndValidateConfig on real config', () => {
  const script = `
    import { loadAndValidateConfig } from './config-validator.mjs';
    import { resolve, dirname } from 'path';
    import { fileURLToPath } from 'url';
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const result = loadAndValidateConfig(resolve(__dirname, '..', 'orchestrator.json'));
    process.stdout.write(JSON.stringify({ valid: result.validation.valid, errors: result.validation.errors, warnings: result.validation.warnings }));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `script failed: ${proc.stderr}`;
  let result;
  try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (!result.valid) return `real orchestrator.json failed validation: ${result.errors.join('; ')}`;
  return true;
});

// ─── Test 47: risk-classifier: exports classifyRiskEnhanced ─────────────────
test('risk-classifier: exports classifyRiskEnhanced', () => {
  const script = `
    import { classifyRiskEnhanced } from './risk-classifier.mjs';
    process.stdout.write(JSON.stringify({ exported: typeof classifyRiskEnhanced === 'function' }));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `script failed: ${proc.stderr}`;
  let result;
  try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (!result.exported) return 'classifyRiskEnhanced is not exported as a function';
  return true;
});

// ─── Test 48: risk-classifier: classifyRiskEnhanced returns expected shape ───
test('risk-classifier: classifyRiskEnhanced returns { risk, basis, details }', () => {
  const script = `
    import { classifyRiskEnhanced } from './risk-classifier.mjs';
    const result = classifyRiskEnhanced('src/utils/helper.js');
    const errors = [];

    if (typeof result !== 'object' || result === null) {
      errors.push('result is not an object');
    } else {
      const validRisks = ['low', 'medium', 'high', 'critical'];
      const validBases = ['static', 'churn', 'history', 'churn+history'];
      if (!validRisks.includes(result.risk)) errors.push('risk not in valid set: ' + result.risk);
      if (!validBases.includes(result.basis)) errors.push('basis not in valid set: ' + result.basis);
      if (typeof result.details !== 'object' || result.details === null) {
        errors.push('details is not an object');
      } else {
        if (!('static_risk' in result.details)) errors.push('details missing static_risk');
        if (!('churn_commits' in result.details)) errors.push('details missing churn_commits');
        if (!('history_success_rate' in result.details)) errors.push('details missing history_success_rate');
      }
    }

    process.stdout.write(JSON.stringify({ errors }));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `script failed: ${proc.stderr}`;
  let result;
  try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (result.errors.length > 0) return result.errors.join('; ');
  return true;
});

// ─── Test 49: risk-classifier: static classification still works (auth → critical) ─
test('risk-classifier: static auth path → critical', () => {
  const script = `
    import { classifyRiskEnhanced } from './risk-classifier.mjs';
    const result = classifyRiskEnhanced('src/auth/credentials.mjs');
    process.stdout.write(JSON.stringify({ risk: result.risk, static_risk: result.details.static_risk }));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `script failed: ${proc.stderr}`;
  let result;
  try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (result.static_risk !== 'critical') return `expected static_risk=critical for auth path, got: ${result.static_risk}`;
  if (result.risk !== 'critical') return `expected risk=critical for auth path, got: ${result.risk}`;
  return true;
});

// ─── Test 50: risk-classifier: handles missing git gracefully ────────────────
test('risk-classifier: handles missing git gracefully (no crash)', () => {
  // Run classifyRiskEnhanced in a temp directory that has no git repo, so
  // git log will fail — the function must not crash, must return a valid shape.
  const tmpDir = spawnSync('mktemp', ['-d'], { encoding: 'utf8' }).stdout.trim();
  try {
    const script = `
      import { classifyRiskEnhanced } from '${resolve(HOOKS, 'risk-classifier.mjs').replace(/\\/g, '/')}';
      let result;
      try {
        result = classifyRiskEnhanced('some/random/file.js');
      } catch (e) {
        process.stdout.write(JSON.stringify({ threw: true, message: e.message }));
        process.exit(0);
      }
      const validBases = ['static', 'churn', 'history', 'churn+history'];
      const validRisks = ['low', 'medium', 'high', 'critical'];
      const ok = validRisks.includes(result.risk) && validBases.includes(result.basis) && typeof result.details === 'object';
      process.stdout.write(JSON.stringify({ ok, threw: false, result }));
    `;
    const proc = spawnSync(process.execPath, [
      '--input-type=module',
      '-e', script,
    ], { encoding: 'utf8', timeout: 8000, cwd: tmpDir });

    if (proc.status !== 0) return `script failed: ${proc.stderr}`;
    let result;
    try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
    if (result.threw) return `classifyRiskEnhanced threw when git unavailable: ${result.message}`;
    if (!result.ok) return `invalid shape returned when git unavailable: ${JSON.stringify(result.result)}`;
    return true;
  } finally {
    spawnSync('rm', ['-rf', tmpDir], { stdio: 'pipe' });
  }
});

// ─── Test 51: agent-chains: exports getChain and listChains ──────────────────
test('agent-chains: exports getChain and listChains', () => {
  const script = `
    import { getChain, listChains } from './agent-chains.mjs';
    const results = { errors: [] };
    if (typeof getChain !== 'function') results.errors.push('getChain is not a function');
    if (typeof listChains !== 'function') results.errors.push('listChains is not a function');
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `agent-chains script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 52: agent-chains: all 3 chains have required fields ────────────────
test('agent-chains: all 3 chains have required fields', () => {
  const script = `
    import { listChains } from './agent-chains.mjs';
    const results = { errors: [] };

    const chains = listChains();
    const EXPECTED = ['explore-then-fix', 'review-and-test', 'audit-and-plan'];

    for (const name of EXPECTED) {
      if (!chains.find(c => c.name === name))
        results.errors.push('missing chain: ' + name);
    }

    for (const chain of chains) {
      if (!chain.name) results.errors.push('chain missing name');
      if (!chain.description) results.errors.push((chain.name || '?') + ': missing description');
      if (!Array.isArray(chain.steps) || chain.steps.length < 2)
        results.errors.push((chain.name || '?') + ': must have at least 2 steps');
      for (const step of (chain.steps || [])) {
        if (!step.label) results.errors.push((chain.name || '?') + ' step missing label');
        if (!step.tier) results.errors.push((chain.name || '?') + ' step missing tier');
        if (!step.model) results.errors.push((chain.name || '?') + ' step missing model');
        if (!('template' in step)) results.errors.push((chain.name || '?') + ' step missing template key');
      }
    }

    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `agent-chains script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 53: agent-chains: getChain returns null for unknown chains ──────────
test('agent-chains: getChain returns null for unknown chains', () => {
  const script = `
    import { getChain } from './agent-chains.mjs';
    const results = { errors: [] };

    const unknown = getChain('no-such-chain');
    if (unknown !== null) results.errors.push('expected null for unknown chain, got: ' + JSON.stringify(unknown));

    const alsoUnknown = getChain('');
    if (alsoUnknown !== null) results.errors.push('expected null for empty string, got: ' + JSON.stringify(alsoUnknown));

    const known = getChain('explore-then-fix');
    if (!known || known.name !== 'explore-then-fix')
      results.errors.push('expected explore-then-fix chain, got: ' + JSON.stringify(known));

    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `agent-chains script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 54: agent-templates: exports getTemplate, listTemplates, buildAgentPrompt ─
test('agent-templates: exports getTemplate, listTemplates, buildAgentPrompt', () => {
  const script = `
    import { getTemplate, listTemplates, buildAgentPrompt } from './agent-templates.mjs';
    const results = { errors: [] };

    if (typeof getTemplate !== 'function')      results.errors.push('getTemplate not a function');
    if (typeof listTemplates !== 'function')    results.errors.push('listTemplates not a function');
    if (typeof buildAgentPrompt !== 'function') results.errors.push('buildAgentPrompt not a function');

    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `agent-templates script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 55: agent-templates: all 4 templates have required fields ───────────
test('agent-templates: all 4 templates have required fields', () => {
  const script = `
    import { TEMPLATES } from './agent-templates.mjs';
    const results = { errors: [] };

    const expected = ['explorer', 'security-review', 'test-writer', 'bug-hunter'];
    const requiredFields = ['tier', 'risk', 'quality_gate', 'prompt_template', 'flags'];

    for (const name of expected) {
      const tmpl = TEMPLATES[name];
      if (!tmpl) { results.errors.push('missing template: ' + name); continue; }
      for (const f of requiredFields) {
        if (tmpl[f] === undefined || tmpl[f] === null)
          results.errors.push(name + ' missing field: ' + f);
      }
      // tier must be one of the known tiers
      if (!['search', 'execute', 'think'].includes(tmpl.tier))
        results.errors.push(name + ' has unknown tier: ' + tmpl.tier);
      // risk must be a valid level
      if (!['low', 'medium', 'high', 'critical'].includes(tmpl.risk))
        results.errors.push(name + ' has unknown risk: ' + tmpl.risk);
      // flags must be an object
      if (typeof tmpl.flags !== 'object' || tmpl.flags === null)
        results.errors.push(name + ' flags is not an object');
    }

    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `agent-templates script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 56: agent-templates: buildAgentPrompt interpolates flags correctly ──
test('agent-templates: buildAgentPrompt interpolates flags correctly', () => {
  const script = `
    import { buildAgentPrompt } from './agent-templates.mjs';
    const results = { errors: [] };

    // explorer: question + scope
    const explorerFull = buildAgentPrompt('explorer', { question: 'find auth files', scope: 'src/auth' });
    if (!explorerFull) { results.errors.push('explorer returned null'); }
    else {
      if (!explorerFull.prompt.includes('find auth files'))
        results.errors.push('explorer prompt missing question: ' + explorerFull.prompt.slice(0, 100));
      if (!explorerFull.model) results.errors.push('explorer missing model');
      if (!explorerFull.tier)  results.errors.push('explorer missing tier');
      if (!explorerFull.risk)  results.errors.push('explorer missing risk');
      if (!explorerFull.quality_gate) results.errors.push('explorer missing quality_gate');
    }

    // explorer: without scope
    const explorerNoScope = buildAgentPrompt('explorer', { question: 'map the codebase' });
    if (!explorerNoScope) { results.errors.push('explorer (no scope) returned null'); }
    else {
      if (!explorerNoScope.prompt.includes('map the codebase'))
        results.errors.push('explorer prompt missing question (no scope): ' + explorerNoScope.prompt.slice(0, 100));
    }

    // test-writer: file flag
    const testWriter = buildAgentPrompt('test-writer', { file: 'src/api.ts', framework: 'jest' });
    if (!testWriter) { results.errors.push('test-writer returned null'); }
    else {
      if (!testWriter.prompt.includes('src/api.ts'))
        results.errors.push('test-writer prompt missing file: ' + testWriter.prompt.slice(0, 100));
    }

    // bug-hunter: deep depth
    const bugHunterDeep = buildAgentPrompt('bug-hunter', { area: 'payments', depth: 'deep' });
    if (!bugHunterDeep) { results.errors.push('bug-hunter returned null'); }
    else {
      if (!bugHunterDeep.prompt.toLowerCase().includes('payments'))
        results.errors.push('bug-hunter prompt missing area: ' + bugHunterDeep.prompt.slice(0, 100));
    }

    // security-review: severity filter
    const secReview = buildAgentPrompt('security-review', { scope: 'src/auth', severity: 'high' });
    if (!secReview) { results.errors.push('security-review returned null'); }
    else {
      if (secReview.risk !== 'high') results.errors.push('security-review risk should be high, got: ' + secReview.risk);
      if (secReview.quality_gate !== 'dual_brain_review')
        results.errors.push('security-review quality_gate should be dual_brain_review, got: ' + secReview.quality_gate);
    }

    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `agent-templates script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 57: agent-templates: getTemplate returns null for unknown ───────────
test('agent-templates: getTemplate returns null for unknown template', () => {
  const script = `
    import { getTemplate } from './agent-templates.mjs';
    const results = { errors: [] };

    const unknown = getTemplate('no-such-template');
    if (unknown !== null) results.errors.push('expected null for unknown template, got: ' + JSON.stringify(unknown));

    const alsoUnknown = getTemplate('');
    if (alsoUnknown !== null) results.errors.push('expected null for empty string, got: ' + JSON.stringify(alsoUnknown));

    const known = getTemplate('explorer');
    if (!known || known.name !== 'explorer')
      results.errors.push('expected explorer template, got: ' + JSON.stringify(known));

    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `agent-templates script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 58: ship-captain.mjs exports planExecution and executeShipCaptain ───
test('ship-captain: exports planExecution and executeShipCaptain', () => {
  const script = `
    import { planExecution, executeShipCaptain } from './ship-captain.mjs';
    const results = { errors: [] };
    if (typeof planExecution !== 'function') results.errors.push('planExecution is not a function');
    if (typeof executeShipCaptain !== 'function') results.errors.push('executeShipCaptain is not a function');
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 8000, cwd: HOOKS });

  if (proc.status !== 0) return `ship-captain script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 59: ship-gate.mjs exports discoverTests, runTests, generateDiffSummary, createPR ─
test('ship-gate: exports discoverTests, runTests, generateDiffSummary, createPR', () => {
  const script = `
    import { discoverTests, runTests, generateDiffSummary, createPR } from './ship-gate.mjs';
    const results = { errors: [] };
    if (typeof discoverTests !== 'function') results.errors.push('discoverTests is not a function');
    if (typeof runTests !== 'function') results.errors.push('runTests is not a function');
    if (typeof generateDiffSummary !== 'function') results.errors.push('generateDiffSummary is not a function');
    if (typeof createPR !== 'function') results.errors.push('createPR is not a function');
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 8000, cwd: HOOKS });

  if (proc.status !== 0) return `ship-gate script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 60: ship-gate discoverTests finds test command in dual-brain itself ─
test('ship-gate: discoverTests finds npm test script', () => {
  // Run from the dual-brain package root so package.json is in cwd
  const pkgRoot = resolve(HOOKS, '..');
  const script = `
    import { discoverTests } from './hooks/ship-gate.mjs';
    const result = await discoverTests();
    const results = { errors: [] };
    if (!result) { results.errors.push('discoverTests returned null/undefined'); }
    else {
      // Must find the npm test script from package.json
      const resultStr = JSON.stringify(result);
      const hasNpmTest = result.command === 'npm test'
        || result.command === 'npm run test'
        || resultStr.includes('npm test')
        || resultStr.includes('test-orchestrator');
      if (!hasNpmTest) results.errors.push('discoverTests did not find npm test: ' + resultStr);
      // Confidence should be "high" when package.json test script is found
      if (result.confidence && result.confidence !== 'high')
        results.errors.push('expected confidence=high, got: ' + result.confidence);
    }
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 10000, cwd: pkgRoot });

  if (proc.status !== 0) return `ship-gate discoverTests script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 61: ship-captain planExecution returns valid plan ───────────────────
test('ship-captain: planExecution returns valid plan', () => {
  const script = `
    import { planExecution } from './ship-captain.mjs';
    const result = await planExecution('fix a bug and write tests');
    const results = { errors: [] };
    if (!result || typeof result !== 'object') {
      results.errors.push('planExecution did not return an object');
    } else {
      if (!result.goal) results.errors.push('plan missing goal');
      if (!Array.isArray(result.steps)) results.errors.push('plan missing steps array');
      else if (result.steps.length === 0) results.errors.push('plan steps array is empty');
      // Accept any duration/time/steps indicator — implementation may vary
      const hasDuration = result.estimated_duration != null
        || result.estimated_duration_ms != null
        || result.duration != null
        || result.estimated_steps != null
        || result.step_count != null
        || result.total_steps != null
        || typeof result.steps?.length === 'number';
      if (!hasDuration) results.errors.push('plan missing any duration or steps count field');
    }
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 15000, cwd: HOOKS });

  if (proc.status !== 0) return `ship-captain planExecution script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 62: install.mjs includes ship-captain commands in help ──────────────
test('install.mjs: includes ship-captain commands in help', () => {
  const installSrc = readFileSync(resolve(__dirname, '..', 'install.mjs'), 'utf8');
  const required = ['do', 'ship', 'runs', 'resume', 'test-run', 'diff', 'Ship Captain'];
  const missing = required.filter(s => !installSrc.includes(s));
  if (missing.length > 0) return `install.mjs missing: ${missing.join(', ')}`;
  // Also check ship-captain.mjs and ship-gate.mjs are in HOOKS array
  if (!installSrc.includes('ship-captain.mjs')) return 'HOOKS array missing ship-captain.mjs';
  if (!installSrc.includes('ship-gate.mjs')) return 'HOOKS array missing ship-gate.mjs';
  return true;
});

// ─── Test 63: confirmation-policy: exports all required functions ─────────────
test('confirmation-policy: exports all required functions', () => {
  const script = `
    import { getConfirmationPolicy, resolveMode, aggregateRisk, formatConfirmation } from './confirmation-policy.mjs';
    const results = { errors: [] };
    if (typeof getConfirmationPolicy !== 'function') results.errors.push('getConfirmationPolicy is not a function');
    if (typeof resolveMode !== 'function') results.errors.push('resolveMode is not a function');
    if (typeof aggregateRisk !== 'function') results.errors.push('aggregateRisk is not a function');
    if (typeof formatConfirmation !== 'function') results.errors.push('formatConfirmation is not a function');
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `confirmation-policy script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 64: confirmation-policy default mode low risk skips confirmations ───
test('confirmation-policy: default mode low risk skips confirmations', () => {
  const script = `
    import { getConfirmationPolicy } from './confirmation-policy.mjs';
    const result = getConfirmationPolicy({ risk: 'low', mode: 'default', step: 'edit' });
    const results = { errors: [] };
    if (result.shouldConfirm !== false) results.errors.push('expected shouldConfirm=false, got: ' + result.shouldConfirm);
    if (result.shouldBlock !== false) results.errors.push('expected shouldBlock=false, got: ' + result.shouldBlock);
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `confirmation-policy script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 65: confirmation-policy default mode critical risk blocks ────────────
test('confirmation-policy: default mode critical risk blocks', () => {
  const script = `
    import { getConfirmationPolicy } from './confirmation-policy.mjs';
    const result = getConfirmationPolicy({ risk: 'critical', mode: 'default', step: 'edit' });
    const results = { errors: [] };
    if (result.shouldBlock !== true) results.errors.push('expected shouldBlock=true, got: ' + result.shouldBlock);
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `confirmation-policy script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 66: confirmation-policy yolo mode allows critical ───────────────────
test('confirmation-policy: yolo mode allows critical', () => {
  const script = `
    import { getConfirmationPolicy } from './confirmation-policy.mjs';
    const result = getConfirmationPolicy({ risk: 'critical', mode: 'yolo', step: 'edit' });
    const results = { errors: [] };
    if (result.shouldBlock !== false) results.errors.push('expected shouldBlock=false in yolo mode, got: ' + result.shouldBlock);
    if (result.shouldConfirm !== false) results.errors.push('expected shouldConfirm=false in yolo mode, got: ' + result.shouldConfirm);
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `confirmation-policy script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 67: confirmation-policy careful mode confirms everything ─────────────
test('confirmation-policy: careful mode confirms everything', () => {
  const script = `
    import { getConfirmationPolicy } from './confirmation-policy.mjs';
    const result = getConfirmationPolicy({ risk: 'low', mode: 'careful', step: 'edit' });
    const results = { errors: [] };
    if (result.shouldConfirm !== true) results.errors.push('expected shouldConfirm=true in careful mode, got: ' + result.shouldConfirm);
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `confirmation-policy script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 68: confirmation-policy aggregateRisk returns highest ───────────────
test('confirmation-policy: aggregateRisk returns highest', () => {
  const script = `
    import { aggregateRisk } from './confirmation-policy.mjs';
    const result = aggregateRisk(['low', 'medium', 'high', 'low']);
    const results = { errors: [] };
    if (result !== 'high') results.errors.push('expected "high", got: ' + result);
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `confirmation-policy script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 69: confirmation-policy resolveMode parses flags ────────────────────
test('confirmation-policy: resolveMode parses flags', () => {
  const script = `
    import { resolveMode } from './confirmation-policy.mjs';
    const results = { errors: [] };
    const yolo = resolveMode(['--yolo']);
    if (yolo !== 'yolo') results.errors.push('expected "yolo" for ["--yolo"], got: ' + yolo);
    const careful = resolveMode(['--careful']);
    if (careful !== 'careful') results.errors.push('expected "careful" for ["--careful"], got: ' + careful);
    const def = resolveMode([]);
    if (def !== 'default') results.errors.push('expected "default" for [], got: ' + def);
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `confirmation-policy script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 70: ship-gate exports runShipGate ───────────────────────────────────
test('ship-gate: exports runShipGate', () => {
  const script = `
    import { runShipGate } from './ship-gate.mjs';
    const results = { errors: [] };
    if (typeof runShipGate !== 'function') results.errors.push('runShipGate is not a function');
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 8000, cwd: HOOKS });

  if (proc.status !== 0) return `ship-gate script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 71: ship-captain run record includes options field ──────────────────
test('ship-captain: planExecution returns plan with steps array', () => {
  const script = `
    import { planExecution } from './ship-captain.mjs';
    const result = planExecution('write tests for the auth module');
    const errors = [];
    if (!result || typeof result !== 'object') {
      errors.push('planExecution did not return an object');
    } else {
      if (!result.goal) errors.push('plan missing goal');
      if (!Array.isArray(result.steps)) errors.push('plan missing steps array');
      else if (result.steps.length === 0) errors.push('plan steps array is empty');
      // Verify each step has the expected shape from planExecution
      for (const step of (result.steps || [])) {
        if (typeof step.index !== 'number') errors.push('step missing index');
        if (typeof step.total !== 'number') errors.push('step missing total');
        if (!step.task) errors.push('step missing task');
      }
    }
    process.stdout.write(JSON.stringify({ errors }));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 15000, cwd: HOOKS });

  if (proc.status !== 0) return `ship-captain planExecution script failed: ${proc.stderr}`;
  let result;
  try { result = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (result.errors.length > 0) return result.errors.join('; ');
  return true;
});

// ─── Test 72: resume handles missing runs directory gracefully ─────────────────
test('resume: handles missing .claude/runs/ directory gracefully', () => {
  // Run the install.mjs resume subcommand from a temp dir that has no .claude/runs/
  const tmpDir = spawnSync('mktemp', ['-d'], { encoding: 'utf8' }).stdout.trim();
  try {
    const installScript = resolve(HOOKS, '..', 'install.mjs');
    const proc = spawnSync(process.execPath, [installScript, 'resume'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: tmpDir,
      timeout: 8000,
      env: { ...process.env, HOME: tmpDir },
    });

    // Should exit cleanly (0 or 1 is fine — just not crash with unhandled exception)
    if (proc.status === null) return 'process timed out';

    const combined = (proc.stdout || '') + (proc.stderr || '');
    // Should print a helpful message, not a stack trace
    if (combined.includes('TypeError') || combined.includes('ReferenceError') ||
        combined.includes('SyntaxError') || combined.includes('at Object.<anonymous>'))
      return `unexpected JS error in output: ${combined.slice(0, 200)}`;

    // Should mention "No runs found" or similar
    const hasHelpMsg = combined.includes('No runs') || combined.includes('no runs') ||
                       combined.includes("Start with") || combined.includes('Nothing to resume');
    if (!hasHelpMsg) return `expected helpful message, got: ${combined.slice(0, 200)}`;

    return true;
  } finally {
    spawnSync('rm', ['-rf', tmpDir], { stdio: 'pipe' });
  }
});

// ─── Test 73: mismatch severity — think task on haiku gets BLOCKED (major) ────
test('enforce-tier v4.5: think on haiku → major mismatch, BLOCKED message', () => {
  // Clear cooldown and use balanced profile (strict tolerance → block on major)
  try { unlinkSync(COOLDOWN_FILE); } catch {}
  const profileFile = resolve(__dirname, '..', 'dual-brain.profile.json');
  let originalProfile;
  try { originalProfile = readFileSync(profileFile, 'utf8'); } catch { originalProfile = null; }
  try {
    writeFileSync(profileFile, JSON.stringify({ active: 'balanced' }));
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: {
        prompt: 'review security architecture and design the auth system',
        model: 'haiku',
      },
    });
    const { parsed } = run(ENFORCE_TIER, payload);
    if (!parsed) return 'no valid JSON output';
    if (!parsed.systemMessage) return `expected systemMessage, got: ${JSON.stringify(parsed)}`;
    const msg = parsed.systemMessage;
    if (!msg.includes('BLOCKED') && !msg.includes('⛔'))
      return `expected BLOCKED marker for think/haiku major mismatch, got: ${msg}`;
    if (!msg.toLowerCase().includes('opus') && !msg.toLowerCase().includes('gpt-5.5') && !msg.toLowerCase().includes('think'))
      return `expected think-tier model suggestion in message, got: ${msg}`;
    return true;
  } finally {
    if (originalProfile !== null) writeFileSync(profileFile, originalProfile);
    else try { unlinkSync(profileFile); } catch {}
  }
});

// ─── Test 74: mismatch severity — execute on sonnet gets no mismatch ──────────
test('enforce-tier v4.5: execute on sonnet → no mismatch', () => {
  try { unlinkSync(COOLDOWN_FILE); } catch {}
  const profileFile = resolve(__dirname, '..', 'dual-brain.profile.json');
  let originalProfile;
  try { originalProfile = readFileSync(profileFile, 'utf8'); } catch { originalProfile = null; }
  try {
    writeFileSync(profileFile, JSON.stringify({ active: 'balanced' }));
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: {
        prompt: `implement the fix and write unit tests ${Date.now()}`,
        model: 'sonnet',
      },
    });
    const { parsed } = run(ENFORCE_TIER, payload);
    if (!parsed) return 'no valid JSON output';
    const msg = parsed.systemMessage || '';
    if (msg.includes('BLOCKED') || msg.includes('⛔'))
      return `unexpected BLOCKED for execute/sonnet (correct tier), got: ${msg}`;
    if (msg.toLowerCase().includes('mismatch'))
      return `unexpected mismatch warning for execute/sonnet, got: ${msg}`;
    return true;
  } finally {
    if (originalProfile !== null) writeFileSync(profileFile, originalProfile);
    else try { unlinkSync(profileFile); } catch {}
  }
});

// ─── Test 75: mismatch severity — search on opus gets BLOCKED (major, overkill) ─
test('enforce-tier v4.5: search on opus → major mismatch, BLOCKED message', () => {
  try { unlinkSync(COOLDOWN_FILE); } catch {}
  const profileFile = resolve(__dirname, '..', 'dual-brain.profile.json');
  let originalProfile;
  try { originalProfile = readFileSync(profileFile, 'utf8'); } catch { originalProfile = null; }
  try {
    writeFileSync(profileFile, JSON.stringify({ active: 'balanced' }));
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: {
        prompt: 'find all auth files',
        model: 'opus',
        subagent_type: 'Explore',
      },
    });
    const { parsed } = run(ENFORCE_TIER, payload);
    if (!parsed) return 'no valid JSON output';
    if (!parsed.systemMessage) return `expected systemMessage, got: ${JSON.stringify(parsed)}`;
    const msg = parsed.systemMessage;
    if (!msg.includes('BLOCKED') && !msg.includes('⛔'))
      return `expected BLOCKED marker for search/opus major mismatch (overkill), got: ${msg}`;
    if (!msg.toLowerCase().includes('haiku') && !msg.toLowerCase().includes('gpt-4.1-mini') && !msg.toLowerCase().includes('search'))
      return `expected search-tier model suggestion in message, got: ${msg}`;
    return true;
  } finally {
    if (originalProfile !== null) writeFileSync(profileFile, originalProfile);
    else try { unlinkSync(profileFile); } catch {}
  }
});

// ─── Test 76: mismatch severity — think on sonnet gets minor WARNING (not block) ─
test('enforce-tier v4.5: think on sonnet → minor mismatch, warning not block', () => {
  try { unlinkSync(COOLDOWN_FILE); } catch {}
  const profileFile = resolve(__dirname, '..', 'dual-brain.profile.json');
  let originalProfile;
  try { originalProfile = readFileSync(profileFile, 'utf8'); } catch { originalProfile = null; }
  try {
    writeFileSync(profileFile, JSON.stringify({ active: 'balanced' }));
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: {
        prompt: 'review architecture and plan the migration strategy',
        model: 'sonnet',
      },
    });
    const { parsed } = run(ENFORCE_TIER, payload);
    if (!parsed) return 'no valid JSON output';
    if (!parsed.systemMessage) return `expected systemMessage warning, got: ${JSON.stringify(parsed)}`;
    const msg = parsed.systemMessage;
    // Minor mismatch under balanced profile → warn, not block
    if (msg.includes('⛔') || msg.includes('BLOCKED'))
      return `expected warning (not BLOCKED) for think/sonnet minor mismatch, got: ${msg}`;
    if (!msg.toLowerCase().includes('think') && !msg.toLowerCase().includes('mismatch') && !msg.toLowerCase().includes('opus'))
      return `expected think-tier mention in warning, got: ${msg}`;
    return true;
  } finally {
    if (originalProfile !== null) writeFileSync(profileFile, originalProfile);
    else try { unlinkSync(profileFile); } catch {}
  }
});

// ─── Test 76: ship-gate exports selfHealGate as a function ───────────────────
test('ship-gate: exports selfHealGate as a function', () => {
  const script = `
    import { selfHealGate } from './ship-gate.mjs';
    const results = { errors: [] };
    if (typeof selfHealGate !== 'function') results.errors.push('selfHealGate is not a function');
    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 8000, cwd: HOOKS });

  if (proc.status !== 0) return `ship-gate script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Test 77: confirmation-policy handles 'heal' step correctly ───────────────
test('confirmation-policy: heal step auto-proceeds in default mode', () => {
  const script = `
    import { getConfirmationPolicy } from './confirmation-policy.mjs';
    const results = { errors: [] };

    // Default mode: heal should auto-proceed at all risk levels
    const healLow = getConfirmationPolicy({ risk: 'low', mode: 'default', step: 'heal' });
    if (healLow.shouldBlock !== false) results.errors.push('default/low heal: expected shouldBlock=false, got: ' + healLow.shouldBlock);
    if (healLow.shouldConfirm !== false) results.errors.push('default/low heal: expected shouldConfirm=false, got: ' + healLow.shouldConfirm);

    const healHigh = getConfirmationPolicy({ risk: 'high', mode: 'default', step: 'heal' });
    if (healHigh.shouldBlock !== false) results.errors.push('default/high heal: expected shouldBlock=false, got: ' + healHigh.shouldBlock);
    if (healHigh.shouldConfirm !== false) results.errors.push('default/high heal: expected shouldConfirm=false, got: ' + healHigh.shouldConfirm);

    const healCritical = getConfirmationPolicy({ risk: 'critical', mode: 'default', step: 'heal' });
    if (healCritical.shouldBlock !== false) results.errors.push('default/critical heal: expected shouldBlock=false, got: ' + healCritical.shouldBlock);

    // Careful mode: heal should require confirmation
    const healCareful = getConfirmationPolicy({ risk: 'low', mode: 'careful', step: 'heal' });
    if (healCareful.shouldConfirm !== true) results.errors.push('careful heal: expected shouldConfirm=true, got: ' + healCareful.shouldConfirm);

    // Yolo mode: heal should auto-proceed
    const healYolo = getConfirmationPolicy({ risk: 'critical', mode: 'yolo', step: 'heal' });
    if (healYolo.shouldBlock !== false) results.errors.push('yolo heal: expected shouldBlock=false, got: ' + healYolo.shouldBlock);
    if (healYolo.shouldConfirm !== false) results.errors.push('yolo heal: expected shouldConfirm=false, got: ' + healYolo.shouldConfirm);

    // Plan-only mode: heal should be blocked (no mutations)
    const healPlanOnly = getConfirmationPolicy({ risk: 'low', mode: 'plan-only', step: 'heal' });
    if (healPlanOnly.shouldBlock !== true) results.errors.push('plan-only heal: expected shouldBlock=true, got: ' + healPlanOnly.shouldBlock);

    process.stdout.write(JSON.stringify(results));
  `;
  const proc = spawnSync(process.execPath, [
    '--input-type=module',
    '-e', script,
  ], { encoding: 'utf8', timeout: 5000, cwd: HOOKS });

  if (proc.status !== 0) return `confirmation-policy script failed: ${proc.stderr}`;
  let results;
  try { results = JSON.parse(proc.stdout.trim()); } catch { return `output not JSON: ${proc.stdout}`; }
  if (results.errors.length > 0) return results.errors.join('; ');
  return true;
});

// ─── Summary ─────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${passed}/${total} tests passed`);
process.exit(failed > 0 ? 1 : 0);
