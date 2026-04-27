#!/usr/bin/env bash
# ─────────────────────────────────────────────────────
# ITSM-in-a-Box: Rolling update all customer deployments
# ─────────────────────────────────────────────────────
# Usage:
#   ./scripts/update-all-customers.sh [--registry-file customers.json] [--dry-run]
#
# customers.json format:
# [
#   { "name": "acme", "rg": "rg-itsm-acme", "app": "itsm-acme-app" },
#   { "name": "globex", "rg": "rg-itsm-globex", "app": "itsm-globex-app" }
# ]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGISTRY_FILE="${SCRIPT_DIR}/customers.json"
DRY_RUN=false
FAILED=()
SUCCEEDED=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --registry-file) REGISTRY_FILE="$2"; shift 2;;
    --dry-run) DRY_RUN=true; shift;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if [[ ! -f "$REGISTRY_FILE" ]]; then
  echo "ERROR: Customer registry not found: ${REGISTRY_FILE}"
  echo "Create it with: [{\"name\":\"acme\",\"rg\":\"rg-itsm-acme\",\"app\":\"itsm-acme-app\"}]"
  exit 1
fi

CUSTOMER_COUNT=$(jq length "$REGISTRY_FILE")
echo "╔══════════════════════════════════════════════════╗"
echo "║  ITSM-in-a-Box: Rolling Update                  "
echo "║  Customers: ${CUSTOMER_COUNT}                    "
echo "║  Dry Run: ${DRY_RUN}                             "
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── Build frontend once ───
echo "▶ Building frontend..."
if [[ "$DRY_RUN" == "false" ]]; then
  cd "${SCRIPT_DIR}/.."
  npx vite build > /dev/null 2>&1
  cp dist/index.html deploy/index.html
  cp dist/assets/*.js deploy/assets/ 2>/dev/null || true
  echo "   ✓ Frontend built"
fi

# ─── Update each customer ───
for i in $(seq 0 $((CUSTOMER_COUNT - 1))); do
  NAME=$(jq -r ".[$i].name" "$REGISTRY_FILE")
  RG=$(jq -r ".[$i].rg" "$REGISTRY_FILE")
  APP=$(jq -r ".[$i].app" "$REGISTRY_FILE")

  echo ""
  echo "━━━ [$(($i+1))/${CUSTOMER_COUNT}] Updating ${NAME} (${APP}) ━━━"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "   [DRY RUN] Would update ${APP} in ${RG}"
    SUCCEEDED+=("$NAME")
    continue
  fi

  # Get publish credentials
  CREDS=$(az webapp deployment list-publishing-credentials \
    --resource-group "$RG" --name "$APP" --output json 2>/dev/null) || {
    echo "   ✗ Failed to get credentials"
    FAILED+=("$NAME")
    continue
  }
  SCM_USER=$(echo "$CREDS" | jq -r '.publishingUserName')
  SCM_PASS=$(echo "$CREDS" | jq -r '.publishingPassword')
  AUTH=$(echo -n "${SCM_USER}:${SCM_PASS}" | base64)
  KUDU_URL="https://${APP}.scm.azurewebsites.net/api/vfs/site/wwwroot"

  # Delete old JS bundles
  OLD_ASSETS=$(curl -s "${KUDU_URL}/assets/" -H "Authorization: Basic ${AUTH}" 2>/dev/null || echo "[]")
  echo "$OLD_ASSETS" | jq -r '.[].name // empty' 2>/dev/null | grep '\.js$' | while read -r fname; do
    curl -s -X DELETE "${KUDU_URL}/assets/${fname}" \
      -H "Authorization: Basic ${AUTH}" -H "If-Match: *" > /dev/null 2>&1
  done

  # Upload server files
  for f in server.js authMiddleware.js msalConfig.js graphService.js slaEngine.js workflowEngine.js notificationEngine.js cacheLayer.js analyticsEngine.js package.json; do
    if [[ -f "${SCRIPT_DIR}/../${f}" ]]; then
      curl -s -X PUT "${KUDU_URL}/${f}" \
        -H "Authorization: Basic ${AUTH}" -H "If-Match: *" \
        -H "Content-Type: application/octet-stream" \
        --data-binary "@${SCRIPT_DIR}/../${f}" > /dev/null
    fi
  done

  # Upload frontend
  curl -s -X PUT "${KUDU_URL}/index.html" \
    -H "Authorization: Basic ${AUTH}" -H "If-Match: *" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${SCRIPT_DIR}/../deploy/index.html" > /dev/null

  for f in "${SCRIPT_DIR}"/../deploy/assets/*.js; do
    fname=$(basename "$f")
    curl -s -X PUT "${KUDU_URL}/assets/${fname}" \
      -H "Authorization: Basic ${AUTH}" -H "If-Match: *" \
      -H "Content-Type: application/octet-stream" \
      --data-binary "@${f}" > /dev/null
  done

  # Restart
  az webapp restart --name "$APP" --resource-group "$RG" --output none

  # Health check
  sleep 10
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${APP}.azurewebsites.net/healthz" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "   ✓ ${NAME} updated successfully"
    SUCCEEDED+=("$NAME")
  else
    echo "   ✗ ${NAME} health check failed (HTTP ${HTTP_CODE})"
    FAILED+=("$NAME")
  fi
done

# ─── Summary ───
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Update Complete                                 "
echo "╠══════════════════════════════════════════════════╣"
echo "║  Succeeded: ${#SUCCEEDED[@]}                     "
echo "║  Failed:    ${#FAILED[@]}                        "
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "║  Failed:    ${FAILED[*]}"
fi
echo "╚══════════════════════════════════════════════════╝"

[[ ${#FAILED[@]} -eq 0 ]] || exit 1
