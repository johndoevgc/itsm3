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
async function validateToken(token, tenantId, clientId) {
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

  // Check issuer
  const validIssuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
  ];
  if (payload.iss && !validIssuers.includes(payload.iss)) {
    return { valid: false, error: "Invalid issuer" };
  }

  // Verify signature using JWKS
  try {
    const keys = await getSigningKeys(tenantId);
    const signingKey = keys.find(k => k.kid === header.kid);
    if (!signingKey) return { valid: false, error: "Signing key not found" };
    const verified = verifyJWTSignature(token, signingKey);
    if (!verified) return { valid: false, error: "Signature verification failed" };
  } catch (err) {
    // If JWKS fetch fails, log but don't block (graceful degradation)
    console.warn("[Auth] JWKS verification skipped:", err.message);
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

// Resolve RBAC role from user email (matches client-side logic)
function resolveRole(email) {
  const lower = (email || "").toLowerCase();
  if (DEV_ADMIN_EMAILS.some(e => lower === e.toLowerCase())) return "VGC Dev Admin";
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
const rateLimitStore = new Map(); // IP -> { count, resetAt }
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 300; // 300 requests per minute per IP
const RATE_LIMIT_MAX_WRITE = 60; // 60 write requests per minute per IP
const RATE_LIMIT_MAX_AI = 30; // 30 AI requests per minute per IP

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
]);
const PUBLIC_PREFIXES = [
  "/api/zendesk/webhook", // Zendesk sends webhooks without our auth
];

function isPublicRoute(pathname) {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p));
}

// ─── Main Auth Middleware ───────────────────────────────────────────────
// Returns: { authenticated, user, role } or writes 401/403 response
async function authMiddleware(req, res, pathname, tenantId, clientId) {
  // Public routes skip auth
  if (isPublicRoute(pathname)) {
    return { authenticated: false, user: null, role: "anonymous", skipped: true };
  }

  // Rate limiting
  const clientIP = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const isWrite = req.method === "POST" || req.method === "PUT" || req.method === "DELETE";
  const isAI = pathname.startsWith("/api/ai/") || pathname.startsWith("/api/ai-");
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
    // No token — allow read-only access for now (graceful migration)
    // In production hardening, change this to return 401
    return { authenticated: false, user: null, role: "Read Only", skipped: false };
  }

  const token = authHeader.slice(7);

  // Local admin token: "Bearer local-hash:<sha256-hash>" — validated against LOCAL_ADMIN_PASSWORD_HASH
  if (token.startsWith("local-hash:")) {
    const providedHash = token.slice(11);
    const localHash = process.env.LOCAL_ADMIN_PASSWORD_HASH;
    if (localHash && providedHash.length === 64) {
      try {
        if (crypto.timingSafeEqual(Buffer.from(providedHash, "hex"), Buffer.from(localHash, "hex"))) {
          return {
            authenticated: true,
            user: { email: process.env.LOCAL_ADMIN_EMAIL || "admin@localhost", name: process.env.LOCAL_ADMIN_NAME || "VGC Dev Admin", id: "LOCAL-vgcdevadmin" },
            role: "VGC Dev Admin",
          };
        }
      } catch {}
    }
    return { authenticated: false, user: null, role: "Read Only", skipped: false };
  }
  if (!tenantId || !clientId) {
    // Entra not configured — decode token but skip full validation
    const decoded = decodeJWT(token);
    if (decoded) {
      const email = decoded.payload.preferred_username || decoded.payload.upn || decoded.payload.email || "";
      const role = resolveRole(email);
      return { authenticated: true, user: { email, name: decoded.payload.name || email, id: decoded.payload.oid }, role };
    }
    return { authenticated: false, user: null, role: "Read Only", skipped: false };
  }

  // Full validation
  const result = await validateToken(token, tenantId, clientId);
  if (!result.valid) {
    // Don't block — log warning and allow with limited role (graceful migration)
    console.warn(`[Auth] Token validation failed: ${result.error}`);
    return { authenticated: false, user: null, role: "Read Only", skipped: false };
  }

  const role = resolveRole(result.user.email);
  return { authenticated: true, user: result.user, role };
}

module.exports = {
  authMiddleware,
  checkPermission,
  resolveRole,
  checkRateLimit,
  isPublicRoute,
  decodeJWT,
  RBAC_PERMISSIONS,
  COLLECTION_TO_MODULE,
};
