import { Client } from '@microsoft/microsoft-graph-client';
import { z } from 'zod';
import type { GraphMailMessage } from '../types.js';
import { redactPii } from '../redact.js';

const SendMailSchema = z.object({
  toAddress: z.string().email('Invalid recipient email'),
  subject: z.string().min(1).max(255),
  body: z.string().min(1),
  isHtml: z.boolean().default(false),
});

/**
 * Sends an email via Microsoft Graph on behalf of the authenticated service account.
 * PDPA: Subject and body are redacted in logs only — full content sent to recipient.
 */
export async function sendMail(
  client: Client,
  params: z.input<typeof SendMailSchema>,
): Promise<void> {
  const { toAddress, subject, body, isHtml } = SendMailSchema.parse(params);

  await client.api('/me/sendMail').post({
    message: {
      subject,
      body: {
        contentType: isHtml ? 'HTML' : 'Text',
        content: body,
      },
      toRecipients: [{ emailAddress: { address: toAddress } }],
    },
    saveToSentItems: true,
  });
}

/**
 * Lists recent emails for a user.
 * Returns at most `limit` messages, sorted by received date descending.
 */
export async function listRecentEmails(
  client: Client,
  userId: string,
  limit = 10,
): Promise<GraphMailMessage[]> {
  z.string().min(1).parse(userId);
  z.number().int().min(1).max(50).parse(limit);

  const result = await client
    .api(`/users/${encodeURIComponent(userId)}/messages`)
    .select('id,subject,bodyPreview,receivedDateTime,from,isRead')
    .orderby('receivedDateTime desc')
    .top(limit)
    .get();

  return (result.value ?? []) as GraphMailMessage[];
}
