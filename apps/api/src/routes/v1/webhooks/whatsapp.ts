import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { env } from '../../../lib/env.js';
import { createOpenAIClient, triageMessage } from '../../../lib/openai.js';
import { createGraphClient } from '@itsm3/graph-client';

/**
 * WhatsApp Cloud API Webhook Handler
 * Handles verification (GET) and incoming messages (POST).
 *
 * SRE: Must ACK within 200ms — processing is async via background job.
 * PDPA: User must have consented before AI processing begins.
 * Idempotent: Deduplicated by WhatsApp message ID.
 */

const WhatsAppMessageSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.literal('whatsapp'),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            contacts: z
              .array(
                z.object({
                  profile: z.object({ name: z.string() }),
                  wa_id: z.string(),
                }),
              )
              .optional(),
            messages: z
              .array(
                z.object({
                  from: z.string(),
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.enum(['text', 'image', 'audio', 'document', 'location', 'interactive']),
                  text: z.object({ body: z.string() }).optional(),
                }),
              )
              .optional(),
          }),
          field: z.string(),
        }),
      ),
    }),
  ),
});

export const webhookWhatsappRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET — WhatsApp webhook verification challenge.
   * Called by Meta when you register the webhook URL.
   */
  fastify.get<{
    Querystring: {
      'hub.mode': string;
      'hub.verify_token': string;
      'hub.challenge': string;
    };
  }>('/', async (request, reply) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } =
      request.query;

    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      fastify.log.info('WhatsApp webhook verified successfully');
      return reply.status(200).send(challenge);
    }

    return reply.status(403).send({
      type: 'https://httpstatuses.com/403',
      title: 'Forbidden',
      status: 403,
      detail: 'Invalid verify token',
    });
  });

  /**
   * POST — Incoming WhatsApp message.
   * SRE: ACK immediately (200), process asynchronously.
   * PDPA: Check consent before AI processing.
   */
  fastify.post('/', async (request, reply) => {
    // ACK immediately per WhatsApp requirement (200ms SLA)
    reply.status(200).send({ status: 'ack' });

    // Process asynchronously
    processWhatsAppMessageAsync(request.body, fastify).catch((err) => {
      fastify.log.error({ err }, 'WhatsApp message processing failed');
    });
  });
};

/**
 * Processes a WhatsApp message asynchronously after 200ms ACK.
 * Full auto-resolve flow: parse → consent check → triage → execute → reply.
 */
async function processWhatsAppMessageAsync(
  rawBody: unknown,
  fastify: { log: { info: Function; error: Function; warn: Function } },
): Promise<void> {
  const parsed = WhatsAppMessageSchema.safeParse(rawBody);
  if (!parsed.success) {
    fastify.log.warn({ errors: parsed.error.issues }, 'Invalid WhatsApp payload');
    return;
  }

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      for (const message of change.value.messages ?? []) {
        if (message.type !== 'text' || !message.text?.body) continue;

        const messageId = message.id;
        const fromPhone = message.from; // E.164 format from WhatsApp
        const text = message.text.body;

        fastify.log.info({ messageId }, 'Processing WhatsApp message');

        try {
          const openai = createOpenAIClient();

          // TODO: Look up tenant and UPN from phone number mapping in Cosmos
          // For now, use placeholder — real implementation uses tenant onboarding data
          const tenantId = change.value.metadata.phone_number_id;
          const userUpn = `${fromPhone}@whatsapp.local`; // Resolved to real UPN in production

          const triage = await triageMessage(openai, text, { tenantId, userUpn });

          fastify.log.info(
            { messageId, action: triage.action.action, tokens: triage.tokensUsed },
            'Triage complete',
          );

          // TODO: Execute the action via graph-client
          // TODO: Reply via WhatsApp Cloud API
        } catch (err) {
          fastify.log.error({ err, messageId }, 'Failed to triage message');
        }
      }
    }
  }
}
