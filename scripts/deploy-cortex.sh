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
BRANCH="${1:-main}"

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

# ── git (bulletproof) ───────────────────────────
echo "[git] Nuclear reset to $BRANCH..."

# Fetch latest remote state
git fetch "$GIT_REMOTE" "$BRANCH" 2>/dev/null || {
    echo "[git] Initial fetch failed, cleaning and retrying..."
    git gc --prune=now 2>/dev/null || true
    git fetch "$GIT_REMOTE" "$BRANCH"
}

# Abort any in-progress operations
git rebase --abort 2>/dev/null || true
git merge --abort 2>/dev/null || true
git cherry-pick --abort 2>/dev/null || true

# Force checkout branch (create if needed)
git checkout "$BRANCH" 2>/dev/null || {
    echo "[git] Creating new branch $BRANCH..."
    git checkout -b "$BRANCH" "$GIT_REMOTE/$BRANCH" 2>/dev/null || {
        # If that fails, force create from remote
        git branch -D "$BRANCH" 2>/dev/null || true
        git checkout -b "$BRANCH" "$GIT_REMOTE/$BRANCH"
    }
}

# Nuclear reset: force exact remote state
git reset --hard "$GIT_REMOTE/$BRANCH"
git clean -fd  # Remove untracked files
git submodule update --init --recursive 2>/dev/null || true

# Ensure tracking is set up correctly
git branch --set-upstream-to="$GIT_REMOTE/$BRANCH" "$BRANCH" 2>/dev/null || true

COMMIT=$(git rev-parse --short HEAD)
echo "[git] ✓ Nuclear reset complete → $COMMIT"

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
echo "[rust] Building cortex-api..."
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
cargo build --release -p cortex-api 2>&1 | tail -5

# Stop ALL services that might hold the binary
SVC=""
for svc in heyvera cortex; do
  if systemctl list-units --type=service --all | grep -q "${svc}.service"; then
    sudo systemctl stop "$svc" 2>/dev/null || true
    echo "[svc] Stopped $svc"
    SVC="$svc"
  fi
done

# Install whichever binary was built
for bin in cortex-server cortex-api; do
  if [ -f "target/release/$bin" ]; then
    sudo cp "target/release/$bin" "/usr/local/bin/$bin"
    echo "[rust] Installed $bin"
    break
  fi
done

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
for svc in heyvera cortex; do
  if systemctl list-unit-files "${svc}.service" &>/dev/null; then
    sudo systemctl start "$svc" 2>/dev/null || true
  fi
done
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
  echo "    Logs: sudo journalctl -u ${SVC:-cortex} -f"
  echo ""
else
  echo "[fail] Health check failed. Recent logs:"
  sudo journalctl -u "${SVC:-cortex}" --no-pager -n 20
  exit 1
fi
