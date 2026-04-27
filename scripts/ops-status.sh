#!/usr/bin/env bash
# ─────────────────────────────────────────────────────
# ITSM-in-a-Box: Ops Status Dashboard
# ─────────────────────────────────────────────────────
# Usage: ./scripts/ops-status.sh [--registry-file customers.json] [--json]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGISTRY_FILE="${SCRIPT_DIR}/customers.json"
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --registry-file) REGISTRY_FILE="$2"; shift 2;;
    --json) JSON_OUTPUT=true; shift;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if [[ ! -f "$REGISTRY_FILE" ]]; then
  echo "ERROR: Customer registry not found: ${REGISTRY_FILE}"
  exit 1
fi

CUSTOMER_COUNT=$(jq length "$REGISTRY_FILE")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HEALTHY=0
UNHEALTHY=0
RESULTS="[]"

if [[ "$JSON_OUTPUT" == "false" ]]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  ITSM-in-a-Box: Operations Dashboard      ${NOW}  "
  echo "╠══════════════════════════════════════════════════════════════════╣"
  printf "║  %-12s %-8s %-8s %-10s %-8s %-12s ║\n" "CUSTOMER" "HEALTH" "READY" "DB" "AI" "VERSION"
  echo "╠══════════════════════════════════════════════════════════════════╣"
fi

for i in $(seq 0 $((CUSTOMER_COUNT - 1))); do
  NAME=$(jq -r ".[$i].name" "$REGISTRY_FILE")
  APP=$(jq -r ".[$i].app" "$REGISTRY_FILE")
  APP_URL="https://${APP}.azurewebsites.net"

  # Health check
  HEALTHZ=$(curl -s -o /dev/null -w "%{http_code}" "${APP_URL}/healthz" 2>/dev/null || echo "000")
  READYZ_BODY=$(curl -s "${APP_URL}/readyz" 2>/dev/null || echo '{}')
  READYZ_STATUS=$(echo "$READYZ_BODY" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
  DB_STATUS=$(echo "$READYZ_BODY" | jq -r '.database // "unknown"' 2>/dev/null || echo "unknown")

  # Full health (version, AI, etc.)
  HEALTH_BODY=$(curl -s "${APP_URL}/api/health" 2>/dev/null || echo '{}')
  VERSION=$(echo "$HEALTH_BODY" | jq -r '.version // "?"' 2>/dev/null || echo "?")
  AI=$(echo "$HEALTH_BODY" | jq -r 'if .aiConfigured == true then "yes" else "no" end' 2>/dev/null || echo "?")
  MAIL=$(echo "$HEALTH_BODY" | jq -r 'if .mailConfigured == true then "yes" else "no" end' 2>/dev/null || echo "?")
  SLA=$(echo "$HEALTH_BODY" | jq -r 'if .slaEngineRunning == true then "yes" else "no" end' 2>/dev/null || echo "?")
  REDIRECT=$(echo "$HEALTH_BODY" | jq -r 'if .emailRedirectMode == true then "ON" else "off" end' 2>/dev/null || echo "?")

  if [[ "$HEALTHZ" == "200" ]]; then
    STATUS="✓ UP"
    HEALTHY=$((HEALTHY + 1))
  else
    STATUS="✗ DOWN"
    UNHEALTHY=$((UNHEALTHY + 1))
  fi

  if [[ "$JSON_OUTPUT" == "false" ]]; then
    printf "║  %-12s %-8s %-8s %-10s %-8s %-12s ║\n" "$NAME" "$STATUS" "$READYZ_STATUS" "$DB_STATUS" "$AI" "v${VERSION}"
  fi

  RESULTS=$(echo "$RESULTS" | jq --arg n "$NAME" --arg a "$APP" --arg h "$HEALTHZ" \
    --arg r "$READYZ_STATUS" --arg d "$DB_STATUS" --arg v "$VERSION" \
    --arg ai "$AI" --arg m "$MAIL" --arg s "$SLA" --arg rd "$REDIRECT" \
    '. += [{"customer":$n,"app":$a,"healthz":($h|tonumber),"ready":$r,"database":$d,"version":$v,"ai":$ai,"mail":$m,"sla":$s,"emailRedirect":$rd}]')
done

if [[ "$JSON_OUTPUT" == "false" ]]; then
  echo "╠══════════════════════════════════════════════════════════════════╣"
  echo "║  Total: ${CUSTOMER_COUNT}  |  Healthy: ${HEALTHY}  |  Unhealthy: ${UNHEALTHY}              ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
else
  echo "$RESULTS" | jq '{timestamp:"'"$NOW"'",total:'"$CUSTOMER_COUNT"',healthy:'"$HEALTHY"',unhealthy:'"$UNHEALTHY"',customers:.}'
fi

[[ "$UNHEALTHY" -eq 0 ]] || exit 1
