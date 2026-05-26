#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# reconcile-counters.sh — Reconcile denormalized post counters
#
# Triggers the /api/admin/reconcile-counters endpoint (or runs SQLite
# directly if SQLITE_DB_PATH is set and no API is reachable).
#
# Usage:
#   ./scripts/reconcile-counters.sh [BASE_URL]
#
# Environment variables:
#   BASE_URL         Cortex API base URL (default: http://localhost:3402)
#   ADMIN_TOKEN      Bearer token for admin authentication (required for API mode)
#   SQLITE_DB_PATH   Path to the SQLite database file (enables direct DB mode)
#   CURL_TIMEOUT     Per-request timeout in seconds (default: 30)
#
# Install (nightly at 2am): crontab -e, add:
#   0 2 * * * /path/to/reconcile-counters.sh >> /var/log/heyvera-reconcile.log 2>&1
# ---------------------------------------------------------------------------
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:3402}}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
SQLITE_DB_PATH="${SQLITE_DB_PATH:-}"
CURL_TIMEOUT="${CURL_TIMEOUT:-30}"

echo "Counter reconciliation — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ─── Direct SQLite mode ──────────────────────────────────────────────────────

if [ -n "$SQLITE_DB_PATH" ] && [ -f "$SQLITE_DB_PATH" ]; then
  echo "Mode: direct SQLite (${SQLITE_DB_PATH})"

  # Check if counter columns exist
  HAS_COLS=$(sqlite3 "$SQLITE_DB_PATH" \
    "SELECT COUNT(*) FROM pragma_table_info('social_posts') WHERE name IN ('like_count','repost_count','bookmark_count','reply_count');" 2>/dev/null || echo "0")

  if [ "$HAS_COLS" -lt "4" ]; then
    echo "SKIP: social_posts does not have counter columns (schema may be older)"
    exit 0
  fi

  sqlite3 "$SQLITE_DB_PATH" <<'SQL'
UPDATE social_posts SET
    like_count     = (SELECT COUNT(*) FROM social_likes     WHERE post_id = social_posts.id),
    repost_count   = (SELECT COUNT(*) FROM social_reposts   WHERE post_id = social_posts.id),
    bookmark_count = (SELECT COUNT(*) FROM social_bookmarks WHERE post_id = social_posts.id),
    reply_count    = (SELECT COUNT(*) FROM social_posts replies WHERE replies.reply_to_post_id = social_posts.id AND replies.deleted_at IS NULL)
WHERE deleted_at IS NULL;
SQL

  UPDATED=$(sqlite3 "$SQLITE_DB_PATH" \
    "SELECT COUNT(*) FROM social_posts WHERE deleted_at IS NULL;" 2>/dev/null || echo "unknown")

  echo "Done: reconciled counters for ${UPDATED} posts"
  exit 0
fi

# ─── API mode ────────────────────────────────────────────────────────────────

echo "Mode: API (${BASE_URL})"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "ERROR: ADMIN_TOKEN is required for API mode (or set SQLITE_DB_PATH for direct mode)"
  exit 1
fi

RESPONSE=$(curl --silent --show-error \
  --max-time "$CURL_TIMEOUT" \
  -X POST "${BASE_URL}/api/admin/reconcile-counters" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" 2>&1)

echo "Response: ${RESPONSE}"

# Parse updated count if jq is available
if command -v jq > /dev/null 2>&1; then
  UPDATED=$(printf '%s' "$RESPONSE" | jq -r '.updated // "unknown"' 2>/dev/null || echo "unknown")
  echo "Done: reconciled counters for ${UPDATED} posts"
else
  echo "Done"
fi
