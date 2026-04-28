/**
 * Graph API operations barrel.
 * All operations return typed results and handle Graph API errors gracefully.
 */
export { getUserProfile, resetUserPassword } from './users.js';
export { sendMail, listRecentEmails } from './mail.js';
export { createTeamsChannel, createTeamsMeeting } from './teams.js';
