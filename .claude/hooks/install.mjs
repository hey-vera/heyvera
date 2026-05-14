#!/usr/bin/env node
/**
 * dual-brain — Dual-provider orchestrator for Claude Code.
 *
 * Usage:
 *   npx -y dual-brain              # auto-detect, configure, done
 *   npx dual-brain --force          # overwrite existing config
 *   npx dual-brain --dry-run        # detect only, don't install
 *   npx dual-brain --help
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version;

// ─── Replit Detection ──────────────────────────────────────────────────────

const IS_REPLIT = !!(process.env.REPL_ID || process.env.REPL_SLUG);

function cmd(s) { return IS_REPLIT ? `! ${s}` : s; }

// ─── CLI ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const force = flag('--force');
const dryRun = flag('--dry-run');
const jsonOut = flag('--json');
const positional = argv.filter(a => !a.startsWith('-'));
const subcommand = positional[0] || null;

if (flag('--version') || flag('-v')) {
  console.log(`dual-brain v${VERSION}`);
  process.exit(0);
}

if (flag('--help') || flag('-h')) {
  console.log(`
  🧠 dual-brain v${VERSION} — Dual-provider orchestrator for Claude Code

  Usage:  npx -y dual-brain [command] [options]

  Setup:
    (none)       Auto-detect and install/update orchestrator
    init         Alias for default install
    doctor       Check system health and report issues
    reset        Clear all state files (keeps config/hooks)
    repair       Fix corrupt files, stale locks, re-register hooks
    --uninstall  Remove dual-brain hooks and state files

  Status:
    status       Open live control panel
    health       Verify system health
    budget       Show or set session/daily spend limits
    cost         Activity and cost estimates
    report       Generate session report

  Routing:
    mode         Show or switch profile
    explain      Explain last routing decision
    gate         Run quality gate
    ledger       Routing outcome insights

  GPT:
    think        Dual-brain think (--question "..." [--round 2])
    review       Dual-brain code review
    dispatch     Dispatch work to GPT via Codex CLI

  Vibe:
    vibe         Decompose casual requests into structured work
    plan         Generate execution plans (--utterance "...")
    memory       Persistent preferences and work threads

  Agents:
    agent        Run a specialist agent template (explorer, security-review, test-writer, bug-hunter)
    agents       List all available agent templates
    chain        Run a built-in agent chain (explore-then-fix, review-and-test, audit-and-plan)
    chains       List all available agent chains

  Ship Captain:
    do "<goal>"         Run full pipeline: agents → tests → gate → PR
                      --yolo        Skip all confirmations
                      --careful     Confirm every step
                      --plan-only   Show plan without executing
                      --no-pr       Skip PR creation
    ship                Create branch, run tests, open PR
    test-run            Discover and run project tests
    diff                Show current changes summary
    runs                List recent Ship Captain runs
    resume              Resume last incomplete run

  Dev:
    test         Run self-tests

  Options:
    --force      Overwrite all existing config
    --dry-run    Detect environment only
    --json       Output detection as JSON
    --help       Show this help

  Routing modes:
    Auto (default) Adapts routing based on risk, health, outcomes
    Balanced       Auto-routes, uses both providers evenly
    Conservative   Fewer GPT dispatches, sticks to Claude
    Aggressive     Maximizes both subscriptions, dual-brain for medium+

  Examples:
    ${cmd('npx dual-brain')}                  # install or update
    ${cmd('npx dual-brain status')}           # open control panel
    ${cmd('npx dual-brain mode cost-saver')}  # switch profile
    ${cmd('npx dual-brain budget 8 25')}      # \$8 session / \$25 daily
    ${cmd('npx dual-brain think --question "should we use Redis?"')}
    ${cmd('npx dual-brain vibe "fix login and update nav"')}
    ${cmd('npx dual-brain agents')}                         # list agent templates
    ${cmd('npx dual-brain agent explorer --question "where is auth handled?"')}
    ${cmd('npx dual-brain agent security-review --scope src/auth --severity high')}
    ${cmd('npx dual-brain chains')}                         # list available chains
    ${cmd('npx dual-brain chain explore-then-fix --question "auth bug" --scope "src/auth"')}
  `);
  process.exit(0);
}

const SUBCOMMANDS = [
  'init', 'status', 'mode', 'budget', 'explain',
  'review', 'think', 'health', 'report', 'gate',
  'vibe', 'plan', 'cost', 'dispatch', 'memory',
  'test', 'ledger', 'doctor', 'reset', 'repair',
  'chain', 'chains',
  'agent', 'agents',
  'do', 'ship', 'test-run', 'diff', 'runs', 'resume',
];
if (subcommand && !SUBCOMMANDS.includes(subcommand)) {
  console.error(`  Unknown command: ${subcommand}`);
  console.error(`  Run: ${cmd('npx dual-brain --help')}`);
  process.exit(1);
}

// ─── Box Drawing ────────────────────────────────────────────────────────────

const W = 54;
const pad = (s, len = W - 2) => {
  s = String(s);
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
};
const ln = (s) => `║ ${pad(s)} ║`;
const br = (l, r) => l + '═'.repeat(W) + r;
const sep = () => '╠' + '═'.repeat(W) + '╣';

// ─── Detection ──────────────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 8000,
    ...opts,
  });
}

function detectReplit() {
  const isReplit = !!(process.env.REPL_ID || process.env.REPL_SLUG);
  const hasReplitTools = existsSync(resolve(process.cwd(), '.replit-tools'));
  return { isReplit, hasReplitTools };
}

function detectClaude() {
  const result = { installed: false, version: null, authed: false };

  const ver = run('claude', ['--version']);
  if (ver.status === 0 && ver.stdout.trim()) {
    result.installed = true;
    result.version = ver.stdout.trim().split('\n')[0];
  }

  if (!result.installed) {
    const which = run('which', ['claude']);
    if (which.status === 0 && which.stdout.trim()) result.installed = true;
  }

  const credPaths = [
    join(process.env.HOME || '', '.claude', '.credentials.json'),
    join(process.env.HOME || '', '.claude', 'credentials.json'),
    resolve(process.cwd(), '.replit-tools', '.claude-persistent', '.credentials.json'),
  ];
  for (const p of credPaths) {
    try {
      const cred = JSON.parse(readFileSync(p, 'utf8'));
      if (cred.claudeAiOauth || cred.apiKey || cred.oauth_token) {
        result.authed = true;
        break;
      }
    } catch {}
  }

  if (!result.authed && result.installed) {
    const auth = run('claude', ['auth', 'status']);
    const out = ((auth.stdout || '') + (auth.stderr || '')).toLowerCase();
    if (out.includes('logged in') || out.includes('authenticated') || out.includes('valid')) {
      result.authed = true;
    }
  }

  return result;
}

function detectCodex() {
  const result = { installed: false, version: null, authed: false, path: null };

  const which = run('which', ['codex']);
  if (which.status === 0 && which.stdout.trim()) {
    result.path = which.stdout.trim();
    result.installed = true;
  }

  if (!result.installed) {
    const home = process.env.HOME || '';
    const fallbacks = [
      join(home, '.local', 'bin', 'codex'),
      join(home, 'bin', 'codex'),
      '/usr/local/bin/codex',
    ];
    for (const p of fallbacks) {
      if (existsSync(p)) { result.path = p; result.installed = true; break; }
    }
  }

  if (result.installed && result.path) {
    const ver = run(result.path, ['--version']);
    if (ver.status === 0) result.version = ver.stdout.trim().split('\n')[0];

    const login = run(result.path, ['login', 'status']);
    const out = ((login.stdout || '') + (login.stderr || '')).toLowerCase();
    if (login.status === 0 || out.includes('logged in') || out.includes('authenticated')) {
      result.authed = true;
    }
  }

  return result;
}

function detectExisting(workspace) {
  const claude = resolve(workspace, '.claude');
  return {
    hasClaudeDir: existsSync(claude),
    hasOrchestrator: existsSync(join(claude, 'orchestrator.json')),
    hasSettings: existsSync(join(claude, 'settings.json')),
    hasHooks: existsSync(join(claude, 'hooks', 'enforce-tier.mjs')),
  };
}

function detectEnvironment() {
  return {
    ...detectReplit(),
    claude: detectClaude(),
    codex: detectCodex(),
    existing: detectExisting(process.cwd()),
    workspace: resolve(process.cwd()),
  };
}

// ─── Mode Resolution ────────────────────────────────────────────────────────

function resolveMode(env) {
  const c = env.claude.authed || env.claude.installed;
  const o = env.codex.authed;
  if (c && o) return { mode: 'dual', claudeEnabled: true, openaiEnabled: true };
  if (c)      return { mode: 'claude-only', claudeEnabled: true, openaiEnabled: false };
  if (o)      return { mode: 'openai-only', claudeEnabled: false, openaiEnabled: true };
  return { mode: 'detect-only', claudeEnabled: true, openaiEnabled: false };
}

const MODE_LABELS = {
  'dual':        'dual-provider (full features)',
  'claude-only': 'Claude only (GPT features available when Codex authed)',
  'openai-only': 'OpenAI + Claude (auth Claude for full features)',
  'detect-only': 'hooks installed (auth providers to activate)',
};

// ─── Config Generation ──────────────────────────────────────────────────────

function generateOrchestrator(mode, workspace) {
  const template = JSON.parse(readFileSync(join(__dirname, 'orchestrator.json'), 'utf8'));
  const existing = {};
  const existingPath = join(workspace, '.claude', 'orchestrator.json');
  try { Object.assign(existing, JSON.parse(readFileSync(existingPath, 'utf8'))); } catch {}

  const config = force ? { ...template } : { ...template, ...existing };

  config.providers = config.providers || template.providers;
  config.providers.claude = { ...(template.providers?.claude || {}), ...(config.providers?.claude || {}) };
  config.providers.openai = { ...(template.providers?.openai || {}), ...(config.providers?.openai || {}) };
  config.providers.claude.enabled = mode.claudeEnabled;
  config.providers.openai.enabled = mode.openaiEnabled;

  config.dual_thinking = config.dual_thinking || template.dual_thinking;
  config.dual_thinking.enabled = mode.mode === 'dual';

  config.subscriptions = config.subscriptions || template.subscriptions;
  config.model_intelligence = config.model_intelligence || template.model_intelligence;
  config.tiers = config.tiers || template.tiers;
  config.quality_gate = force ? template.quality_gate : (config.quality_gate || template.quality_gate);
  config.routing_rules = force ? template.routing_rules : (config.routing_rules || template.routing_rules);
  config.budgets = force ? template.budgets : (config.budgets || template.budgets);
  config.routing = force ? template.routing : (config.routing || template.routing);
  config.codex_skills = template.codex_skills;
  config.pricing_verified = new Date().toISOString().slice(0, 10);

  return config;
}

function generateSettings(workspace) {
  const settingsPath = join(workspace, '.claude', 'settings.json');
  let existing = {};
  try { existing = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}

  const hooks = {
    PreToolUse: [
      {
        matcher: 'Agent',
        hooks: [{ type: 'command', command: 'node .claude/hooks/enforce-tier.mjs' }],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Agent|Bash|Write|Edit',
        hooks: [{ type: 'command', command: 'node .claude/hooks/cost-logger.mjs' }],
      },
    ],
  };

  const DUAL_BRAIN_CMDS = [
    'node .claude/hooks/enforce-tier.mjs',
    'node .claude/hooks/cost-logger.mjs',
  ];

  const merged = { ...(existing.hooks || {}) };
  for (const [event, entries] of Object.entries(hooks)) {
    const existingEntries = (merged[event] || []).filter(e =>
      !e.hooks?.some(h => DUAL_BRAIN_CMDS.includes(h.command))
    );
    merged[event] = [...existingEntries, ...entries];
  }

  return { ...existing, hooks: merged };
}

function generateClaudeMd(mode) {
  let md = readFileSync(join(__dirname, 'CLAUDE.md'), 'utf8');

  if (mode.mode === 'claude-only') {
    md = md.replace(
      /## GPT Lane[\s\S]*?(?=## )/,
      '## GPT Lane\n\nGPT features activate automatically when Codex CLI is authenticated (`npm i -g @openai/codex && codex login`).\n\n'
    );
  } else if (mode.mode === 'detect-only') {
    md = '# Dual-Brain Orchestrator\n\nHooks installed but no providers authenticated yet.\nRun `npx dual-brain` again after authenticating Claude or Codex.\n\n' + md.split('\n').slice(3).join('\n');
  }

  return md;
}

function generateGitignoreEntries(workspace) {
  const entries = [
    '.claude/hooks/usage-*.jsonl',
    '.claude/hooks/usage.jsonl',
    '.claude/reviews/',
    '.claude/hooks/.drift-warned',
    '.claude/hooks/.budget-alerted',
    '.claude/dual-brain.profile.json',
    '.claude/hooks/usage-summary-*.json',
    '.claude/hooks/decision-ledger.jsonl',
    '.claude/.launched',
    '.claude/dual-brain.memory.json',
  ];
  let existing = '';
  try { existing = readFileSync(join(workspace, '.gitignore'), 'utf8'); } catch {}
  const needed = entries.filter(e => !existing.includes(e));
  return { existing, needed };
}

// ─── Installation ───────────────────────────────────────────────────────────

function install(workspace, env, mode) {
  const target = join(workspace, '.claude');
  const actions = [];

  mkdirSync(join(target, 'hooks'), { recursive: true });

  const HOOKS = [
    'enforce-tier.mjs', 'cost-logger.mjs', 'cost-report.mjs',
    'dual-brain-review.mjs', 'dual-brain-think.mjs', 'quality-gate.mjs',
    'test-orchestrator.mjs', 'setup-wizard.mjs', 'health-check.mjs',
    'install-git-hooks.mjs', 'session-report.mjs', 'budget-balancer.mjs',
    'gpt-work-dispatcher.mjs', 'profiles.mjs',
    'summary-checkpoint.mjs', 'decision-ledger.mjs', 'control-panel.mjs',
    'risk-classifier.mjs', 'failure-detector.mjs',
    'vibe-router.mjs', 'plan-generator.mjs', 'vibe-memory.mjs',
    'agent-templates.mjs', 'agent-chains.mjs',
    'ship-captain.mjs', 'ship-gate.mjs', 'confirmation-policy.mjs',
  ];
  for (const h of HOOKS) cpSync(join(__dirname, 'hooks', h), join(target, 'hooks', h));
  actions.push(`✓ ${HOOKS.length} hook scripts`);

  const RULES = [
    'hookify.orchestrator-route.local.md',
    'hookify.orchestrator-gate.local.md',
    'hookify.orchestrator-cost.local.md',
  ];
  for (const r of RULES) cpSync(join(__dirname, r), join(target, r));
  actions.push(`✓ ${RULES.length} hookify rules`);

  const orch = generateOrchestrator(mode, workspace);
  writeFileSync(join(target, 'orchestrator.json'), JSON.stringify(orch, null, 2) + '\n');
  actions.push(`✓ orchestrator.json (${mode.mode})`);

  const settings = generateSettings(workspace);
  writeFileSync(join(target, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  actions.push('✓ settings.json (hooks registered)');

  const claudeMd = generateClaudeMd(mode);
  writeFileSync(join(target, 'CLAUDE.md'), claudeMd);
  actions.push('✓ CLAUDE.md (session instructions)');

  const rulesTarget = join(target, 'review-rules.md');
  if (!existsSync(rulesTarget) || force) {
    cpSync(join(__dirname, 'review-rules.md'), rulesTarget);
    actions.push('✓ review-rules.md template');
  } else {
    actions.push('⊘ review-rules.md (kept yours)');
  }

  const { existing: gi, needed } = generateGitignoreEntries(workspace);
  if (needed.length > 0) {
    writeFileSync(
      join(workspace, '.gitignore'),
      (gi && !gi.endsWith('\n') ? gi + '\n' : gi) + '\n# Dual-Brain Orchestrator\n' + needed.join('\n') + '\n'
    );
    actions.push('✓ .gitignore updated');
  }

  return actions;
}

// ─── Status Report ──────────────────────────────────────────────────────────

function printReport(env, mode, actions, isDryRun) {
  const lines = [];

  lines.push(br('╔', '╗'));
  lines.push(ln(`🧠 Dual-Brain v${VERSION}`));
  lines.push(sep());

  const cAuth = env.claude.authed ? '✅' : env.claude.installed ? '⚠️' : '❌';
  const xAuth = env.codex.authed ? '✅' : env.codex.installed ? '⚠️' : '❌';
  lines.push(ln(`  🟠 Claude ${cAuth}   🟢 Codex ${xAuth}`));

  if (env.isReplit) {
    lines.push(ln(`  🌀 Replit${env.hasReplitTools ? ' + replit-tools' : ''}`));
  }

  if (actions) {
    lines.push(sep());
    for (const a of actions) lines.push(ln(`  ${a}`));
    lines.push(sep());
    lines.push(ln('✅ Installed — launching session manager...'));
  } else if (isDryRun) {
    lines.push(sep());
    lines.push(ln('Dry run — no files written'));
  }

  lines.push(br('╚', '╝'));

  console.log('');
  for (const l of lines) console.log(`  ${l}`);
  console.log('');
}

// ─── Profile System ────────────────────────────────────────────────────────

const PROFILE_FILE_REL = '.claude/dual-brain.profile.json';

function profilePath(workspace) {
  return join(workspace || process.cwd(), PROFILE_FILE_REL);
}

const PROFILES = {
  auto: {
    description: 'Adapts routing based on task risk, provider health, and outcomes',
    routing: { prefer_provider: 'auto', think_threshold: 'adaptive', gpt_dispatch_bias: 0 },
    budgets: { session_warn_usd: 5, session_limit_usd: 10, daily_warn_usd: 20, daily_limit_usd: 50 },
    quality_gate: { sensitivity_floor: 'medium', dual_brain_minimum: 'high' },
  },
  balanced: {
    description: 'Auto-routes by complexity, uses both providers evenly',
    routing: { prefer_provider: 'auto', think_threshold: 'normal', gpt_dispatch_bias: 0 },
    budgets: { session_warn_usd: 5, session_limit_usd: 10, daily_warn_usd: 20, daily_limit_usd: 50 },
    quality_gate: { sensitivity_floor: 'medium', dual_brain_minimum: 'high' },
  },
  'cost-saver': {
    description: 'Conservative — fewer GPT dispatches, sticks to Claude',
    routing: { prefer_provider: 'cheapest', think_threshold: 'strict', gpt_dispatch_bias: -20 },
    budgets: { session_warn_usd: 2, session_limit_usd: 5, daily_warn_usd: 8, daily_limit_usd: 20 },
    quality_gate: { sensitivity_floor: 'high', dual_brain_minimum: 'critical' },
  },
  'quality-first': {
    description: 'Aggressive — maximizes both subscriptions, dual-brain for medium+',
    routing: { prefer_provider: 'most-capable', think_threshold: 'relaxed', gpt_dispatch_bias: 10 },
    budgets: { session_warn_usd: 15, session_limit_usd: 30, daily_warn_usd: 50, daily_limit_usd: 100 },
    quality_gate: { sensitivity_floor: 'low', dual_brain_minimum: 'medium' },
  },
};

function loadProfile(workspace) {
  try {
    const data = JSON.parse(readFileSync(profilePath(workspace), 'utf8'));
    const name = data.active && PROFILES[data.active] ? data.active : 'auto';
    const profile = PROFILES[name];
    const custom = data.custom_overrides || {};
    return {
      name,
      ...profile,
      budgets: { ...profile.budgets, ...custom.budgets },
      routing: { ...profile.routing, ...custom.routing },
      switched_at: data.switched_at || null,
    };
  } catch {
    return { name: 'auto', ...PROFILES.auto, switched_at: null };
  }
}

function saveProfile(workspace, name, customOverrides) {
  const data = { active: name, switched_at: new Date().toISOString() };
  if (customOverrides) data.custom_overrides = customOverrides;
  const target = profilePath(workspace);
  const tmp = target + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, target);
}

// ─── Subcommand: status ────────────────────────────────────────────────────

function launchPanel() {
  const panelPath = join(resolve(process.cwd()), '.claude', 'hooks', 'control-panel.mjs');
  const pkgPanel = join(__dirname, 'hooks', 'control-panel.mjs');
  const panel = existsSync(panelPath) ? panelPath : existsSync(pkgPanel) ? pkgPanel : null;
  if (panel) {
    const { status } = spawnSync(process.execPath, [panel], { stdio: 'inherit' });
    process.exit(status || 0);
  }
}

// ─── Subcommand: mode ──────────────────────────────────────────────────────

function cmdMode() {
  const workspace = resolve(process.cwd());
  const modeArg = positional[1] || null;

  if (!modeArg || modeArg === 'list') {
    const current = loadProfile(workspace);
    const PEMOJIS = { auto: '🤖', balanced: '⚖️ ', 'cost-saver': '🛡️', 'quality-first': '🚀' };
    const UI_NAMES = { auto: 'Auto (default)', balanced: 'Balanced', 'cost-saver': 'Conservative', 'quality-first': 'Aggressive' };
    console.log('');
    console.log('  🎛️  Routing modes:');
    console.log('');
    for (const [name, p] of Object.entries(PROFILES)) {
      const active = name === current.name ? ' ✅ active' : '';
      const label = UI_NAMES[name] || name;
      console.log(`    ${PEMOJIS[name] || '  '} ${label.padEnd(15)} ${p.description}${active}`);
    }
    console.log('');
    console.log(`  Switch: ${cmd('npx dual-brain mode <name>')}`);
    console.log('');
    return;
  }

  let resolvedMode = modeArg;
  if (!PROFILES[resolvedMode]) {
    // Try natural language alias resolution
    const cleaned = resolvedMode.toLowerCase().trim()
      .replace(/^(go|be|use|switch to|set|mode)\s+/i, '')
      .replace(/\s+mode$/i, '');
    const MODE_ALIASES = {
      'auto': 'auto', 'adaptive': 'auto', 'smart': 'auto', 'default': 'auto', 'normal': 'auto',
      'balanced': 'balanced', 'even': 'balanced', 'equal': 'balanced',
      'cost-saver': 'cost-saver', 'cheap': 'cost-saver', 'save': 'cost-saver', 'conservative': 'cost-saver', 'frugal': 'cost-saver', 'budget': 'cost-saver',
      'quality-first': 'quality-first', 'aggressive': 'quality-first', 'quality': 'quality-first', 'max': 'quality-first', 'full': 'quality-first', 'both': 'quality-first',
    };
    resolvedMode = MODE_ALIASES[cleaned] || null;
    if (!resolvedMode) {
      console.error(`  Unknown profile: ${modeArg}`);
      console.error(`  Available: ${Object.keys(PROFILES).join(', ')}`);
      console.error(`  Aliases: cheap, aggressive, quality, budget, frugal, smart, adaptive, ...`);
      process.exit(1);
    }
  }

  const profile = PROFILES[resolvedMode];

  let customOverrides = null;
  try {
    const existing = JSON.parse(readFileSync(profilePath(workspace), 'utf8'));
    if (existing.custom_overrides?.budgets) {
      customOverrides = { budgets: existing.custom_overrides.budgets };
    }
  } catch {}

  saveProfile(workspace, resolvedMode, customOverrides);

  const PEMOJIS = { auto: '🤖', balanced: '⚖️ ', 'cost-saver': '🛡️', 'quality-first': '🚀' };
  const UI_NAMES = { auto: 'Auto (default)', balanced: 'Balanced', 'cost-saver': 'Conservative', 'quality-first': 'Aggressive' };
  console.log('');
  console.log(`  ✅ Mode switched: ${PEMOJIS[resolvedMode] || ''} ${UI_NAMES[resolvedMode] || resolvedMode}`);
  console.log(`  ${profile.description}`);
  console.log('');
  console.log('  🧭 Routing changes:');
  console.log(`    Provider:     ${profile.routing.prefer_provider}`);
  console.log(`    💵 Budget:    $${profile.budgets.session_limit_usd}/session, $${profile.budgets.daily_limit_usd}/day`);
  console.log(`    🛡️  Reviews:   ${profile.quality_gate.sensitivity_floor} risk+`);
  console.log(`    🧠 Dual-brain: ${profile.quality_gate.dual_brain_minimum} risk+`);
  console.log('');
  console.log('  🟢 Active immediately, no restart needed.');
  console.log('');
}

// ─── Subcommand: budget ────────────────────────────────────────────────────

function cmdBudget() {
  const workspace = resolve(process.cwd());
  const sessionArg = positional[1] ? parseFloat(positional[1]) : null;
  const dailyArg = positional[2] ? parseFloat(positional[2]) : null;

  if (sessionArg == null) {
    const profile = loadProfile(workspace);
    console.log('');
    console.log('  📊 Usage alert thresholds (estimated, not billing caps):');
    console.log(`    Session: ⚠️  $${profile.budgets.session_warn_usd} warn · 🛑 $${profile.budgets.session_limit_usd} alert`);
    console.log(`    Daily:   ⚠️  $${profile.budgets.daily_warn_usd} warn · 🛑 $${profile.budgets.daily_limit_usd} alert`);
    console.log('');
    console.log(`  Adjust: ${cmd('npx dual-brain budget <session$> [daily$]')}`);
    console.log(`  Example: ${cmd('npx dual-brain budget 8 25')}`);
    console.log('');
    return;
  }

  if (isNaN(sessionArg) || sessionArg <= 0) {
    console.error('  Session limit must be a positive number');
    process.exit(1);
  }

  const daily = (dailyArg != null && !isNaN(dailyArg) && dailyArg > 0) ? dailyArg : sessionArg * 3;

  let existing = {};
  try { existing = JSON.parse(readFileSync(profilePath(workspace), 'utf8')); } catch {}

  const customOverrides = existing.custom_overrides || {};
  customOverrides.budgets = {
    session_warn_usd: +(sessionArg * 0.6).toFixed(2),
    session_limit_usd: sessionArg,
    daily_warn_usd: +(daily * 0.6).toFixed(2),
    daily_limit_usd: daily,
  };

  const data = {
    active: existing.active || 'auto',
    switched_at: existing.switched_at || new Date().toISOString(),
    custom_overrides: customOverrides,
  };
  const budgetTarget = profilePath(workspace);
  const budgetTmp = budgetTarget + '.tmp.' + process.pid;
  writeFileSync(budgetTmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(budgetTmp, budgetTarget);

  console.log('');
  console.log('  ✅ Budget updated:');
  console.log(`    Session: ⚠️  $${customOverrides.budgets.session_warn_usd} warn · 🛑 $${sessionArg} limit`);
  console.log(`    Daily:   ⚠️  $${customOverrides.budgets.daily_warn_usd} warn · 🛑 $${daily} limit`);
  console.log('');
  console.log('  🟢 Active immediately, no restart needed.');
  console.log('');
}

// ─── Subcommand: explain ───────────────────────────────────────────────────

function cmdExplain() {
  const workspace = resolve(process.cwd());
  const hooksDir = join(workspace, '.claude', 'hooks');
  const today = new Date().toISOString().slice(0, 10);
  const logFile = join(hooksDir, `usage-${today}.jsonl`);

  if (!existsSync(logFile)) {
    console.log('');
    console.log('  💤 No routing decisions recorded today.');
    console.log('  Start a Claude Code session and the tier enforcer will log decisions.');
    console.log('');
    return;
  }

  let lines;
  try {
    lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    console.log('  Could not read usage log.');
    return;
  }

  let lastRec = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === 'tier_recommendation') { lastRec = entry; break; }
    } catch {}
  }

  if (!lastRec) {
    console.log('');
    console.log('  💤 No routing decisions found in today\'s log.');
    console.log('  The tier enforcer logs decisions when Agent tool is used.');
    console.log('');
    return;
  }

  const profile = loadProfile(workspace);

  console.log('');
  console.log('  🧭 Last Routing Decision');
  console.log('  ' + '─'.repeat(40));
  console.log(`  🕐 Time:         ${lastRec.timestamp?.slice(11, 19) || 'unknown'}`);
  console.log(`  🔎 Detected:     ${lastRec.detected_tier || 'unknown'} tier`);
  console.log(`  🧠 Recommended:  ${lastRec.recommended_model || 'unknown'}`);
  console.log(`  🎯 Actual:       ${lastRec.actual_model || 'unknown'}`);
  console.log(`  ${lastRec.followed ? '✅' : '⚠️'}  Followed:     ${lastRec.followed ? 'yes' : 'no'}`);
  console.log(`  🎛️  Profile:      ${profile.name}`);
  console.log('');

  if (!lastRec.followed) {
    console.log('  ⚠️  Recommendation was overridden. This may mean:');
    console.log('  - The task needed a different model (valid override)');
    console.log('  - The subagent_type forced a specific tier');
    console.log(`  - Profile "${profile.name}" adjusted the threshold`);
  } else {
    console.log('  ✅ Routing matched the recommendation.');
  }

  let total = 0, followed = 0;
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.type === 'tier_recommendation') { total++; if (e.followed) followed++; }
    } catch {}
  }
  const pct = total > 0 ? Math.round((followed / total) * 100) : 0;
  console.log('');
  console.log(`  Today: ${followed}/${total} recommendations followed (${pct}%)`);
  console.log('');
}

// ─── Subcommand: doctor ───────────────────────────────────────────────────

function cmdDoctor() {
  const workspace = resolve(process.cwd());
  const claudeDir = join(workspace, '.claude');
  const hooksDir = join(claudeDir, 'hooks');
  const results = [];

  // 1. Hook installation check
  const settingsPath = join(claudeDir, 'settings.json');
  const DUAL_BRAIN_CMDS = [
    'node .claude/hooks/enforce-tier.mjs',
    'node .claude/hooks/cost-logger.mjs',
  ];
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const registeredCmds = [];
      if (settings.hooks) {
        for (const entries of Object.values(settings.hooks)) {
          for (const entry of entries) {
            for (const h of (entry.hooks || [])) {
              if (DUAL_BRAIN_CMDS.includes(h.command)) registeredCmds.push(h.command);
            }
          }
        }
      }
      const missing = DUAL_BRAIN_CMDS.filter(c => !registeredCmds.includes(c));
      if (missing.length === 0) {
        results.push({ name: 'Hook registration', status: 'pass', detail: `${DUAL_BRAIN_CMDS.length}/${DUAL_BRAIN_CMDS.length} hooks registered` });
      } else {
        results.push({ name: 'Hook registration', status: 'fail', detail: `Missing: ${missing.map(c => c.split('/').pop()).join(', ')}`, fix: 'Run: npx dual-brain repair' });
      }
    } catch (err) {
      results.push({ name: 'Hook registration', status: 'fail', detail: `settings.json parse error: ${err.message}`, fix: 'Run: npx dual-brain repair' });
    }
  } else {
    results.push({ name: 'Hook registration', status: 'fail', detail: 'settings.json not found', fix: 'Run: npx dual-brain' });
  }

  // 2. Config validity
  const orchPath = join(claudeDir, 'orchestrator.json');
  if (existsSync(orchPath)) {
    try {
      const config = JSON.parse(readFileSync(orchPath, 'utf8'));
      const requiredKeys = ['subscriptions', 'tiers', 'providers', 'budgets'];
      const missing = requiredKeys.filter(k => !config[k]);
      if (missing.length === 0) {
        results.push({ name: 'Config validity', status: 'pass', detail: 'orchestrator.json valid, all required keys present' });
      } else {
        results.push({ name: 'Config validity', status: 'warn', detail: `Missing keys: ${missing.join(', ')}`, fix: 'Run: npx dual-brain --force' });
      }
    } catch (err) {
      results.push({ name: 'Config validity', status: 'fail', detail: `orchestrator.json corrupt: ${err.message}`, fix: 'Run: npx dual-brain repair' });
    }
  } else {
    results.push({ name: 'Config validity', status: 'fail', detail: 'orchestrator.json not found', fix: 'Run: npx dual-brain' });
  }

  // 3. Auth status
  const claude = detectClaude();
  if (claude.authed) {
    results.push({ name: 'Claude CLI', status: 'pass', detail: 'installed and authenticated' });
  } else if (claude.installed) {
    results.push({ name: 'Claude CLI', status: 'warn', detail: 'installed but not authenticated' });
  } else {
    results.push({ name: 'Claude CLI', status: 'warn', detail: 'not found' });
  }

  const codexResult = detectCodex();
  if (codexResult.authed) {
    results.push({ name: 'Codex CLI', status: 'pass', detail: 'installed and authenticated' });
  } else if (codexResult.installed) {
    results.push({ name: 'Codex CLI', status: 'warn', detail: 'installed but not authenticated' });
  } else {
    results.push({ name: 'Codex CLI', status: 'warn', detail: 'not found (GPT features disabled)' });
  }

  // 4. State file health
  const stateCheckFiles = [
    { path: join(hooksDir, '.burst-state'), label: '.burst-state', format: 'json' },
    { path: join(hooksDir, 'burst-state.json'), label: 'burst-state.json', format: 'json' },
    { path: join(hooksDir, '.drift-warned'), label: '.drift-warned', format: 'any' },
    { path: join(claudeDir, 'dual-brain.profile.json'), label: 'dual-brain.profile.json', format: 'json' },
    { path: join(hooksDir, 'decision-ledger.jsonl'), label: 'decision-ledger.jsonl', format: 'jsonl' },
  ];

  // Add any usage-*.jsonl files
  try {
    for (const f of readdirSync(hooksDir)) {
      if (f.startsWith('usage-') && f.endsWith('.jsonl')) {
        stateCheckFiles.push({ path: join(hooksDir, f), label: f, format: 'jsonl' });
      }
    }
  } catch {}

  let stateHealthy = 0, stateWarns = 0, stateFails = 0;
  const stateIssues = [];

  for (const sf of stateCheckFiles) {
    if (!existsSync(sf.path)) continue;
    try {
      const raw = readFileSync(sf.path, 'utf8');
      if (sf.format === 'json') {
        JSON.parse(raw);
        stateHealthy++;
      } else if (sf.format === 'jsonl') {
        const lines = raw.split('\n').filter(Boolean);
        let badLines = 0;
        for (const line of lines) {
          try { JSON.parse(line); } catch { badLines++; }
        }
        if (badLines > 0) {
          stateWarns++;
          stateIssues.push(`${sf.label}: ${badLines}/${lines.length} unparseable lines`);
        } else {
          stateHealthy++;
        }
      } else {
        stateHealthy++;
      }
    } catch (err) {
      stateFails++;
      stateIssues.push(`${sf.label}: corrupt (${err.message})`);
    }
  }

  // Check for stale locks
  let staleLocks = 0;
  for (const dir of [hooksDir, claudeDir]) {
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.lock')) {
          try {
            const st = statSync(join(dir, f));
            if (Date.now() - st.mtimeMs > 30_000) staleLocks++;
          } catch {}
        }
      }
    } catch {}
  }

  if (staleLocks > 0) {
    stateIssues.push(`${staleLocks} stale lock file(s)`);
    stateWarns++;
  }

  if (stateFails > 0) {
    results.push({ name: 'State files', status: 'fail', detail: stateIssues.join('; '), fix: 'Run: npx dual-brain repair' });
  } else if (stateWarns > 0) {
    results.push({ name: 'State files', status: 'warn', detail: stateIssues.join('; '), fix: 'Run: npx dual-brain repair' });
  } else {
    results.push({ name: 'State files', status: 'pass', detail: `${stateHealthy} file(s) healthy` });
  }

  // 5. Error channel
  const errorsFile = join(hooksDir, 'errors.jsonl');
  if (existsSync(errorsFile)) {
    try {
      const raw = readFileSync(errorsFile, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const entries = [];
      for (const line of lines) {
        try { entries.push(JSON.parse(line)); } catch {}
      }

      const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
      const recent = entries.filter(e => e.timestamp && Date.parse(e.timestamp) >= cutoff24h);

      if (recent.length === 0) {
        results.push({ name: 'Error channel', status: 'pass', detail: 'no errors in last 24h' });
      } else {
        const last3 = recent.slice(-3);
        const detail = `${recent.length} error(s) in last 24h`;
        results.push({ name: 'Error channel', status: 'warn', detail, errors: last3 });
      }
    } catch {
      results.push({ name: 'Error channel', status: 'warn', detail: 'errors.jsonl unreadable' });
    }
  } else {
    results.push({ name: 'Error channel', status: 'pass', detail: 'no errors.jsonl (clean)' });
  }

  // Output
  const passCount = results.filter(r => r.status === 'pass').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const failCount = results.filter(r => r.status === 'fail').length;

  console.log('');
  console.log(`  🩺 dual-brain v${VERSION} — doctor`);
  console.log('  ' + '─'.repeat(50));

  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
    if (r.fix) console.log(`    → ${r.fix}`);
    if (r.errors) {
      for (const e of r.errors) {
        const ts = e.timestamp ? e.timestamp.slice(11, 19) : '??:??:??';
        console.log(`    ${ts} [${e.hook || '?'}] ${e.error || '?'}`);
      }
    }
  }

  console.log('  ' + '─'.repeat(50));
  if (failCount > 0) {
    console.log(`  ✗ Needs repair: ${failCount} issue(s) require attention`);
  } else if (warnCount > 0) {
    console.log(`  ⚠ Warnings: ${warnCount} — system functional but has issues`);
  } else {
    console.log(`  ✓ Healthy: all ${passCount} checks passed`);
  }
  console.log('');
}

// ─── Subcommand: reset ────────────────────────────────────────────────────

function cmdReset() {
  const workspace = resolve(process.cwd());
  const claudeDir = join(workspace, '.claude');
  const hooksDir = join(claudeDir, 'hooks');

  // Collect state files (NOT config, hooks, or profile)
  const STATE_FIXED = [
    join(hooksDir, 'usage.jsonl'),
    join(hooksDir, 'decision-ledger.jsonl'),
    join(hooksDir, 'failure-ledger.json'),
    join(hooksDir, '.burst-state'),
    join(hooksDir, 'burst-state.json'),
    join(hooksDir, '.drift-warned'),
    join(hooksDir, '.budget-alerted'),
    join(hooksDir, 'errors.jsonl'),
    join(hooksDir, 'summary-checkpoint.json'),
    join(claudeDir, '.launched'),
  ];

  const toDelete = [];
  for (const f of STATE_FIXED) {
    if (existsSync(f)) toDelete.push(f);
  }

  // Scan for date-stamped files and lock files
  try {
    for (const f of readdirSync(hooksDir)) {
      if (f.startsWith('usage-') && f.endsWith('.jsonl')) toDelete.push(join(hooksDir, f));
      if (f.startsWith('usage-summary-') && f.endsWith('.json')) toDelete.push(join(hooksDir, f));
      if (f.endsWith('.lock')) toDelete.push(join(hooksDir, f));
    }
  } catch {}
  try {
    for (const f of readdirSync(claudeDir)) {
      if (f.endsWith('.lock')) toDelete.push(join(claudeDir, f));
    }
  } catch {}

  const unique = [...new Set(toDelete)].filter(f => existsSync(f));

  if (unique.length === 0) {
    console.log('');
    console.log('  🔄 Nothing to reset — no state files found.');
    console.log('');
    return;
  }

  // Require --force or confirmation
  if (!force) {
    console.log('');
    console.log(`  🔄 dual-brain reset — will delete ${unique.length} state file(s):`);
    console.log('');
    for (const f of unique) {
      const rel = f.startsWith(workspace) ? f.slice(workspace.length + 1) : f;
      console.log(`    ${rel}`);
    }
    console.log('');
    console.log('  Preserved: orchestrator.json, settings.json, hooks, profile, CLAUDE.md');
    console.log('');
    console.log(`  To confirm: ${cmd('npx dual-brain reset --force')}`);
    console.log('');
    return;
  }

  let removed = 0;
  const errors = [];
  for (const f of unique) {
    try {
      unlinkSync(f);
      removed++;
    } catch (err) {
      errors.push(`  ⚠ Could not remove ${f.split('/').pop()}: ${err.message}`);
    }
  }

  console.log('');
  console.log(`  🔄 dual-brain v${VERSION} — reset`);
  console.log('  ' + '─'.repeat(40));
  console.log(`  ✓ Removed ${removed} state file(s)`);
  for (const e of errors) console.log(e);
  console.log('');
  console.log('  Preserved: orchestrator.json, settings.json, hooks, profile, CLAUDE.md');
  console.log('  State will rebuild automatically on next session.');
  console.log('');
}

// ─── Subcommand: repair ───────────────────────────────────────────────────

function cmdRepair() {
  const workspace = resolve(process.cwd());
  const claudeDir = join(workspace, '.claude');
  const hooksDir = join(claudeDir, 'hooks');
  const actions = [];

  // 1. Remove stale lock files (older than 30 seconds)
  let staleLocks = 0;
  for (const dir of [hooksDir, claudeDir]) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.lock')) continue;
        const lockPath = join(dir, f);
        try {
          const st = statSync(lockPath);
          if (Date.now() - st.mtimeMs > 30_000) {
            unlinkSync(lockPath);
            staleLocks++;
          }
        } catch {}
      }
    } catch {}
  }
  if (staleLocks > 0) {
    actions.push(`✓ Removed ${staleLocks} stale lock file(s)`);
  } else {
    actions.push('⊘ No stale locks found');
  }

  // 2. Repair corrupt JSONL files
  const jsonlFiles = [
    join(hooksDir, 'decision-ledger.jsonl'),
    join(hooksDir, 'errors.jsonl'),
    join(hooksDir, 'usage.jsonl'),
  ];
  try {
    for (const f of readdirSync(hooksDir)) {
      if (f.startsWith('usage-') && f.endsWith('.jsonl')) {
        jsonlFiles.push(join(hooksDir, f));
      }
    }
  } catch {}

  let repairedJsonl = 0;
  for (const filePath of [...new Set(jsonlFiles)]) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      let badCount = 0;
      const goodLines = [];
      for (const line of lines) {
        try {
          JSON.parse(line);
          goodLines.push(line);
        } catch {
          badCount++;
        }
      }
      if (badCount > 0) {
        const tmp = filePath + '.tmp.' + process.pid;
        writeFileSync(tmp, goodLines.length > 0 ? goodLines.join('\n') + '\n' : '');
        renameSync(tmp, filePath);
        repairedJsonl++;
        actions.push(`✓ ${filePath.split('/').pop()}: removed ${badCount} corrupt line(s), kept ${goodLines.length}`);
      }
    } catch (err) {
      actions.push(`⚠ ${filePath.split('/').pop()}: could not repair (${err.message})`);
    }
  }
  if (repairedJsonl === 0) {
    actions.push('⊘ No corrupt JSONL files found');
  }

  // 3. Re-validate and fix orchestrator.json formatting
  const orchPath = join(claudeDir, 'orchestrator.json');
  if (existsSync(orchPath)) {
    try {
      const raw = readFileSync(orchPath, 'utf8');
      const config = JSON.parse(raw);
      const pretty = JSON.stringify(config, null, 2) + '\n';
      if (raw !== pretty) {
        const tmp = orchPath + '.tmp.' + process.pid;
        writeFileSync(tmp, pretty);
        renameSync(tmp, orchPath);
        actions.push('✓ orchestrator.json: re-formatted');
      } else {
        actions.push('⊘ orchestrator.json: already well-formatted');
      }
    } catch (err) {
      actions.push(`✗ orchestrator.json: invalid JSON — ${err.message}`);
      actions.push('  → Run: npx dual-brain --force (to regenerate from template)');
    }
  } else {
    actions.push('✗ orchestrator.json: not found — run: npx dual-brain');
  }

  // 4. Re-run hook registration (ensure hooks are in settings.json)
  if (existsSync(join(claudeDir, 'settings.json')) || existsSync(orchPath)) {
    try {
      const settings = generateSettings(workspace);
      const tmp = join(claudeDir, 'settings.json.tmp.' + process.pid);
      writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
      renameSync(tmp, join(claudeDir, 'settings.json'));
      actions.push('✓ settings.json: hooks re-registered');
    } catch (err) {
      actions.push(`⚠ settings.json: could not re-register hooks (${err.message})`);
    }
  }

  // Print report
  console.log('');
  console.log(`  🔧 dual-brain v${VERSION} — repair`);
  console.log('  ' + '─'.repeat(40));
  for (const a of actions) {
    console.log(`  ${a}`);
  }
  console.log('');
}

// ─── Uninstall ─────────────────────────────────────────────────────────────

function cmdUninstall() {
  const workspace = resolve(process.cwd());
  const claudeDir = join(workspace, '.claude');
  const hooksDir = join(claudeDir, 'hooks');
  const actions = [];

  // 1. Remove dual-brain hooks from settings.json
  const settingsPath = join(claudeDir, 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const DUAL_BRAIN_CMDS = [
        'node .claude/hooks/enforce-tier.mjs',
        'node .claude/hooks/cost-logger.mjs',
      ];

      if (settings.hooks) {
        let removedCount = 0;
        for (const event of Object.keys(settings.hooks)) {
          const before = settings.hooks[event].length;
          settings.hooks[event] = settings.hooks[event].filter(entry =>
            !entry.hooks?.some(h => DUAL_BRAIN_CMDS.includes(h.command))
          );
          removedCount += before - settings.hooks[event].length;

          // Clean up empty arrays
          if (settings.hooks[event].length === 0) {
            delete settings.hooks[event];
          }
        }

        // Clean up empty hooks object
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        if (removedCount > 0) {
          actions.push(`✓ Removed ${removedCount} hook(s) from settings.json`);
        } else {
          actions.push('⊘ No dual-brain hooks found in settings.json');
        }
      } else {
        actions.push('⊘ No hooks section in settings.json');
      }
    } catch (err) {
      actions.push(`⚠ Could not parse settings.json: ${err.message}`);
    }
  } else {
    actions.push('⊘ No settings.json found');
  }

  // 2. Remove state files
  const stateFiles = [
    join(claudeDir, 'dual-brain.profile.json'),
    join(claudeDir, 'dual-brain.memory.json'),
    join(claudeDir, '.launched'),
  ];

  // Add date-stamped usage files and summary files
  const today = new Date().toISOString().slice(0, 10);
  stateFiles.push(join(hooksDir, 'usage.jsonl'));
  stateFiles.push(join(hooksDir, `usage-${today}.jsonl`));
  stateFiles.push(join(hooksDir, 'decision-ledger.jsonl'));
  stateFiles.push(join(hooksDir, '.drift-warned'));
  stateFiles.push(join(hooksDir, '.budget-alerted'));

  // Scan for any usage-*.jsonl and usage-summary-*.json files
  try {
    const files = readdirSync(hooksDir);
    for (const f of files) {
      if (f.startsWith('usage-') && f.endsWith('.jsonl')) {
        stateFiles.push(join(hooksDir, f));
      }
      if (f.startsWith('usage-summary-') && f.endsWith('.json')) {
        stateFiles.push(join(hooksDir, f));
      }
      if (f === 'burst-state.json' || f === 'failure-ledger.json') {
        stateFiles.push(join(hooksDir, f));
      }
    }
  } catch {}

  // Deduplicate
  const uniqueFiles = [...new Set(stateFiles)];

  let removedFiles = 0;
  for (const f of uniqueFiles) {
    try {
      if (existsSync(f)) {
        unlinkSync(f);
        removedFiles++;
      }
    } catch {}
  }

  if (removedFiles > 0) {
    actions.push(`✓ Removed ${removedFiles} state file(s)`);
  } else {
    actions.push('⊘ No state files to remove');
  }

  // 3. Print summary
  console.log('');
  console.log(`  🧠 dual-brain v${VERSION} — uninstall`);
  console.log('  ' + '─'.repeat(40));
  for (const a of actions) {
    console.log(`  ${a}`);
  }
  console.log('');
  console.log('  Hook scripts in .claude/hooks/ were left in place');
  console.log('  (they are part of the npm package, not your repo).');
  console.log('');
  console.log('  To reinstall: npx -y dual-brain');
  console.log('');
}

// ─── Hook Delegation ───────────────────────────────────────────────────────

const HOOK_COMMANDS = {
  review:   'dual-brain-review.mjs',
  think:    'dual-brain-think.mjs',
  health:   'health-check.mjs',
  report:   'session-report.mjs',
  gate:     'quality-gate.mjs',
  vibe:     'vibe-router.mjs',
  plan:     'plan-generator.mjs',
  cost:     'cost-report.mjs',
  dispatch: 'gpt-work-dispatcher.mjs',
  memory:   'vibe-memory.mjs',
  test:     'test-orchestrator.mjs',
  ledger:   'decision-ledger.mjs',
  chains:   'agent-chains.mjs',
};

function resolveHookScript(hookFile) {
  const workspace = resolve(process.cwd());
  const installed = join(workspace, '.claude', 'hooks', hookFile);
  const bundled = join(__dirname, 'hooks', hookFile);
  return existsSync(installed) ? installed : existsSync(bundled) ? bundled : null;
}

function delegateToHook(hookFile) {
  const script = resolveHookScript(hookFile);

  if (!script) {
    console.error(`  Hook not found: ${hookFile}`);
    console.error(`  Run: ${cmd('npx dual-brain')} to install hooks first.`);
    process.exit(1);
  }

  // Pass through all args after the subcommand
  const extraArgs = process.argv.slice(3);
  const { status } = spawnSync(process.execPath, [script, ...extraArgs], {
    stdio: 'inherit',
    cwd: resolve(process.cwd()),
  });
  process.exit(status || 0);
}

function delegateToHookWithArgs(hookFile, args) {
  const script = resolveHookScript(hookFile);

  if (!script) {
    console.error(`  Hook not found: ${hookFile}`);
    console.error(`  Run: ${cmd('npx dual-brain')} to install hooks first.`);
    process.exit(1);
  }

  const { status } = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    cwd: resolve(process.cwd()),
  });
  process.exit(status || 0);
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  if (flag('--uninstall')) { cmdUninstall(); return; }

  if (subcommand === 'status') {
    launchPanel();
    return;
  }
  if (subcommand === 'mode')    { cmdMode();    return; }
  if (subcommand === 'budget')  { cmdBudget();  return; }
  if (subcommand === 'explain') { cmdExplain(); return; }
  if (subcommand === 'doctor')  { cmdDoctor();  return; }
  if (subcommand === 'reset')   { cmdReset();   return; }
  if (subcommand === 'repair')  { cmdRepair();  return; }

  // agent <template> [flags] → agent-templates.mjs --run <template> [flags]
  if (subcommand === 'agent') {
    const templateName = positional[1];
    if (!templateName) {
      // No template name — fall through to list
      delegateToHookWithArgs('agent-templates.mjs', ['--list']);
      return;
    }
    const extraFlags = process.argv.slice(4); // skip node, install.mjs, 'agent', <template>
    delegateToHookWithArgs('agent-templates.mjs', ['--run', templateName, ...extraFlags]);
    return;
  }

  // agents → agent-templates.mjs --list
  if (subcommand === 'agents') {
    delegateToHookWithArgs('agent-templates.mjs', ['--list']);
    return;
  }

  // chain <name> [flags] → agent-chains.mjs --run <name> [flags]
  if (subcommand === 'chain') {
    const chainName = positional[1];
    if (!chainName) {
      // No chain name given — fall through to list
      delegateToHookWithArgs('agent-chains.mjs', ['--list']);
      return;
    }
    const extraFlags = process.argv.slice(4); // skip node, install.mjs, 'chain', <name>
    delegateToHookWithArgs('agent-chains.mjs', ['--run', chainName, ...extraFlags]);
    return;
  }

  // chains → agent-chains.mjs --list
  if (subcommand === 'chains') {
    delegateToHookWithArgs('agent-chains.mjs', ['--list']);
    return;
  }

  // ─── Ship Captain commands ─────────────────────────────────────────────────

  // do "<goal>" → ship-captain.mjs --goal "<goal>" [remaining flags]
  if (subcommand === 'do') {
    const goal = positional[1] || '';
    if (!goal) {
      console.error('  Usage: npx dual-brain do "<goal>"');
      process.exit(1);
    }
    // Collect remaining flags (everything after the goal string)
    const extraFlags = process.argv.slice(4).filter(a => a.startsWith('-'));
    delegateToHookWithArgs('ship-captain.mjs', ['--goal', goal, ...extraFlags]);
    return;
  }

  // ship → ship-gate.mjs --ship [remaining flags]
  if (subcommand === 'ship') {
    const extraFlags = process.argv.slice(3).filter(a => a.startsWith('-'));
    delegateToHookWithArgs('ship-gate.mjs', ['--ship', ...extraFlags]);
    return;
  }

  // test-run → ship-gate.mjs --test-only
  if (subcommand === 'test-run') {
    const extraFlags = process.argv.slice(3).filter(a => a.startsWith('-'));
    delegateToHookWithArgs('ship-gate.mjs', ['--test-only', ...extraFlags]);
    return;
  }

  // diff → ship-gate.mjs --diff-only
  if (subcommand === 'diff') {
    delegateToHookWithArgs('ship-gate.mjs', ['--diff-only']);
    return;
  }

  // runs → list recent Ship Captain runs from .claude/runs/
  if (subcommand === 'runs') {
    const workspace = resolve(process.cwd());
    const runsDir = join(workspace, '.claude', 'runs');
    if (!existsSync(runsDir)) {
      console.log('');
      console.log('  No Ship Captain runs found.');
      console.log(`  Run: ${cmd('npx dual-brain do "<goal>"')} to start your first run.`);
      console.log('');
      return;
    }
    let files;
    try {
      files = readdirSync(runsDir).filter(f => f.endsWith('.json')).sort().reverse();
    } catch {
      files = [];
    }
    if (files.length === 0) {
      console.log('');
      console.log('  No run records found in .claude/runs/');
      console.log('');
      return;
    }
    const rows = [];
    for (const f of files) {
      try {
        const rec = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
        const id = rec.id || f.replace('.json', '');
        const goal = (rec.goal || '').slice(0, 35);
        const status = rec.status || '?';
        const steps = Array.isArray(rec.steps) ? rec.steps.length : (rec.step_count || '?');
        const dur = rec.duration_ms != null ? `${(rec.duration_ms / 1000).toFixed(1)}s` : rec.duration || '?';
        const date = rec.started_at ? rec.started_at.slice(0, 16).replace('T', ' ') : (rec.date || '?');
        rows.push({ id, goal, status, steps, dur, date });
      } catch {}
    }
    if (rows.length === 0) {
      console.log('  No readable run records.');
      return;
    }
    const colW = { id: 14, goal: 37, status: 10, steps: 6, dur: 8, date: 16 };
    const header = [
      'ID'.padEnd(colW.id), 'GOAL'.padEnd(colW.goal), 'STATUS'.padEnd(colW.status),
      'STEPS'.padStart(colW.steps), 'DUR'.padStart(colW.dur), 'DATE'.padEnd(colW.date),
    ].join('  ');
    console.log('');
    console.log(`  Ship Captain Runs (${rows.length})`);
    console.log('  ' + '─'.repeat(header.length));
    console.log('  ' + header);
    console.log('  ' + '─'.repeat(header.length));
    for (const r of rows) {
      const line = [
        String(r.id).padEnd(colW.id), String(r.goal).padEnd(colW.goal),
        String(r.status).padEnd(colW.status), String(r.steps).padStart(colW.steps),
        String(r.dur).padStart(colW.dur), String(r.date).padEnd(colW.date),
      ].join('  ');
      console.log('  ' + line);
    }
    console.log('');
    return;
  }

  // resume → find most recent incomplete/failed run, print its state
  if (subcommand === 'resume') {
    const workspace = resolve(process.cwd());
    const runsDir = join(workspace, '.claude', 'runs');
    if (!existsSync(runsDir)) {
      console.log('');
      console.log('  No runs directory found. Nothing to resume.');
      console.log('');
      return;
    }
    let files;
    try {
      files = readdirSync(runsDir).filter(f => f.endsWith('.json')).sort().reverse();
    } catch {
      files = [];
    }
    const INCOMPLETE_STATUSES = ['failed', 'error', 'partial', 'running', 'pending', 'incomplete'];
    let found = null;
    for (const f of files) {
      try {
        const rec = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
        if (INCOMPLETE_STATUSES.includes((rec.status || '').toLowerCase())) {
          found = { file: f, rec };
          break;
        }
      } catch {}
    }
    if (!found) {
      // Fall back to the most recent run regardless of status
      if (files.length > 0) {
        try {
          const rec = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf8'));
          found = { file: files[0], rec };
        } catch {}
      }
    }
    if (!found) {
      console.log('');
      console.log('  No runs found to resume.');
      console.log('');
      return;
    }
    const { file, rec } = found;
    console.log('');
    console.log('  Last Run State');
    console.log('  ' + '─'.repeat(50));
    console.log(`  ID:       ${rec.id || file.replace('.json', '')}`);
    console.log(`  Goal:     ${rec.goal || '(unknown)'}`);
    console.log(`  Status:   ${rec.status || '(unknown)'}`);
    if (Array.isArray(rec.steps)) {
      const done = rec.steps.filter(s => s.status === 'done' || s.status === 'complete').length;
      const failed = rec.steps.filter(s => s.status === 'failed' || s.status === 'error').length;
      console.log(`  Steps:    ${done}/${rec.steps.length} done, ${failed} failed`);
      const failedStep = rec.steps.find(s => s.status === 'failed' || s.status === 'error');
      if (failedStep) {
        console.log(`  Failed:   ${failedStep.name || failedStep.label || '(step ' + rec.steps.indexOf(failedStep) + ')'}`);
        if (failedStep.error) console.log(`  Error:    ${failedStep.error}`);
      }
    }
    if (rec.started_at) console.log(`  Started:  ${rec.started_at.slice(0, 16).replace('T', ' ')}`);
    if (rec.error) console.log(`  Error:    ${rec.error}`);
    console.log('');
    if (INCOMPLETE_STATUSES.includes((rec.status || '').toLowerCase())) {
      const goalStr = rec.goal || 'your goal here';
      console.log(`  To re-run: ${cmd('npx dual-brain do "' + goalStr + '"')}`);
      console.log('  (Full resume from failed step coming in a future release)');
    }
    console.log('');
    return;
  }

  // Delegate hook-backed commands
  if (subcommand && HOOK_COMMANDS[subcommand]) {
    delegateToHook(HOOK_COMMANDS[subcommand]);
    return;
  }

  const env = detectEnvironment();
  const mode = resolveMode(env);

  if (dryRun || jsonOut) {
    if (jsonOut) {
      console.log(JSON.stringify({ version: VERSION, env, mode }, null, 2));
    } else {
      printReport(env, mode, null, true);
    }
    process.exit(0);
  }

  // Check for replit-tools on Replit
  if (env.isReplit && !env.hasReplitTools) {
    console.log('');
    console.log('  ⚠️  replit-tools not found — recommended for Replit environments.');
    console.log('  Dual-brain works best alongside replit-tools for persistent auth,');
    console.log('  session management, and shell integration.');
    console.log('');
    console.log(`  Install: ${cmd('npx -y data-tools')}`);
    console.log('');
  }

  const actions = install(env.workspace, env, mode);
  printReport(env, mode, actions);

  // After install, launch the session manager (interactive TTY only)
  if (process.stdin.isTTY && process.stdout.isTTY && !process.env.CI) {
    launchPanel();
  }
}

main();
