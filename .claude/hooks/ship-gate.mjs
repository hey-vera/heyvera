#!/usr/bin/env node
/**
 * ship-gate.mjs — Ship Gate for dual-brain v4.4.
 *
 * Handles the "ready to ship" phase: test discovery, test execution,
 * diff summarization, and PR creation.
 *
 * Usage:
 *   node hooks/ship-gate.mjs --ship --goal "..." [--run-id <path>] [--yes]
 *   node hooks/ship-gate.mjs --test-only
 *   node hooks/ship-gate.mjs --diff-only
 *   node hooks/ship-gate.mjs --no-pr --goal "..."
 *
 * Exports:
 *   discoverTests()
 *   runTests(options)
 *   generateDiffSummary()
 *   createPR(options)
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, args = [], opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: opts.cwd ?? PKG_ROOT,
    timeout: opts.timeout ?? 60_000,
    ...opts,
  });
}

function git(...args) {
  return run('git', args, { cwd: process.cwd() });
}

function readPkg() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function kebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
}

function elapsed(startMs) {
  const ms = Date.now() - startMs;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ---------------------------------------------------------------------------
// 1. Test Discovery
// ---------------------------------------------------------------------------

/**
 * Discover which test command to run for the current project.
 * @returns {{ command: string|null, framework: string|null, confidence: 'high'|'medium'|'none' }}
 */
export function discoverTests() {
  const cwd = process.cwd();
  const pkg = readPkg();

  // High confidence: package.json has a test script
  if (pkg?.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
    // Detect framework from the script content
    const script = pkg.scripts.test;
    let framework = null;
    if (/jest/.test(script)) framework = 'jest';
    else if (/vitest/.test(script)) framework = 'vitest';
    else if (/mocha/.test(script)) framework = 'mocha';
    else if (/pytest/.test(script)) framework = 'pytest';
    else if (/tap/.test(script)) framework = 'tap';
    else if (/ava/.test(script)) framework = 'ava';
    return { command: 'npm test', framework, confidence: 'high' };
  }

  // Medium confidence: detect framework from devDependencies
  const devDeps = { ...pkg?.devDependencies, ...pkg?.dependencies };
  const frameworks = [
    { key: 'jest', cmd: 'npx jest' },
    { key: 'vitest', cmd: 'npx vitest run' },
    { key: 'mocha', cmd: 'npx mocha' },
    { key: 'ava', cmd: 'npx ava' },
    { key: 'tap', cmd: 'npx tap' },
  ];
  for (const { key, cmd } of frameworks) {
    if (devDeps?.[key]) {
      return { command: cmd, framework: key, confidence: 'medium' };
    }
  }

  // Medium confidence: detect test dirs/files on disk
  const testDirs = ['__tests__', 'tests', 'test'];
  for (const dir of testDirs) {
    if (existsSync(join(cwd, dir))) {
      // Guess jest if node project, else generic
      if (existsSync(join(cwd, 'package.json'))) {
        return { command: 'npx jest', framework: 'jest', confidence: 'medium' };
      }
    }
  }

  // Check for pytest (Python)
  if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'setup.cfg')) || existsSync(join(cwd, 'pyproject.toml'))) {
    return { command: 'pytest', framework: 'pytest', confidence: 'medium' };
  }

  return { command: null, framework: null, confidence: 'none' };
}

// ---------------------------------------------------------------------------
// 2. Test Runner
// ---------------------------------------------------------------------------

/**
 * Run the discovered (or provided) test command.
 * @param {{ command?: string, timeout?: number }} options
 * @returns {{ passed: boolean, exit_code: number, output: string, command_used: string, duration_ms: number }}
 */
export function runTests(options = {}) {
  const discovery = discoverTests();
  const command = options.command ?? discovery.command;

  if (!command) {
    return {
      passed: null,
      exit_code: null,
      output: 'No test command discovered.',
      command_used: null,
      duration_ms: 0,
    };
  }

  const [bin, ...args] = command.split(' ');
  const start = Date.now();
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
    timeout: options.timeout ?? 120_000,
    shell: true,
  });
  const duration_ms = Date.now() - start;
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  return {
    passed: result.status === 0,
    exit_code: result.status ?? 1,
    output,
    command_used: command,
    duration_ms,
  };
}

