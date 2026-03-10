#!/usr/bin/env bash
# Daily SQLite backup — run via cron: 0 3 * * * /home/guardian/claw-net/scripts/backup.sh
set -euo pipefail

DB_PATH="/home/guardian/claw-net/data/orchestrator.db"
BACKUP_DIR="/home/guardian/backups"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/orchestrator_$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

# Use SQLite's online backup API (safe while DB is live/WAL mode)
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# Compress
gzip "$BACKUP_FILE"

echo "[backup] Created: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"

# Prune old backups
find "$BACKUP_DIR" -name "orchestrator_*.db.gz" -mtime +$RETENTION_DAYS -delete
echo "[backup] Pruned backups older than $RETENTION_DAYS days"

# Verify the backup is readable
BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}.gz" 2>/dev/null || stat -f%z "${BACKUP_FILE}.gz")
if [ "$BACKUP_SIZE" -lt 1024 ]; then
  echo "[backup] ERROR: backup file suspiciously small ($BACKUP_SIZE bytes)" >&2
  exit 1
fi

echo "[backup] Done — backup size: $BACKUP_SIZE bytes"
