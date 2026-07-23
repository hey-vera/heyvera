#!/usr/bin/env bash
set -euo pipefail

MODE="${HEYVERA_SMOKE_MODE:-pre-proxy}"
API_ORIGIN="${HEYVERA_API_ORIGIN:-https://api.heyvera.org}"
FRONTEND_ORIGIN="${HEYVERA_FRONTEND_ORIGIN:-https://heyvera.org}"
CURL_TIMEOUT="${CURL_TIMEOUT:-10}"

failures=0
tmp_files=()

cleanup() {
  if [ "${#tmp_files[@]}" -gt 0 ]; then
    rm -f "${tmp_files[@]}"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'USAGE'
HeyVera launch smoke gate.

Environment:
  HEYVERA_SMOKE_MODE      pre-proxy | post-proxy (default: pre-proxy)
  HEYVERA_API_ORIGIN      API origin to test (default: https://api.heyvera.org)
  HEYVERA_FRONTEND_ORIGIN Frontend origin to test (default: https://heyvera.org)
  CURL_TIMEOUT            Per-request timeout seconds (default: 10)

Modes:
  pre-proxy   Current safe launch gate. Allows upstream /v1 to be absent, but
              fails if the frontend /v1 path appears proxied before upstream
              api.heyvera.org/v1/health is healthy JSON.
  post-proxy  Final launch gate. Requires both api.heyvera.org/v1/health and
              heyvera.org/v1/health to return non-HTML 2xx JSON.

Always probes (Batch A topology):
  - /v1/social/trending (or similar) — Social entry owned by heyvera-server :3002
  - /v1/pulse/drafts — Pulse entry; 401 Unauthorized is OK (route exists), 404 is not
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

case "$MODE" in
  pre-proxy|post-proxy) ;;
  *)
    echo "[fail] unsupported HEYVERA_SMOKE_MODE: $MODE" >&2
    usage >&2
    exit 2
    ;;
esac

record_failure() {
  failures=$((failures + 1))
  echo "[fail] $*"
}

mk_body_file() {
  local file
  file="$(mktemp)"
  tmp_files+=("$file")
  printf '%s' "$file"
}

probe() {
  local prefix="$1"
  local url="$2"
  local body_file="$3"
  local meta
  local curl_exit

  set +e
  meta="$(curl --silent --show-error --max-time "$CURL_TIMEOUT" \
    --output "$body_file" \
    --write-out '%{http_code}|%{content_type}' \
    "$url" 2>&1)"
  curl_exit=$?
  set -e

  printf -v "${prefix}_url" '%s' "$url"
  printf -v "${prefix}_curl_exit" '%s' "$curl_exit"
  if [ "$curl_exit" -eq 0 ]; then
    printf -v "${prefix}_status" '%s' "${meta%%|*}"
    printf -v "${prefix}_content_type" '%s' "${meta#*|}"
  else
    printf -v "${prefix}_status" '%s' "000"
    printf -v "${prefix}_content_type" '%s' ""
    printf -v "${prefix}_error" '%s' "$meta"
  fi
}

is_2xx() {
  local status="$1"
  [ "$status" -ge 200 ] && [ "$status" -lt 300 ]
}

looks_json() {
  local content_type="$1"
  local body_file="$2"

  if printf '%s' "$content_type" | grep -qi 'application/json'; then
    return 0
  fi

  head -c 128 "$body_file" | tr -d '[:space:]' | grep -Eq '^[{\[]'
}

looks_html() {
  local content_type="$1"
  local body_file="$2"

  if printf '%s' "$content_type" | grep -qi 'text/html'; then
    return 0
  fi

  head -c 512 "$body_file" | grep -Eiq '<!doctype html|<html|<head|<body|<div id="root"'
}

print_probe() {
  local label="$1"
  local status="$2"
  local content_type="$3"
  local body_file="$4"
  local preview

  preview="$(head -c 100 "$body_file" | tr '\r\n' '  ' | sed 's/[[:space:]][[:space:]]*/ /g')"
  echo "[probe] ${label}: status=${status} content-type=${content_type:-unknown} body=${preview}"
}

legacy_body="$(mk_body_file)"
api_v1_body="$(mk_body_file)"
frontend_v1_body="$(mk_body_file)"
social_body="$(mk_body_file)"
pulse_body="$(mk_body_file)"

probe legacy_api_health "${API_ORIGIN%/}/api/health" "$legacy_body"
probe api_v1_health "${API_ORIGIN%/}/v1/health" "$api_v1_body"
probe frontend_v1_health "${FRONTEND_ORIGIN%/}/v1/health" "$frontend_v1_body"
# Social entry (public) — heyvera-server owns /v1/social/*
probe social_trending "${API_ORIGIN%/}/v1/social/trending" "$social_body"
# Pulse entry (auth required) — 401 OK means route is mounted; 404 means wrong owner/process
probe pulse_drafts "${API_ORIGIN%/}/v1/pulse/drafts" "$pulse_body"

print_probe "api /api/health" "$legacy_api_health_status" "$legacy_api_health_content_type" "$legacy_body"
print_probe "api /v1/health" "$api_v1_health_status" "$api_v1_health_content_type" "$api_v1_body"
print_probe "frontend /v1/health" "$frontend_v1_health_status" "$frontend_v1_health_content_type" "$frontend_v1_body"
print_probe "api /v1/social/trending" "$social_trending_status" "$social_trending_content_type" "$social_body"
print_probe "api /v1/pulse/drafts" "$pulse_drafts_status" "$pulse_drafts_content_type" "$pulse_body"

if [ "$legacy_api_health_curl_exit" -ne 0 ]; then
  record_failure "${legacy_api_health_url} curl failed: ${legacy_api_health_error:-unknown error}"
elif ! is_2xx "$legacy_api_health_status"; then
  record_failure "${legacy_api_health_url} returned HTTP ${legacy_api_health_status}; expected 2xx"
elif looks_html "$legacy_api_health_content_type" "$legacy_body"; then
  record_failure "${legacy_api_health_url} returned HTML; expected API health JSON"
elif ! looks_json "$legacy_api_health_content_type" "$legacy_body"; then
  record_failure "${legacy_api_health_url} did not look like JSON"
fi

api_v1_ready=false
if [ "$api_v1_health_curl_exit" -eq 0 ] &&
  is_2xx "$api_v1_health_status" &&
  looks_json "$api_v1_health_content_type" "$api_v1_body" &&
  ! looks_html "$api_v1_health_content_type" "$api_v1_body"; then
  api_v1_ready=true
fi

frontend_v1_api=false
if [ "$frontend_v1_health_curl_exit" -eq 0 ] &&
  is_2xx "$frontend_v1_health_status" &&
  looks_json "$frontend_v1_health_content_type" "$frontend_v1_body" &&
  ! looks_html "$frontend_v1_health_content_type" "$frontend_v1_body"; then
  frontend_v1_api=true
fi

# --- Batch A: Social entry must be live on api origin when /v1/health is ready ---
if $api_v1_ready; then
  if [ "$social_trending_curl_exit" -ne 0 ]; then
    record_failure "${social_trending_url} curl failed: ${social_trending_error:-unknown error}"
  elif [ "$social_trending_status" = "404" ]; then
    record_failure "${social_trending_url} returned 404 — Social not owned by heyvera-server (expected 2xx JSON)"
  elif looks_html "$social_trending_content_type" "$social_body"; then
    record_failure "${social_trending_url} returned HTML; expected social API JSON"
  elif ! is_2xx "$social_trending_status"; then
    # Some auth/rate-limit edges may return non-2xx; still require non-404 non-HTML
    if [ "$social_trending_status" = "401" ] || [ "$social_trending_status" = "429" ]; then
      echo "[gate] social trending returned ${social_trending_status} (route present)"
    else
      record_failure "${social_trending_url} returned HTTP ${social_trending_status}; expected 2xx (or 401/429)"
    fi
  elif ! looks_json "$social_trending_content_type" "$social_body"; then
    record_failure "${social_trending_url} did not look like JSON"
  else
    echo "[gate] social entry OK (trending)"
  fi

  # Pulse drafts: unauthenticated → 401 is success for route presence; 404 is topology fail
  if [ "$pulse_drafts_curl_exit" -ne 0 ]; then
    record_failure "${pulse_drafts_url} curl failed: ${pulse_drafts_error:-unknown error}"
  elif [ "$pulse_drafts_status" = "404" ]; then
    record_failure "${pulse_drafts_url} returned 404 — Pulse not mounted on heyvera-server / Caddy mis-route"
  elif looks_html "$pulse_drafts_content_type" "$pulse_body"; then
    record_failure "${pulse_drafts_url} returned HTML; expected JSON auth error or drafts"
  elif [ "$pulse_drafts_status" = "401" ] || [ "$pulse_drafts_status" = "403" ]; then
    echo "[gate] pulse drafts entry OK (HTTP ${pulse_drafts_status} auth required — route present)"
  elif is_2xx "$pulse_drafts_status"; then
    echo "[gate] pulse drafts entry OK (HTTP ${pulse_drafts_status})"
  else
    record_failure "${pulse_drafts_url} returned HTTP ${pulse_drafts_status}; expected 401/403 or 2xx (not 404)"
  fi
else
  echo "[gate] skip social/pulse entry checks until /v1/health is ready"
fi

if [ "$MODE" = "pre-proxy" ]; then
  if [ "$frontend_v1_health_curl_exit" -ne 0 ]; then
    record_failure "${frontend_v1_health_url} curl failed: ${frontend_v1_health_error:-unknown error}"
  elif ! is_2xx "$frontend_v1_health_status"; then
    record_failure "${FRONTEND_ORIGIN%/}/v1/health returned HTTP ${frontend_v1_health_status}; expected current frontend HTML before proxy cutover"
  elif $frontend_v1_api && ! $api_v1_ready; then
    record_failure "${FRONTEND_ORIGIN%/}/v1/health looks proxied, but ${API_ORIGIN%/}/v1/health is not healthy API JSON"
  elif ! $frontend_v1_api && ! looks_html "$frontend_v1_health_content_type" "$frontend_v1_body"; then
    record_failure "${FRONTEND_ORIGIN%/}/v1/health returned an unexpected non-HTML response before proxy cutover"
  fi

  if ! $api_v1_ready; then
    echo "[gate] upstream /v1 is not ready; keep frontend /v1 proxy cutover blocked"
  else
    echo "[gate] upstream /v1 is ready; Pages proxy can be tested with HEYVERA_SMOKE_MODE=post-proxy after it is enabled"
  fi
else
  if [ "$api_v1_health_curl_exit" -ne 0 ]; then
    record_failure "${api_v1_health_url} curl failed: ${api_v1_health_error:-unknown error}"
  elif ! $api_v1_ready; then
    record_failure "${API_ORIGIN%/}/v1/health must return non-HTML 2xx JSON before proxy cutover"
  fi

  if [ "$frontend_v1_health_curl_exit" -ne 0 ]; then
    record_failure "${frontend_v1_health_url} curl failed: ${frontend_v1_health_error:-unknown error}"
  elif ! $frontend_v1_api; then
    record_failure "${FRONTEND_ORIGIN%/}/v1/health must return non-HTML 2xx JSON after proxy cutover"
  fi
fi

if [ "$failures" -gt 0 ]; then
  echo "[result] HeyVera launch smoke failed (${failures} failure(s))"
  exit 1
fi

echo "[result] HeyVera launch smoke passed in ${MODE} mode"