// ---------------------------------------------------------------------------
// 3. Diff Summary
// ---------------------------------------------------------------------------

/**
 * Summarize git changes since HEAD.
 * @returns {{ files_added: string[], files_modified: string[], files_deleted: string[], stats: string, summary: string }}
 */
export function generateDiffSummary() {
  const statResult = git('diff', '--stat', 'HEAD');
  const nameStatusResult = git('diff', '--name-status', 'HEAD');

  const stats = (statResult.stdout || '').trim().split('\n').pop()?.trim() || 'no changes';

  const files_added = [];
  const files_modified = [];
  const files_deleted = [];

  const nameStatus = (nameStatusResult.stdout || '').trim();
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const status = parts[0];
    const file = parts[parts.length - 1];
    if (!file || typeof file !== 'string') continue;
    if (status.startsWith('A')) files_added.push(file);
    else if (status.startsWith('D')) files_deleted.push(file);
    else files_modified.push(file);
  }

  // Also include untracked files as "added"
  const untrackedResult = git('ls-files', '--others', '--exclude-standard');
  const untracked = (untrackedResult.stdout || '').trim().split('\n').filter(Boolean);
  for (const f of untracked) {
    if (!files_added.includes(f)) files_added.push(f);
  }

  // Build a factual summary from file names
  const total = files_added.length + files_modified.length + files_deleted.length;
  const parts = [];
  if (files_added.length) parts.push(`${files_added.length} file(s) added (${files_added.map(f => basename(f)).join(', ')})`);
  if (files_modified.length) parts.push(`${files_modified.length} file(s) modified (${files_modified.map(f => basename(f)).join(', ')})`);
  if (files_deleted.length) parts.push(`${files_deleted.length} file(s) deleted (${files_deleted.map(f => basename(f)).join(', ')})`);

  const summary = total === 0
    ? 'No changes detected.'
    : parts.join('; ') + '. ' + stats + '.';

  return { files_added, files_modified, files_deleted, stats, summary };
}

// ---------------------------------------------------------------------------
// 4. PR Creation
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  /\.env(\.|$)/i,
  /credentials/i,
  /secrets?\.(json|yaml|yml|toml)/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /\.p12$/i,
];

function checkSensitiveFiles(files) {
  return files.filter(f => SENSITIVE_PATTERNS.some(re => re.test(basename(f))));
}

function getCurrentBranch() {
  const res = git('rev-parse', '--abbrev-ref', 'HEAD');
  return (res.stdout || '').trim();
}

function hasUncommittedChanges() {
  const status = git('status', '--porcelain');
  return (status.stdout || '').trim().length > 0;
}

