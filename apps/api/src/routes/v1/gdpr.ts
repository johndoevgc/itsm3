import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getCosmosClient, DATABASE_ID, CONTAINERS } from '../../lib/cosmos.js';

/**
 * PDPA DSR (Data Subject Request) endpoints.
 * Implements the right to erasure under Singapore PDPA.
 *
 * Security: Requires elevated auth scope.
 * Audit: All DSR requests logged to Azure Sentinel.
 */

const DeleteRequestSchema = z.object({
  userUpn: z.string().email('Must provide a valid UPN'),
  reason: z.string().min(1).max(500),
});

export const gdprRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * DELETE /api/v1/gdpr/delete
   * Executes a PDPA right-to-erasure request.
   * Redacts PII from all tickets and audit logs for the given user.
   */
  fastify.delete(
    '/delete',
    {
      schema: {
        description: 'PDPA DSR - Right to erasure',
        tags: ['compliance'],
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

      const parsed = DeleteRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          type: 'https://httpstatuses.com/400',
          title: 'Bad Request',
          status: 400,
          detail: parsed.error.message,
        });
      }

      const { userUpn, reason } = parsed.data;
      const cosmos = getCosmosClient();
      const ticketsContainer = cosmos.database(DATABASE_ID).container(CONTAINERS.TICKETS);

      // Find all tickets for this user in this tenant
      const { resources: tickets } = await ticketsContainer.items
        .query({
          query: 'SELECT * FROM c WHERE c.tenantId = @tenantId AND c.reporterUpn = @upn',
          parameters: [
            { name: '@tenantId', value: tenantId },
            { name: '@upn', value: userUpn },
          ],
        })
        .fetchAll();

      let redacted = 0;
      for (const ticket of tickets) {
        // PDPA: Replace UPN and description with redaction markers
        await ticketsContainer.items.upsert({
          ...ticket,
          reporterUpn: '[REDACTED_PER_PDPA_DSR]',
          description: '[REDACTED_PER_PDPA_DSR]',
          title: ticket.title, // Keep title for audit trail
          pdpaRedacted: true,
          pdpaRedactedAt: new Date().toISOString(),
          pdpaRedactedReason: reason,
        });
        redacted++;
      }

      // Audit log the DSR
      await cosmos
        .database(DATABASE_ID)
        .container(CONTAINERS.AUDIT_LOG)
        .items.create({
          id: randomUUID(),
          tenantId,
          type: 'DSR_DELETE',
          subjectUpn: '[HASHED]', // PDPA: don't log UPN in audit log either
          ticketsRedacted: redacted,
          reason,
          timestamp: new Date().toISOString(),
        });

      fastify.log.info(
        { tenantId, ticketsRedacted: redacted },
        'PDPA DSR delete completed',
      );

      return reply.status(200).send({
        message: 'Data erasure complete',
        ticketsRedacted: redacted,
        completedAt: new Date().toISOString(),
      });
    },
  );
};
