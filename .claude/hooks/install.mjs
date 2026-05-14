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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
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

  ⌨️  Commands:
    (none)       🧠 Auto-detect and install/update orchestrator
    status       🟢 Open live control panel
    mode         🎛️  Show or switch profile
    budget       💵 Set session/daily spend limits
    explain      🧭 Explain last routing decision
    init         Alias for default install

  Options:
    --force      Overwrite all existing config
    --dry-run    Detect environment only
    --json       Output detection as JSON
    --uninstall  Remove dual-brain hooks and state files
    --help       Show this help

  🎛️  Routing modes:
    🤖 Auto (default) Adapts routing based on risk, health, outcomes
    ⚖️  Balanced       Auto-routes, uses both providers evenly
    🛡️  Conservative   Fewer GPT dispatches, sticks to Claude
    🚀 Aggressive     Maximizes both subscriptions, dual-brain for medium+

  🚀 Examples:
    ${cmd('npx dual-brain')}                  # install or update
    ${cmd('npx dual-brain status')}           # open control panel
    ${cmd('npx dual-brain mode cost-saver')}  # switch profile
    ${cmd('npx dual-brain budget 8 25')}      # \$8 session / \$25 daily
    ${cmd('npx dual-brain explain')}          # last routing decision
  `);
  process.exit(0);
}

const SUBCOMMANDS = ['init', 'status', 'mode', 'budget', 'explain'];
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
        matcher: '',
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
