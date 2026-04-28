import { SmsClient } from '@azure/communication-sms';
import { ManagedIdentityCredential } from '@azure/identity';

/**
 * ACS SMS fallback activity.
 * Sends an SMS to HELP_DESK_PHONE if voice call is not answered.
 *
 * SRE: Used as P1 escalation fallback (Step 3 of Sev A flow).
 * PDPA: SMS content should not contain NRIC/FIN — pre-redacted by caller.
 */

interface SendSmsOptions {
  helpDeskPhone: string;
  message: string;
  logger: { info: Function; error: Function; warn: Function };
}

export async function sendSmsFallback(options: SendSmsOptions): Promise<void> {
  const { helpDeskPhone, message, logger } = options;

  const acsEndpoint = process.env['ACS_ENDPOINT'];
  if (!acsEndpoint) {
    logger.warn('ACS_ENDPOINT not set — skipping SMS fallback');
    return;
  }

  const acsSmsFrom = process.env['ACS_SMS_FROM'];
  if (!acsSmsFrom) {
    logger.warn('ACS_SMS_FROM not set — skipping SMS fallback');
    return;
  }

  try {
    const credential = new ManagedIdentityCredential(process.env['AZURE_CLIENT_ID']!);
    const smsClient = new SmsClient(acsEndpoint, credential);

    const results = await smsClient.send({
      from: acsSmsFrom,
      to: [helpDeskPhone],
      message: message.slice(0, 160), // SMS character limit
    });

    const result = results[0];
    if (!result?.successful) {
      throw new Error(`SMS failed: ${result?.errorMessage ?? 'Unknown error'}`);
    }

    logger.info({ to: '[REDACTED]', messageId: result.messageId }, 'P1 SMS fallback sent');
  } catch (err: unknown) {
    logger.error({ err }, 'ACS SMS failed');
    throw err;
  }
}
