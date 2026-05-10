// ─── Server-Side RBAC Middleware ─────────────────────────────────────────
// Validates Entra ID JWT tokens and enforces role-based access control.
// Called from server.js on every API request.

const https = require("https");
const crypto = require("crypto");

// ─── JWKS Cache (Entra ID signing keys) ─────────────────────────────────
let jwksCache = null;
let jwksCacheTime = 0;
const JWKS_TTL = 24 * 60 * 60 * 1000; // refresh daily

function fetchJWKS(tenantId) {
  return new Promise((resolve, reject) => {
    const url = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
    https.get(url, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error("JWKS parse failed")); }
      });
    }).on("error", reject);
  });
}

async function getSigningKeys(tenantId) {
  if (jwksCache && Date.now() - jwksCacheTime < JWKS_TTL) return jwksCache;
  const jwks = await fetchJWKS(tenantId);
  jwksCache = jwks.keys || [];
  jwksCacheTime = Date.now();
  return jwksCache;
}

// ─── JWT Decode (without verification — for extracting claims) ──────────
function decodeJWT(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return { header, payload, signature: parts[2] };
  } catch { return null; }
}

// ─── JWT Signature Verification ─────────────────────────────────────────
function verifyJWTSignature(token, key) {
  const parts = token.split(".");
  const signedData = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], "base64url");
  // Convert JWK to PEM
  const pubKey = crypto.createPublicKey({ key, format: "jwk" });
  return crypto.verify("SHA256", Buffer.from(signedData), pubKey, signature);
}

// ─── Full JWT Validation ────────────────────────────────────────────────
async function validateToken(token, tenantId, clientId, allowedTenantIds) {
  const decoded = decodeJWT(token);
  if (!decoded) return { valid: false, error: "Malformed token" };

  const { header, payload } = decoded;

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { valid: false, error: "Token expired" };
  if (payload.nbf && payload.nbf > now + 300) return { valid: false, error: "Token not yet valid" };

  // Check audience (must match our client ID or the API URI)
  const validAudiences = [clientId, `api://${clientId}`];
  if (payload.aud && !validAudiences.includes(payload.aud)) {
    // Also accept Graph API tokens that were forwarded
    if (payload.aud !== "00000003-0000-0000-c000-000000000000") {
      return { valid: false, error: "Invalid audience" };
    }
  }

  // Multi-tenant: validate token's tenant ID against allowed list
  const tokenTenantId = payload.tid || tenantId;
  if (allowedTenantIds && allowedTenantIds.length > 0 && !allowedTenantIds.includes(tokenTenantId)) {
    return { valid: false, error: "Tenant not allowed" };
  }

  // Check issuer (use token's actual tenant ID for multi-tenant)
  const validIssuers = [
    `https://login.microsoftonline.com/${tokenTenantId}/v2.0`,
    `https://sts.windows.net/${tokenTenantId}/`,
  ];
  if (payload.iss && !validIssuers.includes(payload.iss)) {
    return { valid: false, error: "Invalid issuer" };
  }

  // Verify signature using JWKS
  try {
    const keys = await getSigningKeys(tokenTenantId);
    const signingKey = keys.find(k => k.kid === header.kid);
    if (!signingKey) return { valid: false, error: "Signing key not found" };
    const verified = verifyJWTSignature(token, signingKey);
    if (!verified) return { valid: false, error: "Signature verification failed" };
  } catch (err) {
    // Fail closed: if JWKS fetch fails, reject the token — never skip verification.
    // Previous "graceful degradation" allowed unsigned tokens when Entra was unreachable.
    console.error("[Auth] JWKS verification FAILED — rejecting token:", err.message);
    return { valid: false, error: "Signature verification unavailable" };
  }

  return {
    valid: true,
    user: {
      id: payload.oid || payload.sub,
      email: payload.preferred_username || payload.upn || payload.email || "",
      name: payload.name || payload.preferred_username || "Unknown",
      roles: payload.roles || [],
      tenantId: payload.tid,
    },
  };
}

