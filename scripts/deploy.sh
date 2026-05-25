#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-guardian}"
REPO_DIR="${REPO_DIR:-/home/${DEPLOY_USER}/claw-net}"
WWW_DIR="${WWW_DIR:-/var/www/claw-net}"
EXTERNAL_ENV_FILE="${EXTERNAL_ENV_FILE:-/etc/cortex/cortex.env}"
CLAWNET_ENV_FILE="${CLAWNET_ENV_FILE:-/etc/claw-net/claw-net.env}"
CLAWNET_SERVICE="${CLAWNET_SERVICE:-claw-net-node}"
PORT="${PORT:-3402}"
CORTEX_HEALTH_PORT="${CORTEX_HEALTH_PORT:-3001}"
MAX_WAIT="${MAX_WAIT:-45}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"
AUTO_SWITCH_BRANCH="${AUTO_SWITCH_BRANCH:-0}"
GIT_REMOTE="${GIT_REMOTE:-}"

cd "$REPO_DIR"

if [ -z "$GIT_REMOTE" ]; then
  GIT_REMOTE=$(git remote | head -1)
  echo "[git] Auto-detected remote: $GIT_REMOTE"
fi

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
    git fetch "$GIT_REMOTE" "$TARGET_BRANCH"
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

if [ -f "$CLAWNET_ENV_FILE" ]; then
  export CLAWNET_ENV_FILE
  echo "[env] Found ClawNet env file: $CLAWNET_ENV_FILE"
else
  echo "[env] ClawNet env file not found yet: $CLAWNET_ENV_FILE"
fi

# Source VITE_* vars so frontend builds pick them up
if [ -f "$ENV_FILE" ]; then
  set -a
  if [ -r "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  elif [ "$SUDO_AVAILABLE" = "1" ]; then
    eval "$(sudo cat "$ENV_FILE")"
  else
    echo "[env] WARNING: cannot read $ENV_FILE (no permission and no sudo)"
  fi
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
git fetch "$GIT_REMOTE" "$TARGET_BRANCH"
git checkout "$TARGET_BRANCH"
git reset --hard "$GIT_REMOTE/$TARGET_BRANCH"

DEPLOY_COMMIT="$(git rev-parse HEAD)"
DEPLOY_COMMIT_SHORT="$(git rev-parse --short HEAD)"
DEPLOY_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export DEPLOY_COMMIT DEPLOY_COMMIT_SHORT DEPLOY_TIMESTAMP
export GITHUB_SHA="${GITHUB_SHA:-$DEPLOY_COMMIT}"
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

echo "[clawnet] Building Node/Hono API..."
npm ci
npm run build

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
      sudo systemctl stop cortex 2>/dev/null || true

      sudo cp "$REPO_DIR/target/release/cortex-server" /usr/local/bin/cortex-server
      echo "[cortex] Installed cortex-server binary"

      if [ -f "$REPO_DIR/target/release/cortex-worker" ]; then
        sudo cp "$REPO_DIR/target/release/cortex-worker" /usr/local/bin/cortex-worker
        echo "[cortex] Installed cortex-worker binary"
      fi

      if [ -f /etc/systemd/system/cortex.service ]; then
        sudo systemctl start cortex
        echo "[cortex] Started cortex service"
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

echo "[clawnet] Checking Node/Hono API service..."
if [ -f "/etc/systemd/system/${CLAWNET_SERVICE}.service" ] && [ "$SUDO_AVAILABLE" = "1" ]; then
  sudo systemctl restart "$CLAWNET_SERVICE"
  echo "[clawnet] Restarted $CLAWNET_SERVICE"
elif [ "${CLAWNET_INSTALL_SERVICE:-0}" = "1" ] && [ "$SUDO_AVAILABLE" = "1" ]; then
  if [ -f "/etc/systemd/system/${CLAWNET_SERVICE}.service" ]; then
    sudo systemctl restart "$CLAWNET_SERVICE"
  else
    sudo env \
      CLAWNET_USER="$DEPLOY_USER" \
      DEPLOY_USER="$DEPLOY_USER" \
      CLAWNET_SERVICE="$CLAWNET_SERVICE" \
      CLAWNET_PORT="$PORT" \
      CLAWNET_ENV="$CLAWNET_ENV_FILE" \
      bash "$REPO_DIR/scripts/clawnet-install-service.sh"
  fi
  echo "[clawnet] Restarted $CLAWNET_SERVICE"
elif curl -sf "http://localhost:${PORT}/v1/health" >/dev/null 2>&1; then
  echo "[clawnet] Existing service is healthy on port ${PORT}; installer skipped"
elif [ "${CLAWNET_SERVICE_REQUIRED:-1}" = "1" ]; then
  echo "[clawnet] ERROR: ClawNet service is not healthy and installer is disabled or sudo is unavailable"
  echo "          Set CLAWNET_INSTALL_SERVICE=1 after granting the deploy user service-install sudo permissions."
  exit 1
else
  echo "[clawnet] WARNING: skipped ClawNet service install/restart"
fi

# Docker compose is for legacy Node.js orchestrator. Skip if cortex systemd service is active.
if systemctl is-active cortex >/dev/null 2>&1; then
  echo "[docker] Skipping — cortex runs as native systemd service"
else
  echo "[docker] Building and restarting containers..."
  docker compose up --build -d --remove-orphans
fi

echo -n "[health] Waiting for ClawNet startup"
CLAWNET_HEALTHY=false
for i in $(seq 1 "$MAX_WAIT"); do
  sleep 1
  echo -n "."
  if curl -sf "http://localhost:${PORT}/v1/health" >/dev/null 2>&1; then
    CLAWNET_HEALTHY=true
    break
  fi
done
echo ""

if ! $CLAWNET_HEALTHY; then
  echo "[fail] ClawNet health check failed after ${MAX_WAIT}s. Recent logs:"
  journalctl -u "$CLAWNET_SERVICE" --no-pager -n 40 2>/dev/null || true
  exit 1
fi

if systemctl is-active cortex >/dev/null 2>&1; then
  echo -n "[health] Checking Cortex"
  CORTEX_HEALTHY=false
  for i in $(seq 1 "$MAX_WAIT"); do
    sleep 1
    echo -n "."
    if curl -sf "http://localhost:${CORTEX_HEALTH_PORT}/api/health" >/dev/null 2>&1; then
      CORTEX_HEALTHY=true
      break
    fi
  done
  echo ""

  if ! $CORTEX_HEALTHY; then
    echo "[fail] Cortex health check failed after ${MAX_WAIT}s. Recent logs:"
    journalctl -u cortex --no-pager -n 40 2>/dev/null || true
    exit 1
  fi
else
  echo "[health] Cortex service is not active; skipping Cortex health check"
fi

echo "[done] ClawNet deployed — healthy on port ${PORT}"
echo "       Cortex checked on port ${CORTEX_HEALTH_PORT} when active"
echo "       Commit: ${DEPLOY_COMMIT_SHORT} (${TARGET_BRANCH})"
echo "       Logs: sudo journalctl -u ${CLAWNET_SERVICE} -f"
