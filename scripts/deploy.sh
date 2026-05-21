#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
REPO_DIR="${REPO_DIR:-/home/${DEPLOY_USER}/claw-net}"
WWW_DIR="${WWW_DIR:-/var/www/claw-net}"
EXTERNAL_ENV_FILE="${EXTERNAL_ENV_FILE:-/etc/claw-net/claw-net.env}"
PORT="${PORT:-3402}"
MAX_WAIT="${MAX_WAIT:-45}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"
AUTO_SWITCH_BRANCH="${AUTO_SWITCH_BRANCH:-0}"

cd "$REPO_DIR"

SUDO_AVAILABLE=0
if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  SUDO_AVAILABLE=1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  echo "[git] ERROR: repo is in detached HEAD state."
  echo "      Check out the branch you want to deploy, or re-run with GIT_BRANCH=<branch> AUTO_SWITCH_BRANCH=1."
  exit 1
fi

TARGET_BRANCH="${GIT_BRANCH:-$CURRENT_BRANCH}"

if [ "$ALLOW_DIRTY" != "1" ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "[git] ERROR: tracked files are dirty."
    echo "      Commit/stash changes before deploy, or re-run with ALLOW_DIRTY=1 if you really intend to deploy local edits."
    git status --short
    exit 1
  fi

  if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "[git] WARNING: untracked files present; continuing because tracked files are clean."
    git ls-files --others --exclude-standard
  fi
fi

if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
  if [ "$AUTO_SWITCH_BRANCH" = "1" ]; then
    echo "[git] Switching from ${CURRENT_BRANCH} to ${TARGET_BRANCH}..."
    git fetch origin "$TARGET_BRANCH"
    git checkout "$TARGET_BRANCH"
    CURRENT_BRANCH="$TARGET_BRANCH"
  else
    echo "[git] ERROR: checked out branch is ${CURRENT_BRANCH}, but deploy target is ${TARGET_BRANCH}."
    echo "      Check out ${TARGET_BRANCH} first, or re-run with AUTO_SWITCH_BRANCH=1."
    exit 1
  fi
fi

if [ -f "$EXTERNAL_ENV_FILE" ]; then
  export ENV_FILE="$EXTERNAL_ENV_FILE"
  echo "[env] Using external env file: $ENV_FILE"
else
  export ENV_FILE=".env"
  echo "[env] External env file not found, falling back to repo-local .env"
fi

# Source VITE_* vars so frontend builds pick them up
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo "[env] Sourced env vars from $ENV_FILE"
fi

echo "[backup] Pre-deploy database backup..."
if [ -f "$REPO_DIR/scripts/backup.sh" ]; then
  bash "$REPO_DIR/scripts/backup.sh" || echo "[backup] WARNING: backup failed - continuing deploy"
else
  echo "[backup] No backup script found - skipping"
fi

echo "[git] Fetching and fast-forwarding ${TARGET_BRANCH}..."
git fetch origin "$TARGET_BRANCH"
git checkout "$TARGET_BRANCH"
git reset --hard "origin/$TARGET_BRANCH"

DEPLOY_COMMIT="$(git rev-parse HEAD)"
DEPLOY_COMMIT_SHORT="$(git rev-parse --short HEAD)"
DEPLOY_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[git] Deploying ${TARGET_BRANCH} @ ${DEPLOY_COMMIT_SHORT}"

DEPLOY_META_FILE="$REPO_DIR/deploy-meta.json"
cat > "$DEPLOY_META_FILE" <<EOF
{
  "service": "claw-net",
  "branch": "${TARGET_BRANCH}",
  "commit": "${DEPLOY_COMMIT}",
  "commitShort": "${DEPLOY_COMMIT_SHORT}",
  "deployedAt": "${DEPLOY_TIMESTAMP}"
}
EOF
echo "[meta] Wrote deploy metadata to ${DEPLOY_META_FILE}"

echo "[site] Syncing site/ to $WWW_DIR"
if [ -d "$REPO_DIR/site" ]; then
  mkdir -p "$WWW_DIR"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$REPO_DIR/site/" "$WWW_DIR/"
  else
    echo "[site] WARNING: rsync not found, falling back to cp -r without stale-file cleanup"
    cp -r "$REPO_DIR/site/." "$WWW_DIR/"
  fi
else
  echo "[site] No site/ directory found - skipping static asset sync"
fi

DASHBOARD_WWW="${DASHBOARD_WWW:-/var/www/claw-net-dashboard}"
echo "[dashboard] Building and deploying dashboard SPA..."
if [ -f "$REPO_DIR/dashboard/package.json" ]; then
  cd "$REPO_DIR/dashboard"
  npm ci
  npm run build
  cd "$REPO_DIR"
  mkdir -p "$DASHBOARD_WWW"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$REPO_DIR/dashboard/dist/" "$DASHBOARD_WWW/"
  else
    echo "[dashboard] WARNING: rsync not found, falling back to cp -r without stale-file cleanup"
    cp -r "$REPO_DIR/dashboard/dist/." "$DASHBOARD_WWW/"
  fi
  echo "[dashboard] Synced dashboard/dist/ to $DASHBOARD_WWW"
else
  echo "[dashboard] No dashboard/package.json found - skipping dashboard build"
fi

CORTEX_WWW="${CORTEX_WWW:-/var/www/cortex}"
echo "[cortex] Building Cortex backend and frontend..."
if [ -f "$REPO_DIR/Cargo.toml" ] && [ -f "$REPO_DIR/cortex/package.json" ]; then
  echo "[cortex] Building Vite frontend..."
  cd "$REPO_DIR/cortex"
  npm ci
  npm run build
  cd "$REPO_DIR"
  mkdir -p "$CORTEX_WWW"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$REPO_DIR/cortex/dist/" "$CORTEX_WWW/"
  else
    cp -r "$REPO_DIR/cortex/dist/." "$CORTEX_WWW/"
  fi
  echo "[cortex] Synced cortex/dist/ to $CORTEX_WWW"

  echo "[cortex] Building Rust backend..."
  cd "$REPO_DIR"
  if [ -f "$HOME/.cargo/env" ]; then
    # GitHub Actions reaches the VPS through a non-login shell, so rustup's PATH
    # shim may not be loaded even when Rust is installed for the deploy user.
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi

  if command -v cargo >/dev/null 2>&1; then
    cargo build --release
    if [ "$SUDO_AVAILABLE" = "1" ]; then
      sudo cp "$REPO_DIR/target/release/cortex-server" /usr/local/bin/cortex-server
      echo "[cortex] Installed cortex-server binary"

      if [ -f "$REPO_DIR/target/release/cortex-worker" ]; then
        sudo cp "$REPO_DIR/target/release/cortex-worker" /usr/local/bin/cortex-worker
        echo "[cortex] Installed cortex-worker binary"
      fi

      if [ -f /etc/systemd/system/cortex.service ]; then
        sudo systemctl restart cortex
        echo "[cortex] Restarted cortex service"
      else
        echo "[cortex] WARNING: no systemd service found — run scripts/cortex-install-service.sh first"
      fi

      if [ -f /etc/systemd/system/cortex-worker.service ]; then
        sudo systemctl restart cortex-worker
        echo "[cortex] Restarted cortex-worker service"
      fi
    elif [ "${CORTEX_BACKEND_REQUIRED:-0}" = "1" ]; then
      echo "[cortex] ERROR: passwordless sudo unavailable; cannot install required Cortex backend"
      exit 1
    else
      echo "[cortex] WARNING: passwordless sudo unavailable; skipped Cortex backend install/restart"
    fi
  elif [ "${CORTEX_BACKEND_REQUIRED:-0}" = "1" ]; then
    echo "[cortex] ERROR: cargo not found; cannot build required Cortex backend"
    exit 1
  else
    echo "[cortex] WARNING: cargo not found; skipped Cortex backend build"
  fi
else
  echo "[cortex] Cargo.toml or cortex/package.json not found - skipping"
fi

echo "[caddy] Updating Caddyfile..."
if [ -f "$REPO_DIR/Caddyfile" ]; then
  if command -v caddy >/dev/null 2>&1; then
    caddy validate --config "$REPO_DIR/Caddyfile"
  fi
  if [ "$SUDO_AVAILABLE" = "1" ]; then
    sudo cp "$REPO_DIR/Caddyfile" /etc/caddy/Caddyfile
    sudo systemctl reload caddy
    echo "[caddy] Reloaded"
  else
    echo "[caddy] WARNING: passwordless sudo unavailable; skipped Caddyfile update/reload"
  fi
else
  echo "[caddy] No Caddyfile found - skipping"
fi

echo "[docker] Building and restarting containers..."
docker compose up --build -d --remove-orphans

echo -n "[health] Waiting for startup"
HEALTHY=false
for i in $(seq 1 "$MAX_WAIT"); do
  sleep 1
  echo -n "."
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  if ! docker compose ps --status running | grep -q orchestrator; then
    echo ""
    echo "[fail] Orchestrator container is not running. Recent logs:"
    docker compose logs --tail 60 orchestrator
    exit 1
  fi
done
echo ""

if $HEALTHY; then
  echo "[done] ClawNet deployed successfully - healthy on port ${PORT}"
  echo "       Commit: ${DEPLOY_COMMIT_SHORT} (${TARGET_BRANCH})"
  echo "       View logs: docker compose logs -f orchestrator"
else
  echo "[fail] Health check failed after ${MAX_WAIT}s. Recent logs:"
  docker compose logs --tail 60 orchestrator
  exit 1
fi
