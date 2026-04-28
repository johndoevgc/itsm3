/**
 * @module graph-client
 * Single abstraction over Microsoft Graph API.
 * All business logic MUST import from here — never from @microsoft/microsoft-graph-client directly.
 *
 * PDPA: PII is redacted before any logging. NRIC/FIN/phone patterns stripped.
 * SRE: Exponential backoff per MS Graph 429/503 guidance (Retry-After header respected).
 */

export { createGraphClient, type GraphClientConfig } from './client.js';
export { redactPii } from './redact.js';
export type {
  GraphUserProfile,
  GraphMailMessage,
  GraphCalendarEvent,
  GraphTeamsChannel,
  GraphTeamsMeeting,
} from './types.js';
export {
  getUserProfile,
  sendMail,
  createTeamsChannel,
  createTeamsMeeting,
  listRecentEmails,
  resetUserPassword,
} from './operations/index.js';
