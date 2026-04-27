#!/usr/bin/env bash
# ─────────────────────────────────────────────────────
# ITSM-in-a-Box: Provision a new customer environment
# ─────────────────────────────────────────────────────
# Usage:
#   ./scripts/provision-customer.sh \
#     --name acme \
#     --org "ACME Pte Ltd" \
#     --org-short "ACME" \
#     --tenant-id <entra-tenant-id> \
#     --client-id <entra-client-id> \
#     --helpdesk helpdesk@acme.com \
#     --mail-from itsupport@acme.com \
#     --region southeastasia \
#     [--sku B1] \
#     [--mysql-sku Standard_B1ms] \
#     [--shared-mysql-server <name>] \
#     [--shared-mysql-rg <rg>] \
#     [--openai-endpoint <url>] \
#     [--openai-key <key>]
set -euo pipefail

# ─── Defaults ───
SKU="B1"
MYSQL_SKU="Standard_B1ms"
REGION="southeastasia"
SHARED_MYSQL=""
SHARED_MYSQL_RG=""
OPENAI_ENDPOINT=""
OPENAI_KEY=""

# ─── Parse args ───
while [[ $# -gt 0 ]]; do
  case $1 in
    --name)           CUSTOMER="$2"; shift 2;;
    --org)            ORG_NAME="$2"; shift 2;;
    --org-short)      ORG_SHORT="$2"; shift 2;;
    --tenant-id)      TENANT_ID="$2"; shift 2;;
    --client-id)      CLIENT_ID="$2"; shift 2;;
    --helpdesk)       HELPDESK="$2"; shift 2;;
    --mail-from)      MAIL_FROM="$2"; shift 2;;
    --region)         REGION="$2"; shift 2;;
    --sku)            SKU="$2"; shift 2;;
    --mysql-sku)      MYSQL_SKU="$2"; shift 2;;
    --shared-mysql-server) SHARED_MYSQL="$2"; shift 2;;
    --shared-mysql-rg)     SHARED_MYSQL_RG="$2"; shift 2;;
    --openai-endpoint)     OPENAI_ENDPOINT="$2"; shift 2;;
    --openai-key)          OPENAI_KEY="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

# ─── Validate required args ───
for var in CUSTOMER ORG_NAME TENANT_ID CLIENT_ID HELPDESK MAIL_FROM; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: --$(echo $var | tr '[:upper:]' '[:lower:]' | tr '_' '-') is required"
    exit 1
  fi
done

ORG_SHORT="${ORG_SHORT:-$ORG_NAME}"
RG="rg-itsm-${CUSTOMER}"
MYSQL_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 20)
USE_SHARED=false
if [[ -n "$SHARED_MYSQL" ]]; then
  USE_SHARED=true
fi

echo "╔══════════════════════════════════════════════════╗"
echo "║  ITSM-in-a-Box: Provisioning ${CUSTOMER}        "
echo "╠══════════════════════════════════════════════════╣"
echo "║  Org:      ${ORG_NAME}"
echo "║  Region:   ${REGION}"
echo "║  SKU:      ${SKU} / MySQL: ${MYSQL_SKU}"
echo "║  Shared DB: ${USE_SHARED}"
echo "╚══════════════════════════════════════════════════╝"

# ─── Step 1: Create Resource Group ───
echo ""
echo "▶ [1/5] Creating resource group ${RG}..."
az group create --name "$RG" --location "$REGION" --output none

# ─── Step 2: Deploy Bicep ───
echo "▶ [2/5] Deploying infrastructure (Bicep)..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$RG" \
  --template-file "${SCRIPT_DIR}/../infra/main.bicep" \
  --parameters \
    customerName="$CUSTOMER" \
    appServiceSku="$SKU" \
    mysqlSku="$MYSQL_SKU" \
    mysqlAdminPassword="$MYSQL_PASS" \
    entraClientId="$CLIENT_ID" \
    entraTenantId="$TENANT_ID" \
    orgName="$ORG_NAME" \
    orgShortName="$ORG_SHORT" \
    helpdeskMailbox="$HELPDESK" \
    mailFrom="$MAIL_FROM" \
    azureOpenAiEndpoint="$OPENAI_ENDPOINT" \
    azureOpenAiKey="$OPENAI_KEY" \
    useSharedMysql="$USE_SHARED" \
    sharedMysqlServer="$SHARED_MYSQL" \
    sharedMysqlResourceGroup="$SHARED_MYSQL_RG" \
  --output json)

