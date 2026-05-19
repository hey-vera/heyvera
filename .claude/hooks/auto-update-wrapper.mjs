#!/usr/bin/env node
// auto-update-wrapper.mjs — PostToolUse hook.
// Checks for updates once per session. If found, installs immediately (no wait,
// no question) and writes a notice so HEAD can mention it naturally.
// "Oh, I updated to 0.2.16" — not a prompt, just awareness.

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(__dirname, '..');
const STATE_DIR = join(WORKSPACE, '.dualbrain');
const LOCK_FILE = join(STATE_DIR, '.update-checked');
const NOTICE_FILE = join(STATE_DIR, '.update-notice');
const SESSION_TTL = 30 * 60 * 1000; // Once per 30 min session

// ── 1. Already checked this session? ─────────────────────────────────────────
if (existsSync(LOCK_FILE)) {
  try {
    const lastCheck = parseInt(readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < SESSION_TTL) {
      // Output empty JSON (no hook action)
      process.stdout.write('{}\n');
      process.exit(0);
    }
  } catch {}
}

// ── 2. Mark as checked ───────────────────────────────────────────────────────
try {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOCK_FILE, String(Date.now()));
} catch {
  process.stdout.write('{}\n');
  process.exit(0);
}

// ── 3. Get local version ─────────────────────────────────────────────────────
let localVersion = '';
try {
  const pkg = JSON.parse(readFileSync(join(WORKSPACE, 'package.json'), 'utf8'));
  localVersion = pkg.version || '';
} catch {
  process.stdout.write('{}\n');
  process.exit(0);
}

if (!localVersion) {
  process.stdout.write('{}\n');
  process.exit(0);
}

// ── 4. Check registry (fast, 3s timeout) ─────────────────────────────────────
const npmResult = spawnSync('npm', ['view', 'dual-brain', 'version'], {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 3000,
});

const latestVersion = (npmResult.stdout || '').trim();
if (!latestVersion || !_isNewer(localVersion, latestVersion)) {
  process.stdout.write('{}\n');
  process.exit(0);
}

// ── 5. Install immediately — no detach, no background, just do it ────────────
process.stderr.write(`[dual-brain] updating ${localVersion} → ${latestVersion}\n`);

const installResult = spawnSync('npm', ['install', '-g', `dual-brain@${latestVersion}`], {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 30000,
});

if (installResult.status === 0) {
  // Write notice for HEAD to pick up
  const notice = { from: localVersion, to: latestVersion, ts: Date.now() };
  writeFileSync(NOTICE_FILE, JSON.stringify(notice));
  process.stderr.write(`[dual-brain] updated to ${latestVersion}\n`);
} else {
  process.stderr.write(`[dual-brain] update failed, continuing with ${localVersion}\n`);
}

process.stdout.write('{}\n');
process.exit(0);

// ── Helpers ──────────────────────────────────────────────────────────────────

function _isNewer(local, remote) {
  const lp = local.split('.').map(Number);
  const rp = remote.split('.').map(Number);
  for (let i = 0; i < Math.max(lp.length, rp.length); i++) {
    const diff = (rp[i] || 0) - (lp[i] || 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}
