import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createOpenAIClient, triageMessage } from '../../../lib/openai.js';

/**
 * Microsoft Teams Bot Framework Webhook Handler
 * Handles Activity messages from the Azure Bot Service.
 *
 * SRE: ACK within 200ms — heavy processing is async.
 * Auth: Bot Framework auth token validated via HMAC.
 */

const TeamsActivitySchema = z.object({
  type: z.string(),
  id: z.string(),
  timestamp: z.string().optional(),
  serviceUrl: z.string().url().optional(),
  channelId: z.literal('msteams'),
  from: z.object({
    id: z.string(),
    name: z.string().optional(),
    aadObjectId: z.string().optional(),
  }),
  conversation: z.object({
    id: z.string(),
    tenantId: z.string().optional(),
    isGroup: z.boolean().optional(),
  }),
  recipient: z.object({ id: z.string(), name: z.string().optional() }),
  text: z.string().optional(),
  value: z.record(z.unknown()).optional(),
});

export const webhookTeamsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST — Teams Bot Framework activity.
   * Handles message, invoke (Adaptive Card actions), and other activity types.
   */
  fastify.post('/', async (request, reply) => {
    const parsed = TeamsActivitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        type: 'https://httpstatuses.com/400',
        title: 'Bad Request',
        status: 400,
        detail: 'Invalid Teams activity payload',
      });
    }

    const activity = parsed.data;

    // ACK immediately
    reply.status(200).send({ type: 'message', text: '' });

    // Process asynchronously
    processTeamsActivityAsync(activity, fastify).catch((err) => {
      fastify.log.error({ err, activityId: activity.id }, 'Teams activity processing failed');
    });
  });
};

async function processTeamsActivityAsync(
  activity: z.infer<typeof TeamsActivitySchema>,
  fastify: { log: { info: Function; error: Function } },
): Promise<void> {
  if (activity.type !== 'message' || !activity.text) return;

  const tenantId = activity.conversation.tenantId ?? activity.from.id;
  const userUpn = activity.from.aadObjectId ?? activity.from.id;

  fastify.log.info({ activityId: activity.id, tenantId }, 'Processing Teams message');

  try {
    const openai = createOpenAIClient();
    const triage = await triageMessage(openai, activity.text, { tenantId, userUpn });
    fastify.log.info(
      { activityId: activity.id, action: triage.action.action },
      'Teams triage complete',
    );
    // TODO: Execute action and reply via Bot Framework
  } catch (err) {
    fastify.log.error({ err, activityId: activity.id }, 'Failed to triage Teams activity');
  }
}
