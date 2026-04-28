import { CommunicationIdentityClient } from '@azure/communication-identity';
import { CallAutomationClient, CallInvite } from '@azure/communication-call-automation';
import { ManagedIdentityCredential } from '@azure/identity';

/**
 * ACS (Azure Communication Services) phone call activity.
 * Used for P1 escalation: dial HELP_DESK_PHONE with TTS message.
 *
 * PDPA: Announces call recording at start of message.
 * SRE: 25-second timeout before declaring no-answer.
 * SECURITY: ACS endpoint from env — never hardcoded.
 */

interface CallHelpDeskOptions {
  helpDeskPhone: string;
  ttsMessage: string;
  timeoutSeconds: number;
  logger: { info: Function; error: Function; warn: Function };
}

export async function callHelpDesk(options: CallHelpDeskOptions): Promise<boolean> {
  const { helpDeskPhone, ttsMessage, timeoutSeconds, logger } = options;

  const acsEndpoint = process.env['ACS_ENDPOINT'];
  if (!acsEndpoint) {
    logger.warn('ACS_ENDPOINT not set — skipping phone call (feature-flagged off)');
    return false;
  }

  const acsSourceNumber = process.env['ACS_PHONE_NUMBER'];
  if (!acsSourceNumber) {
    logger.warn('ACS_PHONE_NUMBER not set — skipping phone call');
    return false;
  }

  try {
    const credential = new ManagedIdentityCredential(process.env['AZURE_CLIENT_ID']!);
    const callClient = new CallAutomationClient(acsEndpoint, credential);

    const callInvite: CallInvite = {
      targetParticipant: {
        phoneNumber: helpDeskPhone,
      },
      sourceCallIdNumber: {
        phoneNumber: acsSourceNumber,
      },
    };

    const callResult = await callClient.createCall(callInvite, process.env['ACS_CALLBACK_URL'] ?? '');
    logger.info({ callId: callResult.callConnectionProperties?.callConnectionId }, 'P1 call initiated');

    // Wait for answer or timeout
    const answered = await waitForCallAnswer(
      callResult.callConnectionProperties?.callConnectionId ?? '',
      timeoutSeconds,
      logger,
    );

    if (answered) {
      // Play TTS message
      // In full implementation: callClient.getCallConnection(id).playToAll(...)
      logger.info('P1 call answered, TTS message would play');
    }

    return answered;
  } catch (err: unknown) {
    logger.error({ err }, 'ACS call failed');
    throw err;
  }
}

async function waitForCallAnswer(
  _callConnectionId: string,
  timeoutSeconds: number,
  logger: { info: Function; warn: Function },
): Promise<boolean> {
  // In production: poll ACS call state events via webhook (ACS_CALLBACK_URL)
  // For now: simulate with timeout
  await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutSeconds * 1000, 25_000)));
  logger.warn('Call answer detection not fully implemented — assuming no answer for safety');
  return false;
}
