#!/usr/bin/env bash
set -euo pipefail

# Install the Node/Hono ClawNet API as a sibling service to Cortex.
# Cortex owns port 3001; this service owns the legacy/product API on port 3402.
#
# Usage: sudo bash scripts/clawnet-install-service.sh

CLAWNET_USER="${CLAWNET_USER:-${DEPLOY_USER:-guardian}}"
CLAWNET_SERVICE="${CLAWNET_SERVICE:-claw-net-node}"
CLAWNET_PORT="${CLAWNET_PORT:-3402}"
CLAWNET_WORKSPACE="${CLAWNET_WORKSPACE:-/home/$CLAWNET_USER/claw-net}"
CLAWNET_ENV="${CLAWNET_ENV:-/etc/claw-net/claw-net.env}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  SUDO=()
else
  SUDO=(sudo)
fi

if [ -z "$NODE_BIN" ]; then
  echo "[clawnet] ERROR: node not found on PATH"
  exit 1
fi

if [ ! -d "$CLAWNET_WORKSPACE" ]; then
  echo "[clawnet] ERROR: workspace not found: $CLAWNET_WORKSPACE"
  exit 1
fi

"${SUDO[@]}" mkdir -p "$(dirname "$CLAWNET_ENV")"
if [ ! -f "$CLAWNET_ENV" ]; then
  cat <<ENVEOF | "${SUDO[@]}" tee "$CLAWNET_ENV" >/dev/null
PORT=$CLAWNET_PORT
NODE_ENV=production
DB_PATH=./data/orchestrator.db
LOG_LEVEL=info
# Runtime secrets belong here, not in git:
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# ADMIN_API_KEY=
# API_KEYS=
# CLERK_SECRET_KEY=
# CLAWNET_HEART_SECRET=
ENVEOF
  "${SUDO[@]}" chmod 600 "$CLAWNET_ENV"
  "${SUDO[@]}" chown root:root "$CLAWNET_ENV"
  echo "[clawnet] Created env file at $CLAWNET_ENV - fill in production secrets if needed"
fi

"${SUDO[@]}" mkdir -p "$CLAWNET_WORKSPACE/data"
"${SUDO[@]}" chown -R "$CLAWNET_USER:$CLAWNET_USER" "$CLAWNET_WORKSPACE/data"

cat <<EOF | "${SUDO[@]}" tee "/etc/systemd/system/${CLAWNET_SERVICE}.service" >/dev/null
[Unit]
Description=ClawNet Node API on ${CLAWNET_PORT}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CLAWNET_USER}
Group=${CLAWNET_USER}
WorkingDirectory=${CLAWNET_WORKSPACE}
EnvironmentFile=${CLAWNET_ENV}
EnvironmentFile=-${CLAWNET_WORKSPACE}/.env
Environment=NODE_ENV=production
Environment=PORT=${CLAWNET_PORT}
ExecStart=${NODE_BIN} ${CLAWNET_WORKSPACE}/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

"${SUDO[@]}" systemctl daemon-reload
"${SUDO[@]}" systemctl enable "$CLAWNET_SERVICE"
"${SUDO[@]}" systemctl restart "$CLAWNET_SERVICE"

echo "[clawnet] Service installed and started on port $CLAWNET_PORT"
echo "[clawnet] Check status: sudo systemctl status $CLAWNET_SERVICE"
echo "[clawnet] View logs: sudo journalctl -u $CLAWNET_SERVICE -f"
