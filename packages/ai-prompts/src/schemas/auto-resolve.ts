import { z } from 'zod';

/**
 * Zod schema for the triage result from the AI auto-resolve agent.
 * SECURITY: Never trust the model — always validate via Zod before acting.
 */
export const AutoResolveActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('reset_password'),
    userId: z.string().min(1),
    forceChangeAtNextSignIn: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('unlock_account'),
    userId: z.string().min(1),
  }),
  z.object({
    action: z.literal('assign_license'),
    userId: z.string().min(1),
    skuId: z.string().uuid('License SKU must be a UUID'),
  }),
  z.object({
    action: z.literal('send_email'),
    toAddress: z.string().email(),
    subject: z.string().min(1).max(255),
    body: z.string().min(1),
  }),
  z.object({
    action: z.literal('list_emails'),
    userId: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  z.object({
    action: z.literal('create_teams_channel'),
    teamId: z.string().min(1),
    displayName: z.string().min(1).max(50),
    description: z.string().max(1024).optional(),
  }),
  z.object({
    action: z.literal('create_ticket'),
    title: z.string().min(1).max(255),
    description: z.string().min(1),
    severity: z.enum(['A', 'B', 'C', 'D']),
    reporterUpn: z.string().email(),
  }),
  z.object({
    action: z.literal('escalate_p1'),
    ticketId: z.string().min(1),
    summary: z.string().min(1).max(500),
    tenantId: z.string().min(1),
  }),
  z.object({
    action: z.literal('none'),
    message: z.string().min(1),
  }),
]);

export type AutoResolveAction = z.infer<typeof AutoResolveActionSchema>;

/**
 * OpenAI function definitions for the auto-resolve agent.
 * These are passed as `tools` in the Azure OpenAI chat completion request.
 */
export const OPENAI_FUNCTIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'reset_password',
      description: 'Resets a Microsoft 365 user password',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'UPN or object ID of the user' },
          forceChangeAtNextSignIn: {
            type: 'boolean',
            description: 'Force user to change password on next login',
          },
        },
        required: ['userId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'unlock_account',
      description: 'Unlocks a locked-out Microsoft 365 account',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'UPN or object ID of the user' },
        },
        required: ['userId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_ticket',
      description: 'Creates an ITSM ticket for tracking',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short description of the issue' },
          description: { type: 'string', description: 'Full details of the issue' },
          severity: {
            type: 'string',
            enum: ['A', 'B', 'C', 'D'],
            description: 'A=Critical, B=High, C=Medium, D=Low',
          },
          reporterUpn: { type: 'string', description: 'UPN of the reporter' },
        },
        required: ['title', 'description', 'severity', 'reporterUpn'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'escalate_p1',
      description:
        'Escalates a Severity A ticket: creates Teams war-room and dials helpdesk via ACS',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'The ticket ID to escalate' },
          summary: { type: 'string', description: 'Brief summary for the phone call' },
          tenantId: { type: 'string', description: 'The tenant ID' },
        },
        required: ['ticketId', 'summary', 'tenantId'],
      },
    },
  },
];
