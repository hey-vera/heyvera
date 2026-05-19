#!/usr/bin/env bash
set -euo pipefail

# Install the Cortex systemd service on the VPS.
# Run once after first deploy. Requires: cargo, claude CLI, codex CLI authenticated.
#
# Usage: sudo bash scripts/cortex-install-service.sh

CORTEX_USER="${CORTEX_USER:-deploy}"
CORTEX_PORT="${CORTEX_PORT:-3001}"
CORTEX_LEDGER="${CORTEX_LEDGER:-/var/lib/cortex/ledger.jsonl}"

CORTEX_ENV="${CORTEX_ENV:-/etc/cortex/cortex.env}"

sudo mkdir -p /var/lib/cortex
sudo chown "$CORTEX_USER:$CORTEX_USER" /var/lib/cortex
sudo mkdir -p /var/www/cortex
sudo mkdir -p "$(dirname "$CORTEX_ENV")"

if [ ! -f "$CORTEX_ENV" ]; then
  cat <<ENVEOF | sudo tee "$CORTEX_ENV"
CORTEX_PORT=$CORTEX_PORT
CORTEX_LEDGER_PATH=$CORTEX_LEDGER
CORTEX_WORKSPACE=/home/$CORTEX_USER/claw-net
RUST_LOG=info
# CLERK_SECRET_KEY=sk_live_...
ENVEOF
  sudo chmod 600 "$CORTEX_ENV"
  sudo chown root:root "$CORTEX_ENV"
  echo "[cortex] Created env file at $CORTEX_ENV — add CLERK_SECRET_KEY to it"
fi

cat <<EOF | sudo tee /etc/systemd/system/cortex.service
[Unit]
Description=Cortex Orchestration Engine
After=network.target

[Service]
Type=simple
User=$CORTEX_USER
ExecStart=/usr/local/bin/cortex-server
EnvironmentFile=$CORTEX_ENV
WorkingDirectory=/home/$CORTEX_USER/claw-net
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cortex
sudo systemctl start cortex

echo "[cortex] Service installed and started on port $CORTEX_PORT"
echo "[cortex] Check status: sudo systemctl status cortex"
echo "[cortex] View logs: sudo journalctl -u cortex -f"
echo ""
echo "IMPORTANT: Make sure 'claude' and 'codex' CLIs are authenticated"
echo "for the '$CORTEX_USER' user. SSH in as $CORTEX_USER and run:"
echo "  claude login"
echo "  codex login"