APP_URL=$(echo "$DEPLOY_OUTPUT" | jq -r '.properties.outputs.appUrl.value')
APP_NAME=$(echo "$DEPLOY_OUTPUT" | jq -r '.properties.outputs.appName.value')
KV_NAME=$(echo "$DEPLOY_OUTPUT" | jq -r '.properties.outputs.keyVaultName.value')
echo "   ✓ App URL: ${APP_URL}"
echo "   ✓ Key Vault: ${KV_NAME}"

# ─── Step 3: Deploy application code ───
echo "▶ [3/5] Deploying application code..."

# Enable SCM basic auth
az resource update \
  --resource-group "$RG" \
  --name scm \
  --namespace Microsoft.Web \
  --resource-type basicPublishingCredentialsPolicies \
  --parent "sites/${APP_NAME}" \
  --set properties.allow=true \
  --output none 2>/dev/null || true

# Get publish credentials
CREDS=$(az webapp deployment list-publishing-credentials \
  --resource-group "$RG" \
  --name "$APP_NAME" \
  --output json)
SCM_USER=$(echo "$CREDS" | jq -r '.publishingUserName')
SCM_PASS=$(echo "$CREDS" | jq -r '.publishingPassword')

# Upload files via Kudu VFS
KUDU_URL="https://${APP_NAME}.scm.azurewebsites.net/api/vfs/site/wwwroot"
AUTH=$(echo -n "${SCM_USER}:${SCM_PASS}" | base64)

for f in server.js authMiddleware.js msalConfig.js graphService.js slaEngine.js workflowEngine.js notificationEngine.js cacheLayer.js analyticsEngine.js package.json; do
  if [[ -f "${SCRIPT_DIR}/../${f}" ]]; then
    curl -s -X PUT "${KUDU_URL}/${f}" \
      -H "Authorization: Basic ${AUTH}" \
      -H "If-Match: *" \
      -H "Content-Type: application/octet-stream" \
      --data-binary "@${SCRIPT_DIR}/../${f}" > /dev/null
  fi
done

# Upload built frontend
for f in "${SCRIPT_DIR}"/../deploy/index.html; do
  curl -s -X PUT "${KUDU_URL}/index.html" \
    -H "Authorization: Basic ${AUTH}" \
    -H "If-Match: *" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${f}" > /dev/null
done

# Create assets dir and upload JS bundles
curl -s -X PUT "${KUDU_URL}/assets/" \
  -H "Authorization: Basic ${AUTH}" \
  -H "If-Match: *" > /dev/null 2>&1 || true

for f in "${SCRIPT_DIR}"/../deploy/assets/*.js; do
  fname=$(basename "$f")
  curl -s -X PUT "${KUDU_URL}/assets/${fname}" \
    -H "Authorization: Basic ${AUTH}" \
    -H "If-Match: *" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${f}" > /dev/null
done

echo "   ✓ Application code deployed"

# ─── Step 4: Install dependencies + restart ───
echo "▶ [4/5] Installing dependencies and restarting..."
curl -s -X POST "https://${APP_NAME}.scm.azurewebsites.net/api/command" \
  -H "Authorization: Basic ${AUTH}" \
  -H "Content-Type: application/json" \
  -d '{"command":"npm install --production","dir":"/home/site/wwwroot"}' > /dev/null

az webapp restart --name "$APP_NAME" --resource-group "$RG" --output none
echo "   ✓ App restarted"

# ─── Step 5: Health check ───
echo "▶ [5/5] Waiting for health check..."
sleep 15
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${APP_URL}/healthz")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "   ✓ Health check PASSED (200)"
else
  echo "   ✗ Health check FAILED (HTTP ${HTTP_CODE})"
  echo "   Try: az webapp log tail --name ${APP_NAME} --resource-group ${RG}"
fi

# ─── Summary ───
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Provisioning Complete!                          "
echo "╠══════════════════════════════════════════════════╣"
echo "║  Customer:     ${CUSTOMER}"
echo "║  App URL:      ${APP_URL}"
echo "║  App Name:     ${APP_NAME}"
echo "║  Resource Group: ${RG}"
echo "║  Key Vault:    ${KV_NAME}"
echo "║  MySQL Pass:   (stored in Key Vault)"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Register Entra app redirect URI: ${APP_URL}"
echo "  2. Configure mail integration (Graph API permissions)"
echo "  3. Open ${APP_URL} and complete setup wizard"
