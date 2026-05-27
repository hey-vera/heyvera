#!/usr/bin/env bash
set -euo pipefail

# Install the Cortex Worker systemd service on the VPS.
# The worker connects to the brain and executes tasks via claude/codex CLIs.
#
# Usage: sudo bash scripts/cortex-install-worker.sh

CORTEX_USER="${CORTEX_USER:-deploy}"
CORTEX_BRAIN_URL="${CORTEX_BRAIN_URL:-ws://localhost:3001/api/ws}"

WORKER_ENV="${WORKER_ENV:-/etc/cortex/worker.env}"

sudo mkdir -p "$(dirname "$WORKER_ENV")"

if [ ! -f "$WORKER_ENV" ]; then
  cat <<ENVEOF | sudo tee "$WORKER_ENV"
CORTEX_BRAIN_URL=$CORTEX_BRAIN_URL
SOMA_ENFORCE_DELEGATION=false
RUST_LOG=info
ENVEOF
  sudo chmod 600 "$WORKER_ENV"
  sudo chown root:root "$WORKER_ENV"
  echo "[worker] Created env file at $WORKER_ENV"
fi

cat <<EOF | sudo tee /etc/systemd/system/cortex-worker.service
[Unit]
Description=Cortex Worker (executes tasks via claude/codex CLI)
After=cortex.service network.target
Wants=cortex.service

[Service]
Type=simple
User=$CORTEX_USER
ExecStart=/usr/local/bin/cortex-worker
EnvironmentFile=$WORKER_ENV
WorkingDirectory=/home/$CORTEX_USER/claw-net
Restart=on-failure
RestartSec=5
Environment=HOME=/home/$CORTEX_USER
Environment=PATH=/home/$CORTEX_USER/.local/bin:/home/$CORTEX_USER/.cargo/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cortex-worker
sudo systemctl start cortex-worker

echo "[worker] Service installed and started"
echo "[worker] Check status: sudo systemctl status cortex-worker"
echo "[worker] View logs: sudo journalctl -u cortex-worker -f"
echo ""
echo "IMPORTANT: The worker uses 'claude' and 'codex' CLI authentication."
echo "If you set up API keys for the main service, the worker will inherit them."
echo ""
echo "To verify worker authentication:"
echo "  sudo -u $CORTEX_USER bash scripts/verify-cli-auth.sh"
echo ""
echo "If authentication fails, ensure CLI tools are installed:"
echo "  sudo -u $CORTEX_USER npm install -g @anthropic-ai/claude-cli @openai/codex"
echo ""
echo "For headless auth setup, see: docs/operations/cli-auth-setup.md"
