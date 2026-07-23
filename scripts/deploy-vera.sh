#!/usr/bin/env bash
set -euo pipefail

# HeyVera deploy — run from anywhere with SSH access to the VPS
# Usage: ./scripts/deploy-vera.sh
#   or:  BRANCH=main ./scripts/deploy-vera.sh
#
# Builds and installs:
#   - cortex-server  (:3001) — Cortex product API
#   - heyvera-server (:3002) — Social + Pulse owner process
# Reloads Caddy so api.heyvera.org routes social/pulse/health to :3002.

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

HEYVERA_ENV_FILE="/etc/heyvera/heyvera.env"
if [ -f "$HEYVERA_ENV_FILE" ]; then
  echo "[env] Sourcing $HEYVERA_ENV_FILE..."
  set -a
  eval "$(sudo cat "$HEYVERA_ENV_FILE")"
  set +a
fi

echo "[git] Fetching and checking out $BRANCH..."
git fetch heyvera "$BRANCH"
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "heyvera/$BRANCH"
git reset --hard "heyvera/$BRANCH"
COMMIT=$(git rev-parse --short HEAD)
echo "[git] At $COMMIT"

# Cortex backend (port 3001)
echo "[rust] Building cortex-server..."
cargo build --release -p cortex-server-bin 2>&1 | tail -5
sudo systemctl stop cortex 2>/dev/null || true
sudo cp target/release/cortex-server /usr/local/bin/cortex-server
echo "[rust] Installed cortex-server"

# HeyVera backend (port 3002) — owns Social + Pulse
# Package: heyvera-server-bin, binary name: heyvera-server
echo "[rust] Building heyvera-server..."
cargo build --release -p heyvera-server-bin 2>&1 | tail -5
sudo systemctl stop heyvera-api 2>/dev/null || true
sudo cp target/release/heyvera-server /usr/local/bin/heyvera-server
echo "[rust] Installed heyvera-server"

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

# Caddy (api.heyvera.org → social/pulse/health on :3002)
if [ -f "$REPO_DIR/Caddyfile" ]; then
  sudo cp "$REPO_DIR/Caddyfile" /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  echo "[caddy] Reloaded"
fi

# Start services
sudo systemctl start cortex
echo "[cortex] Started"

if systemctl list-unit-files heyvera-api.service >/dev/null 2>&1; then
  sudo systemctl start heyvera-api
  echo "[heyvera-api] Started"
else
  echo "[heyvera-api] Unit not installed — run: sudo bash scripts/heyvera-install-service.sh"
  # Best-effort: start binary if unit missing but binary present
  if [ -x /usr/local/bin/heyvera-server ]; then
    echo "[heyvera-api] Starting heyvera-server in background (no unit)"
    nohup /usr/local/bin/heyvera-server >/var/log/heyvera-server.log 2>&1 &
  fi
fi

# Health checks
sleep 2
CORTEX_OK=false
HEYVERA_OK=false
if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
  CORTEX_OK=true
fi
if curl -sf http://localhost:3002/v1/health >/dev/null 2>&1; then
  HEYVERA_OK=true
fi

echo ""
if $CORTEX_OK && $HEYVERA_OK; then
  echo "=== Deploy complete — $BRANCH @ $COMMIT ==="
  echo "    cortex-server  :3001 OK"
  echo "    heyvera-server :3002 OK (Social + Pulse owner)"
else
  $CORTEX_OK || echo "[warn] cortex health failed — sudo journalctl -u cortex -n 20"
  $HEYVERA_OK || echo "[warn] heyvera health failed — sudo journalctl -u heyvera-api -n 20"
  echo "=== Deploy finished with warnings — $BRANCH @ $COMMIT ==="
fi
REMOTE
