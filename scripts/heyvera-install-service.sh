#!/usr/bin/env bash
set -euo pipefail

# Install the HeyVera API systemd service (heyvera-server on port 3002).
# Mirrors scripts/cortex-install-service.sh.
#
# Usage: sudo bash scripts/heyvera-install-service.sh

HEYVERA_USER="${HEYVERA_USER:-${CORTEX_USER:-deploy}}"
HEYVERA_PORT="${HEYVERA_PORT:-3002}"
HEYVERA_LEDGER="${HEYVERA_LEDGER:-/var/lib/heyvera/ledger.jsonl}"
HEYVERA_ENV="${HEYVERA_ENV_FILE:-/etc/heyvera/heyvera.env}"
REPO_DIR="${REPO_DIR:-/home/$HEYVERA_USER/claw-net}"
BIN_SRC="${BIN_SRC:-$REPO_DIR/target/release/heyvera-server}"
BIN_DST="${BIN_DST:-/usr/local/bin/heyvera-server}"

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  SUDO=()
else
  SUDO=(sudo)
fi

"${SUDO[@]}" mkdir -p /var/lib/heyvera
"${SUDO[@]}" chown "$HEYVERA_USER:$HEYVERA_USER" /var/lib/heyvera
"${SUDO[@]}" mkdir -p "$(dirname "$HEYVERA_ENV")"
"${SUDO[@]}" mkdir -p "$(dirname "$HEYVERA_LEDGER")"
"${SUDO[@]}" chown "$HEYVERA_USER:$HEYVERA_USER" "$(dirname "$HEYVERA_LEDGER")"

if [ ! -f "$HEYVERA_ENV" ]; then
  cat <<ENVEOF | "${SUDO[@]}" tee "$HEYVERA_ENV" >/dev/null
HEYVERA_PORT=$HEYVERA_PORT
HEYVERA_ENV=production
HEYVERA_WORKSPACE=$REPO_DIR
HEYVERA_LEDGER_PATH=$HEYVERA_LEDGER
RUST_LOG=info
# Auth — required in production
# CLERK_SECRET_KEY=
# CLERK_ISSUER=https://your-clerk-instance.clerk.accounts.dev
# CLERK_AUTHORIZED_PARTY=https://heyvera.org
# CORS
# CORTEX_ALLOWED_ORIGINS=https://heyvera.org,https://www.heyvera.org
# Object storage (required for media in production — mock is fail-closed)
# STORAGE_ENDPOINT=
# STORAGE_BUCKET=
# STORAGE_ACCESS_KEY=
# STORAGE_SECRET_KEY=
# STORAGE_REGION=auto
# STORAGE_PUBLIC_URL=
# Pulse LLM (optional)
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
ENVEOF
  "${SUDO[@]}" chmod 600 "$HEYVERA_ENV"
  "${SUDO[@]}" chown root:root "$HEYVERA_ENV"
  echo "[heyvera] Created env file at $HEYVERA_ENV — fill in keys to go live"
fi

if [ -f "$BIN_SRC" ]; then
  "${SUDO[@]}" cp "$BIN_SRC" "$BIN_DST"
  "${SUDO[@]}" chmod 755 "$BIN_DST"
  echo "[heyvera] Installed binary to $BIN_DST"
else
  echo "[heyvera] WARN: binary not found at $BIN_SRC — install after cargo build --release -p heyvera-server-bin"
fi

# Prefer repo unit template when present; otherwise write inline unit matching deploy/heyvera-api.service intent.
UNIT_SRC="$REPO_DIR/deploy/heyvera-api.service"
if [ -f "$UNIT_SRC" ]; then
  # Adapt template paths to this host's install layout (/usr/local/bin + env file).
  cat <<EOF | "${SUDO[@]}" tee /etc/systemd/system/heyvera-api.service >/dev/null
[Unit]
Description=HeyVera API Server - Social + Pulse (port ${HEYVERA_PORT})
After=network.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=exec
User=${HEYVERA_USER}
Group=${HEYVERA_USER}
WorkingDirectory=${REPO_DIR}
ExecStart=${BIN_DST}
Restart=always
RestartSec=5
TimeoutStopSec=30
EnvironmentFile=${HEYVERA_ENV}
Environment=HEYVERA_PORT=${HEYVERA_PORT}
Environment=RUST_LOG=info
LimitNOFILE=65536
LimitNPROC=4096
NoNewPrivileges=true
PrivateTmp=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=heyvera-api

[Install]
WantedBy=multi-user.target
EOF
else
  cat <<EOF | "${SUDO[@]}" tee /etc/systemd/system/heyvera-api.service >/dev/null
[Unit]
Description=HeyVera API Server - Social + Pulse
After=network.target

[Service]
Type=simple
User=${HEYVERA_USER}
ExecStart=${BIN_DST}
EnvironmentFile=${HEYVERA_ENV}
WorkingDirectory=${REPO_DIR}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
fi

"${SUDO[@]}" systemctl daemon-reload
"${SUDO[@]}" systemctl enable heyvera-api
"${SUDO[@]}" systemctl restart heyvera-api || "${SUDO[@]}" systemctl start heyvera-api

echo "[heyvera] Service installed and started on port $HEYVERA_PORT"
echo "[heyvera] Check status: sudo systemctl status heyvera-api"
echo "[heyvera] View logs: sudo journalctl -u heyvera-api -f"
echo "[heyvera] Health: curl -sf http://localhost:${HEYVERA_PORT}/v1/health"
