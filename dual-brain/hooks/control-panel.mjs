#!/usr/bin/env node
/**
 * control-panel.mjs — Session launcher for Dual-Brain.
 *
 * Progressive disclosure: first-run shows minimal menu (new/shell + auth).
 * Returning users see recent sessions, profile mode, cost alert settings.
 * Loops until user exits to shell.
 */

import readline from 'readline';
import { existsSync, readFileSync, readdirSync, statSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_FILE = join(__dirname, '..', 'dual-brain.profile.json');
const LAUNCHED_MARKER = join(__dirname, '..', '.launched');
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version; } catch {}
  return '?';
})();

const IS_REPLIT = !!(process.env.REPL_ID || process.env.REPL_SLUG);
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const CWD = process.cwd();

// ─── ANSI ──────────────────────────────────────────────────────────────────

const noColor = !!process.env.NO_COLOR;
const e = (code, s) => noColor ? s : `\x1b[${code}m${s}\x1b[0m`;
const bold = s => e('1', s);
const dim = s => e('2', s);
const cyan = s => e('36', s);
const green = s => e('32', s);
const yellow = s => e('33', s);
const orange = s => e('1;38;5;208', s);
const blue = s => e('1;38;5;33', s);

// ─── Profiles ──────────────────────────────────────────────────────────────

const PROFILES = {
  auto:            { emoji: '🤖', uiLabel: 'Auto',          desc: 'Adapts routing based on task risk, provider health, and outcomes' },
  balanced:        { emoji: '⚖️',  uiLabel: 'Balanced',      desc: 'Routes by complexity, uses both providers evenly' },
  'cost-saver':    { emoji: '🛡️', uiLabel: 'Conservative',  desc: 'Fewer GPT dispatches, sticks to Claude for most work' },
  'quality-first': { emoji: '🚀', uiLabel: 'Aggressive',    desc: 'Maximizes both subscriptions, dual-brain for medium+ risk' },
};

const PROFILE_BUDGETS = {
  auto:            { session_warn_usd: 5, session_limit_usd: 10, daily_warn_usd: 20, daily_limit_usd: 50 },
  balanced:        { session_warn_usd: 5, session_limit_usd: 10, daily_warn_usd: 20, daily_limit_usd: 50 },
  'cost-saver':    { session_warn_usd: 2, session_limit_usd: 5, daily_warn_usd: 8, daily_limit_usd: 20 },
  'quality-first': { session_warn_usd: 15, session_limit_usd: 30, daily_warn_usd: 50, daily_limit_usd: 100 },
};

function loadProfile() {
  try {
    const data = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
    const name = data.active && PROFILES[data.active] ? data.active : 'auto';
    const custom = data.custom_overrides || {};
    return { name, budgets: { ...PROFILE_BUDGETS[name], ...custom.budgets }, hasCustomBudget: !!custom.budgets };
  } catch {
    return { name: 'auto', budgets: PROFILE_BUDGETS.auto, hasCustomBudget: false };
  }
}

function saveProfile(name, customOverrides) {
  const data = { active: name, switched_at: new Date().toISOString() };
  if (customOverrides) data.custom_overrides = customOverrides;
  const tmp = PROFILE_FILE + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, PROFILE_FILE);
}

// ─── First-Run Detection ──────────────────────────────────────────────────

function isFirstRun() {
  if (existsSync(LAUNCHED_MARKER)) return false;
  // Also check Claude history for any session in this workspace
  const historyFile = join(HOME, '.claude', 'history.jsonl');
  if (existsSync(historyFile)) {
    try {
      const content = readFileSync(historyFile, 'utf8');
      if (content.includes('"sessionId"')) return false;
    } catch {}
  }
  return true;
}

function markLaunched() {
  try { writeFileSync(LAUNCHED_MARKER, new Date().toISOString() + '\n'); } catch {}
}

// ─── Provider Detection ───────────────────────────────────────────────────

