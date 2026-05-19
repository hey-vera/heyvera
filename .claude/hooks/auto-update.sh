#!/usr/bin/env bash
# auto-update.sh — PostToolUse hook that silently keeps dual-brain current.
#
# Runs once per session (lock file prevents repeated checks).
# Never blocks: npm check has a 3-second timeout, install is backgrounded.
# Exit 0 always — update failures are silent, not fatal.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_DIR="${WORKSPACE}/.dualbrain"
LOCK_FILE="${STATE_DIR}/.update-checked"
TWENTY_FOUR_HOURS=86400  # seconds

# ── 1. Already checked recently? ────────────────────────────────────────────
if [[ -f "${LOCK_FILE}" ]]; then
  last_check=$(cat "${LOCK_FILE}" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$(( now - last_check ))
  if (( age < TWENTY_FOUR_HOURS )); then
    exit 0
  fi
fi

# ── 2. Write lock BEFORE doing anything (prevents concurrent session races) ──
mkdir -p "${STATE_DIR}"
date +%s > "${LOCK_FILE}"

# ── 3. Get local version ─────────────────────────────────────────────────────
PKG_JSON="${WORKSPACE}/package.json"
if [[ ! -f "${PKG_JSON}" ]]; then
  exit 0
fi

local_version=$(node -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync('${PKG_JSON}','utf8')).version||'')}catch(e){}" 2>/dev/null || true)
if [[ -z "${local_version}" ]]; then
  exit 0
fi

# ── 4. Check npm for latest (3-second timeout, silent on failure) ─────────────
latest_version=$(timeout 3 npm view dual-brain version 2>/dev/null || true)
if [[ -z "${latest_version}" ]]; then
  exit 0
fi

# ── 5. Compare versions ───────────────────────────────────────────────────────
# Returns 1 if $1 < $2 (newer available), 0 otherwise
version_lt() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ] && [ "$1" != "$2" ]
}

if ! version_lt "${local_version}" "${latest_version}"; then
  # Already up to date — lock file already updated above
  exit 0
fi

# ── 6. Newer version found — update in background ────────────────────────────
echo "dual-brain: updating v${local_version} → v${latest_version}..." >&2

# Spawn a completely detached background process so this hook returns immediately
nohup bash -c "
  npx -y dual-brain@latest --quiet 2>/dev/null || true
" > /dev/null 2>&1 &
disown $! 2>/dev/null || true

exit 0
