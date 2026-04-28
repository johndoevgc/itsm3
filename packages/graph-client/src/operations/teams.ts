import { Client } from '@microsoft/microsoft-graph-client';
import { z } from 'zod';
import type { GraphTeamsChannel, GraphTeamsMeeting } from '../types.js';

const CreateChannelSchema = z.object({
  teamId: z.string().min(1),
  displayName: z.string().min(1).max(50),
  description: z.string().max(1024).optional(),
  membershipType: z.enum(['standard', 'private']).default('private'),
});

const CreateMeetingSchema = z.object({
  subject: z.string().min(1).max(255),
  organizerUpn: z.string().email(),
  startDateTime: z.string().datetime(),
  endDateTime: z.string().datetime(),
  attendeeUpns: z.array(z.string().email()).optional(),
});

/**
 * Creates a Microsoft Teams channel in the specified team.
 * Used for P1 war-room creation.
 * SRE: Private channels are used by default for security isolation.
 */
export async function createTeamsChannel(
  client: Client,
  params: z.input<typeof CreateChannelSchema>,
): Promise<GraphTeamsChannel> {
  const { teamId, displayName, description, membershipType } = CreateChannelSchema.parse(params);

  const result = await client.api(`/teams/${encodeURIComponent(teamId)}/channels`).post({
    displayName,
    description: description ?? '',
    membershipType,
  });

  return result as GraphTeamsChannel;
}

/**
 * Creates an online Teams meeting.
 * Used to generate a join URL for the P1 war-room.
 */
export async function createTeamsMeeting(
  client: Client,
  params: z.input<typeof CreateMeetingSchema>,
): Promise<GraphTeamsMeeting> {
  const { subject, organizerUpn, startDateTime, endDateTime, attendeeUpns } =
    CreateMeetingSchema.parse(params);

  const result = await client
    .api(`/users/${encodeURIComponent(organizerUpn)}/onlineMeetings`)
    .post({
      subject,
      startDateTime,
      endDateTime,
      participants: {
        organizer: { upn: organizerUpn },
        attendees: (attendeeUpns ?? []).map((upn) => ({ upn, role: 'attendee' })),
      },
    });

  return result as GraphTeamsMeeting;
}