function detectProviders() {
  const claude = { installed: false, authed: false };
  const codex = { installed: false, authed: false };

  const claudeCheck = spawnSync('which', ['claude'], { encoding: 'utf8', stdio: 'pipe', timeout: 3000 });
  claude.installed = claudeCheck.status === 0 && !!claudeCheck.stdout.trim();

  const credPaths = [
    join(HOME, '.claude', '.credentials.json'),
    join(HOME, '.claude', 'credentials.json'),
    join(CWD, '.replit-tools', '.claude-persistent', '.credentials.json'),
  ];
  for (const p of credPaths) {
    try {
      const cred = JSON.parse(readFileSync(p, 'utf8'));
      if (cred.claudeAiOauth || cred.apiKey || cred.oauth_token) { claude.authed = true; break; }
    } catch {}
  }
  if (!claude.authed && claude.installed) {
    const r = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    const out = ((r.stdout || '') + (r.stderr || '')).toLowerCase();
    if (out.includes('logged in') || out.includes('authenticated')) claude.authed = true;
  }

  const codexCheck = spawnSync('which', ['codex'], { encoding: 'utf8', stdio: 'pipe', timeout: 3000 });
  if (codexCheck.status === 0 && codexCheck.stdout.trim()) {
    codex.installed = true;
    const login = spawnSync(codexCheck.stdout.trim(), ['login', 'status'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    const out = ((login.stdout || '') + (login.stderr || '')).toLowerCase();
    if (login.status === 0 || out.includes('logged in') || out.includes('authenticated')) codex.authed = true;
  }

  return { claude, codex };
}

// ─── Session Discovery ────────────────────────────────────────────────────

function getRecentSessions() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const sessions = new Map();

  const isRealPrompt = (txt) => {
    if (!txt) return false;
    const t = txt.trim();
    if (!t) return false;
    if (/^[✅❌📦🔗⚠️🚀🎉🔧📝]/.test(t)) return false;
    if (/Claude (history|binary|versions) symlink/.test(t)) return false;
    if (t.startsWith('# AGENTS.md')) return false;
    return true;
  };

  const historyFile = join(HOME, '.claude', 'history.jsonl');
  if (existsSync(historyFile)) {
    try {
      const lines = readFileSync(historyFile, 'utf8').trim().split('\n');
      const entries = [];
      for (const line of lines) {
        try { const j = JSON.parse(line); if (j.sessionId && j.timestamp) entries.push(j); } catch {}
      }
      entries.sort((a, b) => a.timestamp - b.timestamp);
      for (const j of entries) {
        const key = 'claude:' + j.sessionId;
        if (!sessions.has(key)) {
          sessions.set(key, { tool: 'claude', id: j.sessionId, firstSeen: j.timestamp, lastSeen: j.timestamp, firstPrompt: '' });
        }
        const s = sessions.get(key);
        if (j.timestamp < s.firstSeen) s.firstSeen = j.timestamp;
        if (j.timestamp > s.lastSeen) s.lastSeen = j.timestamp;
        if (!s.firstPrompt && isRealPrompt(j.display)) s.firstPrompt = j.display;
      }
      for (const [key, s] of sessions) {
        if (s.tool === 'claude' && !s.firstPrompt) sessions.delete(key);
      }
    } catch {}
  }

  const codexDir = join(HOME, '.codex', 'sessions');
  if (existsSync(codexDir)) {
    const walk = (dir) => {
      let results = [];
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) results = results.concat(walk(full));
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(full);
        }
      } catch {}
      return results;
    };
    for (const f of walk(codexDir)) {
      try {
        const stat = statSync(f);
        if (stat.mtimeMs < cutoff) continue;
        const content = readFileSync(f, 'utf8');
        const lns = content.trim().split('\n');
        if (!lns.length) continue;
        const meta = JSON.parse(lns[0]);
        if (meta.type !== 'session_meta' || !meta.payload) continue;
        if (meta.payload.cwd !== CWD) continue;
        const id = meta.payload.id;
        const firstTs = Date.parse(meta.payload.timestamp || meta.timestamp);
        let lastTs = firstTs;
        let firstPrompt = '';
        let realMsgCount = 0;
        for (const ln of lns) {
          try {
            const j = JSON.parse(ln);
            if (j.timestamp) lastTs = Math.max(lastTs, Date.parse(j.timestamp));
            if (j.type === 'event_msg' && j.payload?.type === 'user_message') {
              const text = (j.payload.message || '').trim();
              if (text) { if (!firstPrompt) firstPrompt = text; realMsgCount++; }
            }
          } catch {}
        }
        if (realMsgCount === 0 || !firstPrompt) continue;
        if (/^(you are |you're |\*\*role\*\*|<role>|## role)/i.test(firstPrompt)) continue;
        if (realMsgCount === 1 && firstPrompt.length > 500) continue;
        sessions.set('codex:' + id, { tool: 'codex', id, firstSeen: firstTs, lastSeen: lastTs, firstPrompt });
      } catch {}
    }
  }

  return Array.from(sessions.values())
    .filter(s => (s.lastSeen || 0) >= cutoff)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .slice(0, 9);
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const h = Math.round(mins / 60);
  return h + 'h ago';
}