function confirm(question) {
  // In non-interactive/CI environments, default to yes
  if (!process.stdin.isTTY) return true;
  process.stdout.write(question + ' [y/N] ');
  // Synchronous readline via child_process
  const res = spawnSync('bash', ['-c', 'read ans && echo "$ans"'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
  const answer = (res.stdout || '').trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

/**
 * Create a PR for the current changes.
 * @param {{
 *   goal?: string,
 *   run_id?: string,
 *   yes?: boolean,
 *   no_pr?: boolean,
 *   branch?: string,
 *   test_result?: object,
 *   gate_result?: object,
 *   diff_summary?: object,
 * }} options
 * @returns {{ pr_url?: string, branch: string, commit_hash?: string, error?: string }}
 */
export async function createPR(options = {}) {
  const {
    goal = 'Ship changes',
    run_id,
    yes = false,
    no_pr = false,
    test_result,
    gate_result,
    diff_summary,
  } = options;

  // Check gh CLI
  const ghCheck = run('which', ['gh'], { cwd: process.cwd() });
  const ghAvailable = ghCheck.status === 0;

  // Check remote
  const remoteCheck = git('remote', '-v');
  const hasRemote = (remoteCheck.stdout || '').trim().length > 0;

  // Determine current branch
  const currentBranch = getCurrentBranch();
  const isMainBranch = currentBranch === 'main' || currentBranch === 'master';

  // Create new branch if on main/master
  let targetBranch = currentBranch;
  if (isMainBranch) {
    const slug = kebabCase(goal);
    targetBranch = `dual-brain/${slug}`;
    const branchRes = git('checkout', '-b', targetBranch);
    if (branchRes.status !== 0) {
      return { error: `Failed to create branch ${targetBranch}: ${branchRes.stderr}` };
    }
    console.log(`Created branch: ${targetBranch}`);
  }

  // Check for sensitive files before staging
  const untrackedRes = git('ls-files', '--others', '--exclude-standard');
  const allChangedRes = git('diff', '--name-only', 'HEAD');
  const allFiles = [
    ...(untrackedRes.stdout || '').trim().split('\n').filter(Boolean),
    ...(allChangedRes.stdout || '').trim().split('\n').filter(Boolean),
  ];
  const sensitiveFiles = checkSensitiveFiles(allFiles);
  if (sensitiveFiles.length > 0) {
    console.warn(`\nWARNING: Sensitive files detected — will NOT be staged:\n  ${sensitiveFiles.join('\n  ')}\n`);
  }

  // Check for uncommitted changes
  if (!hasUncommittedChanges()) {
    return { error: 'No uncommitted changes to ship.' };
  }

  // Stage all (except sensitive)
  if (sensitiveFiles.length > 0) {
    // Add files individually, skipping sensitive
    const safeFiles = allFiles.filter(f => !sensitiveFiles.includes(f));
    if (safeFiles.length === 0) {
      return { error: 'Only sensitive files detected — nothing safe to stage.' };
    }
    const addRes = git('add', '--', ...safeFiles);
    if (addRes.status !== 0) {
      return { error: `git add failed: ${addRes.stderr}` };
    }
  } else {
    const addRes = git('add', '-A');
    if (addRes.status !== 0) {
      return { error: `git add failed: ${addRes.stderr}` };
    }
  }

  // Build commit message
  const commitMsg = buildCommitMessage(goal, diff_summary, test_result, gate_result);
  const commitRes = git('commit', '-m', commitMsg);
  if (commitRes.status !== 0) {
    const out = (commitRes.stdout || '') + (commitRes.stderr || '');
    if (/nothing to commit/i.test(out)) {
      return { error: 'Nothing to commit — working tree clean.' };
    }
    return { error: `git commit failed: ${commitRes.stderr}` };
  }

  // Get commit hash
  const hashRes = git('rev-parse', 'HEAD');
  const commit_hash = (hashRes.stdout || '').trim();

  if (no_pr) {
    console.log(`Committed to branch ${targetBranch} (${commit_hash.slice(0, 8)}). --no-pr: skipping push and PR.`);
    return { branch: targetBranch, commit_hash };
  }

  if (!hasRemote) {
    return { branch: targetBranch, commit_hash, error: 'No git remote configured — skipping push and PR.' };
  }

  // Confirm push
  if (!yes && !confirm(`Push branch ${targetBranch} and create PR?`)) {
    return { branch: targetBranch, commit_hash, error: 'Aborted by user.' };
  }

  // Push
  const pushRes = git('push', '-u', 'origin', targetBranch);
  if (pushRes.status !== 0) {
    return { branch: targetBranch, commit_hash, error: `git push failed: ${pushRes.stderr}` };
  }

  if (!ghAvailable) {
    return { branch: targetBranch, commit_hash, error: 'gh CLI not available — branch pushed but PR not created.' };
  }

  // Build PR body
  const prBody = buildPRBody({ goal, diff_summary, test_result, gate_result, run_id });
  const prTitle = goal.length > 70 ? goal.slice(0, 67) + '...' : goal;

  const prRes = spawnSync('gh', ['pr', 'create', '--title', prTitle, '--body', prBody], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
  });

  if (prRes.status !== 0) {
    return { branch: targetBranch, commit_hash, error: `gh pr create failed: ${prRes.stderr}` };
  }

  const pr_url = (prRes.stdout || '').trim();
  return { pr_url, branch: targetBranch, commit_hash };
}

function buildCommitMessage(goal, diff_summary, test_result, gate_result) {
  const lines = [goal];
  if (diff_summary?.stats) lines.push('', diff_summary.stats);
  const testStatus = test_result == null ? 'not run' : test_result.passed ? 'passed' : 'failed';
  const gateStatus = gate_result?.gate ?? 'not run';
  lines.push('', `Tests: ${testStatus} | Gate: ${gateStatus}`);
  lines.push('', 'Generated by dual-brain Ship Captain');
  return lines.join('\n');
}

function buildPRBody({ goal, diff_summary, test_result, gate_result, run_id }) {
  const testStatus = test_result == null
    ? 'not found'
    : test_result.passed
      ? `passed (${test_result.command_used})`
      : `FAILED (exit ${test_result.exit_code})`;

  const gateStatus = gate_result?.gate ?? 'not run';
  const riskLevel = gate_result?.risk ?? 'unknown';

  let runSection = 'N/A';
  if (run_id) {
    try {
      const rec = JSON.parse(readFileSync(run_id, 'utf8'));
      const completed = Array.isArray(rec.steps) ? rec.steps.filter(s => s.status === 'done').length : '?';
      const total = Array.isArray(rec.steps) ? rec.steps.length : '?';
      const dur = rec.duration_ms ? elapsed(Date.now() - rec.duration_ms) : '?';
      runSection = `Steps completed: ${completed}/${total}\n- Duration: ${dur}\n- Run record: ${run_id}`;
    } catch {
      runSection = `Run record: ${run_id}`;
    }
  }

  const changesSection = diff_summary
    ? [
        diff_summary.summary,
        '',
        diff_summary.stats,
        '',
        diff_summary.files_added.length ? `Added: ${diff_summary.files_added.join(', ')}` : '',
        diff_summary.files_modified.length ? `Modified: ${diff_summary.files_modified.join(', ')}` : '',
        diff_summary.files_deleted.length ? `Deleted: ${diff_summary.files_deleted.join(', ')}` : '',
      ].filter(l => l !== undefined).join('\n')
    : 'Not computed.';

  return [
    '## Summary',
    goal,
    '',
    '## Changes',
    changesSection,
    '',
    '## Quality',
    `- Tests: ${testStatus}`,
    `- Quality gate: ${gateStatus}`,
    `- Risk level: ${riskLevel}`,
    '',
    '## Ship Captain Run',
    `- ${runSection}`,
    '',
    'Generated by dual-brain Ship Captain',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 5. Programmatic API
// ---------------------------------------------------------------------------

/**
 * Run the full ship flow programmatically.
 *
 * @param {{
 *   goal?: string,
 *   runId?: string,
 *   yes?: boolean,
 *   noPr?: boolean,
 *   runRecord?: object,
 * }} options
 * @returns {Promise<{
 *   tests: { ran: boolean, passed: boolean|null, output: string, command: string|null },
 *   gate: { status: string, risk: string|null, approval: string|null } | null,
 *   diff: { files_added: string[], files_modified: string[], files_deleted: string[], stats: string },
 *   pr: { url: string|null, branch: string, commit: string|null } | null,
 *   status: 'shipped'|'tests_failed'|'gate_failed'|'no_changes'|'pr_skipped',
 * }>}
 */
export async function runShipGate(options = {}) {
  const {
    goal = 'Ship changes',
    runId,
    yes = false,
    noPr = false,
    runRecord,
  } = options;

  // 1. Test discovery and execution
  process.stderr.write('[ship-gate] Step 1/4: Discovering and running tests...\n');
  const discovery = discoverTests();
  let testResult = null;
  let testsRan = false;

  if (discovery.command) {
    process.stderr.write(`[ship-gate]   Command: ${discovery.command} (${discovery.framework ?? 'unknown'}, confidence: ${discovery.confidence})\n`);
    testResult = runTests();
    testsRan = true;
    const status = testResult.passed ? 'PASSED' : 'FAILED';
    process.stderr.write(`[ship-gate]   Result: ${status} (${testResult.duration_ms}ms)\n`);
  } else {
    process.stderr.write('[ship-gate]   No tests found — skipping.\n');
  }

  const testsOutput = {
    ran: testsRan,
    passed: testResult?.passed ?? null,
    output: testResult?.output ?? '',
    command: testResult?.command_used ?? discovery.command ?? null,
  };

  if (testsRan && !testResult.passed) {
    return {
      tests: testsOutput,
      gate: null,
      diff: generateDiffSummary(),
      pr: null,
      status: 'tests_failed',
    };
  }

  // 2. Quality gate
  process.stderr.write('[ship-gate] Step 2/4: Running quality gate...\n');
  const qgPath = join(__dirname, 'quality-gate.mjs');
  let gateResult = null;

  if (existsSync(qgPath)) {
    const qgRes = spawnSync(process.execPath, [qgPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      timeout: 120_000,
    });
    try {
      gateResult = JSON.parse((qgRes.stdout || '').trim());
      process.stderr.write(`[ship-gate]   Gate: ${gateResult.gate} | Risk: ${gateResult.risk ?? 'N/A'}\n`);
    } catch {
      process.stderr.write('[ship-gate]   Quality gate returned unparseable output.\n');
    }
  } else {
    process.stderr.write('[ship-gate]   quality-gate.mjs not found — skipping.\n');
  }

  const gateOutput = gateResult
    ? {
        status: gateResult.gate ?? 'unknown',
        risk: gateResult.risk ?? null,
        approval: gateResult.approval ?? null,
      }
    : null;

  // Fail if gate explicitly failed (issues_found is a warning, not a hard stop in programmatic mode)
  if (gateResult && gateResult.gate === 'gate_failed') {
    const diffSummaryEarly = generateDiffSummary();
    return {
      tests: testsOutput,
      gate: gateOutput,
      diff: diffSummaryEarly,
      pr: null,
      status: 'gate_failed',
    };
  }

  // 3. Diff summary
  process.stderr.write('[ship-gate] Step 3/4: Generating diff summary...\n');
  const diffSummary = generateDiffSummary();
  process.stderr.write(`[ship-gate]   ${diffSummary.stats}\n`);

  const total = diffSummary.files_added.length + diffSummary.files_modified.length + diffSummary.files_deleted.length;
  if (total === 0 && diffSummary.stats === 'no changes') {
    return {
      tests: testsOutput,
      gate: gateOutput,
      diff: diffSummary,
      pr: null,
      status: 'no_changes',
    };
  }

  // 4. PR
  process.stderr.write('[ship-gate] Step 4/4: Creating PR...\n');

  const gatePassed = !gateResult || gateResult.gate === 'pass' || gateResult.gate === 'self_check';

  if (noPr || !gatePassed) {
    if (!gatePassed) {
      process.stderr.write('[ship-gate]   Gate status requires review — skipping PR.\n');
    } else {
      process.stderr.write('[ship-gate]   --no-pr set — skipping PR creation.\n');
    }
    return {
      tests: testsOutput,
      gate: gateOutput,
      diff: diffSummary,
      pr: null,
      status: 'pr_skipped',
    };
  }

  const prResult = await createPR({
    goal,
    run_id: runId,
    yes,
    no_pr: false,
    test_result: testResult,
    gate_result: gateResult,
    diff_summary: diffSummary,
  });

  const prOutput = {
    url: prResult.pr_url ?? null,
    branch: prResult.branch ?? null,
    commit: prResult.commit_hash ?? null,
    error: prResult.error ?? null,
  };

  if (prResult.error) {
    process.stderr.write(`[ship-gate]   PR step error: ${prResult.error}\n`);
  } else {
    process.stderr.write(`[ship-gate]   PR created: ${prResult.pr_url ?? 'N/A'}\n`);
  }

  return {
    tests: testsOutput,
    gate: gateOutput,
    diff: diffSummary,
    pr: prOutput,
    status: prResult.error ? 'pr_skipped' : 'shipped',
  };
}

// ---------------------------------------------------------------------------
// 6. CLI Entry Point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const has = (flag) => args.includes(flag);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

  const testOnly = has('--test-only');
  const diffOnly = has('--diff-only');
  const ship = has('--ship');
  const yes = has('--yes');
  const noPR = has('--no-pr');
  const goal = get('--goal') ?? 'Ship changes';
  const runId = get('--run-id');

  if (testOnly) {
    console.log('Discovering tests...');
    const discovery = discoverTests();
    console.log(`Framework: ${discovery.framework ?? 'none'} | Confidence: ${discovery.confidence}`);
    if (!discovery.command) {
      console.log('No test command found.');
      process.exit(0);
    }
    console.log(`Running: ${discovery.command}`);
    const result = runTests();
    console.log(`\n--- Test Output ---\n${result.output || '(none)'}`);
    console.log(`\nResult: ${result.passed ? 'PASSED' : 'FAILED'} (exit ${result.exit_code}) in ${result.duration_ms}ms`);
    process.exit(result.passed ? 0 : 1);
  }

  if (diffOnly) {
    const diff = generateDiffSummary();
    console.log(`Stats:    ${diff.stats}`);
    console.log(`Added:    ${diff.files_added.join(', ') || 'none'}`);
    console.log(`Modified: ${diff.files_modified.join(', ') || 'none'}`);
    console.log(`Deleted:  ${diff.files_deleted.join(', ') || 'none'}`);
    console.log(`\nSummary: ${diff.summary}`);
    process.exit(0);
  }

  if (ship || noPR) {
    console.log('=== Ship Gate ===\n');

    const result = await runShipGate({ goal, runId, yes, noPr: noPR });

    // Surface test output if tests failed
    if (result.status === 'tests_failed') {
      console.log(`\nTests: FAILED`);
      if (result.tests.output) {
        console.log(`\n  Output:\n${result.tests.output.split('\n').map(l => '  ' + l).join('\n')}`);
      }
      if (!yes && !confirm('\nTests failed. Continue anyway?')) {
        console.log('Aborted.');
        process.exit(1);
      }
      // Re-run with tests ignored (caller chose to continue)
      const retry = await runShipGate({ goal, runId, yes: true, noPr: noPR });
      return exitFromResult(retry);
    }

    exitFromResult(result);
  } else {
    // No mode specified
    console.log('Usage:');
    console.log('  node hooks/ship-gate.mjs --test-only');
    console.log('  node hooks/ship-gate.mjs --diff-only');
    console.log('  node hooks/ship-gate.mjs --ship --goal "..." [--run-id <path>] [--yes]');
    console.log('  node hooks/ship-gate.mjs --no-pr --goal "..." [--yes]');
    process.exit(0);
  }
}

function exitFromResult(result) {
  const { tests, gate, diff, pr, status } = result;

  console.log('\n=== Ship Gate Complete ===');
  console.log(`Status: ${status}`);

  if (tests.ran) {
    console.log(`Tests: ${tests.passed ? 'PASSED' : 'FAILED'} (${tests.command})`);
  } else {
    console.log('Tests: not found');
  }

  if (gate) {
    console.log(`Gate: ${gate.status} | Risk: ${gate.risk ?? 'N/A'}`);
  }

  console.log(`Diff: ${diff.stats}`);

  if (pr) {
    if (pr.url) console.log(`PR: ${pr.url}`);
    if (pr.branch) console.log(`Branch: ${pr.branch}`);
    if (pr.commit) console.log(`Commit: ${pr.commit?.slice(0, 8)}`);
    if (pr.error) console.error(`PR error: ${pr.error}`);
  }

  const exitCode = status === 'shipped' || status === 'pr_skipped' || status === 'no_changes' ? 0 : 1;
  process.exit(exitCode);
}

// Run CLI if invoked directly
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(err => {
    console.error('ship-gate fatal error:', err);
    process.exit(1);
  });
}
