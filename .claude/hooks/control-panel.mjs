#!/usr/bin/env node
/**
 * control-panel.mjs — Session launcher for Dual-Brain.
 *
 * Progressive disclosure: first-run shows minimal menu (new/shell + auth).
 * Returning users see recent sessions, profile mode, cost alert settings.
 * Loops until user exits to shell.
 */

import readline from 'readline';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_FILE = join(__dirname, '..', 'dual-brain.profile.json');
const PERMISSIONS_FILE = join(__dirname, '..', 'dual-brain.permissions.json');
const LAUNCHED_MARKER = join(__dirname, '..', '.launched');
const VERSION_STAMP_FILE = join(__dirname, '..', 'dual-brain.version.json');
const UPDATE_CACHE_FILE = join(__dirname, '..', 'dual-brain.update-check.json');
const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;
const VERSION = (() => {
  try {
    const stamp = JSON.parse(readFileSync(VERSION_STAMP_FILE, 'utf8'));
    if (stamp.version) return stamp.version;
  } catch {}
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

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function loadPermissions() {
  const defaults = {
    claude_skip_permissions: false,
    codex_bypass_sandbox: false,
  };
  try {
    const data = JSON.parse(readFileSync(PERMISSIONS_FILE, 'utf8'));
    return {
      claude_skip_permissions: !!data.claude_skip_permissions,
      codex_bypass_sandbox: !!data.codex_bypass_sandbox,
    };
  } catch {
    return defaults;
  }
}

function savePermissions(perms) {
  const next = {
    claude_skip_permissions: !!perms.claude_skip_permissions,
    codex_bypass_sandbox: !!perms.codex_bypass_sandbox,
  };
  const tmp = PERMISSIONS_FILE + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  renameSync(tmp, PERMISSIONS_FILE);
}

function compareVersions(a, b) {
  const aParts = String(a || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const bParts = String(b || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getInstalledVersion() {
  return readJsonFile(VERSION_STAMP_FILE)?.version || VERSION;
}

function getCachedUpdateStatus() {
  const cache = readJsonFile(UPDATE_CACHE_FILE);
  if (!cache?.checked_at) return null;
  const age = Date.now() - Date.parse(cache.checked_at);
  if (!Number.isFinite(age) || age < 0 || age > UPDATE_CACHE_TTL_MS) return null;
  return cache;
}

function writeUpdateStatusCache(result) {
  writeJsonFile(UPDATE_CACHE_FILE, {
    checked_at: new Date().toISOString(),
    ...result,
  });
}

function checkForUpdate({ force = false } = {}) {
  const installed = getInstalledVersion();

  if (!force) {
    const cached = getCachedUpdateStatus();
    if (cached && cached.installed === installed) {
      return {
        updateAvailable: !!cached.updateAvailable,
        installed: cached.installed,
        latest: cached.latest || installed,
        checkedAt: cached.checked_at,
      };
    }
  }

  try {
    const result = spawnSync('npm', ['view', 'dual-brain', 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    if (result.status !== 0 || !result.stdout.trim()) return null;
    const latestRaw = JSON.parse(result.stdout);
    const latest = Array.isArray(latestRaw) ? latestRaw[latestRaw.length - 1] : latestRaw;
    if (!latest) return null;
    const payload = {
      updateAvailable: compareVersions(latest, installed) > 0,
      installed,
      latest,
    };
    writeUpdateStatusCache(payload);
    return payload;
  } catch {
    return null;
  }
}

function formatVersionStatus(updateInfo) {
  const installed = updateInfo?.installed || getInstalledVersion();
  if (updateInfo?.updateAvailable && updateInfo.latest) return `v${installed} → v${updateInfo.latest} available`;
  if (updateInfo?.latest && updateInfo.latest === installed) return `v${installed} (up to date)`;
  return `v${installed}`;
}

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
    const ok = login.status === 0 || (out.includes('logged in') && !out.includes('not logged in'));
    if (ok) codex.authed = true;
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

function snippet(s, n = 35) {
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

function otherProviderForSession(session) {
  return session?.tool === 'codex' ? 'claude' : 'codex';
}

function sessionBrief(session, target) {
  const prompt = session?.firstPrompt || session?.name || session?.id || 'previous session';
  return [
    `Continue the ${session?.tool || 'claude'} session in ${target}.`,
    session?.id ? `Original session id: ${session.id}.` : '',
    `Context: ${String(prompt).replace(/\s+/g, ' ').slice(0, 700)}`,
  ].filter(Boolean).join(' ');
}

function importVisibleSessions(sessions) {
  const dir = join(CWD, '.dualbrain');
  const file = join(dir, 'sessions.json');
  mkdirSync(dir, { recursive: true });
  let meta = {};
  try { meta = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const now = new Date().toISOString();
  let count = 0;
  for (const s of sessions) {
    if (!s?.id) continue;
    if (meta[s.id]?.source === 'data-tools') continue;
    meta[s.id] = {
      ...(meta[s.id] || {}),
      source: 'data-tools',
      tool: s.tool || 'claude',
      importedAt: now,
      createdAt: meta[s.id]?.createdAt || now,
      name: s.firstPrompt || s.id,
    };
    count++;
  }
  const tmp = file + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n');
  renameSync(tmp, file);
  return count;
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

// ─── Auth Detail Helpers ──────────────────────────────────────────────────

function getClaudeAuthDetail() {
  const credPaths = [
    join(HOME, '.claude', '.credentials.json'),
    join(HOME, '.claude', 'credentials.json'),
    join(CWD, '.replit-tools', '.claude-persistent', '.credentials.json'),
  ];
  for (const p of credPaths) {
    try {
      const cred = JSON.parse(readFileSync(p, 'utf8'));
      if (cred.claudeAiOauth) {
        const exp = cred.claudeAiOauth.expiresAt;
        let expiryText = 'n/a';
        if (exp) {
          const remaining = exp - Date.now();
          if (remaining <= 0) expiryText = 'expired';
          else {
            const h = Math.floor(remaining / 3600000);
            const m = Math.floor((remaining % 3600000) / 60000);
            expiryText = `${h}h ${m}m remaining`;
          }
        }
        return { method: 'subscription (OAuth)', expiry: expiryText, storage: p.replace(HOME, '~') };
      }
      if (cred.apiKey) return { method: 'API key', expiry: 'n/a', storage: p.replace(HOME, '~') };
    } catch {}
  }
  return { method: 'unknown', expiry: 'n/a', storage: 'n/a' };
}

function getCodexAuthDetail() {
  const authPath = join(HOME, '.codex', 'auth.json');
  try {
    const stat = statSync(authPath);
    return {
      method: 'subscription (device-auth)',
      lastRefresh: timeAgo(stat.mtimeMs),
      storage: '~/.codex/auth.json',
    };
  } catch {}
  return { method: 'unknown', lastRefresh: 'n/a', storage: 'n/a' };
}

// ─── Submenu: Auth ────────────────────────────────────────────────────────

async function showAuthMenu(rl, providers) {
  const ask = () => new Promise(resolve => rl.question('  Choice: ', resolve));

  while (true) {
    const claudeDetail = getClaudeAuthDetail();
    const codexDetail = getCodexAuthDetail();
    const cStat = providers.claude.authed ? green('✅ authenticated') : yellow('❌ not authenticated');
    const xStat = providers.codex.authed ? green('✅ authenticated') : yellow('❌ not authenticated');

    console.log('');
    console.log(`  ${bold('🔑 Auth Management')}`);
    console.log('  ' + '─'.repeat(44));
    console.log(`  🟠 Claude  ${cStat}`);
    if (providers.claude.authed) {
      console.log(`     Method:  ${dim(claudeDetail.method)}`);
      console.log(`     Expiry:  ${dim(claudeDetail.expiry)}`);
      console.log(`     Storage: ${dim(claudeDetail.storage)}`);
    }
    console.log('');
    console.log(`  🟢 Codex   ${xStat}`);
    if (providers.codex.authed) {
      console.log(`     Method:  ${dim(codexDetail.method)}`);
      console.log(`     Refresh: ${dim(codexDetail.lastRefresh)}`);
      console.log(`     Storage: ${dim(codexDetail.storage)}`);
    }
    console.log('');
    if (!providers.claude.authed) console.log(`  ${bold('[j]')} Sign in to Claude`);
    if (providers.codex.installed && !providers.codex.authed) console.log(`  ${bold('[k]')} Sign in to Codex ${dim('(ChatGPT subscription)')}`);
    if (providers.claude.authed || providers.codex.authed) console.log(`  ${bold('[r]')} Refresh all tokens`);
    console.log(`  ${bold('[q]')} Back to main menu`);
    console.log('');

    const choice = (await ask()).trim().toLowerCase();
    if (choice === 'q' || choice === '') return;

    if (choice === 'j') {
      console.log('');
      const r = spawnSync('claude', ['login'], { stdio: 'inherit' });
      const fresh = detectProviders();
      providers.claude = fresh.claude;
      if (providers.claude.authed) {
        console.log(`  ${green('Claude authenticated.')}`);
      } else {
        console.log(`  ${yellow('Claude login did not complete.')} Try again or check your subscription.`);
      }
      continue;
    }
    if (choice === 'k' && providers.codex.installed) {
      const codexPath = spawnSync('which', ['codex'], { encoding: 'utf8', stdio: 'pipe', timeout: 3000 });
      if (codexPath.status === 0) {
        console.log('');
        console.log(`  Open: ${cyan('https://auth.openai.com/codex/device')}`);
        console.log('');
        spawnSync(codexPath.stdout.trim(), ['login', '--device-auth'], { stdio: 'inherit' });
        const fresh = detectProviders();
        providers.codex = fresh.codex;
        if (providers.codex.authed) {
          console.log(`  ${green('Codex authenticated.')}`);
        } else {
          console.log(`  ${yellow('Codex login did not complete.')} Try again.`);
        }
      }
      continue;
    }
    if (choice === 'r') {
      console.log('');
      const refreshScript = join(CWD, '.replit-tools', 'scripts', 'claude-auth-refresh.sh');
      if (existsSync(refreshScript)) {
        console.log('  Refreshing Claude token...');
        const r = spawnSync('bash', [refreshScript, '--force'], { encoding: 'utf8', stdio: 'pipe', timeout: 10000 });
        console.log(`  ${(r.stdout || '').trim() || 'Done'}`);
      }
      console.log('  Codex tokens refreshed on next API call.');
      console.log('');
      continue;
    }
  }
}

// ─── Submenu: Budget ──────────────────────────────────────────────────────

async function showBudgetMenu(rl) {
  const ask = () => new Promise(resolve => rl.question('  Choice: ', resolve));

  while (true) {
    const profile = loadProfile();
    const balance = loadProviderBalance();

    console.log('');
    console.log(`  ${bold('💵 Budget & Spend')}`);
    console.log('  ' + '─'.repeat(44));
    console.log(`  Session:  ⚠️  $${profile.budgets.session_warn_usd} warn · 🛑 $${profile.budgets.session_limit_usd} limit`);
    console.log(`  Daily:    ⚠️  $${profile.budgets.daily_warn_usd} warn · 🛑 $${profile.budgets.daily_limit_usd} limit`);
    console.log('');
    console.log(`  Today: ${balance.total} calls · ${balance.label}`);
    console.log(`  ${balanceBar(balance.claude, balance.openai)}`);
    console.log('');
    console.log(`  ${bold('[c]')} Change budget limits`);
    console.log(`  ${bold('[r]')} Full cost report`);
    console.log(`  ${bold('[q]')} Back to main menu`);
    console.log('');

    const choice = (await ask()).trim().toLowerCase();
    if (choice === 'q' || choice === '') return;

    if (choice === 'c') {
      const sessionAns = await new Promise(r => rl.question('  New session limit ($): ', r));
      const sessionVal = parseFloat(sessionAns);
      if (isNaN(sessionVal) || sessionVal <= 0) { console.log('  Invalid number.'); continue; }
      const dailyAns = await new Promise(r => rl.question(`  New daily limit ($ default ${sessionVal * 3}): `, r));
      const dailyVal = dailyAns.trim() ? parseFloat(dailyAns) : sessionVal * 3;
      if (isNaN(dailyVal) || dailyVal <= 0) { console.log('  Invalid number.'); continue; }

      const customOverrides = {
        budgets: {
          session_warn_usd: +(sessionVal * 0.6).toFixed(2),
          session_limit_usd: sessionVal,
          daily_warn_usd: +(dailyVal * 0.6).toFixed(2),
          daily_limit_usd: dailyVal,
        },
      };
      let existing = {};
      try { existing = JSON.parse(readFileSync(PROFILE_FILE, 'utf8')); } catch {}
      saveProfile(existing.active || 'auto', customOverrides);
      console.log(`  ✅ Budget updated: $${sessionVal}/session, $${dailyVal}/day`);
      continue;
    }

    if (choice === 'r') {
      console.log('');
      spawnSync(process.execPath, [join(__dirname, 'cost-report.mjs')], { stdio: 'inherit' });
      console.log('');
      await new Promise(r => rl.question('  Press Enter to continue...', r));
      continue;
    }
  }
}

// ─── Submenu: Tools Dashboard ─────────────────────────────────────────────

async function showToolsMenu(rl) {
  const ask = () => new Promise(resolve => rl.question('  Choice: ', resolve));

  while (true) {
    const updateInfo = checkForUpdate();
    console.log('');
    console.log(`  ${bold('🛠️  Tools & Diagnostics')}`);
    console.log('  ' + '─'.repeat(44));
    console.log(`  ${bold('[1]')} Health check`);
    console.log(`  ${bold('[2]')} Cost report`);
    console.log(`  ${bold('[3]')} Decision ledger insights`);
    console.log(`  ${bold('[4]')} Run test suite (40 tests)`);
    console.log(`  ${bold('[5]')} Session report`);
    console.log(`  ${bold('[u]')} Update Dual Brain ${dim('(' + formatVersionStatus(updateInfo) + ')')}`);
    console.log(`  ${bold('[q]')} Back to main menu`);
    console.log('');

    const choice = (await ask()).trim().toLowerCase();
    if (choice === 'q' || choice === '') return;

    const tools = {
      '1': 'health-check.mjs',
      '2': 'cost-report.mjs',
      '3': 'decision-ledger.mjs',
      '4': 'test-orchestrator.mjs',
      '5': 'session-report.mjs',
    };

    if (tools[choice]) {
      console.log('');
      spawnSync(process.execPath, [join(__dirname, tools[choice])], { stdio: 'inherit' });
      console.log('');
      await new Promise(r => rl.question('  Press Enter to continue...', r));
      continue;
    }

    if (choice === 'u') {
      console.log('');
      const result = spawnSync('npx', ['-y', 'dual-brain', 'update'], { stdio: 'inherit', cwd: CWD });
      console.log('');
      if (result.status === 0) {
        console.log('  ✅ Dual-brain hooks refreshed.');
      } else {
        console.log('  ⚠️  Update did not complete.');
      }
      console.log('');
      await new Promise(r => rl.question('  Press Enter to continue...', r));
    }
  }
}

// ─── Submenu: Data Tools Status ───────────────────────────────────────────

async function showDataToolsStatus(rl, providers) {
  const dtPath = join(CWD, '.replit-tools');
  const configPath = join(dtPath, 'config.json');
  const claudeArchive = join(dtPath, '.session-archive', 'claude', 'history.jsonl');
  const codexArchive = join(dtPath, '.session-archive', 'codex', 'history.jsonl');
  const claudeCreds = join(dtPath, '.claude-persistent', '.credentials.json');
  const codexAuth = join(dtPath, '.codex-persistent', 'auth.json');
  const sessionManager = join(dtPath, 'scripts', 'claude-session-manager.sh');

  const fileStatus = (p) => existsSync(p) ? green('present') : yellow('missing');
  const countLines = (p) => {
    try {
      return readFileSync(p, 'utf8').split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  };

  console.log('');
  console.log(`  ${bold('Data Tools Integration')}`);
  console.log('  ' + '─'.repeat(44));
  if (!existsSync(dtPath)) {
    console.log(`  ${yellow('replit-tools is not installed in this workspace.')}`);
    console.log('');
    console.log(`  ${bold('[i]')} Install replit-tools`);
    console.log(`  ${bold('[q]')} Back to main menu`);
    const choice = (await new Promise(resolve => rl.question('  Choice: ', resolve))).trim().toLowerCase();
    if (choice === 'i') spawnSync('npx', ['-y', 'data-tools'], { stdio: 'inherit', cwd: CWD });
    return;
  }

  console.log(`  Root:            ${dim(dtPath)}`);
  console.log(`  Config:          ${fileStatus(configPath)}`);
  console.log(`  Claude auth:     ${providers.claude.authed ? green('authenticated') : yellow('not authenticated')} ${dim('(' + fileStatus(claudeCreds) + ')')}`);
  console.log(`  Codex auth:      ${providers.codex.authed ? green('authenticated') : yellow('not authenticated')} ${dim('(' + fileStatus(codexAuth) + ')')}`);
  console.log(`  Claude archive:  ${countLines(claudeArchive)} entries`);
  console.log(`  Codex archive:   ${countLines(codexArchive)} entries`);
  console.log(`  Session manager: ${fileStatus(sessionManager)}`);
  console.log('');
  console.log(`  ${dim('The original Replit/Data Tools menu is still available with:')} ${cyan('claude-menu')}`);
  console.log('');
  console.log(`  ${bold('[r]')} Refresh auth`);
  console.log(`  ${bold('[m]')} Open original session manager`);
  console.log(`  ${bold('[q]')} Back to main menu`);
  console.log('');

  const choice = (await new Promise(resolve => rl.question('  Choice: ', resolve))).trim().toLowerCase();
  if (choice === 'r') {
    const refreshScript = join(dtPath, 'scripts', 'claude-auth-refresh.sh');
    if (existsSync(refreshScript)) {
      spawnSync('bash', [refreshScript, '--force'], { stdio: 'inherit', cwd: CWD });
    } else {
      console.log(`  ${yellow('Refresh script missing.')}`);
    }
    await new Promise(resolve => rl.question('  Press Enter to continue...', resolve));
  }
  if (choice === 'm') {
    console.log('');
    console.log(`  ${dim('Opening the original Data Tools session manager. Use [s] there to return to shell.')}`);
    console.log('');
    spawnSync('bash', ['-lc', `source "${sessionManager}" && claude_prompt`], { stdio: 'inherit', cwd: CWD });
  }
}

// ─── Submenu: Vibe Workflow ───────────────────────────────────────────────

async function showVibeWorkflow(rl) {
  console.log('');
  console.log(`  ${bold('Vibe Workflow')} ${dim('— describe what you want, we orchestrate it')}`);
  console.log('');
  console.log(`  Tell us what to build, fix, or change in plain English.`);
  console.log(`  The wave orchestrator will plan, dispatch agents, test, and review.`);
  console.log('');

  const utterance = await new Promise(resolve => {
    rl.question(`  ${bold('What do you want?')} `, resolve);
  });

  const trimmed = utterance.trim();
  if (!trimmed || trimmed === 'q') return;

  // Ask dry-run or execute
  console.log('');
  const mode = await new Promise(resolve => {
    rl.question(`  ${bold('[d]')} Dry run (plan only)  ${bold('[g]')} Go (execute)  ${bold('[q]')} Cancel: `, resolve);
  });

  const modeChoice = mode.trim().toLowerCase();
  if (modeChoice === 'q' || !modeChoice) return;

  const isDryRun = modeChoice === 'd';
  const args = isDryRun
    ? ['hooks/wave-orchestrator.mjs', '--dry-run', trimmed]
    : ['hooks/wave-orchestrator.mjs', trimmed];

  console.log('');
  console.log(`  ${isDryRun ? 'Planning' : 'Orchestrating'}...`);
  console.log('');

  const result = spawnSync('node', args, {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    encoding: 'utf8',
    timeout: 600_000,
  });

  if (result.status !== 0) {
    console.log('');
    console.log(`  ${noColor ? '[!]' : '⚠️'}  Wave orchestrator exited with code ${result.status}`);
    if (result.error) console.log(`  ${dim(result.error.message)}`);
  }

  console.log('');
  const next = await new Promise(resolve => {
    rl.question(`  Press Enter to return to menu...`, resolve);
  });
}

// ─── Menu Renderers ───────────────────────────────────────────────────────

function renderFirstRunMenu(providers) {
  const lines = [];
  const updateInfo = checkForUpdate();

  lines.push('');
  lines.push(`  🧠 ${bold('Data Tools')} ${dim('—')} ${bold('Dual Brain')} ${dim(`v${VERSION}`)}`);
  lines.push(`  ${dim(formatVersionStatus(updateInfo))}`);
  lines.push(`  ${dim('Powered by replit-tools by Steve Moraco')}`);
  lines.push('');

  // Provider status
  const cStat = providers.claude.authed ? (noColor ? '[OK]' : '✅') : providers.claude.installed ? (noColor ? '[!]' : '⚠️') : (noColor ? '[X]' : '❌');
  const xStat = providers.codex.authed ? (noColor ? '[OK]' : '✅') : providers.codex.installed ? (noColor ? '[!]' : '⚠️') : (noColor ? '[X]' : '❌');
  lines.push(`  ${noColor ? '' : '🟠 '}Claude ${cStat}  ${noColor ? '' : '🟢 '}Codex ${xStat}`);

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

  // Data Tools integration status
  if (IS_REPLIT && existsSync(join(CWD, '.replit-tools'))) {
    lines.push(`  ${bold('[t]')} Data Tools status`);
  } else if (IS_REPLIT) {
    lines.push(`  ${bold('[t]')} Install replit-tools ${dim('(recommended for Replit)')}`);
  }

  // Primary actions
  lines.push(`  ${bold('[n]')} Start new session`);
  lines.push(`  ${bold('[w]')} Vibe workflow ${dim('(natural language → orchestrated work)')}`);
  lines.push(`  ${bold('[a]')} Auth management`);
  lines.push(`  ${bold('[d]')} Dashboard & diagnostics`);
  lines.push(`  ${bold('[s]')} Skip — just shell`);
  lines.push(`  ${dim('Enter = new session · [?] help')}`);

  lines.push('');

  return lines;
}

function renderReturningMenu(providers, sessions) {
  const profile = loadProfile();
  const permissions = loadPermissions();
  const pf = PROFILES[profile.name];
  const running = countRunning();
  const balance = loadProviderBalance();
  const updateInfo = checkForUpdate();
  const lines = [];

  lines.push('');
  lines.push(`  🧠 ${bold('Data Tools')} ${dim('—')} ${bold('Dual Brain')} ${dim(`v${VERSION}`)}`);
  lines.push(`  ${dim(formatVersionStatus(updateInfo))}`);
  lines.push(`  ${dim('Powered by replit-tools by Steve Moraco')}`);
  lines.push('');

  // Provider status
  const cStat = providers.claude.authed ? (noColor ? '[OK]' : '✅') : (noColor ? '[!]' : '⚠️');
  const xStat = providers.codex.authed ? (noColor ? '[OK]' : '✅') : providers.codex.installed ? (noColor ? '[!]' : '⚠️') : (noColor ? '[X]' : '❌');
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

  // ── Sessions
  lines.push(`  ${dim('─── Sessions')}`);
  lines.push(`  ${bold('[c]')} Continue last session`);
  lines.push(`  ${bold('[g]')} Continue last in other provider`);
  if (sessions.length > 0) lines.push(`  ${bold('[1-9]')} Resume numbered above`);
  lines.push(`  ${bold('[n]')} New session`);
  lines.push(`  ${bold('[i]')} Import/sync sessions`);
  lines.push(`  ${bold('[w]')} Vibe workflow ${dim('(say what you want, we handle the rest)')}`);

  // ── Settings
  lines.push('');
  lines.push(`  ${dim('─── Settings')}`);
  lines.push(`  ${bold('[p]')} Mode: ${dim(pf.uiLabel)}`);
  lines.push(`  ${bold('[b]')} Budget: ${dim('$' + profile.budgets.session_limit_usd + '/session, $' + profile.budgets.daily_limit_usd + '/day')}`);
  lines.push(`  ${bold('[x]')} Permissions: ${dim(permissions.claude_skip_permissions || permissions.codex_bypass_sandbox ? 'skip-permissions enabled' : 'safe mode')}`);

  // ── Auth
  lines.push('');
  const authSummary = providers.claude.authed && providers.codex.authed
    ? green('both connected')
    : providers.claude.authed ? yellow('Claude only')
    : yellow('needs setup');
  lines.push(`  ${dim('─── Auth')}`);
  lines.push(`  ${bold('[a]')} Auth management ${dim('(' + authSummary + ')')}`);

  // ── Tools
  lines.push('');
  lines.push(`  ${dim('─── Tools')}`);
  lines.push(`  ${bold('[d]')} Dashboard & diagnostics`);
  lines.push(`  ${bold('[u]')} Update Dual Brain ${dim('(' + formatVersionStatus(updateInfo) + ')')}`);

  if (IS_REPLIT && existsSync(join(CWD, '.replit-tools'))) {
    lines.push(`  ${bold('[t]')} Data Tools status`);
  } else if (IS_REPLIT) {
    lines.push(`  ${bold('[t]')} Install replit-tools`);
  }

  lines.push('');
  lines.push(`  ${bold('[s]')} Exit to shell`);
  if (sessions.length > 0) {
    lines.push(`  ${dim('Enter = continue last · [?] help')}`);
  } else {
    lines.push(`  ${dim('Enter = new session · [?] help')}`);
  }
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
  const permissions = loadPermissions();
  const finalArgs = [...args];
  if (cmd === 'claude' && permissions.claude_skip_permissions) {
    finalArgs.push('--dangerously-skip-permissions');
  }
  if (cmd === 'codex' && permissions.codex_bypass_sandbox) {
    finalArgs.push('--dangerously-bypass-approvals-and-sandbox');
  }

  console.log('');
  console.log(`  ${label}`);
  console.log(`  ${dim('Inside Claude: press Ctrl+C twice to return here.')}`);
  console.log('');
  markLaunched();
  const result = spawnSync(cmd, finalArgs, { stdio: 'inherit' });
  console.log('');
  if (result.status !== 0 && result.status !== null) {
    console.log(`  ${yellow('Session exited with code ' + result.status + '.')} ${dim('(' + cmd + ' ' + finalArgs.join(' ') + ')')}`);
  }
  console.log('  Returned to Data Tools — Dual Brain.');
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
          runSession('codex', ['resume', s.id], `Resuming codex ${s.id.slice(0, 8)}...`);
        } else {
          runSession('claude', ['-r', s.id], `Resuming session ${s.id.slice(0, 8)}...`);
        }
      } else if (!providers.claude.authed && !providers.claude.installed) {
        console.log('');
        console.log(`  ${yellow('Claude is not installed.')} Install first:`);
        console.log(`  ${cyan('curl -fsSL https://claude.ai/install.sh | sh')}`);
        console.log('');
      } else if (!providers.claude.authed) {
        console.log('');
        console.log(`  ${yellow('Claude is not authenticated.')} Press ${bold('[j]')} to sign in first.`);
        console.log('');
      } else {
        runSession('claude', [], 'Starting new session...');
      }
      continue;
    }

    if (choice === 'g') {
      if (sessions.length === 0) {
        console.log('');
        console.log(`  ${yellow('No recent session to switch.')} Start a new session first.`);
        console.log('');
        continue;
      }
      const s = sessions[0];
      const target = otherProviderForSession(s);
      const brief = sessionBrief(s, target);
      console.log('');
      console.log(`  Switching ${s.tool || 'claude'} session to ${target}...`);
      console.log('');
      spawnSync('dual-brain', ['switch', target, brief], { stdio: 'inherit', cwd: CWD });
      continue;
    }

    const num = parseInt(choice, 10);
    if (num >= 1 && num <= 9 && sessions[num - 1]) {
      const s = sessions[num - 1];
      if (s.tool === 'codex') {
        runSession('codex', ['resume', s.id], `Resuming codex ${s.id.slice(0, 8)}...`);
      } else {
        runSession('claude', ['-r', s.id], `Resuming session ${s.id.slice(0, 8)}...`);
      }
      continue;
    }

    if (choice === 'w') {
      await showVibeWorkflow(rl);
      continue;
    }

    if (choice === 'n') {
      if (!providers.claude.authed) {
        console.log('');
        console.log(`  ${yellow('Claude needs to be authenticated first.')} Press ${bold('[j]')} to sign in.`);
        console.log('');
      } else {
        runSession('claude', [], 'Starting new session...');
      }
      continue;
    }

    if (choice === 'i') {
      const count = importVisibleSessions(sessions);
      console.log('');
      console.log(count > 0
        ? `  ${green('Imported ' + count + ' session' + (count === 1 ? '' : 's') + '.')}`
        : `  ${dim('Sessions already synced.')}`);
      console.log('');
      await ask();
      continue;
    }

    if (choice === 'p') {
      await showProfilePicker(rl);
      continue;
    }

    if (choice === 'a') {
      await showAuthMenu(rl, providers);
      continue;
    }

    if (choice === 'b') {
      await showBudgetMenu(rl);
      continue;
    }

    if (choice === 'x' && !firstRun) {
      const permissions = loadPermissions();
      if (permissions.claude_skip_permissions || permissions.codex_bypass_sandbox) {
        savePermissions({
          claude_skip_permissions: false,
          codex_bypass_sandbox: false,
        });
        console.log('');
        console.log(`  ${green('Permissions set to safe mode.')}`);
        console.log('');
        continue;
      }

      console.log('');
      const confirm = await new Promise(resolve => rl.question('  WARNING: This enables skip-permissions mode for Claude sessions. Type YES to confirm: ', resolve));
      if (confirm.trim() === 'YES') {
        savePermissions({
          claude_skip_permissions: true,
          codex_bypass_sandbox: true,
        });
        console.log(`  ${yellow('Skip-permissions mode enabled for Claude and Codex sessions.')}`);
      } else {
        console.log('  No changes made. Safe mode remains enabled.');
      }
      console.log('');
      continue;
    }

    if (choice === 'd') {
      await showToolsMenu(rl);
      continue;
    }

    if (choice === 'u') {
      console.log('');
      console.log('  Updating Dual Brain...');
      console.log('');
      const upd = spawnSync('npx', ['-y', 'dual-brain', 'update'], { stdio: 'inherit', cwd: CWD });
      if (upd.status !== 0) {
        console.log('');
        console.log(`  ${yellow('Update failed (exit ' + upd.status + ').')} Try manually: ${cyan('npx -y dual-brain@latest')}`);
        console.log('');
      }
      continue;
    }

    if (choice === 't') {
      const dtPath = join(CWD, '.replit-tools');
      if (existsSync(dtPath)) {
        await showDataToolsStatus(rl, providers);
      } else if (IS_REPLIT) {
        console.log('');
        console.log('  Installing replit-tools (Data Tools)...');
        console.log('');
        spawnSync('npx', ['-y', 'data-tools'], { stdio: 'inherit', cwd: CWD });
        console.log('');
        console.log('  Done. Press Enter to continue...');
        const askOnce = () => new Promise(resolve => rl.question('', resolve));
        await askOnce();
      } else {
        console.log('');
        console.log(`  Data Tools is designed for Replit environments.`);
        console.log('');
      }
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
      console.log(`  Open: ${cyan('https://auth.openai.com/codex/device')}`);
      console.log('');
      spawnSync(codexPath.stdout.trim(), ['login', '--device-auth'], { stdio: 'inherit' });
      continue;
    }

    if (choice === '?') {
      console.log('');
      console.log(`  ${bold('What is Dual Brain?')}`);
      console.log('');
      console.log('  Dual Brain orchestrates your Claude + Codex subscriptions together.');
      console.log('  It routes tasks to the right model: search (fast), execute (edits),');
      console.log('  think (architecture). Both providers work in parallel when possible.');
      console.log('');
      console.log('  Modes: Auto adapts to your workflow. Cost-saver minimizes GPT usage.');
      console.log('  Quality-first uses dual-brain review on all medium+ risk changes.');
      console.log('');
      console.log(`  ${dim('Press Enter to return...')}`);
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