// ─── RBAC Permission Matrix ─────────────────────────────────────────────
// Mirrors the client-side RBAC_PERMISSIONS from itsm-tool.jsx
const RBAC_PERMISSIONS = {
  "VGC Dev Admin":       { dashboard: "full", incidents: "full", problems: "full", changes: "full", requests: "full", catalog: "full", knowledge: "full", assets: "full", approvals: "full", sla: "full", ai: "full", admin: "full", customers: "full", reports: "full" },
  "Tenant Admin":        { dashboard: "full", incidents: "full", problems: "full", changes: "full", requests: "full", catalog: "full", knowledge: "full", assets: "full", approvals: "full", sla: "full", ai: "view", admin: "limited", customers: "full", reports: "full" },
  "Administrator":       { dashboard: "full", incidents: "full", problems: "full", changes: "full", requests: "full", catalog: "full", knowledge: "full", assets: "full", approvals: "full", sla: "full", ai: "full", admin: "full", customers: "full", reports: "full" },
  "Service Desk Lead":   { dashboard: "view", incidents: "manage", problems: "manage", changes: "view", requests: "manage", catalog: "view", knowledge: "publish", assets: "view", approvals: "approve", sla: "view", ai: "view", admin: "limited", customers: "manage", reports: "manage" },
  "L1 Support Engineer": { dashboard: "view", incidents: "edit", problems: "view", changes: "view", requests: "fulfill", catalog: "view", knowledge: "contribute", assets: "view", approvals: "none", sla: "view", ai: "use", admin: "none", customers: "edit", reports: "edit" },
  "L2 Support Engineer": { dashboard: "view", incidents: "manage", problems: "edit", changes: "view", requests: "fulfill", catalog: "view", knowledge: "contribute", assets: "view", approvals: "none", sla: "view", ai: "use", admin: "none", customers: "edit", reports: "edit" },
  "Network Engineer":    { dashboard: "view", incidents: "edit", problems: "edit", changes: "submit", requests: "fulfill", catalog: "view", knowledge: "contribute", assets: "edit", approvals: "none", sla: "view", ai: "use", admin: "none", customers: "edit", reports: "edit" },
  "Change Manager":      { dashboard: "view", incidents: "view", problems: "view", changes: "full", requests: "view", catalog: "view", knowledge: "view", assets: "view", approvals: "approve", sla: "view", ai: "view", admin: "none", customers: "view", reports: "view" },
  "Problem Manager":     { dashboard: "view", incidents: "view", problems: "full", changes: "view", requests: "view", catalog: "view", knowledge: "publish", assets: "view", approvals: "none", sla: "view", ai: "view", admin: "none", customers: "view", reports: "view" },
  "Asset Manager":       { dashboard: "view", incidents: "view", problems: "view", changes: "view", requests: "view", catalog: "manage", knowledge: "view", assets: "full", approvals: "none", sla: "view", ai: "view", admin: "none", customers: "view", reports: "view" },
  "End User":            { dashboard: "none", incidents: "create", problems: "none", changes: "none", requests: "create", catalog: "view", knowledge: "view", assets: "none", approvals: "none", sla: "none", ai: "none", admin: "none", customers: "none", reports: "none" },
  "Read Only":           { dashboard: "view", incidents: "view", problems: "view", changes: "view", requests: "view", catalog: "view", knowledge: "view", assets: "view", approvals: "none", sla: "view", ai: "none", admin: "none", customers: "view", reports: "view" },
};

