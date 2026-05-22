#!/usr/bin/env bash
set -euo pipefail

# One-command Cortex deploy. Run on the VPS with no args.
# Usage: deploy-cortex
#   or:  deploy-cortex feat/some-branch

REPO_DIR="/home/guardian/claw-net"
ENV_FILE="/etc/cortex/cortex.env"
CORTEX_WWW="/var/www/cortex"
MAX_WAIT=45

cd "$REPO_DIR"

GIT_REMOTE=$(git remote | head -1)
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

REMOTE_URL=$(git remote get-url "$GIT_REMOTE" 2>/dev/null || true)
if [[ "$REMOTE_URL" == https://github.com/* ]]; then
  SSH_URL="${REMOTE_URL/https:\/\/github.com\//git@github.com:}"
  git remote set-url "$GIT_REMOTE" "$SSH_URL"
  echo "[git] Switched $GIT_REMOTE to SSH: $SSH_URL"
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║         Cortex Deploy                ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Remote:  $GIT_REMOTE"
echo "  Branch:  $BRANCH"
echo ""

# ── env ──────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  set -a
  eval "$(sudo cat "$ENV_FILE")"
  set +a
  echo "[env] Loaded $ENV_FILE"
fi

# ── git ──────────────────────────────────────
echo "[git] Fetching $BRANCH..."
git fetch "$GIT_REMOTE" "$BRANCH"
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "$GIT_REMOTE/$BRANCH"
git reset --hard "$GIT_REMOTE/$BRANCH"
COMMIT=$(git rev-parse --short HEAD)
echo "[git] At $COMMIT"

# ── frontend ─────────────────────────────────
echo "[vite] Building frontend..."
cd "$REPO_DIR/cortex"
npm ci --silent 2>&1 | tail -1
npm run build 2>&1 | tail -3
cd "$REPO_DIR"
sudo mkdir -p "$CORTEX_WWW"
sudo rsync -a --delete "$REPO_DIR/cortex/dist/" "$CORTEX_WWW/"
echo "[vite] Deployed to $CORTEX_WWW"

# ── backend ──────────────────────────────────
echo "[rust] Building cortex-server..."
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
cargo build --release 2>&1 | tail -5

sudo systemctl stop cortex 2>/dev/null || true
sudo cp target/release/cortex-server /usr/local/bin/cortex-server
echo "[rust] Installed binary"

if [ -f target/release/cortex-worker ]; then
  sudo cp target/release/cortex-worker /usr/local/bin/cortex-worker
fi

# ── caddy ────────────────────────────────────
if [ -f "$REPO_DIR/Caddyfile" ]; then
  sudo cp "$REPO_DIR/Caddyfile" /etc/caddy/Caddyfile
  sudo systemctl reload caddy 2>/dev/null || true
  echo "[caddy] Reloaded"
fi

# ── start + health ───────────────────────────
sudo systemctl start cortex
echo -n "[health] Waiting"
HEALTHY=false
for _ in $(seq 1 "$MAX_WAIT"); do
  sleep 1
  echo -n "."
  if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
done
echo ""

if $HEALTHY; then
  echo ""
  echo "  ✓ Cortex deployed — $BRANCH @ $COMMIT"
  echo "    https://cortex.heyvera.org"
  echo "    Logs: sudo journalctl -u cortex -f"
  echo ""
else
  echo "[fail] Health check failed. Recent logs:"
  sudo journalctl -u cortex --no-pager -n 20
  exit 1
fi
