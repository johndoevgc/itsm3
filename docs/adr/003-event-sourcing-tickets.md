# ADR-003: Event Sourcing for Ticket State

**Date**: 2024-01-01  
**Status**: Accepted

## Context

ITSM tickets change state frequently (open → in_progress → resolved). We need a reliable audit trail for PDPA compliance and debugging.

## Decision

Use **event sourcing** for ticket state in Cosmos DB. Each ticket document contains an `events[]` array with immutable state change records.

## Rationale

1. **PDPA compliance**: Complete audit trail of all state changes and who made them.
2. **Debuggability**: Can replay events to understand how a ticket reached its current state.
3. **Idempotency**: Events are idempotent — replaying them produces the same state.
4. **Cosmos DB**: Serverless, `southeastasia`, `/tenantId` partition key for multi-tenant isolation.

## Schema

```typescript
interface Ticket {
  id: string;               // UUID
  tenantId: string;         // Partition key
  title: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  events: TicketEvent[];    // Immutable event log
}

interface TicketEvent {
  type: 'created' | 'updated' | 'comment' | 'resolved' | 'escalated';
  timestamp: string;        // ISO 8601
  actor: string;            // UPN of who made the change
  data: Record<string, unknown>;
}
```

## Consequences

- DB changes must be additive only (new event types allowed; existing fields immutable).
- `/api/v1` is immutable once shipped. Breaking changes require `/api/v2`.
- Continuous 30-day backup on Cosmos DB.
