# Runbook: P1 Escalation

**Service**: `apps/functions` — POST /api/escalate-p1  
**Trigger**: Ticket with `severity: 'A'` created  
**SLA**: War-room created within 60s. Call placed within 90s.

## Overview

When a Severity A ticket is created, the P1 escalation orchestrator:
1. Creates a Microsoft Teams private channel (war-room)
2. Creates a Teams online meeting
3. Dials `HELP_DESK_PHONE` via ACS with TTS message
4. If no answer in 25s → sends SMS fallback

## Required Configuration

```bash
azd env set HELP_DESK_PHONE=+6569781299    # E.164 format
azd env set P1_TEAM_ID=<teams-team-id>     # Team for war-rooms
azd env set TEAMS_ORGANIZER_UPN=itsm@contoso.com
azd env set ACS_ENDPOINT=https://acs-itsm3-*.communication.azure.com
azd env set ACS_PHONE_NUMBER=+6500000000   # Your ACS phone number
azd env set ACS_SMS_FROM=+6500000000       # Your ACS SMS sender
```

## War-Room Naming Convention

Channels are created as `P1-{ticketId}` in the configured team.

## TTS Message Script

```
"This is an automated Priority 1 alert for tenant {tenantId}.
Ticket {ticketId}: {summary}.
This call may be recorded. Press 1 to accept the escalation."
```

## PDPA Compliance

- **Call recording**: All calls are announced as potentially recorded per PDPA.
- **Recordings**: Stored in Azure Blob with Customer-Managed Key (CMK).
- **Retention**: 30 days by default (configurable via App Config).

## Troubleshooting

### War-room not created

```bash
# Check P1_TEAM_ID is set and valid
az teams team show --team-id $P1_TEAM_ID

# Check UAMI has Teams permissions
# Required Graph scope: ChannelSettings.ReadWrite.All
```

### ACS call not placed

```bash
# Check ACS endpoint and phone numbers
curl https://$ACS_ENDPOINT/

# Check UAMI has ACS Contributor role
az role assignment list --assignee $UAMI_PRINCIPAL_ID
```

### SMS not sent

```bash
# Verify ACS SMS capability is enabled (not all ACS endpoints support SMS)
az communication sms list --endpoint $ACS_ENDPOINT
```

## Manual Override

To manually trigger P1 escalation:

```bash
curl -X POST https://ca-fn-itsm3-*.azurecontainerapps.io/api/escalate-p1 \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": "TICK-001",
    "tenantId": "tenant-123",
    "summary": "Production database unreachable"
  }'
```
