# Runbook: Ticket API

**Service**: `apps/api` — POST /api/v1/tickets  
**SLO**: 99.95% availability, P95 < 2s  
**On-Call**: Refer to PagerDuty escalation policy

## Overview

The Ticket API is a Fastify endpoint that creates ITSM tickets in Cosmos DB. For Severity A tickets, it asynchronously triggers the P1 escalation flow.

## Architecture

```
WhatsApp/Teams → API (/api/v1/tickets) → Cosmos DB (tickets container)
                                     ↘ Functions (/api/escalate-p1) [Sev A only]
```

## Common Issues

### 1. POST /api/v1/tickets returns 503

**Cause**: Cosmos DB unreachable or rate limited.

**Resolution**:
```bash
# Check Cosmos DB status
az cosmosdb show --name <cosmos-name> --resource-group <rg> --query "documentEndpoint"

# Check Container App logs
az containerapp logs show --name ca-api-itsm3-* --resource-group <rg> --type system
```

### 2. POST /api/v1/tickets returns 401

**Cause**: `x-tenant-id` header missing, or JWT expired.

**Resolution**: Check that the caller is including `x-tenant-id` header. Verify Entra ID token validity.

### 3. P1 escalation not triggering

**Cause**: `HELP_DESK_PHONE` not set, or Functions service unreachable.

**Resolution**:
```bash
# Check env var
azd env get HELP_DESK_PHONE

# Check Functions service health
curl https://ca-fn-itsm3-*.azurecontainerapps.io/health
```

### 4. Ticket created but missing from list

**Cause**: Eventual consistency in Cosmos DB. Session consistency is used; cross-session reads may lag.

**Resolution**: Wait 1-2 seconds and retry. For tests, use direct point-reads by ID.

## Deployment

```bash
# Deploy only the API
azd deploy --service api

# Check deployment health
curl https://ca-api-itsm3-*.azurecontainerapps.io/health
```

## Rollback

```bash
# List recent revisions
az containerapp revision list --name ca-api-itsm3-* --resource-group <rg>

# Activate previous revision
az containerapp revision activate --revision <previous-revision-name> --resource-group <rg>
```

## Monitoring

- **Dashboard**: Azure Monitor → `itsm3-${env}` → Container Apps
- **Alerts**: P95 latency > 2s → PagerDuty P2
- **Errors**: 5xx rate > 0.1% → PagerDuty P1
- **Logs**: Log Analytics → `ContainerAppConsoleLogs_CL`