function snippet(s, n = 15) {
  const clean = (s || '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

function countRunning() {
  let claude = 0, codex = 0;
  try {
    const r = spawnSync('pgrep', ['-x', 'claude'], { encoding: 'utf8', stdio: 'pipe', timeout: 2000 });
    claude = (r.stdout || '').trim().split('\n').filter(Boolean).length;
  } catch {}
  try {
    const r = spawnSync('pgrep', ['-x', 'codex'], { encoding: 'utf8', stdio: 'pipe', timeout: 2000 });
    codex = (r.stdout || '').trim().split('\n').filter(Boolean).length;
  } catch {}
  return { claude, codex };
}

// ─── Provider Balance ─────────────────────────────────────────────────────

function loadProviderBalance() {
  const today = new Date().toISOString().slice(0, 10);
  const logFile = join(__dirname, `usage-${today}.jsonl`);
  if (!existsSync(logFile)) return { claude: 0, openai: 0, total: 0, label: 'No activity yet' };

  let claude = 0, openai = 0;
  try {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.provider === 'claude') claude++;
        else if (e.provider === 'openai') openai++;
      } catch {}
    }
  } catch {}

  const total = claude + openai;
  if (total === 0) return { claude: 0, openai: 0, total: 0, label: 'No activity yet' };

  const claudePct = Math.round((claude / total) * 100);
  const openaiPct = 100 - claudePct;

  let label;
  if (openaiPct === 0) label = 'Claude only — GPT subscription unused';
  else if (claudePct === 0) label = 'GPT only — Claude subscription unused';
  else if (Math.abs(claudePct - openaiPct) <= 20) label = 'Well balanced';
  else if (claudePct > openaiPct) label = `Claude-heavy — GPT has capacity`;
  else label = `GPT-heavy — Claude has capacity`;

  return { claude: claudePct, openai: openaiPct, total, label };
}

function balanceBar(claudePct, openaiPct, width = 20) {
  if (claudePct === 0 && openaiPct === 0) return dim('░'.repeat(width) + '  no activity');
  const cFill = Math.round((claudePct / 100) * width);
  const oFill = width - cFill;
  const cBar = noColor ? '█'.repeat(cFill) : `\x1b[38;5;208m${'█'.repeat(cFill)}\x1b[0m`;
  const oBar = noColor ? '▓'.repeat(oFill) : `\x1b[32m${'▓'.repeat(oFill)}\x1b[0m`;
  return `${cBar}${oBar}  ${orange(claudePct + '%')} Claude · ${green(openaiPct + '%')} GPT`;
}

// ─── Menu Renderers ───────────────────────────────────────────────────────

