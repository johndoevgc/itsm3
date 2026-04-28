/**
 * Shared TypeScript types for Microsoft Graph API responses.
 * Keeping them in this package avoids importing @microsoft/microsoft-graph-client types
 * in business logic layers.
 */

export interface GraphUserProfile {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
  officeLocation: string | null;
  mobilePhone: string | null;
  businessPhones: string[];
}

export interface GraphMailMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  receivedDateTime: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  isRead: boolean;
}

export interface GraphCalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location: { displayName: string };
  organizer: { emailAddress: { name: string; address: string } };
  onlineMeetingUrl: string | null;
}

export interface GraphTeamsChannel {
  id: string;
  displayName: string;
  description: string | null;
  webUrl: string;
  membershipType: 'standard' | 'private' | 'shared';
}

export interface GraphTeamsMeeting {
  id: string;
  joinUrl: string;
  joinWebUrl: string;
  subject: string;
  participants: {
    organizer: { upn: string };
  };
}
