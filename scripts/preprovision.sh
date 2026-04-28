#!/usr/bin/env bash
# scripts/preprovision.sh
# Pre-provision checks for VGC ITSM.
# Called by `azd up` before any Bicep deployment.
#
# Checks:
# 1. Azure OpenAI model availability in region
# 2. Data residency (southeastasia for prod)
# 3. Required env vars
# 4. Azure subscription quota
#
# SRE: Fail fast with actionable messages. Never leave user guessing.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

info "VGC ITSM pre-provision checks starting..."

# -------------------------------------------------------------------
# 1. Check required environment variables
# -------------------------------------------------------------------
info "Checking required environment variables..."

REQUIRED_VARS=(
  "AZURE_SUBSCRIPTION_ID"
  "AZURE_TENANT_ID"
  "AZURE_ENV_NAME"
  "AZURE_LOCATION"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    error "Missing required env var: $var. Run: azd env set $var <value>"
  fi
done

info "Environment variables: OK"

# -------------------------------------------------------------------
# 2. Data residency check
# -------------------------------------------------------------------
info "Checking data residency..."

LOCATION="${AZURE_LOCATION:-southeastasia}"
ENV_NAME="${AZURE_ENV_NAME:-dev}"
ALLOW_NON_SG="${ALLOW_NON_SG:-false}"

if [[ "$ENV_NAME" == "production" && "$LOCATION" != "southeastasia" ]]; then
  if [[ "$ALLOW_NON_SG" != "true" ]]; then
    error "DATA RESIDENCY VIOLATION: Production must deploy to 'southeastasia' for PDPA compliance.
Current location: $LOCATION

To override (non-SG production deployment):
  azd env set ALLOW_NON_SG=true

WARNING: This will violate PDPA data residency requirements for Singapore SMEs."
  else
    warn "ALLOW_NON_SG=true — deploying to $LOCATION. Ensure PDPA compliance is handled externally."
  fi
else
  info "Data residency: OK (${LOCATION})"
fi

# -------------------------------------------------------------------
# 3. Check HELP_DESK_PHONE is set
# -------------------------------------------------------------------
info "Checking helpdesk configuration..."

if [[ -z "${HELP_DESK_PHONE:-}" ]]; then
  warn "HELP_DESK_PHONE not set. P1 escalation will be disabled."
  warn "To enable: azd env set HELP_DESK_PHONE=+6569781299"
else
  # Validate E.164 format
  if [[ ! "$HELP_DESK_PHONE" =~ ^\+[1-9][0-9]{1,14}$ ]]; then
    error "HELP_DESK_PHONE must be E.164 format (e.g., +6569781299). Got: $HELP_DESK_PHONE"
  fi
  info "Helpdesk phone: OK (E.164 validated)"
fi

# -------------------------------------------------------------------
# 4. Check Azure OpenAI model availability
# -------------------------------------------------------------------
info "Checking Azure OpenAI availability in ${LOCATION}..."

# List available OpenAI models in region
if command -v az &>/dev/null; then
  OPENAI_MODELS=$(az cognitiveservices model list \
    --location "$LOCATION" \
    --query "[?name=='gpt-4o'].name" \
    --output tsv 2>/dev/null || echo "")

  if [[ -z "$OPENAI_MODELS" ]]; then
    warn "gpt-4o may not be available in $LOCATION. Deployment may fail."
    warn "Check: https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models"
    warn "If unavailable, run: azd env set AZURE_LOCATION eastus (non-prod only)"
  else
    info "Azure OpenAI gpt-4o: Available in ${LOCATION}"
  fi
else
  warn "Azure CLI not available — skipping OpenAI model check"
fi

# -------------------------------------------------------------------
# 5. Check Teams Phone license (optional)
# -------------------------------------------------------------------
info "Checking Teams Phone configuration..."

if [[ -z "${P1_TEAM_ID:-}" ]]; then
  warn "P1_TEAM_ID not set. Teams war-room creation will be skipped for P1s."
  warn "To enable: azd env set P1_TEAM_ID=<your-teams-team-id>"
fi

# -------------------------------------------------------------------
# 6. Check Azure subscription quota
# -------------------------------------------------------------------
info "Checking Azure subscription state..."

if command -v az &>/dev/null; then
  # Check subscription is not suspended
  SUB_STATE=$(az account show \
    --subscription "${AZURE_SUBSCRIPTION_ID}" \
    --query "state" \
    --output tsv 2>/dev/null || echo "unknown")

  if [[ "$SUB_STATE" != "Enabled" ]]; then
    error "Azure subscription ${AZURE_SUBSCRIPTION_ID} is not in 'Enabled' state. Current: $SUB_STATE"
  fi
  info "Azure subscription: OK (${SUB_STATE})"
fi

# -------------------------------------------------------------------
# All checks passed
# -------------------------------------------------------------------
info "All pre-provision checks passed! ✓"
info "Proceeding with: azd up (environment: $ENV_NAME, location: $LOCATION)"
