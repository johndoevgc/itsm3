import { PublicClientApplication, LogLevel } from "@azure/msal-browser";

// ─── MSAL Configuration ──────────────────────────────────────────────────
// Uses Authorization Code Flow with PKCE (no client secret needed in browser)

const redirectUri = window.location.origin;

// Entra ID configuration — set via build-time or runtime injection
const ENTRA_CLIENT_ID = window.__ITSM_CONFIG__?.clientId || "7c2be528-9424-4530-9c50-cc97fc6bc793";
const ENTRA_TENANT_ID = window.__ITSM_CONFIG__?.tenantId || "3994f368-b34e-4722-a56b-92ac87150f00";

// Multi-tenant: use /common/ to allow any M365 tenant, validated server-side via ALLOWED_TENANT_IDS
// Single-tenant: use specific tenant ID for VGC-only deployments
const AUTHORITY_MODE = window.__ITSM_CONFIG__?.authorityMode || "multi"; // "single" | "multi"
const authorityBase = AUTHORITY_MODE === "multi"
  ? "https://login.microsoftonline.com/common"
  : `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`;

const msalConfig = {
  auth: {
    clientId: ENTRA_CLIENT_ID,
    authority: authorityBase,
    redirectUri,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
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
  login: ["openid", "profile", "email", "User.Read", "User.ReadBasic.All"],
  mail: ["Mail.Read"],
  calendar: ["Calendars.Read"],
  chat: ["Chat.Read"],
  teams: ["Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Read.All"],
  presence: ["Presence.Read.All"],
  people: ["People.Read"],
  tasks: ["Tasks.Read"],
};

export const apiScopes = {
  access: [`api://${ENTRA_CLIENT_ID}/access_as_user`],
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
  ...apiScopes.access,
];

export const msalInstance = new PublicClientApplication(msalConfig);

export default msalConfig;
