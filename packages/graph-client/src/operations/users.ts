import { Client } from '@microsoft/microsoft-graph-client';
import { z } from 'zod';
import type { GraphUserProfile } from '../types.js';
import { redactPii } from '../redact.js';

const UserIdSchema = z.string().min(1, 'userId must not be empty');

/**
 * Fetches a user's profile from Microsoft Graph.
 * SRE: Returns null if user not found (404) instead of throwing.
 */
export async function getUserProfile(
  client: Client,
  userId: string,
): Promise<GraphUserProfile | null> {
  UserIdSchema.parse(userId);
  try {
    const user = await client
      .api(`/users/${encodeURIComponent(userId)}`)
      .select('id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,mobilePhone,businessPhones')
      .get();
    return user as GraphUserProfile;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) return null;
    throw new GraphOperationError('getUserProfile', userId, err);
  }
}

/**
 * Resets a user's Microsoft 365 password.
 * SECURITY: Only callable with PIM-elevated Graph write scope.
 * PDPA: userId is not logged in plain form.
 */
export async function resetUserPassword(
  client: Client,
  userId: string,
  newPassword: string,
  forceChangeAtNextSignIn = true,
): Promise<void> {
  UserIdSchema.parse(userId);
  z.string().min(8).parse(newPassword);
  try {
    await client.api(`/users/${encodeURIComponent(userId)}`).patch({
      passwordProfile: {
        forceChangePasswordNextSignIn: forceChangeAtNextSignIn,
        password: newPassword,
      },
    });
  } catch (err: unknown) {
    throw new GraphOperationError('resetUserPassword', redactPii(userId), err);
  }
}

class GraphOperationError extends Error {
  constructor(operation: string, subject: string, cause: unknown) {
    super(`Graph operation "${operation}" failed for subject "${subject}": ${String(cause)}`);
    this.name = 'GraphOperationError';
    this.cause = cause;
  }
}
