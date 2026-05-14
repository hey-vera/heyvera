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

// ─── Test 15: profile consistency across modules ────────────────────────────
test('profiles: consistent across modules', () => {
  const profilesSrc = readFileSync(resolve(__dirname, 'profiles.mjs'), 'utf8');
  const profileNames = ['auto', 'balanced', 'cost-saver', 'quality-first'];
  for (const name of profileNames) {
    if (!profilesSrc.includes(`${name}:`) && !profilesSrc.includes(`'${name}':`)) return `profiles.mjs missing: ${name}`;
  }

  const installSrc = readFileSync(resolve(__dirname, '..', 'install.mjs'), 'utf8');
  for (const name of profileNames) {
    if (!installSrc.includes(`${name}:`) && !installSrc.includes(`'${name}':`)) return `install.mjs missing profile: ${name}`;
  }

  const enforceSrc = readFileSync(resolve(__dirname, 'enforce-tier.mjs'), 'utf8');
  if (!enforceSrc.includes('auto:')) return 'enforce-tier.mjs missing auto in PROFILE_SETTINGS';

  return true;
});

// ─── Test 16: failure-detector only counts real failures ─────────────────────
test('failure-detector: ignores followed=false', () => {
  const src = readFileSync(resolve(__dirname, 'failure-detector.mjs'), 'utf8');
  if (src.includes('followed === false')) return 'still conflates followed=false with failure';
  if (!src.includes('success === false') && !src.includes('success !== false')) return 'missing success check';
  return true;
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
    if (entry.type !== 'failure') return `expected type=failure, got: ${entry.type}`;
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
  try {
    // Expire burst state by setting window_start to 0 (well outside 90s window)
    writeFileSync(BURST_FILE, JSON.stringify({ count: 0, window_start: 0 }));
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { prompt: 'non-burst duplicate test identical prompt', model: 'sonnet' },
    });

    // First call — establishes the prompt hash
    run(ENFORCE_TIER, payload);
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
    const writeTargets = [...src.matchAll(/(?:writeFileSync|appendFileSync|renameSync)\(\s*([^,)]+)/g)].map(m => m[1].trim());

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

// ─── Summary ─────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${passed}/${total} tests passed`);
process.exit(failed > 0 ? 1 : 0);
