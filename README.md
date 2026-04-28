# VGC ITSM

**Enterprise-grade, multi-tenant IT Service Management for Singapore SMEs.**

Built on Azure. Deploys in minutes. PDPA + CSA Cyber Essentials compliant.

## Quick Start

```bash
# Prerequisites: Node 20+, pnpm 9+, Azure CLI, Azure Developer CLI (azd)
npm install -g pnpm@9 @azure/azd

# Deploy to your Azure tenant
azd auth login
azd env new my-itsm
azd env set HELP_DESK_PHONE=+6569781299   # Your helpdesk number
azd up
```

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 + TypeScript + shadcn/ui + Tailwind |
| Backend | Node 20 + Fastify + TypeScript |
| AI | Azure OpenAI gpt-4o (southeastasia) |
| Data | Azure Cosmos DB Serverless |
| Auth | Microsoft Entra ID + Singpass OIDC |
| Infra | Azure Container Apps + Bicep |
| Messaging | Azure Bot Service + WhatsApp Cloud API + ACS |

## Key Flows

1. **L1 Auto-Resolve**: User messages WhatsApp/Teams → OpenAI triages → Graph API executes → Reply
2. **P1 Escalation**: Critical issue → Teams war-room → ACS phone call to helpdesk
3. **PDPA Compliance**: Auto-redact PII → Consent management → DSR endpoint

## Monorepo Structure

```
/apps/api          # Fastify backend + webhook handlers
/apps/web          # Next.js admin + user portal
/apps/functions    # Durable Functions: AI agent, P1 escalation
/apps/teams-app    # Teams bot + tab
/packages/graph-client    # MS Graph SDK wrapper
/packages/ai-prompts      # Versioned .prompto files + Zod schemas
/packages/ui              # Shared components + Adaptive Cards
/infra             # Bicep infrastructure (AZD)
/tests             # vitest, playwright, k6, pact
/docs              # ADRs, runbooks
```

## Development

```bash
pnpm install
pnpm dev          # Start all apps in watch mode
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm lint         # Lint all packages
pnpm type-check   # TypeScript check all packages
```

## Compliance

- **PDPA**: Consent on first message, auto-redact NRIC/FIN, DSR endpoint
- **CSA Cyber Essentials**: Controls mapped in `/docs/csa-mapping.md`
- **Data Residency**: All data in `southeastasia`. Hard fail if prod region mismatch.

## License

Proprietary — VGC Pte Ltd
