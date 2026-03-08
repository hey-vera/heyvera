#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/guardian/claw-net"
WWW_DIR="/var/www/claw-net"

cd "$REPO_DIR"

echo "[git] Pulling latest..."
git pull origin main

echo "[site] Syncing site/ → $WWW_DIR"
sudo mkdir -p "$WWW_DIR"
sudo cp -r site/. "$WWW_DIR/"

echo "[docker] Building and restarting containers..."
docker compose up --build -d --remove-orphans

echo "[done] Deploy complete"
