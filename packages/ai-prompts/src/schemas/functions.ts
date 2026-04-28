import { z } from 'zod';

/**
 * Schemas for Azure Durable Function activity inputs.
 * SECURITY: All function arguments are validated here before execution.
 */

export const CreateTicketArgsSchema = z.object({
  tenantId: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  severity: z.enum(['A', 'B', 'C', 'D']),
  reporterUpn: z.string().email(),
  channel: z.enum(['whatsapp', 'teams', 'email', 'web']),
  sourceMessageId: z.string().optional(),
});

export type CreateTicketArgs = z.infer<typeof CreateTicketArgsSchema>;

// E.164 phone number validation
const E164PhoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format: +[country][number]');

export const EscalateP1ArgsSchema = z.object({
  tenantId: z.string().min(1),
  ticketId: z.string().min(1),
  summary: z.string().min(1).max(500),
  helpDeskPhone: E164PhoneSchema,
  warroomUrl: z.string().url().optional(),
});

export type EscalateP1Args = z.infer<typeof EscalateP1ArgsSchema>;

export const CreateWarroomArgsSchema = z.object({
  tenantId: z.string().min(1),
  ticketId: z.string().min(1),
  teamId: z.string().min(1),
  organizerUpn: z.string().email(),
  attendeeUpns: z.array(z.string().email()).optional(),
});

export type CreateWarroomArgs = z.infer<typeof CreateWarroomArgsSchema>;
