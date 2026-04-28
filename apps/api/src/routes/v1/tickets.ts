import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getCosmosClient, DATABASE_ID, CONTAINERS } from '../../lib/cosmos.js';
import { env } from '../../lib/env.js';
import crypto from 'node:crypto';

/**
 * Tickets API — /api/v1/tickets
 * Event-sourcing model: immutable events appended to Cosmos DB.
 *
 * SLI: 99.95% availability on POST /api/v1/tickets. P95 <2s.
 * Partition key: /tenantId (multi-tenant isolation).
 * Idempotency: POST accepts X-Idempotency-Key header.
 */

const CreateTicketBodySchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  severity: z.enum(['A', 'B', 'C', 'D']),
  reporterUpn: z.string().email(),
  channel: z.enum(['whatsapp', 'teams', 'email', 'web']).default('web'),
  sourceMessageId: z.string().optional(),
});

export type CreateTicketBody = z.infer<typeof CreateTicketBodySchema>;

export interface Ticket {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  severity: 'A' | 'B' | 'C' | 'D';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  reporterUpn: string;
  channel: 'whatsapp' | 'teams' | 'email' | 'web';
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
  // Event sourcing: all state changes appended here
  events: TicketEvent[];
}

export interface TicketEvent {
  type: 'created' | 'updated' | 'comment' | 'resolved' | 'escalated';
  timestamp: string;
  actor: string;
  data: Record<string, unknown>;
}

export const ticketsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/v1/tickets
   * Creates a new ITSM ticket.
   * Supports idempotency via X-Idempotency-Key header.
   */
  fastify.post<{ Body: CreateTicketBody }>(
    '/',
    {
      schema: {
        description: 'Create a new ITSM ticket',
        tags: ['tickets'],
        headers: {
          type: 'object',
          properties: {
            'x-tenant-id': { type: 'string', description: 'Tenant ID from JWT' },
            'x-idempotency-key': { type: 'string', description: 'Idempotency key for dedup' },
          },
          required: ['x-tenant-id'],
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string;
      const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;

      // Validate body
      const parseResult = CreateTicketBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          type: 'https://httpstatuses.com/400',
          title: 'Bad Request',
          status: 400,
          detail: parseResult.error.message,
          errors: parseResult.error.issues,
        });
      }

      const body = parseResult.data;
      const cosmos = getCosmosClient();
      const container = cosmos.database(DATABASE_ID).container(CONTAINERS.TICKETS);

      // Idempotency: check if ticket with same key already exists
      if (idempotencyKey) {
        const existing = await container.items
          .query({
            query: 'SELECT * FROM c WHERE c.tenantId = @tenantId AND c.idempotencyKey = @key',
            parameters: [
              { name: '@tenantId', value: tenantId },
              { name: '@key', value: idempotencyKey },
            ],
          })
          .fetchAll();

        if (existing.resources.length > 0) {
          return reply.status(200).send(existing.resources[0]);
        }
      }

      const now = new Date().toISOString();
      const ticket: Ticket & { idempotencyKey?: string } = {
        id: crypto.randomUUID(),
        tenantId,
        title: body.title,
        description: body.description,
        severity: body.severity,
        status: 'open',
        reporterUpn: body.reporterUpn,
        channel: body.channel,
        sourceMessageId: body.sourceMessageId,
        createdAt: now,
        updatedAt: now,
        events: [
          {
            type: 'created',
            timestamp: now,
            actor: body.reporterUpn,
            data: { channel: body.channel, severity: body.severity },
          },
        ],
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };

      const { resource } = await container.items.create(ticket);

      // If Severity A, trigger P1 escalation asynchronously
      if (body.severity === 'A') {
        // Fire-and-forget: POST to functions service for P1 escalation
        // SRE: Non-blocking — ticket is created even if escalation fails
        escalateP1Async(ticket.id, tenantId, body.title, body.reporterUpn).catch((err) => {
          fastify.log.error({ err, ticketId: ticket.id }, 'P1 escalation trigger failed');
        });
      }

      return reply
        .status(201)
        .header('Location', `/api/v1/tickets/${resource!.id}`)
        .send(resource);
    },
  );

  /**
   * GET /api/v1/tickets/:id
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Get a ticket by ID',
        tags: ['tickets'],
        headers: {
          type: 'object',
          properties: {
            'x-tenant-id': { type: 'string' },
          },
          required: ['x-tenant-id'],
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string;
      const { id } = request.params;

      const cosmos = getCosmosClient();
      const container = cosmos.database(DATABASE_ID).container(CONTAINERS.TICKETS);

      try {
        const { resource } = await container.item(id, tenantId).read();
        if (!resource) {
          return reply.status(404).send({
            type: 'https://httpstatuses.com/404',
            title: 'Not Found',
            status: 404,
            detail: `Ticket ${id} not found`,
          });
        }
        return reply.send(resource);
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 404) {
          return reply.status(404).send({
            type: 'https://httpstatuses.com/404',
            title: 'Not Found',
            status: 404,
            detail: `Ticket ${id} not found`,
          });
        }
        throw err;
      }
    },
  );

  /**
   * GET /api/v1/tickets
   * List tickets for a tenant with pagination.
   */
  fastify.get<{
    Querystring: { status?: string; severity?: string; limit?: number; continuationToken?: string };
  }>(
    '/',
    async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string;
      const { status, severity, limit = 20, continuationToken } = request.query;

      const cosmos = getCosmosClient();
      const container = cosmos.database(DATABASE_ID).container(CONTAINERS.TICKETS);

      let query = 'SELECT * FROM c WHERE c.tenantId = @tenantId';
      const parameters: Array<{ name: string; value: unknown }> = [
        { name: '@tenantId', value: tenantId },
      ];

      if (status) {
        query += ' AND c.status = @status';
        parameters.push({ name: '@status', value: status });
      }
      if (severity) {
        query += ' AND c.severity = @severity';
        parameters.push({ name: '@severity', value: severity });
      }

      query += ' ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit';
      parameters.push({ name: '@limit', value: Math.min(Number(limit), 100) });

      const result = await container.items
        .query({ query, parameters }, { continuationToken })
        .fetchAll();

      return reply.send({
        items: result.resources,
        continuationToken: result.continuationToken ?? null,
      });
    },
  );
};

/**
 * Triggers P1 escalation via the Azure Functions service.
 * Non-blocking fire-and-forget.
 */
async function escalateP1Async(
  ticketId: string,
  tenantId: string,
  summary: string,
  reporterUpn: string,
): Promise<void> {
  const functionsUrl = process.env['FUNCTIONS_URL'];
  if (!functionsUrl) {
    // Functions service not configured — skip
    return;
  }

  const response = await fetch(`${functionsUrl}/api/escalate-p1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId, tenantId, summary, reporterUpn }),
  });

  if (!response.ok) {
    throw new Error(`P1 escalation HTTP ${response.status}: ${await response.text()}`);
  }
}
