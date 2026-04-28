import type { RouteHandlerMethod } from 'fastify';
import { z } from 'zod';
import { EscalateP1ArgsSchema } from '@itsm3/ai-prompts';
import { createGraphClient, createTeamsChannel, createTeamsMeeting } from '@itsm3/graph-client';
import { callHelpDesk } from '../activities/acs-call.js';
import { sendSmsFallback } from '../activities/acs-sms.js';

/**
 * P1 Escalation Orchestrator
 *
 * Sev A Flow:
 * 1. create_teams_warroom → Teams channel + meeting URL
 * 2. escalate_to_phone → ACS dials HELP_DESK_PHONE. TTS: "Priority 1 for {tenant}. Press 1 to accept."
 * 3. If no answer 25s → SMS on-call via ACS + post to Teams channel
 *
 * PDPA: Call is announced as recorded per PDPA requirement.
 * SECURITY: HELP_DESK_PHONE read from env — NEVER hardcoded.
 */

const EscalateRequestSchema = z.object({
  ticketId: z.string().min(1),
  tenantId: z.string().min(1),
  summary: z.string().min(1).max(500),
  reporterUpn: z.string().email().optional(),
});

export const escalateP1Handler: RouteHandlerMethod = async (request, reply) => {
  const parsed = EscalateRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      type: 'https://httpstatuses.com/400',
      title: 'Bad Request',
      status: 400,
      detail: parsed.error.message,
    });
  }

  const { ticketId, tenantId, summary, reporterUpn } = parsed.data;

  // Read helpdesk phone from env — NEVER hardcoded (see problem statement §9.1)
  const helpDeskPhone = process.env['HELP_DESK_PHONE'];
  if (!helpDeskPhone) {
    return reply.status(503).send({
      type: 'https://httpstatuses.com/503',
      title: 'Configuration Error',
      status: 503,
      detail: 'HELP_DESK_PHONE not configured. Run: azd env set HELP_DESK_PHONE=+6569781299',
    });
  }

  // Validate E.164 format
  const phoneResult = EscalateP1ArgsSchema.shape.helpDeskPhone.safeParse(helpDeskPhone);
  if (!phoneResult.success) {
    return reply.status(503).send({
      type: 'https://httpstatuses.com/503',
      title: 'Configuration Error',
      status: 503,
      detail: `HELP_DESK_PHONE must be E.164 format. Got: ${helpDeskPhone}`,
    });
  }

  // ACK immediately — orchestration is async
  reply.status(202).send({
    ticketId,
    status: 'escalating',
    message: 'P1 escalation started. War-room being created.',
  });

  // Run orchestration asynchronously
  runEscalationOrchestration({
    ticketId,
    tenantId,
    summary,
    helpDeskPhone,
    reporterUpn,
    logger: request.log,
  }).catch((err) => {
    request.log.error({ err, ticketId }, 'P1 escalation orchestration failed');
  });
};

interface EscalationContext {
  ticketId: string;
  tenantId: string;
  summary: string;
  helpDeskPhone: string;
  reporterUpn?: string;
  logger: { info: Function; error: Function; warn: Function };
}

async function runEscalationOrchestration(ctx: EscalationContext): Promise<void> {
  const { ticketId, tenantId, summary, helpDeskPhone, logger } = ctx;

  let warroomUrl: string | undefined;

  // Step 1: Create Teams war-room
  try {
    const graphClient = createGraphClient({
      tenantId,
      clientId: process.env['AZURE_CLIENT_ID']!,
    });

    const teamId = process.env['P1_TEAM_ID'];
    if (teamId) {
      const channel = await createTeamsChannel(graphClient, {
        teamId,
        displayName: `P1-${ticketId}`,
        description: `Priority 1 war-room for ticket ${ticketId}: ${summary.slice(0, 100)}`,
        membershipType: 'private',
      });

      const now = new Date();
      const end = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
      const organizerUpn = process.env['TEAMS_ORGANIZER_UPN'] ?? 'itsm-bot@contoso.onmicrosoft.com';

      const meeting = await createTeamsMeeting(graphClient, {
        subject: `P1 War-Room: ${ticketId}`,
        organizerUpn,
        startDateTime: now.toISOString(),
        endDateTime: end.toISOString(),
      });

      warroomUrl = meeting.joinUrl;
      logger.info({ ticketId, channelId: channel.id, meetingUrl: warroomUrl }, 'War-room created');
    }
  } catch (err) {
    // SRE: War-room failure is non-fatal — still attempt phone escalation
    logger.error({ err, ticketId }, 'Failed to create Teams war-room, continuing with phone escalation');
  }

  // Step 2: Call helpdesk via ACS
  try {
    const ttsMessage =
      `This is an automated Priority 1 alert for tenant ${tenantId}. ` +
      `Ticket ${ticketId}: ${summary.slice(0, 200)}. ` +
      // PDPA: Announce call is recorded
      `This call may be recorded. Press 1 to accept the escalation.`;

    const answered = await callHelpDesk({
      helpDeskPhone,
      ttsMessage,
      timeoutSeconds: 25,
      logger,
    });

    if (!answered) {
      // Step 3: Fallback — send SMS
      logger.warn({ ticketId }, 'No answer on P1 call, sending SMS fallback');
      await sendSmsFallback({
        helpDeskPhone,
        message: `VGC ITSM P1 ALERT: ${ticketId}. ${summary.slice(0, 100)}. ${warroomUrl ?? 'No war-room URL'}`,
        logger,
      });
    }
  } catch (err) {
    logger.error({ err, ticketId }, 'P1 phone escalation failed');
    // Attempt SMS as last resort
    try {
      await sendSmsFallback({
        helpDeskPhone,
        message: `VGC ITSM P1 ALERT (voice failed): ${ticketId}. ${summary.slice(0, 100)}`,
        logger,
      });
    } catch (smsErr) {
      logger.error({ smsErr, ticketId }, 'P1 SMS fallback also failed — manual intervention required');
    }
  }
}