function renderFirstRunMenu(providers) {
  const lines = [];

  lines.push('');
  lines.push(`  🧠 ${bold(`Dual-Brain v${VERSION}`)}`);
  lines.push('');

  // Provider status
  const cStat = providers.claude.authed ? '✅' : providers.claude.installed ? '⚠️' : '❌';
  const xStat = providers.codex.authed ? '✅' : providers.codex.installed ? '⚠️' : '❌';
  lines.push(`  🟠 Claude ${cStat}  🟢 Codex ${xStat}`);

  if (providers.claude.authed && providers.codex.authed) {
    lines.push(`  ${green('Both providers ready — full dual-brain mode')}`);
  } else if (providers.claude.authed) {
    lines.push(`  ${dim('Claude ready. Add Codex for dual-brain features.')}`);
  } else if (!providers.claude.installed) {
    lines.push(`  ${yellow('Claude not found — needed to start.')}`);
  } else {
    lines.push(`  ${yellow('Claude needs login to start.')}`);
  }

  lines.push('');

  // Auth actions if needed
  if (!providers.claude.authed || !providers.codex.authed) {
    if (!providers.claude.installed) {
      lines.push(`  ${dim('Install Claude:')} ${cyan('curl -fsSL https://claude.ai/install.sh | sh')}`);
    }
    if (!providers.claude.authed && providers.claude.installed) {
      lines.push(`  ${bold('[j]')} Sign in to Claude`);
    }
    if (!providers.codex.installed) {
      lines.push(`  ${dim('Install Codex:')} ${cyan('npm i -g @openai/codex')}`);
    } else if (!providers.codex.authed) {
      lines.push(`  ${bold('[k]')} Sign in to Codex ${dim('(optional — enables GPT collaboration)')}`);
    }
    lines.push('');
  }

  // Replit-tools check
  if (IS_REPLIT && !existsSync(join(CWD, '.replit-tools'))) {
    lines.push(`  ${bold('[t]')} Install replit-tools ${dim('(recommended for Replit)')}`);
  }

  // Primary actions
  lines.push(`  ${bold('[n]')} Start new session`);
  lines.push(`  ${bold('[s]')} Skip — just shell`);
  lines.push('');

  return lines;
}

function renderReturningMenu(providers, sessions) {
  const profile = loadProfile();
  const pf = PROFILES[profile.name];
  const running = countRunning();
  const balance = loadProviderBalance();
  const lines = [];

  lines.push('');
  lines.push(`  🧠 ${bold(`Dual-Brain v${VERSION}`)}`);
  lines.push('');

  // Provider status
  const cStat = providers.claude.authed ? '✅' : '⚠️';
  const xStat = providers.codex.authed ? '✅' : providers.codex.installed ? '⚠️' : '❌';
  let modeStatus = pf.uiLabel;
  if (profile.name === 'auto') {
    if (balance.total === 0) {
      modeStatus = 'Auto · learning your workflow';
    } else if (balance.openai > balance.claude + 20) {
      modeStatus = 'Auto · routing GPT for isolated work';
    } else if (balance.claude > balance.openai + 20) {
      modeStatus = 'Auto · Claude-primary, GPT available';
    } else {
      modeStatus = 'Auto · balanced routing active';
    }
  }
  lines.push(`  🟠 Claude ${cStat}  🟢 Codex ${xStat}  ${pf.emoji}  ${bold(modeStatus)}`);

  // Provider balance bar
  lines.push(`  ${balanceBar(balance.claude, balance.openai)}`);
  if (balance.total > 0) lines.push(`  ${dim(balance.label + ' · ' + balance.total + ' calls today')}`);

  // Recent sessions
  if (sessions.length > 0) {
    lines.push('');
    lines.push(`  ${bold('Recent (last 24h):')}`);
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const num = String(i + 1);
      const toolLabel = s.tool === 'codex' ? orange('cdx') : blue('cld');
      const ago = timeAgo(s.lastSeen).padEnd(9);
      lines.push(`  ${bold('[' + num + ']')} ${toolLabel}  ${dim(ago)} ${snippet(s.firstPrompt)}`);
    }
  }

  lines.push('');

  const runParts = [];
  if (running.claude > 0) runParts.push(`${running.claude} claude`);
  if (running.codex > 0) runParts.push(`${running.codex} codex`);
  if (runParts.length > 0) lines.push(`  ${dim('(' + runParts.join(', ') + ' running)')}`);

  // Menu options
  lines.push(`  ${bold('[c]')} Continue last session`);
  if (sessions.length > 0) lines.push(`  ${bold('[1-9]')} Resume numbered above`);
  lines.push(`  ${bold('[n]')} New session`);
  lines.push(`  ${bold('[p]')} Mode: ${dim(pf.uiLabel)}`);

  // Auth if needed
  if (!providers.claude.authed) lines.push(`  ${bold('[j]')} Sign in to Claude`);
  if (providers.codex.installed && !providers.codex.authed) lines.push(`  ${bold('[k]')} Sign in to Codex`);
  if (IS_REPLIT && !existsSync(join(CWD, '.replit-tools'))) lines.push(`  ${bold('[t]')} Install replit-tools`);

  lines.push(`  ${bold('[s]')} Shell`);
  lines.push('');

  return lines;
}

