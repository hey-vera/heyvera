#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ClawNet Load Test — F4
# Fires 100 concurrent POST /v1/orchestrate requests and reports p50/p95/p99
# latency, success rate, and error count.
#
# Usage:
#   ./scripts/loadtest.sh [API_KEY] [BASE_URL] [CONCURRENCY] [TOTAL]
#
# Defaults:
#   BASE_URL    = https://api.claw-net.org
#   CONCURRENCY = 100
#   TOTAL       = 100
#
# Requires: curl, bc, sort
# ─────────────────────────────────────────────────────────────────────────────

API_KEY="${1:-${CLAWNET_API_KEY}}"
BASE_URL="${2:-https://api.claw-net.org}"
CONCURRENCY="${3:-100}"
TOTAL="${4:-100}"

if [ -z "$API_KEY" ]; then
  echo "Error: API key required. Pass as first argument or set CLAWNET_API_KEY env var."
  echo "Usage: ./scripts/loadtest.sh <api_key> [base_url] [concurrency] [total]"
  exit 1
fi

ENDPOINT="${BASE_URL}/v1/orchestrate"
TMPDIR_RESULTS=$(mktemp -d)

# Rotate through several realistic queries to avoid cache hits dominating
QUERIES=(
  '{"query":"What is the current SOL price?"}'
  '{"query":"Show me trending tokens on Solana"}'
  '{"query":"What is the Twitter sentiment on Bitcoin?"}'
  '{"query":"Get the latest crypto news"}'
  '{"query":"What tokens are risky right now?"}'
)

echo "═══════════════════════════════════════════════════════"
echo "  ClawNet Load Test"
echo "  Endpoint  : $ENDPOINT"
echo "  Requests  : $TOTAL (concurrency: $CONCURRENCY)"
echo "  Started   : $(date)"
echo "═══════════════════════════════════════════════════════"
echo ""

# Fire all requests in background, capturing latency and HTTP status
run_request() {
  local idx=$1
  local query="${QUERIES[$((idx % ${#QUERIES[@]}))]}"
  local out_file="${TMPDIR_RESULTS}/req_${idx}"

  local start_ms
  start_ms=$(date +%s%3N)

  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$ENDPOINT" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    --max-time 30 \
    -d "$query")

  local end_ms
  end_ms=$(date +%s%3N)
  local latency_ms=$((end_ms - start_ms))

  echo "${latency_ms} ${http_code}" > "$out_file"
}

export -f run_request
export ENDPOINT API_KEY TMPDIR_RESULTS
# Export QUERIES as individual env vars (bash arrays aren't exportable)
for i in "${!QUERIES[@]}"; do
  export "QUERY_${i}=${QUERIES[$i]}"
done

GLOBAL_START=$(date +%s%3N)

# Launch all requests with bounded concurrency using xargs
seq 0 $((TOTAL - 1)) | xargs -P "$CONCURRENCY" -I{} bash -c 'run_request "$@"' _ {}

GLOBAL_END=$(date +%s%3N)
WALL_TIME_MS=$((GLOBAL_END - GLOBAL_START))

# ── Aggregate results ────────────────────────────────────────────────────────
LATENCIES=()
SUCCESS=0
ERRORS=0
declare -A STATUS_COUNTS

for f in "${TMPDIR_RESULTS}"/req_*; do
  read -r latency status < "$f"
  LATENCIES+=("$latency")
  STATUS_COUNTS["$status"]=$(( (STATUS_COUNTS["$status"]:-0) + 1 ))
  if [[ "$status" == "200" ]]; then
    ((SUCCESS++))
  else
    ((ERRORS++))
  fi
done

# Sort latencies numerically
IFS=$'\n' SORTED=($(sort -n <<< "${LATENCIES[*]}")); unset IFS

COUNT=${#SORTED[@]}

if [ "$COUNT" -eq 0 ]; then
  echo "No results collected. Check your API key and connectivity."
  rm -rf "$TMPDIR_RESULTS"
  exit 1
fi

p50_idx=$(( COUNT * 50 / 100 ))
p95_idx=$(( COUNT * 95 / 100 ))
p99_idx=$(( COUNT * 99 / 100 ))

P50=${SORTED[$p50_idx]}
P95=${SORTED[$p95_idx]}
P99=${SORTED[$p99_idx]}
MIN=${SORTED[0]}
MAX=${SORTED[$((COUNT - 1))]}

# Average
SUM=0
for l in "${SORTED[@]}"; do SUM=$((SUM + l)); done
AVG=$((SUM / COUNT))

THROUGHPUT=$(echo "scale=1; $COUNT * 1000 / $WALL_TIME_MS" | bc)

echo "Results"
echo "───────────────────────────────────────────────────────"
printf "  Total requests  : %d\n" "$COUNT"
printf "  Successful (2xx): %d\n" "$SUCCESS"
printf "  Errors          : %d\n" "$ERRORS"
printf "  Success rate    : %d%%\n" "$((SUCCESS * 100 / COUNT))"
echo ""
echo "Latency"
echo "───────────────────────────────────────────────────────"
printf "  min  : %dms\n" "$MIN"
printf "  avg  : %dms\n" "$AVG"
printf "  p50  : %dms\n" "$P50"
printf "  p95  : %dms\n" "$P95"
printf "  p99  : %dms\n" "$P99"
printf "  max  : %dms\n" "$MAX"
echo ""
echo "Throughput"
echo "───────────────────────────────────────────────────────"
printf "  Wall time       : %dms\n" "$WALL_TIME_MS"
printf "  Req/sec         : %s\n" "$THROUGHPUT"
echo ""
echo "HTTP Status Breakdown"
echo "───────────────────────────────────────────────────────"
for code in "${!STATUS_COUNTS[@]}"; do
  printf "  HTTP %s : %d\n" "$code" "${STATUS_COUNTS[$code]}"
done | sort

echo ""
echo "Targets (p95 < 5000ms, 0 server errors)"
echo "───────────────────────────────────────────────────────"
if [ "$P95" -lt 5000 ]; then
  printf "  p95 latency : PASS (%dms < 5000ms)\n" "$P95"
else
  printf "  p95 latency : FAIL (%dms >= 5000ms)\n" "$P95"
fi

SERVER_ERRORS=${STATUS_COUNTS["500"]:-0}
if [ "$SERVER_ERRORS" -eq 0 ]; then
  echo "  500 errors  : PASS (0)"
else
  printf "  500 errors  : FAIL (%d)\n" "$SERVER_ERRORS"
fi

echo ""
echo "Done: $(date)"
rm -rf "$TMPDIR_RESULTS"
