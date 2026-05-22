#!/usr/bin/env bash
set -euo pipefail

# HeyVera deploy — run from anywhere with SSH access to the VPS
# Usage: ./scripts/deploy-vera.sh
#   or:  BRANCH=main ./scripts/deploy-vera.sh

VPS_HOST="${VPS_HOST:-guardian@clawguard}"
REPO_DIR="/home/guardian/claw-net"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
CORTEX_WWW="/var/www/cortex"
DASHBOARD_WWW="/var/www/claw-net-dashboard"

echo "=== HeyVera Deploy ==="
echo "    VPS: $VPS_HOST"
echo "    Branch: $BRANCH"
echo ""

ssh "$VPS_HOST" bash -s "$BRANCH" "$REPO_DIR" "$CORTEX_WWW" "$DASHBOARD_WWW" <<'REMOTE'
set -euo pipefail
BRANCH="$1"
REPO_DIR="$2"
CORTEX_WWW="$3"
DASHBOARD_WWW="$4"

cd "$REPO_DIR"

ENV_FILE="/etc/cortex/cortex.env"
if [ -f "$ENV_FILE" ]; then
  echo "[env] Sourcing $ENV_FILE..."
  set -a
  eval "$(sudo cat "$ENV_FILE")"
  set +a
fi

echo "[git] Fetching and checking out $BRANCH..."
git fetch heyvera "$BRANCH"
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "heyvera/$BRANCH"
git reset --hard "heyvera/$BRANCH"
COMMIT=$(git rev-parse --short HEAD)
echo "[git] At $COMMIT"

# Cortex backend
echo "[rust] Building cortex-server..."
cargo build --release 2>&1 | tail -3
sudo systemctl stop cortex 2>/dev/null || true
sudo cp target/release/cortex-server /usr/local/bin/cortex-server
echo "[rust] Installed binary"

# Cortex frontend
echo "[vite] Building cortex frontend..."
cd "$REPO_DIR/cortex"
npm ci --silent 2>&1 | tail -1
npm run build 2>&1 | tail -3
cd "$REPO_DIR"
sudo mkdir -p "$CORTEX_WWW"
sudo rsync -a --delete "$REPO_DIR/cortex/dist/" "$CORTEX_WWW/"
echo "[vite] Deployed to $CORTEX_WWW"

# Dashboard (if present)
if [ -f "$REPO_DIR/dashboard/package.json" ]; then
  echo "[dash] Building dashboard..."
  cd "$REPO_DIR/dashboard"
  npm ci --silent 2>&1 | tail -1
  npm run build 2>&1 | tail -3
  cd "$REPO_DIR"
  sudo mkdir -p "$DASHBOARD_WWW"
  sudo rsync -a --delete "$REPO_DIR/dashboard/dist/" "$DASHBOARD_WWW/"
  echo "[dash] Deployed to $DASHBOARD_WWW"
fi

# Caddy
if [ -f "$REPO_DIR/Caddyfile" ]; then
  sudo cp "$REPO_DIR/Caddyfile" /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  echo "[caddy] Reloaded"
fi

# Start cortex
sudo systemctl start cortex
echo "[cortex] Started"

# Health check
sleep 2
if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
  echo ""
  echo "=== Deploy complete — $BRANCH @ $COMMIT ==="
else
  echo "[warn] Health check failed — check: sudo journalctl -u cortex -n 20"
fi
REMOTE