// ─── Profile Picker ───────────────────────────────────────────────────────

function showProfilePicker(rl) {
  return new Promise((resolve) => {
    const current = loadProfile();
    const balance = loadProviderBalance();
    console.log('');
    console.log(`  ${bold('Switch routing mode:')}`);
    if (balance.total > 0) {
      console.log(`  ${dim('Current balance: Claude ' + balance.claude + '% / GPT ' + balance.openai + '% · ' + balance.label)}`);
    }
    console.log('');
    for (const [i, [name, pf]] of Object.entries(PROFILES).entries()) {
      const active = name === current.name ? ' ✅' : '';
      const recommended = name === 'auto' && current.name !== 'auto' ? dim(' (recommended)') : '';
      console.log(`  ${bold('[' + (i + 1) + ']')} ${pf.emoji}  ${pf.uiLabel.padEnd(15)} ${dim(pf.desc)}${active}${recommended}`);
    }
    console.log(`  ${bold('[q]')} Cancel`);
    console.log('');

    rl.question('  Choice: ', (answer) => {
      const names = Object.keys(PROFILES);
      const trimmed = answer.trim();
      let selectedName = null;

      // Try numeric selection first
      const idx = parseInt(trimmed, 10) - 1;
      if (idx >= 0 && idx < names.length) {
        selectedName = names[idx];
      }

      // Try natural language alias resolution
      if (!selectedName && trimmed && trimmed !== 'q') {
        const PANEL_ALIASES = {
          'auto': 'auto', 'adaptive': 'auto', 'smart': 'auto', 'default': 'auto', 'normal': 'auto',
          'balanced': 'balanced', 'even': 'balanced', 'equal': 'balanced',
          'cost-saver': 'cost-saver', 'cheap': 'cost-saver', 'save': 'cost-saver', 'conservative': 'cost-saver', 'frugal': 'cost-saver', 'budget': 'cost-saver',
          'quality-first': 'quality-first', 'aggressive': 'quality-first', 'quality': 'quality-first', 'max': 'quality-first', 'full': 'quality-first', 'both': 'quality-first',
        };
        const cleaned = trimmed.toLowerCase()
          .replace(/^(go|be|use|switch to|set|mode)\s+/i, '')
          .replace(/\s+mode$/i, '');
        selectedName = PANEL_ALIASES[cleaned] || null;
      }

      if (selectedName) {
        let customOverrides = null;
        try {
          const existing = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
          if (existing.custom_overrides?.budgets) customOverrides = { budgets: existing.custom_overrides.budgets };
        } catch {}
        saveProfile(selectedName, customOverrides);
        const pf = PROFILES[selectedName];
        console.log(`  ✅ Switched to ${pf.emoji}  ${pf.uiLabel}`);
      } else if (trimmed && trimmed !== 'q') {
        console.log(`  Unknown profile: ${trimmed}. Try: cheap, aggressive, quality, balanced, auto`);
      }
      resolve();
    });
  });
}

// (Cost alert editor removed — replaced by provider balance + mode switching)

// ─── Session Runner ───────────────────────────────────────────────────────