// Map DB collections to RBAC permission modules
const COLLECTION_TO_MODULE = {
  incidents: "incidents", problems: "problems", changes: "changes",
  requests: "requests", assets: "assets", kb: "knowledge",
  services: "catalog", users: "admin", vendors: "admin",
  workflow_rules: "admin", survey_templates: "admin", smart_tasks: "admin",
  integrations: "admin", escalation_log: "admin", escalation_config: "admin",
  customers: "customers", service_reports: "reports",
  zendesk_tickets: "incidents", zendesk_users: "admin", zendesk_orgs: "customers",
  zendesk_sync_state: "admin", zendesk_comments: "incidents",
  ai_actions: "ai", ai_triage_history: "ai", ai_briefings: "ai", ai_patterns: "ai",
  m365_agent_runs: "ai", m365_agent_actions: "ai",
  sla_calendars: "sla", notification_templates: "admin", i18n_packs: "admin",
};

// Map HTTP methods to required permission levels
const METHOD_TO_PERM_LEVEL = {
  GET: new Set(["view", "edit", "manage", "publish", "contribute", "approve", "submit", "fulfill", "use", "create", "full", "limited"]),
  POST: new Set(["edit", "manage", "publish", "contribute", "create", "submit", "fulfill", "full", "limited"]),
  PUT: new Set(["edit", "manage", "publish", "full", "limited"]),
  DELETE: new Set(["manage", "full"]),
};

// Admin emails that get VGC Dev Admin role regardless of token
const DEV_ADMIN_EMAILS = [
  "hlaing@vgctechnology.com",
  "qing@vgctechnology.com",
];
const ADMIN_EMAILS = [
  "hlaing@vgctechnology.com",
  "qing@vgctechnology.com",
  "hamidi@vgctechnology.com",
  "adrian@vgctechnology.com",
];

// ─── DB Role Cache ──────────────────────────────────────────────────────
// Cache DB-stored roles for 30s to avoid a query on every request
const _roleCache = { data: null, expiresAt: 0 };
const ROLE_CACHE_TTL = 30_000; // 30 seconds

async function _getDbRole(email, db) {
  if (!db || !email) return null;
  const now = Date.now();
  try {
    if (!_roleCache.data || now > _roleCache.expiresAt) {
      _roleCache.data = await db.getAll("users");
      _roleCache.expiresAt = now + ROLE_CACHE_TTL;
    }
    const lower = email.toLowerCase();
    const match = (_roleCache.data || []).find(u => {
      const d = typeof u.data === "string" ? JSON.parse(u.data) : (u.data || u);
      return (d.email || "").toLowerCase() === lower;
    });
    if (match) {
      const d = typeof match.data === "string" ? JSON.parse(match.data) : (match.data || match);
      return d.rbacRole || null;
    }
  } catch (e) {
    console.warn("[Auth] DB role lookup failed:", e.message);
  }
  return null;
}

// Resolve RBAC role from user email — checks DB-stored roles when db is provided
async function resolveRole(email, db) {
  const lower = (email || "").toLowerCase();
  // DEV_ADMIN_EMAILS always wins (platform security — can't be downgraded via GUI)
  if (DEV_ADMIN_EMAILS.some(e => lower === e.toLowerCase())) return "VGC Dev Admin";
  // DB-stored role takes precedence over hardcoded ADMIN_EMAILS
  if (db) {
    const dbRole = await _getDbRole(email, db);
    if (dbRole) return dbRole;
  }
  if (ADMIN_EMAILS.some(e => lower === e.toLowerCase())) return "Administrator";
  return "L1 Support Engineer"; // default for authenticated Entra users
}

// ─── Check Permission ───────────────────────────────────────────────────
function checkPermission(role, collection, method) {
  const module = COLLECTION_TO_MODULE[collection];
  if (!module) return true; // unknown collection — allow (whitelist in VALID_COLLECTIONS handles security)

  const perms = RBAC_PERMISSIONS[role];
  if (!perms) return false;

  const userLevel = perms[module];
  if (!userLevel || userLevel === "none") return false;

  const allowedLevels = METHOD_TO_PERM_LEVEL[method];
  if (!allowedLevels) return false;

  return allowedLevels.has(userLevel);
}

