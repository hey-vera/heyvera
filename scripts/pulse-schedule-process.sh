#!/usr/bin/env bash
# Cron-callable Pulse schedule processor.
# Publishes approved drafts whose publish_at <= now via heyvera-server.
#
# Suggested crontab (every minute):
#   * * * * * /path/to/repo/scripts/pulse-schedule-process.sh >>/var/log/pulse-schedule.log 2>&1
#
# Required env:
#   PULSE_PROCESS_TOKEN  Clerk (or service) JWT with Authorization Bearer
# Optional env:
#   HEYVERA_API_ORIGIN   default https://api.heyvera.org
#   CURL_TIMEOUT         default 30

set -euo pipefail

API_ORIGIN="${HEYVERA_API_ORIGIN:-https://api.heyvera.org}"
CURL_TIMEOUT="${CURL_TIMEOUT:-30}"
TOKEN="${PULSE_PROCESS_TOKEN:-${CLERK_SESSION_JWT:-}}"

if [ -z "$TOKEN" ]; then
  echo "[pulse-schedule] ERROR: set PULSE_PROCESS_TOKEN (or CLERK_SESSION_JWT) to a valid API JWT" >&2
  exit 2
fi

URL="${API_ORIGIN%/}/v1/pulse/schedules/process"

set +e
body_file="$(mktemp)"
meta="$(curl --silent --show-error --max-time "$CURL_TIMEOUT" \
  --request POST \
  --header "Authorization: Bearer ${TOKEN}" \
  --header "Content-Type: application/json" \
  --output "$body_file" \
  --write-out '%{http_code}' \
  "$URL" 2>&1)"
curl_exit=$?
set -e

if [ "$curl_exit" -ne 0 ]; then
  echo "[pulse-schedule] curl failed (exit $curl_exit): $meta" >&2
  rm -f "$body_file"
  exit 1
fi

status="$meta"
preview="$(head -c 200 "$body_file" 2>/dev/null | tr '\r\n' '  ' || true)"
rm -f "$body_file"

echo "[pulse-schedule] POST $URL → HTTP $status body=${preview}"

# 200/204 success; 401 means token bad (still not a 404 routing miss)
case "$status" in
  200|201|204)
    exit 0
    ;;
  401|403)
    echo "[pulse-schedule] auth rejected (HTTP $status) — check PULSE_PROCESS_TOKEN" >&2
    exit 1
    ;;
  404)
    echo "[pulse-schedule] route missing (HTTP 404) — is heyvera-server owning /v1/pulse on api.heyvera.org?" >&2
    exit 1
    ;;
  *)
    echo "[pulse-schedule] unexpected HTTP $status" >&2
    exit 1
    ;;
esac
