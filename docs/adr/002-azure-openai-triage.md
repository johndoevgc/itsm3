# ADR-002: Azure OpenAI for L1 Auto-Resolve

**Date**: 2024-01-01  
**Status**: Accepted

## Context

VGC ITSM needs to automatically resolve common M365/Azure issues without engineer involvement. We need an AI model to triage messages and determine the appropriate remediation action.

## Decision

Use **Azure OpenAI gpt-4o** in `southeastasia` region with function calling (tools API).

## Rationale

1. **Data residency**: Azure OpenAI in `southeastasia` keeps all inference in Singapore. PDPA compliant.
2. **Function calling**: Structured output via JSON function calls. Zod validation ensures safe execution.
3. **gpt-4o**: Best reasoning-to-cost ratio for ITSM triage. Sufficient context window (128K tokens).
4. **Managed Identity**: No API keys. Consistent with Zero Trust architecture.

## Implementation

- System prompt: `packages/ai-prompts/src/prompts/system-v1.prompto`
- Function schemas: `packages/ai-prompts/src/schemas/auto-resolve.ts`
- All model outputs validated via Zod before execution (defense-in-depth vs prompt injection)
- PII redacted from user messages before sending to OpenAI (`redactPii()`)

## Consequences

- Feature-flagged via App Config (`enable-openai-triage`). Graceful degradation to ticket-only mode.
- Token costs tracked per tenant. Budget alerts in Azure Cost Management.
- Model version pinned (`gpt-4o:2024-08-06`). No auto-upgrade.
- Prompt changes require new version (e.g., `system-v2.prompto`) + ADR update.