// ─── Rate Limiting ──────────────────────────────────────────────────────
// In-memory per-worker counter. The Node cluster runs N workers and HTTP
// connections are distributed round-robin, so a single worker only sees
// ~1/N of the traffic for any given IP. We compensate by dividing the
// documented limit by the worker count, so the aggregate across the cluster
// stays within the intended budget. This is still per-worker (not shared
// state); a hot-spot IP that always hashes to the same worker would hit the
// stricter limit. Move to Azure Cache for Redis for a true distributed
// counter when traffic warrants it.
const rateLimitStore = new Map(); // IP -> { count, resetAt }
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const _workerCount = Math.max(1, parseInt(process.env.WEB_CONCURRENCY || "1", 10) || 1);
const _share = (n) => Math.max(1, Math.ceil(n / _workerCount));
const RATE_LIMIT_MAX = _share(300);       // 300 req/min per IP cluster-wide
const RATE_LIMIT_MAX_WRITE = _share(60);  // 60 writes/min per IP cluster-wide
const RATE_LIMIT_MAX_AI = _share(30);     // 30 AI calls/min per IP cluster-wide

function checkRateLimit(ip, isWrite, isAI) {
  const now = Date.now();
  const key = `${ip}:${isAI ? "ai" : isWrite ? "w" : "r"}`;
  let entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitStore.set(key, entry);
  }
  entry.count++;
  const limit = isAI ? RATE_LIMIT_MAX_AI : isWrite ? RATE_LIMIT_MAX_WRITE : RATE_LIMIT_MAX;
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
}

// Clean up rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Routes that don't require authentication ──────────────────────────
const PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/auth/local",
  "/api/csat/submit",
  "/api/status/public",
  "/api/weather/disaster-alert",
  "/api/teams/messages",  // v3.33.1 Bot Framework webhook (validated via X-Teams-Bot-Secret)
  "/api/teams/health",
  "/api/sms/webhook",     // v3.33.2 ACS Event Grid SMS webhook
  "/api/sms/health",
]);
const PUBLIC_PREFIXES = [
  "/api/zendesk/webhook", // Zendesk sends webhooks without our auth
  "/api/self-service/",   // End-user self-service portal
  "/api/status/subscribe", // Status page subscription
  "/api/ingest/email",    // Inbound email webhook
];

// POST endpoints that do not mutate server state. They still pass through
// normal AI rate limiting, but should not be blocked as write operations when
// MSAL is still bootstrapping or the user is in demo mode.
const READ_ONLY_POST_ROUTES = new Set([
  "/api/ai/resolve-error",
  "/api/chat-assist/message",
  "/api/chat-assist/feedback",
  "/api/chat-assist/session",
  // VGC AI Assist guided-flow endpoints — reachable by anonymous customer widget.
  "/api/chat-assist/intake-action",
  "/api/chat-assist/create-ticket",
  "/api/chat-assist/csat",
  "/api/chat-assist/book-slot",
]);

function isPublicRoute(pathname) {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p));
}

function isReadOnlyPostRoute(pathname, method) {
  return method === "POST" && READ_ONLY_POST_ROUTES.has(pathname);
}

