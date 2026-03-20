#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/guardian/claw-net"
WWW_DIR="/var/www/claw-net"

cd "$REPO_DIR"

echo "[backup] Pre-deploy database backup..."
bash "$REPO_DIR/scripts/backup.sh" || echo "[backup] WARNING: backup failed — continuing deploy"

echo "[git] Pulling latest..."
git pull origin main

echo "[site] Syncing site/ → $WWW_DIR"
mkdir -p "$WWW_DIR"
cp -r site/. "$WWW_DIR/"

echo "[caddy] Updating Caddyfile..."
if [ -f "$REPO_DIR/Caddyfile" ]; then
  sudo cp "$REPO_DIR/Caddyfile" /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  echo "[caddy] Reloaded"
else
  echo "[caddy] No Caddyfile found — skipping"
fi

echo "[docker] Building and restarting containers..."
docker compose up --build -d --remove-orphans

echo "[done] Deploy complete"
