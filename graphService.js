// ─── Microsoft Graph API Service ──────────────────────────────────────────
// Client-side Graph calls using MSAL access tokens (PKCE flow, no secret)

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function callGraph(accessToken, endpoint, options = {}) {
  const res = await fetch(`${GRAPH_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message || `Graph API error: ${res.status}`);
  }
  return res.json();
}

// ─── User Profile ──────────────────────────────────────────────────────
export async function getMyProfile(accessToken) {
  return callGraph(accessToken, "/me?$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,mobilePhone,businessPhones,companyName");
}

export async function getMyPhoto(accessToken) {
  try {
    const res = await fetch(`${GRAPH_BASE}/me/photo/$value`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// ─── Mail (Outlook) ──────────────────────────────────────────────────────
export async function getRecentEmails(accessToken, top = 10) {
  return callGraph(accessToken, `/me/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,importance,bodyPreview,hasAttachments`);
}

export async function getMailFolders(accessToken) {
  return callGraph(accessToken, "/me/mailFolders?$select=id,displayName,unreadItemCount,totalItemCount");
}

export async function getUnreadCount(accessToken) {
  const data = await callGraph(accessToken, "/me/mailFolders/Inbox?$select=unreadItemCount");
  return data.unreadItemCount || 0;
}

// ─── Calendar ──────────────────────────────────────────────────────────
export async function getTodayEvents(accessToken) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  return callGraph(accessToken, `/me/calendarView?startDateTime=${startOfDay}&endDateTime=${endOfDay}&$orderby=start/dateTime&$select=id,subject,start,end,location,organizer,isOnlineMeeting,onlineMeetingUrl,importance&$top=20`);
}

export async function getUpcomingEvents(accessToken, days = 7) {
  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + days * 86400000).toISOString();
  return callGraph(accessToken, `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$select=id,subject,start,end,organizer,isOnlineMeeting&$top=30`);
}

// ─── Teams Chats ──────────────────────────────────────────────────────
export async function getRecentChats(accessToken, top = 10) {
  return callGraph(accessToken, `/me/chats?$top=${top}&$orderby=lastUpdatedDateTime desc&$expand=lastMessagePreview&$select=id,topic,chatType,lastUpdatedDateTime`);
}

export async function getJoinedTeams(accessToken) {
  return callGraph(accessToken, "/me/joinedTeams?$select=id,displayName,description");
}

export async function getTeamChannels(accessToken, teamId) {
  return callGraph(accessToken, `/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName,description,membershipType`);
}

// ─── Presence ──────────────────────────────────────────────────────────
export async function getMyPresence(accessToken) {
  return callGraph(accessToken, "/me/presence");
}

// ─── People (Frequent Contacts) ──────────────────────────────────────
export async function getFrequentContacts(accessToken, top = 10) {
  return callGraph(accessToken, `/me/people?$top=${top}&$select=displayName,scoredEmailAddresses,department,jobTitle`);
}

// ─── To Do Tasks ─────────────────────────────────────────────────────
export async function getTaskLists(accessToken) {
  return callGraph(accessToken, "/me/todo/lists?$select=id,displayName");
}

export async function getTasks(accessToken, listId) {
  return callGraph(accessToken, `/me/todo/lists/${encodeURIComponent(listId)}/tasks?$select=id,title,status,importance,dueDateTime,completedDateTime&$top=50`);
}

export default {
  getMyProfile,
  getMyPhoto,
  getRecentEmails,
  getMailFolders,
  getUnreadCount,
  getTodayEvents,
  getUpcomingEvents,
  getRecentChats,
  getJoinedTeams,
  getTeamChannels,
  getMyPresence,
  getFrequentContacts,
  getTaskLists,
  getTasks,
};