// ─── Main Auth Middleware ───────────────────────────────────────────────
// Returns: { authenticated, user, role } or writes 401/403 response
async function authMiddleware(req, res, pathname, tenantId, clientId, allowedTenantIds, db) {
  // Public routes skip auth
  if (isPublicRoute(pathname)) {
    return { authenticated: false, user: null, role: "anonymous", skipped: true };
  }

  const schedulerToken = process.env.INTERNAL_SCHEDULER_TOKEN;
  const providedSchedulerToken = req.headers["x-internal-scheduler-token"];
  if (schedulerToken && providedSchedulerToken) {
    try {
      const expected = Buffer.from(String(schedulerToken));
      const provided = Buffer.from(String(providedSchedulerToken));
      if (expected.length === provided.length && crypto.timingSafeEqual(expected, provided)) {
        return {
          authenticated: true,
          user: { email: "system@internal", name: "Internal Scheduler", id: "SYSTEM-SCHEDULER" },
          role: "System",
        };
      }
    } catch { /* ignore */ }
  }

  // Rate limiting
  const clientIP = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const isWriteMethod = req.method === "POST" || req.method === "PUT" || req.method === "DELETE";
  const isWrite = isWriteMethod && !isReadOnlyPostRoute(pathname, req.method);
  // AI action management (approve/reject/execute/purge) uses normal write limits, not the strict AI inference limit
  const isAiActionMgmt = pathname.startsWith("/api/ai/actions");
  const isAI = !isAiActionMgmt && (pathname.startsWith("/api/ai/") || pathname.startsWith("/api/ai-"));
  const rateResult = checkRateLimit(clientIP, isWrite, isAI);
  if (!rateResult.allowed) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
      "X-RateLimit-Remaining": "0",
    });
    res.end(JSON.stringify({ error: "Too many requests", retryAfter: Math.ceil((rateResult.resetAt - Date.now()) / 1000) }));
    return { authenticated: false, blocked: true };
  }
  res.setHeader("X-RateLimit-Remaining", String(rateResult.remaining));

  // Extract Bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    // v3.14 H1: deny anonymous writes (POST/PUT/DELETE) to /api/* — frontend
    // attaches MSAL Bearer tokens via patched window.fetch in main.jsx.
    // Reads remain allowed for graceful degradation during MSAL bootstrap.
    if (isWrite) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Authentication required for write operations" }));
      return { authenticated: false, blocked: true };
    }
    return { authenticated: false, user: null, role: "Read Only", skipped: false };
  }

  const token = authHeader.slice(7);

  // (#3 follow-up, 2026-05-03) Local-admin SHA-256 bearer token ("local-hash:")
  // is RETIRED. Production has used Entra SSO exclusively since 2026-05-02 and
  // LOCAL_ADMIN_PASSWORD_HASH is unset on prod. Even if a future env-var mistake
  // re-introduces the secret, this code path no longer trusts it — callers must
  // present a valid Entra Bearer token instead.
  if (token.startsWith("local-hash:")) {
    if (process.env.LOCAL_ADMIN_PASSWORD_HASH) {
      console.warn("[Auth] local-hash bearer token rejected — path retired (LOCAL_ADMIN_PASSWORD_HASH still set on this host; please remove it).");
    }
    return { authenticated: false, user: null, role: "Read Only", skipped: false };
  }
  if (!tenantId || !clientId) {
    // Entra not configured — decode token but skip full validation
    const decoded = decodeJWT(token);
    if (decoded) {
      const email = decoded.payload.preferred_username || decoded.payload.upn || decoded.payload.email || "";
      const role = await resolveRole(email, db);
      return { authenticated: true, user: { email, name: decoded.payload.name || email, id: decoded.payload.oid }, role };
    }
    return { authenticated: false, user: null, role: "Read Only", skipped: false };
  }

  // Full validation
  const result = await validateToken(token, tenantId, clientId, allowedTenantIds);
  if (!result.valid) {
    // v3.37: Fail closed for write operations — invalid tokens must not mutate data.
    // Read-only requests still degrade gracefully during token rotation windows.
    console.warn(`[Auth] Token validation failed: ${result.error}`);
    if (isWrite) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Authentication required", detail: result.error }));
      return { authenticated: false, blocked: true };
    }
    return { authenticated: false, user: null, role: "Read Only", skipped: false };
  }

  const role = await resolveRole(result.user.email, db);
  return { authenticated: true, user: result.user, role };
}

module.exports = {
  authMiddleware,
  checkPermission,
  resolveRole,
  checkRateLimit,
  isPublicRoute,
  isReadOnlyPostRoute,
  decodeJWT,
  validateToken,
  RBAC_PERMISSIONS,
  COLLECTION_TO_MODULE,
};
