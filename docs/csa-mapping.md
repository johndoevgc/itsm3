# CSA Cyber Essentials Control Mapping

**Framework**: CSA Cyber Essentials (Singapore)  
**Product**: VGC ITSM  
**Last Updated**: 2024-01-01

## Control Areas

### 1. Asset Management

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| AM-1: Asset inventory | Azure Resource Graph queries | `/docs/runbook/assets.md` |
| AM-2: Authorised software | Container images from MCR only | `Dockerfile` files |
| AM-3: Removal of unnecessary access | PIM JIT for admin access | Entra ID PIM config |

### 2. Patching

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| PA-1: OS/app patching | Base images updated weekly via Dependabot | `.github/dependabot.yml` |
| PA-2: Firmware patching | Azure manages host OS | Azure SLA |
| PA-3: Patch management policy | Dependabot `semver:minor` auto-merge | `.github/dependabot.yml` |

### 3. Secure Configuration

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| SC-1: Default accounts removed | No local auth on Cosmos/OpenAI/ACS | Bicep modules |
| SC-2: Unnecessary services disabled | Container Apps: minimal image | `Dockerfile` |
| SC-3: Security headers | Fastify Helmet, Next.js headers | `apps/api/src/server.ts`, `next.config.mjs` |

### 4. Access Control

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| AC-1: User accounts | Entra ID + Singpass OIDC | `apps/web/src/` |
| AC-2: Admin accounts | PIM JIT, MFA required | Entra ID config |
| AC-3: Password policy | Entra ID Smart Lockout | Entra ID config |
| AC-4: Privileged access | Managed Identity only, no secrets | All `*.bicep` files |

### 5. Malware Protection

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| MP-1: Anti-malware | Microsoft Defender for Containers | Azure Security Center |
| MP-2: Malware scanning | GitHub Advanced Security | `.github/workflows/ci.yml` |

### 6. Network Security

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| NS-1: Firewall | Azure Container Apps ingress rules | `infra/core/containerapps-env.bicep` |
| NS-2: Secure remote access | VPN/Bastion only, no SSH | Azure Bastion config |
| NS-3: Network segmentation | Internal-only Container Apps for functions | `infra/app/functions.bicep` |

## Export Evidence

To export audit evidence for CSA assessment:

```bash
# Export Cosmos DB audit logs
az monitor log-analytics query \
  --workspace $LOG_ANALYTICS_WORKSPACE_ID \
  --analytics-query "ContainerAppConsoleLogs_CL | where TimeGenerated > ago(30d)"

# Export Key Vault audit logs
az monitor log-analytics query \
  --workspace $LOG_ANALYTICS_WORKSPACE_ID \
  --analytics-query "AzureDiagnostics | where ResourceType == 'VAULTS'"
```