function runSession(cmd, args, label) {
  console.log('');
  console.log(`  ${label}`);
  console.log(`  ${dim('Inside Claude: press Ctrl+C twice to return here.')}`);
  console.log('');
  markLaunched();
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  console.log('');
  console.log('  Returned to Dual-Brain.');
  return result.status || 0;
}

// ─── Main Loop ────────────────────────────────────────────────────────────

async function mainLoop() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => new Promise(resolve => rl.question('  Choice: ', resolve));

  while (true) {
    const firstRun = isFirstRun();
    const providers = detectProviders();
    const sessions = firstRun ? [] : getRecentSessions();

    const lines = firstRun
      ? renderFirstRunMenu(providers)
      : renderReturningMenu(providers, sessions);

    for (const l of lines) console.log(l);

    const choice = (await ask()).trim().toLowerCase();

    if (choice === 's' || choice === 'q') {
      console.log('');
      rl.close();
      return;
    }

    if (choice === 'c' || choice === '') {
      if (sessions.length > 0) {
        const s = sessions[0];
        if (s.tool === 'codex') {
          runSession('codex', ['--dangerously-bypass-approvals-and-sandbox', 'resume', s.id], `Resuming codex ${s.id.slice(0, 8)}...`);
        } else {
          runSession('claude', ['-r', s.id, '--dangerously-skip-permissions'], `Resuming session ${s.id.slice(0, 8)}...`);
        }
      } else {
        runSession('claude', ['--dangerously-skip-permissions'], 'Starting new session...');
      }
      continue;
    }

    const num = parseInt(choice, 10);
    if (num >= 1 && num <= 9 && sessions[num - 1]) {
      const s = sessions[num - 1];
      if (s.tool === 'codex') {
        runSession('codex', ['--dangerously-bypass-approvals-and-sandbox', 'resume', s.id], `Resuming codex ${s.id.slice(0, 8)}...`);
      } else {
        runSession('claude', ['-r', s.id, '--dangerously-skip-permissions'], `Resuming session ${s.id.slice(0, 8)}...`);
      }
      continue;
    }

    if (choice === 'n') {
      runSession('claude', ['--dangerously-skip-permissions'], 'Starting new session...');
      continue;
    }

    if (choice === 'p') {
      await showProfilePicker(rl);
      continue;
    }

    if (choice === 'j') {
      console.log('');
      console.log('  Starting Claude login...');
      console.log('');
      spawnSync('claude', ['login'], { stdio: 'inherit' });
      continue;
    }

    if (choice === 'k') {
      const codexPath = spawnSync('which', ['codex'], { encoding: 'utf8', stdio: 'pipe', timeout: 3000 });
      if (codexPath.status !== 0) {
        console.log('');
        console.log(`  Codex not installed. Run: ${cyan('npm i -g @openai/codex')}`);
        console.log('');
        await ask();
        continue;
      }
      console.log('');
      console.log('  Starting Codex login...');
      console.log('');
      spawnSync(codexPath.stdout.trim(), ['login'], { stdio: 'inherit' });
      continue;
    }

    if (choice === 't' && IS_REPLIT) {
      console.log('');
      console.log('  Installing replit-tools...');
      console.log('');
      spawnSync('npx', ['-y', 'data-tools'], { stdio: 'inherit', cwd: CWD });
      console.log('');
      console.log('  ✅ replit-tools installed.');
      console.log('');
      await ask();
      continue;
    }

    console.log(`  Unknown option: ${choice}`);
  }
}

// ─── Non-Interactive Fallback ─────────────────────────────────────────────

function renderStatic() {
  const providers = detectProviders();
  const sessions = getRecentSessions();
  const lines = sessions.length > 0
    ? renderReturningMenu(providers, sessions)
    : renderFirstRunMenu(providers);
  for (const l of lines) console.log(l);
}

// ─── Entry ────────────────────────────────────────────────────────────────

if (process.stdin.isTTY && process.stdout.isTTY && !process.env.CI) {
  mainLoop().catch(err => { console.error(err); process.exit(1); });
} else {
  renderStatic();
}
