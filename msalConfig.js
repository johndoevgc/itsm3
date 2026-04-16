import { PublicClientApplication, LogLevel } from "@azure/msal-browser";

// ─── MSAL Configuration ──────────────────────────────────────────────────
// Uses Authorization Code Flow with PKCE (no client secret needed in browser)

// Map of known origins to their registered SPA redirect URIs
const REGISTERED_REDIRECT_URIS = [
  "http://localhost:8080",
  "http://localhost:4173",
  "http://localhost:5173",
  "https://vgc-itsm1-app.azurewebsites.net",
];
// Add production URI dynamically — will be set after Entra ID app registration
if (window.__ITSM_CONFIG__?.redirectUris) {
  REGISTERED_REDIRECT_URIS.push(...window.__ITSM_CONFIG__.redirectUris);
}
const redirectUri = REGISTERED_REDIRECT_URIS.includes(window.location.origin)
  ? window.location.origin
  : window.location.origin; // fallback to current origin

// Entra ID configuration — set via build-time or runtime injection
const ENTRA_CLIENT_ID = window.__ITSM_CONFIG__?.clientId || "7c2be528-9424-4530-9c50-cc97fc6bc793";
const ENTRA_TENANT_ID = window.__ITSM_CONFIG__?.tenantId || "3994f368-b34e-4722-a56b-92ac87150f00";

const msalConfig = {
  auth: {
    clientId: ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
    redirectUri,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: true, // for IE11/Edge compatibility
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
  },
};

// Scopes for Microsoft Graph API
export const graphScopes = {
  login: ["openid", "profile", "email", "User.Read"],
  mail: ["Mail.Read"],
  calendar: ["Calendars.Read"],
  chat: ["Chat.Read"],
  teams: ["Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Read.All"],
  presence: ["Presence.Read.All"],
  people: ["People.Read"],
  tasks: ["Tasks.Read"],
};

// All scopes needed for the app (requested at login)
export const allLoginScopes = [
  "openid", "profile", "email",
  "User.Read", "User.ReadBasic.All",
  "Mail.Read",
  "Calendars.Read",
  "Chat.Read",
  "Presence.Read.All",
  "People.Read",
  "Tasks.Read",
];

export const msalInstance = new PublicClientApplication(msalConfig);

export default msalConfig;
