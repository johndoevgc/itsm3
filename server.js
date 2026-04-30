const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const zlib = require("zlib");
const { authMiddleware, checkPermission, decodeJWT } = require("./authMiddleware");
const { SlaEngine, computeSlaStatus } = require("./slaEngine");
const { WebSocketServer } = require("./wsServer");
const { NotificationEngine } = require("./notificationEngine");
const { WorkflowEngine } = require("./workflowEngine");
const { AnalyticsEngine } = require("./analyticsEngine");
const { CacheLayer } = require("./cacheLayer");
const incidentIndexFactory = require("./incidentIndex");
const featureFlags = require("./featureFlags");
const shadowMode = require("./shadowMode");
const shadowWorkflow = require("./shadowWorkflow");
const piiRedact = require("./piiRedact");

const PORT = process.env.PORT || 8080;

// ─── Phase 9.1: Structured JSON Logger ──────────────────────────────────
// Outputs JSON lines with timestamp, level, module, and optional correlationId.
// Falls back to console.log in dev for readability.
const LOG_JSON = process.env.LOG_FORMAT === "json";
function structuredLog(level, module, message, extra = {}) {
  if (LOG_JSON) {
    const entry = { ts: new Date().toISOString(), level, module, msg: message, ...extra };
    process.stdout.write(JSON.stringify(entry) + "\n");
  } else {
    const prefix = `[${module}]`;
    const extraStr = Object.keys(extra).length ? " " + JSON.stringify(extra) : "";
    if (level === "error") console.error(`${prefix} ${message}${extraStr}`);
    else if (level === "warn") console.warn(`${prefix} ${message}${extraStr}`);
    else console.log(`${prefix} ${message}${extraStr}`);
  }
}
const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID || "";
const AZURE_RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP || "vgc-itsm-1-RG";
const USE_MSSQL = !!(process.env.AZURE_SQL_SERVER || process.env.MSSQL_HOST);
const USE_MYSQL = !USE_MSSQL && !!(process.env.MYSQL_HOST);

// Extract text from Azure OpenAI response (supports Responses API + Chat Completions API)
function extractAIText(aiResult) {
  // Responses API: top-level "output_text" convenience field (most common)
  if (typeof aiResult?.output_text === "string" && aiResult.output_text) return aiResult.output_text;
  // Responses API: top-level "text" convenience field
  if (typeof aiResult?.text === "string" && aiResult.text) return aiResult.text;
  // Responses API: find message-type output item (skip reasoning items)
  if (Array.isArray(aiResult?.output)) {
    const msgItem = aiResult.output.find(o => o.type === "message");
    const t = msgItem?.content?.[0]?.text;
    if (t) return t;
  }
  // Chat Completions API fallback
  if (aiResult?.choices?.[0]?.message?.content) return aiResult.choices[0].message.content;
  return "";
}

// Microsoft Entra ID config (client secret via env var only — NEVER in frontend)
const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID || "";
const ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID || "";
const ENTRA_CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET || "";
const ENTRA_CERT_THUMBPRINT = process.env.ENTRA_CERT_THUMBPRINT || "";
// Multi-tenant: comma-separated list of allowed tenant IDs. If empty, all tenants allowed.
const ALLOWED_TENANT_IDS = (process.env.ALLOWED_TENANT_IDS || ENTRA_TENANT_ID).split(",").map(s => s.trim()).filter(Boolean);

// Helper: Build client assertion JWT for certificate-based auth
let _cachedPrivateKey = null;
let _cachedX5t = null;
function buildClientAssertion() {
  if (!ENTRA_CERT_THUMBPRINT) return null;
  // Defence in depth: thumbprint is interpolated into a file path / shell
  // argument below. Reject anything that isn't a SHA-1 hex thumbprint so a
  // hostile env var cannot inject shell metacharacters or path traversal.
  if (!/^[0-9a-fA-F]{40}$/.test(ENTRA_CERT_THUMBPRINT)) {
    console.error("[Entra] ENTRA_CERT_THUMBPRINT is not a 40-char hex value, refusing to use it");
    return null;
  }
  try {
    // Cache private key after first extraction (avoid blocking spawn on every call)
    if (!_cachedPrivateKey) {
      const pfxPath = `/var/ssl/private/${ENTRA_CERT_THUMBPRINT}.p12`;
      if (!fs.existsSync(pfxPath)) { console.error("[Entra] PFX not found at", pfxPath); return null; }
      // spawnSync with an argv array bypasses the shell, so no metachar parsing.
      const { spawnSync } = require("child_process");
      const result = spawnSync("openssl", ["pkcs12", "-in", pfxPath, "-nocerts", "-nodes", "-passin", "pass:"], { encoding: "utf8" });
      if (result.status !== 0) {
        console.error("[Entra] openssl pkcs12 exited", result.status, result.stderr);
        return null;
      }
      _cachedPrivateKey = crypto.createPrivateKey(result.stdout);
      _cachedX5t = Buffer.from(ENTRA_CERT_THUMBPRINT, "hex").toString("base64url");
      console.log("[Entra] Private key extracted and cached");
    }
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", x5t: _cachedX5t })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      aud: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/oauth2/v2.0/token`,
      iss: ENTRA_CLIENT_ID, sub: ENTRA_CLIENT_ID,
      jti: crypto.randomUUID(), nbf: now, exp: now + 300,
    })).toString("base64url");
    const sig = crypto.sign("SHA256", Buffer.from(`${header}.${payload}`), _cachedPrivateKey).toString("base64url");
    return `${header}.${payload}.${sig}`;
  } catch (err) { console.error("[Entra] Client assertion build failed:", err.message); return null; }
}

// Azure OpenAI config (server-side only — avoids CORS and protects API key)
// Multi-model tiered architecture — Sweden Central resource, Responses API
let AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || "https://hlain-mod12m44-swedencentral.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview";
let AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY || "";
let AZURE_OPENAI_MODEL = process.env.AZURE_OPENAI_MODEL || "gpt-5.4-pro";
// Tiered AI models: primary (long-form generation), secondary (structured decisions), tertiary (simple/bulk)
const AI_MODELS = {
  primary: process.env.AZURE_OPENAI_MODEL_PRIMARY || "gpt-5.4-pro",
  secondary: process.env.AZURE_OPENAI_MODEL_SECONDARY || "gpt-5.4-mini",
  tertiary: process.env.AZURE_OPENAI_MODEL_TERTIARY || "gpt-5.4-nano",
};
// Fallback cascade: if the requested tier fails, try the next one down
const AI_FALLBACK = { primary: "secondary", secondary: "tertiary", tertiary: null };
function getAIModel(tier) { return AI_MODELS[tier] || AI_MODELS.primary; }

// Centralized AI call helper with automatic model fallback
async function callAI(systemPrompt, userPrompt, { tier = "secondary", maxTokens = 1500, timeout = 30000 } = {}) {
  if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) throw new Error("Azure OpenAI not configured");
  // Budget enforcement: check monthly spend
  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const row = await db.getOne("ai_usage", `usage_${monthKey}`);
    if (row) {
      const usage = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      if (usage.estimatedCostUSD >= AI_MONTHLY_BUDGET_USD) {
        if (tier !== "tertiary") { tier = "tertiary"; console.warn(`[AI Budget] Monthly budget $${AI_MONTHLY_BUDGET_USD} exceeded ($${usage.estimatedCostUSD}), downgrading to nano`); }
      } else if (usage.estimatedCostUSD >= AI_MONTHLY_BUDGET_USD * 0.8 && tier === "primary") {
        tier = "secondary"; console.warn(`[AI Budget] 80% budget used, downgrading primary to secondary`);
      }
    }
  } catch {}
  const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
  let currentTier = tier;
  let lastError = null;
  while (currentTier) {
    const model = getAIModel(currentTier);
    const payload = { model, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: maxTokens };
    try {
      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
        }, (resp) => {
          let data = ""; resp.on("data", c => data += c);
          resp.on("end", () => {
            if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`AI ${resp.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        req.on("error", reject);
        req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`AI timeout (${model})`)); });
        req.write(JSON.stringify(payload));
        req.end();
      });
      const text = extractAIText(result);
      // Track AI usage
      try {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
        const usageId = `usage_${monthKey}`;
        let usage = { month: monthKey, totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, estimatedCostUSD: 0, byModel: {}, byDay: {} };
        try { const row = await db.getOne("ai_usage", usageId); if (row) usage = typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch (e) { structuredLog("warn", "AI", "usage tracking read failed", { usageId, err: e.message }); }
        const inTok = result.usage?.input_tokens || result.usage?.prompt_tokens || 0;
        const outTok = result.usage?.output_tokens || result.usage?.completion_tokens || 0;
        const costPer1k = model.includes("nano") ? 0.0001 : model.includes("mini") ? 0.0004 : 0.003;
        const cost = ((inTok + outTok) / 1000) * costPer1k;
        usage.totalCalls++;
        usage.totalInputTokens += inTok;
        usage.totalOutputTokens += outTok;
        usage.estimatedCostUSD = Math.round((usage.estimatedCostUSD + cost) * 10000) / 10000;
        const dayKey = now.toISOString().slice(0,10);
        usage.byDay[dayKey] = (usage.byDay[dayKey] || 0) + 1;
        usage.byModel[model] = (usage.byModel[model] || 0) + 1;
        await db.upsert("ai_usage", usageId, JSON.stringify(usage));
      } catch (e) { console.warn("[AI Usage] tracking failed:", e.message); }
      return { text, model, tier: currentTier, fallback: currentTier !== tier, inputTokens: result.usage?.input_tokens || 0, outputTokens: result.usage?.output_tokens || 0 };
    } catch (err) {
      lastError = err;
      console.error(`[AI] ${model} failed: ${err.message}, trying fallback...`);
      currentTier = AI_FALLBACK[currentTier];
    }
  }
  throw lastError || new Error("All AI models failed");
}

// Zendesk API config (server-side only — protects API token)
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || "";
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL || "";
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN || "";
const ZENDESK_WEBHOOK_SECRET = process.env.ZENDESK_WEBHOOK_SECRET || "";

// Cisco Meraki Dashboard API (server-side only)
const MERAKI_API_KEYS = (process.env.MERAKI_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);

// SolarWinds RMM / N-able API (server-side only)
let SOLARWINDS_API_KEY = process.env.SOLARWINDS_API_KEY || "";
let SOLARWINDS_API_HOST = process.env.SOLARWINDS_API_HOST || "wwwasia.system-monitor.com";

// Sophos Central Firewall API (server-side only)
const SOPHOS_CLIENT_ID = process.env.SOPHOS_CLIENT_ID || "";
const SOPHOS_CLIENT_SECRET = process.env.SOPHOS_CLIENT_SECRET || "";

// M365 Mail sending via Managed Identity
const MAIL_FROM = process.env.MAIL_FROM || "itsupport@vgctechnology.com";
// Phase B5 — channel-specific senders (default to MAIL_FROM for backward compat).
// Use senderFor(channel) where channel ∈ {"alerts","support","noreply"}.
const MAIL_FROM_ALERTS  = process.env.MAIL_FROM_ALERTS  || MAIL_FROM;
const MAIL_FROM_SUPPORT = process.env.MAIL_FROM_SUPPORT || MAIL_FROM;
const MAIL_FROM_NOREPLY = process.env.MAIL_FROM_NOREPLY || MAIL_FROM;
function senderFor(channel) {
  switch ((channel || "").toLowerCase()) {
    case "alerts":  return MAIL_FROM_ALERTS;
    case "support": return MAIL_FROM_SUPPORT;
    case "noreply": return MAIL_FROM_NOREPLY;
    default:        return MAIL_FROM;
  }
}

// ─── Production Mode ────────────────────────────────────────────────────
// PROD_TEST_MODE=false: AI thresholds at production levels, Zendesk bidirectional sync enabled
const PROD_TEST_MODE = process.env.PROD_TEST_MODE === "true";

// ─── Feature Flags ──────────────────────────────────────────────────────
const FEATURE_PDPA = process.env.FEATURE_PDPA === "true";
const FEATURE_PORTAL = process.env.FEATURE_PORTAL === "true";
const FEATURE_BILLING = process.env.FEATURE_BILLING === "true";
const FEATURE_SETUP_WIZARD = process.env.FEATURE_SETUP_WIZARD !== "false"; // default ON

// ─── AI Cost Control ────────────────────────────────────────────────────
const AI_MONTHLY_BUDGET_USD = parseFloat(process.env.AI_MONTHLY_BUDGET_USD || "10");
const AI_AUTONOMY_LEVEL = process.env.AI_AUTONOMY_LEVEL || "suggest"; // suggest | auto-approve | full-auto

// ─── Email Redirect (safety net) ────────────────────────────────────────
// When true, ALL outbound emails are redirected to EMAIL_REDIRECT_TARGET
// Flip to false when ready to send to real customers
const EMAIL_REDIRECT_MODE = process.env.EMAIL_REDIRECT_MODE !== undefined ? process.env.EMAIL_REDIRECT_MODE === "true" : true;
const EMAIL_REDIRECT_TARGET = process.env.EMAIL_REDIRECT_TARGET || "hlaing@vgctechnology.com";
// Customer-facing emails go here when redirect is active
const CUSTOMER_REDIRECT_TARGET = process.env.CUSTOMER_REDIRECT_TARGET || "johndoe@vgcsg.com";
// Legacy aliases (referenced elsewhere)
const PROD_TEST_EMAIL = EMAIL_REDIRECT_TARGET;
// Inbound helpdesk mailbox — email-to-ticket reads from this mailbox
const HELPDESK_MAILBOX = process.env.HELPDESK_MAILBOX || "helpdesk@vgctechnology.com";
// Phase G — in-memory dedup of outbound ZD sync comments (key: ticketId|commentText, value: ts)
const _zdPushDedup = new Map();
// Phase E1: internal Entra/customer domains — ticket is created but NO confirmation
// email is sent back (they can see it on the dashboard). Override with env var.
const INTERNAL_DOMAINS = (process.env.INTERNAL_DOMAINS || "vgctechnology.com,vgcsg.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

// ─── Local Auth: Dev Admin ──────────────────────────────────────────────
// Password is stored as SHA-256 hash (never plain text)
// Local admin users are configured via environment variables
// Format: LOCAL_ADMIN_PASSWORD_HASH = SHA-256 hash of the password
const LOCAL_USERS = process.env.LOCAL_ADMIN_PASSWORD_HASH ? {
  vgcdevadmin: {
    passwordHash: process.env.LOCAL_ADMIN_PASSWORD_HASH,
    profile: {
      id: "LOCAL-vgcdevadmin",
      name: process.env.LOCAL_ADMIN_NAME || "VGC Dev Admin",
      role: "Administrator",
      avatar: "SA",
      team: "IT",
      gender: "other",
      rbacRole: "Administrator",
      email: process.env.LOCAL_ADMIN_EMAIL || "admin@localhost",
      phone: "",
      location: "",
      department: "IT",
      pcName: "",
      employeeId: "ADMIN001",
      authType: "local",
    },
  },
} : {};
const localAuthEnabled = Object.keys(LOCAL_USERS).length > 0;

const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".webp": "image/webp",
};

// ─── Database Abstraction Layer ─────────────────────────────────────────
let db; // set during init()
let slaEngine = null; // set after DB init
let wsServer = null;
let notifyEngine = null;
let workflowEngine = null;
let analyticsEngine = null;
let cacheLayer = null;

// Phase 9 — incident in-memory index. Created here so it can be referenced
// by request handlers; warmed + db-wrapped after db is ready (server.listen).
let incidentIndex = null;

// ─── Configurable AI Thresholds ─────────────────────────────────────────
const AI_THRESHOLDS = {
  autoApply: parseInt(process.env.AI_AUTO_APPLY_THRESHOLD || (PROD_TEST_MODE ? "70" : "85"), 10),
  slaRisk: parseInt(process.env.AI_SLA_RISK_THRESHOLD || "70", 10),
  patternConfidence: parseInt(process.env.AI_PATTERN_CONFIDENCE_THRESHOLD || "70", 10),
  autoResolveConfidence: parseInt(process.env.AI_AUTO_RESOLVE_THRESHOLD || "85", 10),
  maxPendingPerIncident: parseInt(process.env.AI_MAX_PENDING_PER_INCIDENT || "3", 10),
  maxPendingTotal: parseInt(process.env.AI_MAX_PENDING_TOTAL || "200", 10),
  staleDays: parseInt(process.env.AI_STALE_DAYS || "1", 10),
  monitorIntervalMin: parseInt(process.env.AI_MONITOR_INTERVAL_MIN || "15", 10),
};
console.log("[AI Thresholds]", JSON.stringify(AI_THRESHOLDS));

// ─── Phase A safety helpers (Major Incident Process + recipient hygiene) ─
// Returns true for Sev-A, P1, Critical (any case/dash). Used to block AI auto-resolve.
function isHighSeverity(priority) {
  if (!priority) return false;
  const p = String(priority).toLowerCase().replace(/[\s_-]/g, "");
  return p === "seva" || p === "sev1" || p === "p1" || p === "critical" || p === "sevcritical";
}
// Returns a real recipient or null. Never returns the "customer@example.com" placeholder.
// Callers MUST handle null by skipping the send and logging to audit_log.
function safeRecipient(record) {
  if (!record || typeof record !== "object") return null;
  const candidates = [record.reporterEmail, record.requesterEmail, record.contactEmail, record.email];
  for (const c of candidates) {
    if (typeof c === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) && !/example\.com$/i.test(c)) {
      return c;
    }
  }
  return null;
}

// ─── Phase B helpers: feature-gated customer email + cooling-off queue ───
function _severityKey(priority) {
  if (!priority) return "sevC";
  const p = String(priority).toLowerCase().replace(/[\s_-]/g, "");
  if (p === "seva" || p === "sev1" || p === "p1" || p === "critical") return "sevA";
  if (p === "sevb" || p === "sev2" || p === "p2" || p === "high") return "sevB";
  if (p === "sevd" || p === "sev4" || p === "p4" || p === "low") return "sevD";
  return "sevC";
}
// Decides whether to send a customer email immediately, queue it for cooling-off,
// or skip it entirely based on feature flags. `meta` MUST include {incidentId, severity, source}.
// Returns: { action: "sent"|"queued"|"skipped", reason }
async function queueOrSendCustomerEmail(opts, meta) {
  const incidentId = (meta && meta.incidentId) || "unknown";
  const severity = (meta && meta.severity) || "Sev-C";
  const source = (meta && meta.source) || "system";

  // Phase F — apply the same recipient-noise gate as Phase E (internal-domain
  // skip, per-email opt-out, 24h throttle). Treat array `to` by checking first.
  try {
    const firstTo = Array.isArray(opts && opts.to) ? opts.to[0] : (opts && opts.to);
    const _gate = await shouldSendCustomerConfirmation(firstTo);
    if (!_gate.send) {
      try { await db.audit("incidents", incidentId, "email_skipped_recipient_gate", JSON.stringify({ source, severity, to: firstTo, reason: _gate.reason }), source); } catch (e) { structuredLog("warn", "Audit", "audit write failed", { incidentId, action: "email_skipped_recipient_gate", err: e.message }); }
      console.log(`[CustomerEmail] Recipient-gate skip for ${incidentId} → ${firstTo} (${_gate.reason})`);
      return { action: "skipped", reason: _gate.reason };
    }
    // log only when we DO send so throttle window starts
    if (firstTo) await _logConfirmation(firstTo, incidentId);
  } catch { /* gate is advisory; never block on its errors */ }

  // Phase B1 — auto_customer_email gate
  if (!featureFlags.isEnabled("auto_customer_email")) {
    try { await db.audit("incidents", incidentId, "email_skipped_flag_off", JSON.stringify({ source, severity, flag: "auto_customer_email" }), source); } catch (e) { structuredLog("warn", "Audit", "audit write failed", { incidentId, action: "email_skipped_flag_off", err: e.message }); }
    console.log(`[CustomerEmail] auto_customer_email=off → skipped for ${incidentId} (${source})`);
    return { action: "skipped", reason: "auto_customer_email flag off" };
  }

  // Phase B3 — cooling-off queue
  const cool = featureFlags.isEnabled("ai_cooling_off");
  if (cool) {
    const payload = featureFlags.payload("ai_cooling_off") || { sevA: -1, sevB: 10, sevC: 5, sevD: 2 };
    const key = _severityKey(severity);
    const minutes = typeof payload[key] === "number" ? payload[key] : 5;
    if (minutes < 0) {
      try { await db.audit("incidents", incidentId, "email_blocked_severity", JSON.stringify({ source, severity, key }), source); } catch (e) { structuredLog("warn", "Audit", "audit write failed", { incidentId, action: "email_blocked_severity", err: e.message }); }
      console.warn(`[CustomerEmail] BLOCKED for ${incidentId} (${severity}) — cooling-off policy disallows`);
      return { action: "skipped", reason: `cooling-off blocks ${severity}` };
    }
    if (minutes > 0) {
      const sendAfter = new Date(Date.now() + minutes * 60_000).toISOString();
      const id = `OBX-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const rec = {
        id, incidentId, severity, source,
        opts, // { to, subject, body, isCustomerEmail, from }
        status: "queued",
        queuedAt: new Date().toISOString(),
        sendAfter,
      };
      try {
        await db.upsert("ai_email_outbox", id, JSON.stringify(rec));
        console.log(`[CustomerEmail] Queued ${id} for ${incidentId} (${severity}, +${minutes}m)`);
        return { action: "queued", reason: `cooling-off ${minutes}m` };
      } catch (qErr) {
        console.warn(`[CustomerEmail] Queue failed for ${incidentId}, sending immediately:`, qErr.message);
        // fall through to immediate send
      }
    }
  }

  // Immediate send
  await graphSendMail(opts);
  return { action: "sent", reason: "immediate" };
}

// Outbox drainer (runs every 60s). Sends queued customer emails whose sendAfter <= now.
async function _drainCustomerEmailOutbox() {
  if (!db) return;
  try {
    const rows = await db.getAll("ai_email_outbox");
    const now = Date.now();
    let sent = 0, failed = 0;
    for (const r of rows) {
      let rec; try { rec = typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { continue; }
      if (!rec || rec.status !== "queued") continue;
      if (!rec.sendAfter || new Date(rec.sendAfter).getTime() > now) continue;
      try {
        await graphSendMail(rec.opts);
        rec.status = "sent";
        rec.sentAt = new Date().toISOString();
        await db.upsert("ai_email_outbox", rec.id, JSON.stringify(rec));
        sent++;
      } catch (sendErr) {
        rec.status = "failed";
        rec.failedAt = new Date().toISOString();
        rec.errorMessage = sendErr.message;
        try { await db.upsert("ai_email_outbox", rec.id, JSON.stringify(rec)); } catch (e) { structuredLog("warn", "Outbox", "outbox persist failed", { recId: rec.id, err: e.message }); }
        failed++;
      }
    }
    if (sent || failed) console.log(`[Outbox Drain] sent=${sent} failed=${failed}`);
  } catch (err) {
    console.warn("[Outbox Drain] error:", err.message);
  }
}

// PII redaction wrapper for AI prompts. Returns { prompt, map } so callers can
// reverse-map AI output for the FINAL outbound email (never log raw values).
function redactForAI(prompt) {
  if (!featureFlags.isEnabled("pii_redact")) return { prompt, map: {} };
  const { redacted, map } = piiRedact.redact(prompt);
  if (Object.keys(map).length > 0) {
    console.log("[PII Redact]", JSON.stringify(piiRedact.summary(map)));
  }
  return { prompt: redacted, map };
}

// ─── Phase C helpers: data residency, CSAT loop, RACI, MIM review ────────
const AZURE_REGION = process.env.AZURE_REGION || process.env.WEBSITE_REGION_NAME || "southeastasia";

// C3 — log every AI call with region + timestamp (PDPA / ISO 27018 evidence trail).
// Stores the prompt HASH only (sha256, first 16 chars) to avoid retaining raw PII.
async function logAICall({ purpose, model, incidentId, promptText, redactionCount, tokensIn, tokensOut, status, errorMessage }) {
  if (!db) return;
  try {
    const crypto = require("crypto");
    const promptHash = promptText
      ? crypto.createHash("sha256").update(String(promptText)).digest("hex").substring(0, 16)
      : null;
    const id = `AICALL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await db.upsert("ai_audit_log", id, JSON.stringify({
      id,
      type: "ai_call",
      purpose: purpose || "unknown",
      model: model || null,
      incidentId: incidentId || null,
      region: AZURE_REGION,
      promptHash,
      redactionCount: redactionCount || 0,
      tokensIn: tokensIn || null,
      tokensOut: tokensOut || null,
      status: status || "ok",
      errorMessage: errorMessage || null,
      timestamp: new Date().toISOString(),
    }));
  } catch (e) {
    console.warn("[AI Call Log] failed:", e.message);
  }
}

// C1 — CSAT survey scheduled at +N hours after AI resolution.
// Uses ai_email_outbox so it benefits from the same drainer + cooling-off cancel UX.
async function scheduleCsatSurvey(incident, resolvedBy) {
  if (!db) return null;
  if (!featureFlags.isEnabled("csat_ai_loop")) return null;
  const recipient = safeRecipient(incident);
  if (!recipient) return null;
  const hours = (featureFlags.payload("csat_ai_loop") && featureFlags.payload("csat_ai_loop").delayHours) || 24;
  const sendAfter = new Date(Date.now() + hours * 3600_000).toISOString();
  const id = `CSAT-${incident.id}-${Date.now()}`;
  const surveyUrl = `${process.env.PORTAL_URL || "https://vgc-itsm1-app.azurewebsites.net"}/portal/csat?incident=${encodeURIComponent(incident.id)}&token=${id}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;">
    <div style="background:linear-gradient(135deg,#1E3A5F,#3B82F6);padding:20px 24px;border-radius:8px 8px 0 0;">
      <h2 style="margin:0;color:#fff;font-size:18px;">How did we do?</h2>
    </div>
    <div style="background:#f8f9fa;padding:20px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
      <p style="color:#333;">Hi ${(incident.reporterName || "there").replace(/</g, "&lt;")},</p>
      <p style="color:#333;">Your incident <strong>${String(incident.id).replace(/</g, "&lt;")}</strong> was resolved by ${(resolvedBy || "VGC IT Support").replace(/</g, "&lt;")}.
      Please take 30 seconds to rate your experience.</p>
      <p style="text-align:center;margin:24px 0;">
        ${[1,2,3,4,5].map(n => `<a href="${surveyUrl}&score=${n}" style="display:inline-block;padding:10px 14px;margin:0 4px;background:#3B82F6;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">${n} ⭐</a>`).join("")}
      </p>
      <p style="color:#888;font-size:11px;">VGC Technology Pte Ltd — IT Service Management</p>
    </div>
  </div>`;
  const rec = {
    id, incidentId: incident.id, severity: incident.priority || "Sev-C",
    source: "csat_ai_loop",
    opts: {
      to: [recipient],
      subject: `[VGC ITSM] How did we do? — Incident ${incident.id}`,
      body: html,
      isCustomerEmail: true,
      from: senderFor("noreply"),
    },
    status: "queued",
    queuedAt: new Date().toISOString(),
    sendAfter,
  };
  await db.upsert("ai_email_outbox", id, JSON.stringify(rec));
  console.log(`[CSAT Schedule] ${id} scheduled for ${incident.id} (sendAfter=${sendAfter})`);
  return id;
}

// ─── Phase D4: fire Teams webhook for Sev-A MIM declarations ────────────
// Reads `teams_webhooks` collection; fires fire-and-forget POST to webhooks
// where (channel === "major-incidents") OR (active === true && no channel filter).
// Gated by feature flag `mim_teams_webhook` so initial rollout is opt-in.
async function notifyTeamsMajorIncident(mimRecord, incident) {
  try {
    if (!featureFlags || !featureFlags.isEnabled("mim_teams_webhook")) return;
    const rows = await db.getAll("teams_webhooks");
    const hooks = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    const targets = hooks.filter(h => h && h.url && h.active !== false && (!h.channel || h.channel === "major-incidents" || h.channel === "mim"));
    if (targets.length === 0) return;
    const card = {
      "@type": "MessageCard", "@context": "https://schema.org/extensions",
      themeColor: "C8102E", summary: `Major Incident Declared: ${incident.id}`,
      title: `🚨 Sev-A Major Incident — ${incident.id}`,
      sections: [{
        activityTitle: incident.title || incident.summary || "(no title)",
        activitySubtitle: `Priority ${incident.priority} • Declared ${mimRecord.declaredAt}`,
        facts: [
          { name: "Incident", value: incident.id },
          { name: "Severity", value: incident.priority },
          { name: "Affected", value: (mimRecord.affectedServices || []).join(", ") || "TBD" },
          { name: "MIM Record", value: mimRecord.id },
          { name: "Region", value: AZURE_REGION },
        ],
      }],
    };
    const payload = JSON.stringify(card);
    for (const h of targets) {
      try {
        const u = new URL(h.url);
        const opts = { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } };
        const r = https.request(opts, (resp) => { resp.on("data", () => {}); resp.on("end", () => {}); });
        r.on("error", e => console.warn(`[Teams MIM] webhook ${h.id || h.url} failed:`, e.message));
        r.write(payload); r.end();
      } catch (e) { console.warn("[Teams MIM] bad webhook:", e.message); }
    }
    console.log(`[Teams MIM] dispatched to ${targets.length} webhook(s) for ${incident.id}`);
  } catch (e) { console.warn("[Teams MIM] notify failed:", e.message); }
}

// ─── Phase E: Email-noise controls ──────────────────────────────────────
// E4: per-recipient opt-out cache (refreshed on lookup; misses are not cached).
async function isEmailUnsubscribed(email) {
  if (!email) return false;
  try {
    const row = await db.getOne("email_preferences", String(email).toLowerCase());
    if (!row) return false;
    const pref = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    return pref && pref.autoConfirm === false;
  } catch { return false; }
}

// E5: per-sender 24h throttle for confirmation emails.
// Returns true if a confirmation has already been logged for `email` within the
// configured window (default 24h via `internal_quiet_hours.windowHours`).
async function _wasRecentlyConfirmed(email) {
  if (!email) return false;
  try {
    const flag = featureFlags.payload("internal_quiet_hours") || {};
    const windowH = Number(flag.windowHours) > 0 ? Number(flag.windowHours) : 24;
    const cutoff = Date.now() - windowH * 3600_000;
    const id = `EC-${String(email).toLowerCase()}`;
    const row = await db.getOne("email_confirm_log", id);
    if (!row) return false;
    const rec = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    return rec && rec.lastSentAt && new Date(rec.lastSentAt).getTime() > cutoff;
  } catch { return false; }
}
async function _logConfirmation(email, incidentId) {
  if (!email) return;
  try {
    const id = `EC-${String(email).toLowerCase()}`;
    await db.upsert("email_confirm_log", id, JSON.stringify({
      id, email: String(email).toLowerCase(), lastSentAt: new Date().toISOString(),
      lastIncidentId: incidentId || null,
    }));
  } catch {}
}

// E1+E4+E5 unified gate: returns { send: boolean, reason?: string }.
// Caller skips graphSendMail when send=false and audits the reason.
// NOT tied to `auto_customer_email` so external (paying) customers always receive
// confirmations; only internal/opted-out/throttled recipients are suppressed.
async function shouldSendCustomerConfirmation(email, opts = {}) {
  const e = (email || "").toLowerCase();
  if (!e) return { send: false, reason: "no_recipient" };
  // E1: internal users get the dashboard, not an email
  const dom = e.split("@")[1] || "";
  if (!opts.allowInternal && INTERNAL_DOMAINS.includes(dom)) {
    return { send: false, reason: "internal_domain" };
  }
  // E4: per-recipient opt-out
  if (await isEmailUnsubscribed(e)) {
    return { send: false, reason: "unsubscribed" };
  }
  // E5: 24h throttle when flag enabled
  if (featureFlags && featureFlags.isEnabled("internal_quiet_hours")) {
    if (await _wasRecentlyConfirmed(e)) {
      return { send: false, reason: "throttled_24h" };
    }
  }
  return { send: true };
}

// ─── Scheduled Purge Status Tracker ─────────────────────────────────────
const purgeStatus = {
  queueCleanup: { lastRun: null, lastResult: null, nextRun: null, totalDismissed: 0, runCount: 0 },
  logPurge: { lastRun: null, lastResult: null, nextRun: null, totalDeleted: 0, runCount: 0 },
  terminalPurge: { lastRun: null, lastResult: null, nextRun: null, totalDeleted: 0, runCount: 0 },
  auditPurge: { lastRun: null, lastResult: null, nextRun: null, totalDeleted: 0, runCount: 0 },
};

// ─── Cached DB helpers (uses cacheLayer when available) ─────────────────
async function cachedGetAll(collection) {
  if (cacheLayer) {
    const key = `getAll:${collection}`;
    const cached = cacheLayer.get(key);
    if (cached !== null) return cached;
    const rows = await db.getAll(collection);
    cacheLayer.set(key, rows);
    return rows;
  }
  return db.getAll(collection);
}
async function cachedGetOne(collection, id) {
  if (cacheLayer) {
    const key = `getOne:${collection}:${id}`;
    const cached = cacheLayer.get(key);
    if (cached !== null) return cached;
    const row = await db.getOne(collection, id);
    cacheLayer.set(key, row);
    return row;
  }
  return db.getOne(collection, id);
}

// ─── Shared AI Actions Dedup Helper ─────────────────────────────────────
// Returns { pendingByIncident: Map<incidentId, count>, pendingTotal: number, pendingByTypeInc: Set<"type:incidentId">, pendingByTitle: Set<normalized-title> }
async function getAiActionsDedupState() {
  const rows = await cachedGetAll("ai_actions");
  const pendingByIncident = new Map();
  const pendingByTypeInc = new Set();
  const pendingByTitle = new Set();
  let pendingTotal = 0;
  for (const r of rows) {
    try {
      const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      if (!item || item.status !== "pending_approval") continue;
      pendingTotal++;
      if (item.incidentId) {
        pendingByIncident.set(item.incidentId, (pendingByIncident.get(item.incidentId) || 0) + 1);
        if (item.type) pendingByTypeInc.add(`${item.type}:${item.incidentId}`);
      }
      if (item.title) pendingByTitle.add(item.title.toLowerCase().replace(/[^a-z0-9]/g, ""));
    } catch {}
  }
  return { pendingByIncident, pendingTotal, pendingByTypeInc, pendingByTitle };
}

// Check if we should skip creating a new pending action (returns reason string, or null if OK)
function shouldSkipAction(dedupState, { incidentId, type, title } = {}) {
  if (dedupState.pendingTotal >= AI_THRESHOLDS.maxPendingTotal) return `pending_total_cap (${dedupState.pendingTotal}>=${AI_THRESHOLDS.maxPendingTotal})`;
  if (incidentId && dedupState.pendingByIncident.get(incidentId) >= AI_THRESHOLDS.maxPendingPerIncident) return `per_incident_cap (${incidentId} has ${dedupState.pendingByIncident.get(incidentId)})`;
  if (incidentId && type && dedupState.pendingByTypeInc.has(`${type}:${incidentId}`)) return `dup_type_incident (${type}:${incidentId})`;
  if (title) {
    const norm = title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (dedupState.pendingByTitle.has(norm)) return `dup_title`;
  }
  return null;
}

// After creating an action, update the dedup state in-memory for intra-batch dedup
function trackNewAction(dedupState, { incidentId, type, title } = {}) {
  dedupState.pendingTotal++;
  if (incidentId) {
    dedupState.pendingByIncident.set(incidentId, (dedupState.pendingByIncident.get(incidentId) || 0) + 1);
    if (type) dedupState.pendingByTypeInc.add(`${type}:${incidentId}`);
  }
  if (title) dedupState.pendingByTitle.add(title.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

// ─── Dynamic SLA Map helper (reads from slaEngine policy, falls back to defaults) ──
function getSlaMap() {
  if (slaEngine && slaEngine.currentPolicy) {
    return Object.fromEntries(Object.entries(slaEngine.currentPolicy.severities).map(([k, v]) => [k, v.worstResponse]));
  }
  return { "Sev-A": 4, "Sev-B": 4, "Sev-C": 9, "Sev-D": 27 };
}

function getSlaDescription() {
  const m = getSlaMap();
  return `Sev-A (CRITICAL): ${m["Sev-A"]}h, Sev-B (HIGH): ${m["Sev-B"]}h, Sev-C (MEDIUM): ${m["Sev-C"]}h, Sev-D (LOW): ${m["Sev-D"]}h`;
}

async function initDatabase() {
  if (USE_MSSQL) {
    const sql = require("mssql");
    const mssqlConfig = {
      server: process.env.AZURE_SQL_SERVER || process.env.MSSQL_HOST,
      database: process.env.AZURE_SQL_DATABASE || "itsmdb",
      user: process.env.AZURE_SQL_USER || "vgcadmin",
      password: process.env.AZURE_SQL_PASSWORD || "",
      port: parseInt(process.env.AZURE_SQL_PORT || "1433", 10),
      options: { encrypt: true, trustServerCertificate: false },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    };
    const pool = await sql.connect(mssqlConfig);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'itsm_data')
      CREATE TABLE itsm_data (
        collection NVARCHAR(64) NOT NULL,
        id NVARCHAR(128) NOT NULL,
        data NVARCHAR(MAX) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT PK_itsm_data PRIMARY KEY (collection, id)
      )
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_itsm_collection')
      CREATE NONCLUSTERED INDEX idx_itsm_collection ON itsm_data(collection)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_itsm_updated')
      CREATE NONCLUSTERED INDEX idx_itsm_updated ON itsm_data(updated_at)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'audit_log')
      CREATE TABLE audit_log (
        id INT IDENTITY(1,1) PRIMARY KEY,
        collection NVARCHAR(64) NOT NULL,
        record_id NVARCHAR(128) NOT NULL,
        action NVARCHAR(32) NOT NULL,
        data NVARCHAR(MAX),
        user_name NVARCHAR(128),
        [timestamp] DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_audit_collection')
      CREATE NONCLUSTERED INDEX idx_audit_collection ON audit_log(collection)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_audit_timestamp')
      CREATE NONCLUSTERED INDEX idx_audit_timestamp ON audit_log([timestamp])
    `);
    db = {
      type: "mssql",
      label: `Azure SQL: ${mssqlConfig.server}/${mssqlConfig.database}`,
      upsert: async (coll, id, data) => {
        await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .input("id", sql.NVarChar(128), id)
          .input("data", sql.NVarChar(sql.MAX), data)
          .query(`MERGE itsm_data AS t
            USING (SELECT @coll AS collection, @id AS id, @data AS data) AS s
            ON t.collection = s.collection AND t.id = s.id
            WHEN MATCHED THEN UPDATE SET data = s.data, updated_at = GETUTCDATE()
            WHEN NOT MATCHED THEN INSERT (collection, id, data) VALUES (s.collection, s.id, s.data);`);
      },
      getAll: async (coll) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .query("SELECT id, data FROM itsm_data WHERE collection = @coll ORDER BY updated_at DESC");
        return r.recordset;
      },
      getOne: async (coll, id) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .input("id", sql.NVarChar(128), id)
          .query("SELECT data FROM itsm_data WHERE collection = @coll AND id = @id");
        return r.recordset[0] || null;
      },
      deleteOne: async (coll, id) => {
        await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .input("id", sql.NVarChar(128), id)
          .query("DELETE FROM itsm_data WHERE collection = @coll AND id = @id");
      },
      count: async (coll) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .query("SELECT COUNT(*) AS cnt FROM itsm_data WHERE collection = @coll");
        return r.recordset[0].cnt;
      },
      audit: async (coll, rid, action, data, user) => {
        await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .input("rid", sql.NVarChar(128), rid)
          .input("action", sql.NVarChar(32), action)
          .input("data", sql.NVarChar(sql.MAX), data)
          .input("usr", sql.NVarChar(128), user)
          .query("INSERT INTO audit_log (collection, record_id, action, data, user_name) VALUES (@coll, @rid, @action, @data, @usr)");
      },
      getAudit: async (coll, limit) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .input("lim", sql.Int, Number(limit))
          .query("SELECT TOP (@lim) * FROM audit_log WHERE collection = @coll ORDER BY [timestamp] DESC");
        return r.recordset;
      },
      getAllAudit: async (limit) => {
        const r = await pool.request()
          .input("lim", sql.Int, Number(limit))
          .query("SELECT TOP (@lim) * FROM audit_log ORDER BY [timestamp] DESC");
        return r.recordset;
      },
      bulkUpsert: async (coll, items) => {
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
          for (const item of items) {
            const id = item.id || item.title || String(Math.random());
            await transaction.request()
              .input("coll", sql.NVarChar(64), coll)
              .input("id", sql.NVarChar(128), id)
              .input("data", sql.NVarChar(sql.MAX), JSON.stringify(item))
              .query(`MERGE itsm_data AS t
                USING (SELECT @coll AS collection, @id AS id, @data AS data) AS s
                ON t.collection = s.collection AND t.id = s.id
                WHEN MATCHED THEN UPDATE SET data = s.data, updated_at = GETUTCDATE()
                WHEN NOT MATCHED THEN INSERT (collection, id, data) VALUES (s.collection, s.id, s.data);`);
          }
          await transaction.commit();
        } catch (e) { await transaction.rollback(); throw e; }
      },
      getOpen: async (coll) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .query("SELECT id, data FROM itsm_data WHERE collection = @coll AND JSON_VALUE(data, '$.status') NOT IN ('Closed', 'closed', 'Resolved', 'resolved') ORDER BY updated_at DESC");
        return r.recordset;
      },
      getByField: async (coll, jsonPath, value) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .input("val", sql.NVarChar(512), value)
          .query(`SELECT id, data FROM itsm_data WHERE collection = @coll AND JSON_VALUE(data, '$.${jsonPath.replace(/[^a-zA-Z0-9_.]/g, "")}') = @val ORDER BY updated_at DESC`);
        return r.recordset;
      },
      getPage: async (coll, { limit = 50, offset = 0, orderBy = "updated_at DESC" } = {}) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .input("offset", sql.Int, offset)
          .input("limit", sql.Int, limit)
          .query(`SELECT id, data FROM itsm_data WHERE collection = @coll ORDER BY updated_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`);
        return r.recordset;
      },
      deleteByFilter: async (coll, jsonPath, value) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .input("val", sql.NVarChar(512), value)
          .query(`DELETE FROM itsm_data WHERE collection = @coll AND JSON_VALUE(data, '$.${jsonPath.replace(/[^a-zA-Z0-9_.]/g, "")}') = @val`);
        return r.rowsAffected?.[0] || 0;
      },
      pruneAudit: async (keepDays) => {
        const r = await pool.request()
          .input("cutoff", sql.DateTime2, new Date(Date.now() - keepDays * 86400000))
          .query("DELETE FROM audit_log WHERE [timestamp] < @cutoff");
        return r.rowsAffected?.[0] || 0;
      },
      getMaxUpdatedAt: async (coll) => {
        const r = await pool.request()
          .input("coll", sql.NVarChar(64), coll)
          .query("SELECT MAX(updated_at) AS max_updated FROM itsm_data WHERE collection = @coll");
        return r.recordset[0]?.max_updated || null;
      },
      ping: async () => { await pool.request().query("SELECT 1"); return true; },
      close: () => pool.close(),
    };
  } else if (USE_MYSQL) {
    const mysql = require("mysql2/promise");
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST || "vgc-itsm-mysql.mysql.database.azure.com",
      user: process.env.MYSQL_USER || "vgcadmin",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "flexibleserverdb",
      port: parseInt(process.env.MYSQL_PORT || "3306", 10),
      ssl: { rejectUnauthorized: true },
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS itsm_data (
        collection VARCHAR(64) NOT NULL,
        id VARCHAR(128) NOT NULL,
        data LONGTEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (collection, id),
        INDEX idx_itsm_collection (collection),
        INDEX idx_itsm_updated (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Phase 6 — Generated columns + indexes for common JSON field queries
    const alterStmts = [
      "ALTER TABLE itsm_data ADD COLUMN IF NOT EXISTS gen_status VARCHAR(32) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.status'))) STORED",
      "ALTER TABLE itsm_data ADD COLUMN IF NOT EXISTS gen_priority VARCHAR(16) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.priority'))) STORED",
      "ALTER TABLE itsm_data ADD COLUMN IF NOT EXISTS gen_assignee VARCHAR(128) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee'))) STORED",
    ];
    const idxStmts = [
      "CREATE INDEX IF NOT EXISTS idx_gen_status ON itsm_data (collection, gen_status)",
      "CREATE INDEX IF NOT EXISTS idx_gen_priority ON itsm_data (collection, gen_priority)",
      "CREATE INDEX IF NOT EXISTS idx_gen_assignee ON itsm_data (collection, gen_assignee)",
      "CREATE INDEX IF NOT EXISTS idx_coll_updated ON itsm_data (collection, updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_audit_coll_ts ON audit_log (collection, timestamp DESC)",
    ];
    for (const stmt of [...alterStmts, ...idxStmts]) {
      try { await pool.execute(stmt); } catch (e) {
        if (!e.message.includes("Duplicate") && !e.message.includes("already exists")) {
          console.warn("[DB Phase 6]", e.message.substring(0, 120));
        }
      }
    }
    console.log("[DB Phase 6] Generated columns + indexes applied");

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        collection VARCHAR(64) NOT NULL,
        record_id VARCHAR(128) NOT NULL,
        action VARCHAR(32) NOT NULL,
        data LONGTEXT,
        user_name VARCHAR(128),
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_collection (collection),
        INDEX idx_audit_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    db = {
      type: "mysql",
      label: `MySQL: ${process.env.MYSQL_HOST || "vgc-itsm-mysql.mysql.database.azure.com"}`,
      upsert: async (coll, id, data) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await pool.execute(
              "INSERT INTO itsm_data (collection, id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP",
              [coll, id, data]
            );
            return;
          } catch (e) {
            if (e.message.includes("Deadlock") && attempt < 2) {
              await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
              continue;
            }
            throw e;
          }
        }
      },
      getAll: async (coll) => {
        const [rows] = await pool.execute("SELECT id, data FROM itsm_data WHERE collection = ? ORDER BY updated_at DESC", [coll]);
        return rows;
      },
      getOpen: async (coll) => {
        // Phase 6 — use generated column for indexed status filter
        const [rows] = await pool.execute(
          `SELECT id, data FROM itsm_data WHERE collection = ? AND gen_status NOT IN ('Closed', 'closed', 'Resolved', 'resolved') ORDER BY updated_at DESC`,
          [coll]
        );
        return rows;
      },
      getOne: async (coll, id) => {
        const [rows] = await pool.execute("SELECT data FROM itsm_data WHERE collection = ? AND id = ?", [coll, id]);
        return rows[0] || null;
      },
      deleteOne: async (coll, id) => {
        await pool.execute("DELETE FROM itsm_data WHERE collection = ? AND id = ?", [coll, id]);
      },
      count: async (coll) => {
        const [rows] = await pool.execute("SELECT COUNT(*) as cnt FROM itsm_data WHERE collection = ?", [coll]);
        return rows[0].cnt;
      },
      audit: async (coll, rid, action, data, user) => {
        await pool.execute("INSERT INTO audit_log (collection, record_id, action, data, user_name) VALUES (?, ?, ?, ?, ?)", [coll, rid, action, data, user]);
      },
      getAudit: async (coll, limit) => {
        const [rows] = await pool.query("SELECT * FROM audit_log WHERE collection = ? ORDER BY timestamp DESC LIMIT ?", [coll, Number(limit)]);
        return rows;
      },
      getAllAudit: async (limit) => {
        const [rows] = await pool.query("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?", [Number(limit)]);
        return rows;
      },
      bulkUpsert: async (coll, items) => {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const item of items) {
            const id = item.id || item.title || String(Math.random());
            await conn.execute(
              "INSERT INTO itsm_data (collection, id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP",
              [coll, id, JSON.stringify(item)]
            );
          }
          await conn.commit();
        } catch (e) { await conn.rollback(); throw e; }
        finally { conn.release(); }
      },
      getByField: async (coll, jsonPath, value) => {
        // Phase 6 — use generated columns when available for indexed lookup
        const genColMap = { status: "gen_status", priority: "gen_priority", assignee: "gen_assignee" };
        const genCol = genColMap[jsonPath];
        if (genCol) {
          const [rows] = await pool.execute(
            `SELECT id, data FROM itsm_data WHERE collection = ? AND ${genCol} = ? ORDER BY updated_at DESC`,
            [coll, value]
          );
          return rows;
        }
        const [rows] = await pool.execute(
          `SELECT id, data FROM itsm_data WHERE collection = ? AND JSON_UNQUOTE(JSON_EXTRACT(data, CONCAT('$.', ?))) = ? ORDER BY updated_at DESC`,
          [coll, jsonPath, value]
        );
        return rows;
      },
      getPage: async (coll, { limit = 50, offset = 0 } = {}) => {
        const [rows] = await pool.execute(
          "SELECT id, data FROM itsm_data WHERE collection = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
          [coll, limit, offset]
        );
        return rows;
      },
      deleteByFilter: async (coll, jsonPath, value) => {
        const [result] = await pool.execute(
          `DELETE FROM itsm_data WHERE collection = ? AND JSON_UNQUOTE(JSON_EXTRACT(data, CONCAT('$.', ?))) = ?`,
          [coll, jsonPath, value]
        );
        return result.affectedRows || 0;
      },
      pruneAudit: async (keepDays) => {
        const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 19).replace("T", " ");
        const [result] = await pool.execute("DELETE FROM audit_log WHERE timestamp < ?", [cutoff]);
        return result.affectedRows || 0;
      },
      getMaxUpdatedAt: async (coll) => {
        const [rows] = await pool.execute("SELECT MAX(updated_at) AS max_updated FROM itsm_data WHERE collection = ?", [coll]);
        return rows[0]?.max_updated || null;
      },
      ping: async () => { await pool.execute("SELECT 1"); return true; },
      close: () => pool.end(),
      // Phase 6 — slow query logging wrapper
      _pool: pool,
      poolStats: () => {
        const p = pool.pool;
        return {
          active: p._allConnections?.length || 0,
          idle: p._freeConnections?.length || 0,
          queued: p._connectionQueue?.length || 0,
        };
      },
    };

    // Phase 6 — wrap pool.execute with slow query logging
    const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || "500", 10);
    const origExecute = pool.execute.bind(pool);
    pool.execute = async function(...args) {
      const start = performance.now();
      const result = await origExecute(...args);
      const elapsed = performance.now() - start;
      if (elapsed > SLOW_QUERY_MS) {
        const sql = typeof args[0] === "string" ? args[0].substring(0, 200) : "prepared";
        console.warn(`[SLOW QUERY] ${elapsed.toFixed(0)}ms — ${sql}`);
      }
      return result;
    };
  } else {
    const Database = require("better-sqlite3");
    const DB_PATH = path.join(__dirname, process.env.SQLITE_PATH || "itsm.db");
    const sdb = new Database(DB_PATH);
    sdb.pragma("journal_mode = WAL");
    sdb.pragma("foreign_keys = ON");
    sdb.exec(`
      CREATE TABLE IF NOT EXISTS itsm_data (
        collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_itsm_collection ON itsm_data(collection);
      CREATE INDEX IF NOT EXISTS idx_itsm_updated ON itsm_data(updated_at);
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL,
        record_id TEXT NOT NULL, action TEXT NOT NULL, data TEXT,
        user_name TEXT, timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_collection ON audit_log(collection);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    `);
    const s = {
      upsert: sdb.prepare("INSERT INTO itsm_data (collection, id, data, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"),
      getAll: sdb.prepare("SELECT id, data FROM itsm_data WHERE collection = ? ORDER BY updated_at DESC"),
      getOne: sdb.prepare("SELECT data FROM itsm_data WHERE collection = ? AND id = ?"),
      deleteOne: sdb.prepare("DELETE FROM itsm_data WHERE collection = ? AND id = ?"),
      count: sdb.prepare("SELECT COUNT(*) as cnt FROM itsm_data WHERE collection = ?"),
      audit: sdb.prepare("INSERT INTO audit_log (collection, record_id, action, data, user_name) VALUES (?, ?, ?, ?, ?)"),
      getAudit: sdb.prepare("SELECT * FROM audit_log WHERE collection = ? ORDER BY timestamp DESC LIMIT ?"),
      getAllAudit: sdb.prepare("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?"),
      getOpen: sdb.prepare("SELECT id, data FROM itsm_data WHERE collection = ? AND json_extract(data, '$.status') NOT IN ('Closed', 'closed', 'Resolved', 'resolved') ORDER BY updated_at DESC"),
      getPage: sdb.prepare("SELECT id, data FROM itsm_data WHERE collection = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?"),
      maxUpdatedAt: sdb.prepare("SELECT MAX(updated_at) AS max_updated FROM itsm_data WHERE collection = ?"),
      pruneAudit: sdb.prepare("DELETE FROM audit_log WHERE timestamp < ?"),
    };
    const bulkTx = sdb.transaction((coll, items) => {
      for (const item of items) {
        const id = item.id || item.title || String(Math.random());
        s.upsert.run(coll, id, JSON.stringify(item));
      }
    });
    db = {
      type: "sqlite",
      label: `SQLite: ${DB_PATH}`,
      upsert: async (coll, id, data) => s.upsert.run(coll, id, data),
      getAll: async (coll) => s.getAll.all(coll),
      getOne: async (coll, id) => s.getOne.get(coll, id) || null,
      deleteOne: async (coll, id) => s.deleteOne.run(coll, id),
      count: async (coll) => s.count.get(coll).cnt,
      audit: async (coll, rid, action, data, user) => s.audit.run(coll, rid, action, data, user),
      getAudit: async (coll, limit) => s.getAudit.all(coll, limit),
      getAllAudit: async (limit) => s.getAllAudit.all(limit),
      bulkUpsert: async (coll, items) => bulkTx(coll, items),
      getOpen: async (coll) => s.getOpen.all(coll),
      getByField: async (coll, jsonPath, value) => {
        return sdb.prepare(`SELECT id, data FROM itsm_data WHERE collection = ? AND json_extract(data, '$.' || ?) = ? ORDER BY updated_at DESC`).all(coll, jsonPath, value);
      },
      getPage: async (coll, { limit = 50, offset = 0 } = {}) => s.getPage.all(coll, limit, offset),
      deleteByFilter: async (coll, jsonPath, value) => {
        const info = sdb.prepare(`DELETE FROM itsm_data WHERE collection = ? AND json_extract(data, '$.' || ?) = ?`).run(coll, jsonPath, value);
        return info.changes || 0;
      },
      pruneAudit: async (keepDays) => {
        const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();
        const info = s.pruneAudit.run(cutoff);
        return info.changes || 0;
      },
      getMaxUpdatedAt: async (coll) => {
        const row = s.maxUpdatedAt.get(coll);
        return row?.max_updated || null;
      },
      ping: async () => { sdb.prepare("SELECT 1").get(); return true; },
      close: () => sdb.close(),
    };
  }
}

// ─── Helper: read JSON body from request ────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 10 * 1024 * 1024; // 10MB limit
    const timeout = setTimeout(() => { reject(new Error("Body read timeout")); req.destroy(); }, 30000);
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX) { clearTimeout(timeout); reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  const req = res.req;
  const accept = (req && req.headers && req.headers["accept-encoding"] || "").toLowerCase();

  let etag = null;
  if (status === 200 && req && req.method === "GET" && body.length > 256) {
    const hash = crypto.createHash("sha1").update(body).digest("base64").replace(/=+$/, "");
    etag = `W/"${hash}"`;
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.writeHead(304, { "ETag": etag, "Cache-Control": "private, must-revalidate" });
      return res.end();
    }
  }

  if (body.length > 1024 && accept) {
    const headers = { "Content-Type": "application/json", "Vary": "Accept-Encoding" };
    if (etag) { headers["ETag"] = etag; headers["Cache-Control"] = "private, must-revalidate"; }
    if (accept.includes("br")) {
      return new Promise((resolve) => {
        zlib.brotliCompress(Buffer.from(body), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, (err, buf) => {
          if (err) {
            const fh = { "Content-Type": "application/json" };
            if (etag) { fh["ETag"] = etag; fh["Cache-Control"] = "private, must-revalidate"; }
            res.writeHead(status, fh);
            resolve(res.end(body));
          } else {
            res.writeHead(status, { ...headers, "Content-Encoding": "br" });
            resolve(res.end(buf));
          }
        });
      });
    }
    if (accept.includes("gzip")) {
      return new Promise((resolve) => {
        zlib.gzip(Buffer.from(body), { level: 6 }, (err, buf) => {
          if (err) {
            const fh = { "Content-Type": "application/json" };
            if (etag) { fh["ETag"] = etag; fh["Cache-Control"] = "private, must-revalidate"; }
            res.writeHead(status, fh);
            resolve(res.end(body));
          } else {
            res.writeHead(status, { ...headers, "Content-Encoding": "gzip" });
            resolve(res.end(buf));
          }
        });
      });
    }
  }
  const finalHeaders = { "Content-Type": "application/json" };
  if (etag) { finalHeaders["ETag"] = etag; finalHeaders["Cache-Control"] = "private, must-revalidate"; }
  res.writeHead(status, finalHeaders);
  res.end(body);
}

// Phase T5 — compressed text response helper. Used by CSV/HTML/text exports.
function sendText(res, status, contentType, body, extraHeaders) {
  const req = res.req;
  const accept = (req && req.headers && req.headers["accept-encoding"] || "").toLowerCase();
  const baseHeaders = { "Content-Type": contentType, ...(extraHeaders || {}) };
  if (typeof body === "string" && body.length > 1024 && accept) {
    try {
      if (accept.includes("br")) {
        const buf = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
        res.writeHead(status, { ...baseHeaders, "Content-Encoding": "br", "Vary": "Accept-Encoding" });
        return res.end(buf);
      }
      if (accept.includes("gzip")) {
        const buf = zlib.gzipSync(body, { level: 6 });
        res.writeHead(status, { ...baseHeaders, "Content-Encoding": "gzip", "Vary": "Accept-Encoding" });
        return res.end(buf);
      }
    } catch { /* fall through */ }
  }
  res.writeHead(status, baseHeaders);
  res.end(body);
}

function parseBody(req, maxSize = 50000) {
  return new Promise((resolve, reject) => {
    let d = "";
    const timeout = setTimeout(() => reject(new Error("Body read timeout")), 15000);
    req.on("data", c => { d += c; if (d.length > maxSize) { clearTimeout(timeout); reject(new Error("Payload too large")); } });
    req.on("end", () => { clearTimeout(timeout); try { resolve(JSON.parse(d)); } catch(e) { reject(new Error("Invalid JSON body")); } });
    req.on("error", (err) => { clearTimeout(timeout); reject(new Error("Body read error: " + err.message)); });
  });
}

// ─── Enterprise Email Template Builder ───────────────────────────────────
// Centralized HTML email builder for all notification types. Outlook-compatible
// table-based layout with structured sections: header, action banner, details,
// resolution, impact, next actions, references, AI guidance, footer.
const PORTAL_URL = process.env.PORTAL_URL || "https://vgc-itsm1-app.azurewebsites.net";
const ORG_NAME = process.env.ORG_NAME || "VGC Technology Pte Ltd";
const ORG_SHORT_NAME = process.env.ORG_SHORT_NAME || "VGC Technology";
const ORG_PHONE = process.env.ORG_PHONE || "+65 6000 0000";
const APP_DISPLAY_NAME = process.env.APP_DISPLAY_NAME || "VGC ITSM";
const EMAIL_PRESETS = {
  incident_resolved:       { color: "#4CAF50", gradient: "linear-gradient(135deg,#4CAF50,#06B6D4)", icon: "&#9989;", label: "Incident Resolved",           actionRequired: false },
  incident_assigned:       { color: "#F59E0B", gradient: "linear-gradient(135deg,#F59E0B,#EF4444)", icon: "&#128276;", label: "Incident Assigned to You",    actionRequired: true },
  incident_closed:         { color: "#6B7280", gradient: "linear-gradient(135deg,#6B7280,#374151)", icon: "&#128193;", label: "Incident Closed",             actionRequired: false },
  ai_review:               { color: "#7C3AED", gradient: "linear-gradient(135deg,#7C3AED,#6366F1)", icon: "&#129302;", label: "AI Auto-Resolve — Review Required", actionRequired: true },
  ai_approved_customer:    { color: "#0078D4", gradient: "linear-gradient(135deg,#0078D4,#00BCF2)", icon: "&#9989;", label: "Incident Resolved",             actionRequired: false },
  ai_approved_internal:    { color: "#0078D4", gradient: "linear-gradient(135deg,#0078D4,#6366F1)", icon: "&#9989;", label: "Resolution Approved",           actionRequired: false },
  ai_followup:             { color: "#6366F1", gradient: "linear-gradient(135deg,#6366F1,#8B5CF6)", icon: "&#128233;", label: "Follow-Up Update",            actionRequired: false },
  ai_followup_resolved:    { color: "#4CAF50", gradient: "linear-gradient(135deg,#4CAF50,#06B6D4)", icon: "&#9989;", label: "Incident Resolved",             actionRequired: false },
  escalation:              { color: "#EF4444", gradient: "linear-gradient(135deg,#EF4444,#F59E0B)", icon: "&#9889;", label: "Incident Escalated",            actionRequired: true },
  sla_warning:             { color: "#F59E0B", gradient: "linear-gradient(135deg,#F59E0B,#EAB308)", icon: "&#9202;", label: "SLA Breach Warning",            actionRequired: true },
  general_info:            { color: "#4CAF50", gradient: "linear-gradient(135deg,#4CAF50,#06B6D4)", icon: "&#8505;", label: "Notification",                  actionRequired: false },
  general_warning:         { color: "#FFB347", gradient: "linear-gradient(135deg,#FFB347,#F59E0B)", icon: "&#9888;", label: "Warning",                       actionRequired: false },
  general_critical:        { color: "#FF4444", gradient: "linear-gradient(135deg,#FF4444,#EF4444)", icon: "&#128680;", label: "Critical Alert",              actionRequired: true },
};

function esc(s) { return String(s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function formatResolutionText(raw) {
  if (!raw) return "";
  let text = String(raw);
  // Convert markdown bold **text** to <strong>
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Detect numbered items: (1), 1., 1) — split into ordered list
  const numberedPattern = /(?:^|\n)\s*(?:\(?\d+\)?[\.\):])\s+/;
  if (numberedPattern.test(text)) {
    const items = text.split(/(?:^|\n)\s*(?:\(?\d+\)?[\.\):])\s+/).filter(Boolean);
    if (items.length > 1) {
      return `<ol style="margin:8px 0;padding-left:20px;color:#1F2937;font-size:13px;line-height:1.7;">${items.map(i => `<li style="margin-bottom:6px;">${i.trim().replace(/\n/g, " ")}</li>`).join("")}</ol>`;
    }
  }
  // Detect bullet points: •, -, *
  const bulletPattern = /(?:^|\n)\s*[•\-\*]\s+/;
  if (bulletPattern.test(text)) {
    const items = text.split(/(?:^|\n)\s*[•\-\*]\s+/).filter(Boolean);
    if (items.length > 1) {
      return `<ul style="margin:8px 0;padding-left:20px;color:#1F2937;font-size:13px;line-height:1.7;">${items.map(i => `<li style="margin-bottom:6px;">${i.trim().replace(/\n/g, " ")}</li>`).join("")}</ul>`;
    }
  }
  // Paragraphs: double newline
  const paras = text.split(/\n{2,}/).filter(Boolean);
  if (paras.length > 1) {
    return paras.map(p => `<p style="margin:0 0 10px;color:#1F2937;font-size:13px;line-height:1.7;">${p.trim().replace(/\n/g, "<br/>")}</p>`).join("");
  }
  // Single paragraph
  return `<p style="margin:0;color:#1F2937;font-size:13px;line-height:1.7;">${text.replace(/\n/g, "<br/>")}</p>`;
}

function buildEmailTemplate(opts = {}) {
  const {
    type = "general_info",
    title = "",
    incidentId = "",
    priority = "",
    category = "",
    status = "",
    assignee = "",
    confidence,
    approvedBy = "",
    resolvedBy = "",
    resolution = "",
    rootCause = "",
    customerName = "",
    customerMessage = "",
    description = "",
    impactAssessment = null,
    nextActions = [],
    references = [],
    aiGuidance = "",
    additionalFields = {},
    footerNote = "",
    timestamp = new Date().toISOString(),
  } = opts;

  const preset = EMAIL_PRESETS[type] || EMAIL_PRESETS.general_info;
  const actionRequired = opts.actionRequired !== undefined ? opts.actionRequired : preset.actionRequired;
  const dateStr = new Date(timestamp).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

  // ── Build incident details rows ──
  const detailRows = [];
  if (incidentId) detailRows.push(["Incident ID", esc(incidentId)]);
  if (title) detailRows.push(["Title", esc(title)]);
  if (priority) detailRows.push(["Priority", esc(priority)]);
  if (category) detailRows.push(["Category", esc(category)]);
  if (status) detailRows.push(["Status", esc(status)]);
  if (assignee) detailRows.push(["Assigned To", esc(assignee)]);
  if (confidence !== undefined && confidence !== null) detailRows.push(["AI Confidence", `${confidence}%`]);
  if (approvedBy) detailRows.push(["Approved By", esc(approvedBy)]);
  if (resolvedBy) detailRows.push(["Resolved By", esc(resolvedBy)]);
  Object.entries(additionalFields).forEach(([k, v]) => { if (v) detailRows.push([esc(k), esc(v)]); });
  const detailsHtml = detailRows.map((r, i) =>
    `<tr style="background:${i % 2 === 0 ? "#f8fafc" : "#ffffff"};"><td style="padding:10px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;font-weight:600;color:#4a5568;width:140px;border-bottom:1px solid #e8ebef;">${r[0]}</td><td style="padding:10px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1a202c;border-bottom:1px solid #e8ebef;">${r[1]}</td></tr>`
  ).join("");

  // ── Action banner ──
  const bannerHtml = actionRequired
    ? `<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="background:#FFF3CD;border:1px solid #FFD700;border-radius:6px;padding:14px 18px;margin:0;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:700;color:#856404;">&#9888; Action Required</td>
          <td align="right" style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#856404;">Please review and take action</td>
        </tr></table>
      </td></tr></table>`
    : `<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="background:#D4EDDA;border:1px solid #28A745;border-radius:6px;padding:14px 18px;margin:0;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:700;color:#155724;">&#8505; For Your Information</td>
          <td align="right" style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#155724;">No action required at this time</td>
        </tr></table>
      </td></tr></table>`;

  // ── Resolution section ──
  const resolutionHtml = resolution ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;">
    <tr><td style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c;padding:0 0 8px;">&#128221; Resolution Summary</td></tr>
    <tr><td style="background:#f8fafc;border:1px solid #e8ebef;border-radius:6px;padding:14px 16px;">${formatResolutionText(resolution)}</td></tr>
  </table>` : "";

  // ── Root cause ──
  const rootCauseHtml = rootCause ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:14px;">
    <tr><td style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c;padding:0 0 8px;">&#128269; Root Cause Analysis</td></tr>
    <tr><td style="background:#FFF8F0;border:1px solid #FED7AA;border-radius:6px;padding:14px 16px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1F2937;line-height:1.6;">${esc(rootCause)}</td></tr>
  </table>` : "";

  // ── Organization & Customer Impact ──
  let impactHtml = "";
  if (impactAssessment) {
    const ia = impactAssessment;
    impactHtml = `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;">
      <tr><td style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c;padding:0 0 8px;">&#127919; Impact Assessment</td></tr>
      <tr><td style="border:1px solid #e8ebef;border-radius:6px;overflow:hidden;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr style="background:#f0f7ff;"><td style="padding:10px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;font-weight:600;color:#1E40AF;width:160px;border-bottom:1px solid #e8ebef;">Organization Impact</td>
            <td style="padding:10px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1a202c;border-bottom:1px solid #e8ebef;">${ia.orgImpacted ? "&#9888; Yes — " + esc(ia.orgDetails || "Review recommended") : "&#9989; No direct impact identified"}</td></tr>
          <tr><td style="padding:10px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;font-weight:600;color:#1E40AF;width:160px;">Customer Impact</td>
            <td style="padding:10px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1a202c;">${ia.customerImpacted ? "&#9888; Yes — " + esc(ia.customerDetails || "Customer may be affected") : "&#9989; No customer impact"}</td></tr>
        </table>
      </td></tr>
    </table>`;
  }

  // ── Next Actions ──
  let actionsHtml = "";
  if (nextActions.length > 0) {
    const actionItems = nextActions.map((a, i) => {
      const linkBtn = a.url ? ` <a href="${a.url.replace(/"/g, "&quot;")}" style="display:inline-block;margin-left:8px;padding:4px 12px;background:#0078D4;color:#ffffff;font-size:11px;font-weight:600;border-radius:4px;text-decoration:none;font-family:'Segoe UI',Arial,sans-serif;">${esc(a.linkLabel || "Open")}</a>` : "";
      return `<tr><td style="padding:8px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1F2937;border-bottom:1px solid #f0f0f0;line-height:1.6;"><strong style="color:#0078D4;">${i + 1}.</strong> ${esc(a.label || a.step || a)}${linkBtn}</td></tr>`;
    }).join("");
    actionsHtml = `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;">
      <tr><td style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c;padding:0 0 8px;">&#128203; Recommended Next Actions</td></tr>
      <tr><td style="border:1px solid #e8ebef;border-radius:6px;overflow:hidden;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">${actionItems}</table>
      </td></tr>
    </table>`;
  }

  // ── Official References ──
  let refsHtml = "";
  if (references.length > 0) {
    const refItems = references.filter(r => r.url && r.title).map(r =>
      `<tr><td style="padding:6px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;border-bottom:1px solid #f0f0f0;">&#128206; <a href="${r.url.replace(/"/g, "&quot;")}" style="color:#0369A1;text-decoration:none;font-weight:500;">${esc(r.title)}</a>${r.source ? ` <span style="color:#9CA3AF;font-size:10px;">(${esc(r.source)})</span>` : ""}</td></tr>`
    ).join("");
    if (refItems) {
      refsHtml = `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;">
        <tr><td style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c;padding:0 0 8px;">&#128218; Official References &amp; Resources</td></tr>
        <tr><td style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:6px;overflow:hidden;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">${refItems}</table>
        </td></tr>
      </table>`;
    }
  }

  // ── AI Guidance callout ──
  const aiGuidanceHtml = aiGuidance ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;">
    <tr><td style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c;padding:0 0 8px;">&#129302; ITSM AI Comprehensive Guidance</td></tr>
    <tr><td style="background:#F5F3FF;border:1px solid #C4B5FD;border-radius:6px;padding:14px 16px;">
      ${formatResolutionText(aiGuidance)}
    </td></tr>
  </table>` : "";

  // ── Customer message callout ──
  const customerMsgHtml = customerMessage ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:16px;">
    <tr><td style="padding:14px 16px;background:#f0f7ff;border-left:4px solid #0078D4;border-radius:0 6px 6px 0;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#2d3748;line-height:1.6;">${customerMessage.replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</td></tr>
  </table>` : "";

  // ── Description (for assignment/review emails) ──
  const descHtml = description ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:14px;">
    <tr><td style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c;padding:0 0 8px;">&#128196; Description</td></tr>
    <tr><td style="background:#f8fafc;border:1px solid #e8ebef;border-radius:6px;padding:14px 16px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#374151;line-height:1.6;">${esc(description).substring(0, 500)}</td></tr>
  </table>` : "";

  // ── Custom footer note ──
  const footerText = footerNote || (actionRequired
    ? "Please review and take the recommended actions at your earliest convenience."
    : "If this issue persists, please reply to this email or open a new support ticket.");

  // ── Portal link button ──
  const portalBtnHtml = `<table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
    <tr><td align="center" style="background:#0078D4;border-radius:6px;padding:0;">
      <a href="${PORTAL_URL}" style="display:inline-block;padding:12px 28px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;">Open ${APP_DISPLAY_NAME} Portal</a>
    </td></tr>
  </table>`;

  // ── ASSEMBLE FULL EMAIL ──
  const html = `<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f6f8;font-family:'Segoe UI',Arial,sans-serif;">
  <tr><td align="center" style="padding:24px 0;">
    <table cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;">

      <!-- HEADER -->
      <tr><td style="background:${preset.gradient};padding:20px 24px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="font-family:'Segoe UI',Arial,sans-serif;font-size:18px;font-weight:700;color:#ffffff;">${preset.icon} ${preset.label}</td>
            <td align="right" style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.85);">${ORG_SHORT_NAME}<br/>${dateStr}</td>
          </tr>
        </table>
      </td></tr>

      <!-- BODY -->
      <tr><td style="padding:24px;">

        <!-- Action / FYI Banner -->
        ${bannerHtml}

        <!-- Incident Details -->
        ${detailsHtml ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;border:1px solid #e8ebef;border-radius:6px;overflow:hidden;">${detailsHtml}</table>` : ""}

        <!-- Description -->
        ${descHtml}

        <!-- Resolution -->
        ${resolutionHtml}

        <!-- Root Cause -->
        ${rootCauseHtml}

        <!-- Impact Assessment -->
        ${impactHtml}

        <!-- Customer Message -->
        ${customerMsgHtml}

        <!-- AI Guidance -->
        ${aiGuidanceHtml}

        <!-- Next Actions -->
        ${actionsHtml}

        <!-- References -->
        ${refsHtml}

        <!-- Portal Link -->
        ${portalBtnHtml}

        <!-- Footer Note -->
        <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#718096;margin:20px 0 0;line-height:1.5;">${esc(footerText)}</p>

      </td></tr>

      <!-- FOOTER -->
      <tr><td style="background:#f8fafc;border-top:1px solid #e8ebef;padding:14px 24px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="font-family:'Segoe UI',Arial,sans-serif;font-size:10px;color:#a0aec0;line-height:1.6;">
              <strong>${ORG_NAME}</strong> &middot; IT Service Management<br/>
              &#128231; <a href="mailto:${HELPDESK_MAILBOX}" style="color:#a0aec0;text-decoration:none;">${HELPDESK_MAILBOX}</a> &nbsp;|&nbsp; &#128222; ${ORG_PHONE}<br/>
              This is an automated notification from ${APP_DISPLAY_NAME}. Please do not reply to automated messages.
            </td>
            <td align="right" valign="top" style="font-family:'Segoe UI',Arial,sans-serif;font-size:10px;color:#a0aec0;">${incidentId ? `Ref: ${esc(incidentId)}` : ""}</td>
          </tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>`;

  return html;
}

// ─── Category Normalization ──────────────────────────────────────────────
// Maps freeform AI-generated categories to ~10 standard ITIL buckets.
// Applied at incident write time to ensure consistent analytics/reporting.
function normalizeCategory(cat) {
  const c = (cat || "General").toLowerCase();
  if (c.includes("network") || c.includes("connectivity") || c.includes("vpn") || c.includes("firewall") || c.includes("dns") || c.includes("dhcp") || c.includes("ip address") || /\blan\b/.test(c) || /\bwan\b/.test(c)) return "Network";
  if (c.includes("hardware") || c.includes("laptop") || c.includes("desktop") || c.includes("device") || c.includes("monitor") || c.includes("keyboard") || c.includes("mouse") || c.includes("dock")) return "Hardware";
  if (c.includes("security") || c.includes("phishing") || c.includes("malware") || c.includes("virus") || c.includes("vulnerability") || c.includes("attack") || c.includes("threat") || c.includes("defender")) return "Security";
  if (c.includes("print") || c.includes("scanner") || c.includes("fax")) return "Printing";
  if (c.includes("email") || c.includes("outlook") || c.includes("exchange") || c.includes("mail")) return "Email";
  if (c.includes("access") || c.includes("password") || c.includes("login") || c.includes("locked") || c.includes("permission") || c.includes("mfa") || c.includes("identity") || c.includes("certificate")) return "Access/Identity";
  if (c.includes("cloud") || c.includes("azure") || c.includes("m365") || c.includes("microsoft") || c.includes("saas") || c.includes("subscription") || c.includes("license") || c.includes("licensing")) return "Cloud";
  if (c.includes("service request") || c.includes("service catalog") || c.includes("service level") || c.includes("service management") || c.includes("change enablement") || c.includes("change management") || c.includes("request fulfilment") || c.includes("request fulfillment")) return "Service Request";
  if (c.includes("software") || c.includes("application") || c.includes("install") || c.includes("update") || c.includes("patch") || c.includes("browser")) return "Software";
  if (c.includes("end user") || c.includes("workstation") || c.includes("onboard") || c.includes("setup") || c.includes("provisioning") || c.includes("user account")) return "End User Computing";
  return "General";
}

// Valid collection names (whitelist to prevent injection)
const VALID_COLLECTIONS = new Set([
  "incidents", "problems", "changes", "requests",
  "assets", "kb", "services", "users", "vendors",
  "workflow_rules", "survey_templates", "smart_tasks",
  "integrations", "escalation_log", "escalation_config",
  "customers", "service_reports",
  "zendesk_tickets", "zendesk_users", "zendesk_orgs",
  "zendesk_sync_state", "zendesk_comments",
  "ai_actions", "ai_triage_history", "ai_briefings", "ai_patterns",
  "sla_tracking", "sla_config",
  "notifications",
  "workflow_executions",
  "saved_filters",
  "incident_templates",
  "approval_chains", "approval_instances",
  "cmdb_relationships",
  "runbook_executions",
  "report_schedules",
  "email_rejections",
  "email_templates",
  "email_whitelist",
  "zd_ai_queue",
  "advisories",
  "csat_responses",
  "change_freeze_windows",
  "ai_learning_feedback",
  "custom_fields",
  "contracts",
  "automation_rules",
  "sla_calendars",
  "notification_templates",
  "i18n_packs",
  "worklogs",
  "known_errors",
  "field_visibility_rules",
  "notification_preferences",
  "mim_records",
  "ai_chat_sessions",
  "ai_kb_drafts",
  "channel_stats",
  "gamification_scores",
  "dashboard_layouts",
  "releases",
  "cost_allocations",
  "cost_rates",
  "compliance_evidence",
  "teams_webhooks",
  "cmdb_discovery",
  "status_subscribers",
  "pdpa_config",
  "dsar_requests",
  "billing_entries",
  "sg_holidays",
  "portal_sessions",
  "ai_usage",
  "ai_audit_log",
  "releases",
  "cost_allocations",
  "cost_rates",
  "compliance_evidence",
  "saved_reports",
  "report_schedules",
  "anomaly_alerts",
  "benchmarks",
  "ticket_templates",
  "saved_filters",
  "tenant_settings",
  "feature_flags",
  "shadow_diffs",
  "ai_email_outbox",
  "email_preferences",
  "email_confirm_log",
  "workflow_rules_v2",
  "compliance_evidence",
]);

// ─── Version Info ─────────────────────────────────────────────────────
let APP_VERSION = { version: "unknown", build: "unknown" };
try { APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "VERSION.json"), "utf8")); } catch {}

// ─── Zendesk Sync State ──────────────────────────────────────────────
let zdSyncInProgress = false;
let zdLastSyncTime = null;
let zdSyncStats = { tickets: 0, users: 0, orgs: 0, comments: 0, errors: 0 };
let zdAutoSyncInterval = null;

// ─── Cluster scheduler gate ──────────────────────────────────────────
// In a multi-worker cluster, only the worker with WORKER_INDEX=0 owns the
// periodic jobs (SLA snapshot/guardian, Zendesk auto-sync, queue/log/audit
// purges, uptime probes). When run standalone (no cluster), WORKER_INDEX is
// unset and this resolves to true, preserving single-process behaviour.
const IS_SCHEDULER_WORKER = !process.env.WORKER_INDEX || process.env.WORKER_INDEX === "0";
// Shutdown handle registries — push any setInterval/setTimeout that needs cleanup on SIGTERM/SIGINT
const _shutdownIntervals = [];
const _shutdownTimeouts = [];

// ─── Dynamic Org Name (cached, refreshed every 5 min) ────────────────
let _cachedOrgName = ORG_NAME;
let _orgNameCacheTs = 0;
async function getOrgName() {
  if (Date.now() - _orgNameCacheTs < 300000) return _cachedOrgName;
  try {
    const row = await db.getOne("tenant_settings", "tenant_config");
    if (row) {
      const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      if (d.orgName) _cachedOrgName = d.orgName;
    }
  } catch {}
  _orgNameCacheTs = Date.now();
  return _cachedOrgName;
}

// Get access token via Managed Identity (no secrets needed on Azure App Service)
function getManagedIdentityToken(resource = "https://graph.microsoft.com") {
  return new Promise((resolve, reject) => {
    const identityEndpoint = process.env.IDENTITY_ENDPOINT;
    const identityHeader = process.env.IDENTITY_HEADER;
    if (!identityEndpoint || !identityHeader) {
      return reject(new Error("Managed Identity not available — IDENTITY_ENDPOINT or IDENTITY_HEADER missing"));
    }
    const url = new URL(identityEndpoint);
    url.searchParams.set("resource", resource);
    url.searchParams.set("api-version", "2019-08-01");
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(url.href, { headers: { "X-IDENTITY-HEADER": identityHeader } }, (resp) => {
      let data = "";
      resp.on("data", c => data += c);
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error(parsed.error_description || "MI token failed"));
        } catch { reject(new Error("MI token parse failed")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("MI token timeout")); });
  });
}

// Server-side Graph API call using client credentials (app-only) — supports cert or secret
function graphAppCall(endpoint, extraHeaders) {
  return new Promise((resolve, reject) => {
    // Build token request body — prefer cert, fall back to client secret
    let tokenBody;
    const assertion = buildClientAssertion();
    if (assertion) {
      tokenBody = `client_id=${encodeURIComponent(ENTRA_CLIENT_ID)}&scope=${encodeURIComponent("https://graph.microsoft.com/.default")}&client_assertion_type=${encodeURIComponent("urn:ietf:params:oauth:client-assertion-type:jwt-bearer")}&client_assertion=${encodeURIComponent(assertion)}&grant_type=client_credentials`;
    } else if (ENTRA_CLIENT_SECRET) {
      tokenBody = `client_id=${encodeURIComponent(ENTRA_CLIENT_ID)}&scope=${encodeURIComponent("https://graph.microsoft.com/.default")}&client_secret=${encodeURIComponent(ENTRA_CLIENT_SECRET)}&grant_type=client_credentials`;
    } else {
      return reject(new Error("No client secret or certificate configured"));
    }
    const tokenReq = https.request({
      hostname: "login.microsoftonline.com", path: `/${ENTRA_TENANT_ID}/oauth2/v2.0/token`,
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(tokenBody) },
    }, tokenRes => {
      let data = "";
      tokenRes.on("data", c => data += c);
      tokenRes.on("end", () => {
        try {
          const token = JSON.parse(data);
          if (!token.access_token) return reject(new Error(token.error_description || "Token failed"));
          const graphReq = https.request({
            hostname: "graph.microsoft.com", path: `/v1.0${endpoint}`,
            method: "GET", headers: { Authorization: `Bearer ${token.access_token}`, ...(extraHeaders || {}) },
          }, graphRes => {
            let gData = "";
            graphRes.on("data", c => gData += c);
            graphRes.on("end", () => {
              try { resolve(JSON.parse(gData)); } catch { reject(new Error("Invalid JSON")); }
            });
          });
          graphReq.on("error", reject);
          graphReq.end();
        } catch { reject(new Error("Token parse failed")); }
      });
    });
    tokenReq.on("error", reject);
    tokenReq.write(tokenBody);
    tokenReq.end();
  });
}

// Graph API binary call (for photos) — returns base64 data URL or null
function graphAppCallBinary(endpoint) {
  return new Promise((resolve, reject) => {
    let tokenBody;
    const assertion = buildClientAssertion();
    if (assertion) {
      tokenBody = `client_id=${encodeURIComponent(ENTRA_CLIENT_ID)}&scope=${encodeURIComponent("https://graph.microsoft.com/.default")}&client_assertion_type=${encodeURIComponent("urn:ietf:params:oauth:client-assertion-type:jwt-bearer")}&client_assertion=${encodeURIComponent(assertion)}&grant_type=client_credentials`;
    } else if (ENTRA_CLIENT_SECRET) {
      tokenBody = `client_id=${encodeURIComponent(ENTRA_CLIENT_ID)}&scope=${encodeURIComponent("https://graph.microsoft.com/.default")}&client_secret=${encodeURIComponent(ENTRA_CLIENT_SECRET)}&grant_type=client_credentials`;
    } else {
      return reject(new Error("No client secret or certificate configured"));
    }
    const tokenReq = https.request({
      hostname: "login.microsoftonline.com", path: `/${ENTRA_TENANT_ID}/oauth2/v2.0/token`,
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(tokenBody) },
    }, tokenRes => {
      let data = "";
      tokenRes.on("data", c => data += c);
      tokenRes.on("end", () => {
        try {
          const token = JSON.parse(data);
          if (!token.access_token) return reject(new Error(token.error_description || "Token failed"));
          const graphReq = https.request({
            hostname: "graph.microsoft.com", path: `/v1.0${endpoint}`,
            method: "GET", headers: { Authorization: `Bearer ${token.access_token}` },
          }, graphRes => {
            if (graphRes.statusCode === 404) return resolve(null);
            const chunks = [];
            graphRes.on("data", c => chunks.push(c));
            graphRes.on("end", () => {
              const buf = Buffer.concat(chunks);
              const contentType = graphRes.headers["content-type"] || "image/jpeg";
              resolve(`data:${contentType};base64,${buf.toString("base64")}`);
            });
          });
          graphReq.on("error", reject);
          graphReq.end();
        } catch { reject(new Error("Token parse failed")); }
      });
    });
    tokenReq.on("error", reject);
    tokenReq.write(tokenBody);
    tokenReq.end();
  });
}

// Send email via Microsoft Graph API using Managed Identity
async function graphSendMail({ to, subject, body, from, isCustomerEmail }) {
  const token = await getManagedIdentityToken();
  const sender = from || MAIL_FROM;

  // ─── Email Redirect Mode: redirect ALL emails to safe inbox ───────
  let finalTo = Array.isArray(to) ? to : [to];
  let finalSubject = subject;
  let finalBody = body;
  if (EMAIL_REDIRECT_MODE) {
    const originalRecipients = finalTo.join(", ");
    const testTarget = isCustomerEmail ? CUSTOMER_REDIRECT_TARGET : EMAIL_REDIRECT_TARGET;
    finalSubject = `[REDIRECT → ${originalRecipients}] ${subject}`;
    finalBody = `<div style="background:#FFF3CD;border:1px solid #FFD700;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-family:Arial,sans-serif;">
      <strong style="color:#856404;">⚠️ EMAIL REDIRECT ACTIVE${isCustomerEmail ? " (CUSTOMER EMAIL)" : ""}</strong><br/>
      <span style="color:#856404;font-size:13px;">Original recipient(s): <code>${originalRecipients}</code></span>
    </div>\n${body}`;
    finalTo = [testTarget];
    console.log(`[M365 Mail] EMAIL_REDIRECT: Redirected email from [${originalRecipients}] → ${testTarget}`);
  }

  const mailPayload = JSON.stringify({
    message: {
      subject: finalSubject,
      body: { contentType: "HTML", content: finalBody },
      toRecipients: finalTo.map(addr => ({ emailAddress: { address: addr } })),
      from: { emailAddress: { address: sender } },
    },
    saveToSentItems: true,
  });
  return new Promise((resolve, reject) => {
    const graphReq = https.request({
      hostname: "graph.microsoft.com",
      path: `/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(mailPayload),
      },
    }, (resp) => {
      let data = "";
      resp.on("data", c => data += c);
      resp.on("end", () => {
        if (resp.statusCode === 202 || resp.statusCode === 200) {
          console.log(`[M365 Mail] Sent to ${to} subject="${subject}"`);
          resolve({ success: true, statusCode: resp.statusCode });
        } else {
          console.error(`[M365 Mail] Failed ${resp.statusCode}: ${data.substring(0, 500)}`);
          reject(new Error(`Graph sendMail ${resp.statusCode}: ${data.substring(0, 300)}`));
        }
      });
    });
    graphReq.on("error", reject);
    graphReq.setTimeout(20000, () => { graphReq.destroy(); reject(new Error("Graph sendMail timeout")); });
    graphReq.write(mailPayload);
    graphReq.end();
  });
}

// ─── Email-to-Ticket: Inbound Email Processing ─────────────────────────
// Reads unread emails from the ITSM mailbox via Graph API and creates incidents
// Only emails from registered customer domains or VGC internal domains create tickets.
let _emailPipelineLock = false;
async function processInboundEmails() {
  if (_emailPipelineLock) {
    console.log("[Email-to-Ticket] Pipeline already running, skipping concurrent call");
    return { processed: 0, rejected: 0, incidents: [], skipped: "pipeline-locked" };
  }
  _emailPipelineLock = true;
  try {
    const token = await getManagedIdentityToken();
    const sender = HELPDESK_MAILBOX;

    // ── Build customer domain + email whitelist ─────────────────────────
    const allowedDomains = new Set(["vgctechnology.com", "vgcsg.com"]); // internal always allowed
    const allowedEmails = new Set(); // individual email addresses
    // 1. Load from dedicated email_whitelist collection
    try {
      const wlRows = await db.getAll("email_whitelist");
      for (const row of wlRows) {
        try {
          const entry = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (entry.type === "domain" && entry.value) allowedDomains.add(entry.value.toLowerCase());
          if (entry.type === "email" && entry.value) allowedEmails.add(entry.value.toLowerCase());
        } catch {}
      }
    } catch (e) { console.warn("[Email-to-Ticket] Could not load email_whitelist:", e.message); }
    // 2. Merge customer domains as fallback (backward compat)
    try {
      const allCustomers = await db.getAll("customers");
      for (const row of allCustomers) {
        try {
          const cust = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          const domain = (cust.email || "").split("@")[1]?.toLowerCase();
          if (domain) allowedDomains.add(domain);
        } catch {}
      }
    } catch (e) { console.warn("[Email-to-Ticket] Could not load customers for whitelist:", e.message); }
    console.log(`[Email-to-Ticket] Allowed domains: ${[...allowedDomains].join(", ")}`);
    if (allowedEmails.size > 0) console.log(`[Email-to-Ticket] Allowed emails: ${[...allowedEmails].join(", ")}`);

    // Fetch unread emails (top 10, newest first)
    const filterParams = new URLSearchParams({
      "$filter": "isRead eq false",
      "$top": "10",
      "$orderby": "receivedDateTime desc",
      "$select": "id,subject,bodyPreview,from,receivedDateTime,body,internetMessageHeaders,conversationId",
    });
    const graphData = await new Promise((resolve, reject) => {
      const graphReq = https.request({
        hostname: "graph.microsoft.com",
        path: `/v1.0/users/${encodeURIComponent(sender)}/messages?${filterParams.toString()}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }, (resp) => {
        let data = "";
        resp.on("data", c => data += c);
        resp.on("end", () => {
          if (resp.statusCode === 200) {
            try { resolve(JSON.parse(data)); } catch { reject(new Error("Failed to parse inbox response")); }
          } else {
            reject(new Error(`Graph inbox read failed ${resp.statusCode}: ${data.substring(0, 300)}`));
          }
        });
      });
      graphReq.on("error", reject);
      graphReq.setTimeout(20000, () => { graphReq.destroy(); reject(new Error("Graph inbox timeout")); });
      graphReq.end();
    });

    const messages = graphData.value || [];
    if (messages.length === 0) {
      console.log("[Email-to-Ticket] No unread emails found");
      return { processed: 0, rejected: 0, incidents: [] };
    }

    const createdIncidents = [];
    let rejectedCount = 0;

    // Helper: log rejected email to email_rejections collection
    const _logRejection = async (from, subject, reason) => {
      try {
        const rejId = `REJ-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        await db.upsert("email_rejections", rejId, JSON.stringify({
          id: rejId, from, subject: (subject || "").substring(0, 200), reason,
          processedAt: new Date().toISOString(),
        }));
      } catch {}
      rejectedCount++;
    };

    // Pre-load incidents ONCE for email dedup (avoid N+1 per email)
    const _emailIncRows = await db.getAll("incidents");
    let _emailParsedIncidents = _emailIncRows.map(row => {
      try { return typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch { return null; }
    }).filter(Boolean);
    const _emailMsgIdSet = new Set(_emailParsedIncidents.filter(i => i.emailMessageId).map(i => i.emailMessageId));
    // Dedup: conversationId → existing incident ID (for email-sourced open incidents)
    const _emailConvIdMap = new Map();
    // Dedup: RFC Message-ID set (from internetMessageHeaders stored on incidents)
    const _emailRfcMsgIdSet = new Set();
    for (const inc of _emailParsedIncidents) {
      if (inc.source === "email" && !["Closed", "Resolved"].includes(inc.status)) {
        if (inc.conversationId) _emailConvIdMap.set(inc.conversationId, inc);
        if (inc.rfcMessageId) _emailRfcMsgIdSet.add(inc.rfcMessageId);
      }
    }

    // Helper: extract RFC header value from internetMessageHeaders array
    const _extractHeader = (headers, name) => {
      if (!Array.isArray(headers)) return null;
      const h = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
      return h ? h.value : null;
    };

    // Helper: fuzzy subject similarity (word overlap)
    const _subjectSimilarity = (s1, s2) => {
      const words1 = s1.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
      const words2 = s2.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
      if (words1.length === 0 || words2.length === 0) return 0;
      const matchCount = words1.filter(w => words2.includes(w)).length;
      return matchCount / Math.max(words1.length, words2.length);
    };

    // Helper: append email as reply to an existing incident
    const _appendAsReply = async (existingInc, msg, fromAddr, subject, reason) => {
      const rawReply = (msg.body?.content || msg.bodyPreview || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (!existingInc.activityLog) existingInc.activityLog = [];
      existingInc.activityLog.push({
        id: `AL-REPLY-${Date.now()}`,
        type: "email_reply",
        user: msg.from?.emailAddress?.name || fromAddr,
        time: new Date().toISOString(),
        detail: `Email reply from ${fromAddr}: ${rawReply.substring(0, 500)}`,
      });
      existingInc.updatedAt = new Date().toISOString();
      await db.upsert("incidents", existingInc.id, JSON.stringify(existingInc));
      await _markEmailRead(token, sender, msg.id);
      console.log(`[Email-to-Ticket] Dedup (${reason}): appended to ${existingInc.id} — "${subject.substring(0, 60)}"`);
    };

    for (const msg of messages) {
      try {
        const fromAddr = (msg.from?.emailAddress?.address || "").toLowerCase();
        const subject = msg.subject || "(No Subject)";

        // ── Gate 1: Skip auto-generated, no-reply, and ITSM notification emails (Phase E2 hardened) ──
        // Catch Re:/Fwd: of our own confirmations (e.g. "Re: [VGC ITSM] Incident...") which previously
        // slipped past startsWith() and round-tripped into new tickets.
        const _selfLoop = /\[vgc itsm\]|\[vgc technology pte ltd\]|\[test →/i.test(subject);
        if (fromAddr.includes("noreply") || fromAddr.includes("no-reply") || fromAddr.includes("mailer-daemon") || _selfLoop) {
          await _markEmailRead(token, sender, msg.id);
          await _logRejection(fromAddr, subject, _selfLoop ? "self-loop" : "auto-generated");
          console.log(`[Email-to-Ticket] Skipped ${_selfLoop ? "self-loop" : "auto-generated"}: ${fromAddr}`);
          continue;
        }

        // ── Gate 1.5: Zendesk system / external ticket-system echo emails ──
        // Subjects like "[Request received] Ticket ID: #8371 - ..." or "#8368 - ..."
        // are confirmation/notification emails from Zendesk or other ITSM systems
        // that we've forwarded into. They should be ingested into the existing
        // ZD-linked incident (handled by reconcile), not create a new orphan.
        const _zdEcho = /\[request received\]|\[ticket #\d+|^#\d{3,}\s*[-–]/i.test(subject)
          || fromAddr.endsWith("@zendesk.com")
          || fromAddr.includes("@support.")
          || /support\+id\d+@/.test(fromAddr);
        if (_zdEcho) {
          await _markEmailRead(token, sender, msg.id);
          await _logRejection(fromAddr, subject, "zendesk-system-echo");
          console.log(`[Email-to-Ticket] Skipped zendesk-system-echo: ${fromAddr} "${subject.substring(0, 60)}"`);
          continue;
        }

        // ── Gate 2: Skip newsletters, marketing, bulk mail, news digests ──
        const noisePatterns = ["newsletter", "marketing", "promo", "digest", "updates@", "info@", "notification@", "campaign", "unsubscribe", "daily briefing", "weekly briefing", "threat brief", "cyber brief", "news alert", "security alert roundup", "threat roundup", "daily recap", "weekly recap", "news round"];
        const isNoise = noisePatterns.some(p => fromAddr.includes(p) || subject.toLowerCase().includes(p));
        const headers = msg.internetMessageHeaders || [];
        const hasBulkHeader = headers.some(h => h.name?.toLowerCase() === "list-unsubscribe" || (h.name?.toLowerCase() === "precedence" && h.value?.toLowerCase() === "bulk"));
        // Detect news aggregation: subjects with 3+ comma-separated topics (e.g. "Stuxnet Malware, Cisco Backdoor, NASA Phished")
        const commaSegments = subject.split(",").map(s => s.trim()).filter(s => s.length > 3);
        const isNewsDigest = commaSegments.length >= 3;
        if (isNoise || hasBulkHeader || isNewsDigest) {
          await _markEmailRead(token, sender, msg.id);
          const reason = isNewsDigest ? "news-digest-multi-topic" : hasBulkHeader ? "bulk-mail-header" : "newsletter-pattern";
          await _logRejection(fromAddr, subject, reason);
          console.log(`[Email-to-Ticket] Skipped ${reason}: ${fromAddr} "${subject.substring(0, 60)}"`);
          continue;
        }

        // ── Gate 3: Skip auto-replies / out-of-office ──
        const autoReplyPatterns = ["out of office", "automatic reply", "auto-reply", "autoreply", "automatische antwort"];
        if (autoReplyPatterns.some(p => subject.toLowerCase().includes(p))) {
          await _markEmailRead(token, sender, msg.id);
          await _logRejection(fromAddr, subject, "auto-reply");
          console.log(`[Email-to-Ticket] Skipped auto-reply: ${fromAddr}`);
          continue;
        }

        // ── Gate 4: Customer domain + email whitelist — ONLY whitelisted senders create tickets ──
        const senderDomain = fromAddr.split("@")[1] || "";
        const isWhitelisted = allowedDomains.has(senderDomain) || allowedEmails.has(fromAddr);
        if (!isWhitelisted) {
          await _markEmailRead(token, sender, msg.id);
          await _logRejection(fromAddr, subject, "non-whitelisted");
          // Silently ignore — do NOT send rejection email to non-whitelisted senders
          console.log(`[Email-to-Ticket] Silently rejected: ${fromAddr} (not in whitelist)`);
          continue;
        }

        // ── Gate 5: Duplicate detection — skip if same emailMessageId already exists ──
        const isDuplicate = _emailMsgIdSet.has(msg.id);
        if (isDuplicate) {
          await _markEmailRead(token, sender, msg.id);
          console.log(`[Email-to-Ticket] Skipped duplicate email: ${msg.id}`);
          continue;
        }

        // ── Gate 5.5: RFC Message-ID dedup — unique email ID from headers ──
        const msgHeaders = msg.internetMessageHeaders || [];
        const rfcMessageId = _extractHeader(msgHeaders, "Message-ID");
        const inReplyTo = _extractHeader(msgHeaders, "In-Reply-To");
        if (rfcMessageId && _emailRfcMsgIdSet.has(rfcMessageId)) {
          await _markEmailRead(token, sender, msg.id);
          console.log(`[Email-to-Ticket] Skipped duplicate RFC Message-ID: ${rfcMessageId}`);
          continue;
        }

        // Phase E2: In-Reply-To matches an existing incident's RFC Message-ID → reply
        if (inReplyTo && _emailRfcMsgIdSet.has(inReplyTo)) {
          const parentInc = _emailParsedIncidents.find(i => i.rfcMessageId === inReplyTo);
          if (parentInc) { await _appendAsReply(parentInc, msg, fromAddr, subject, "in-reply-to-match"); continue; }
        }

        // ── Gate 5.7: ConversationId dedup — Graph API groups thread messages ──
        const openStatuses = new Set(["New", "Open", "In Progress", "Pending", "On Hold"]);
        if (msg.conversationId && _emailConvIdMap.has(msg.conversationId)) {
          const convInc = _emailConvIdMap.get(msg.conversationId);
          if (convInc && openStatuses.has(convInc.status)) {
            await _appendAsReply(convInc, msg, fromAddr, subject, "conversationId-match");
            continue;
          }
        }

        // ── Gate 6: Thread-aware dedup — replies to same thread append to existing incident ──
        const normalizeSubject = (s) => s.replace(/^(\s*(re|fw|fwd)\s*:\s*)+/gi, "").replace(/^\[.*?\]\s*/g, "").trim().toLowerCase();
        const normalizedSubject = normalizeSubject(subject);
        // 6a: Exact normalized subject match
        const threadMatch = _emailParsedIncidents.find(inc =>
          inc.source === "email" && openStatuses.has(inc.status) &&
          normalizeSubject(inc.title || "") === normalizedSubject
        );
        if (threadMatch) {
          await _appendAsReply(threadMatch, msg, fromAddr, subject, "exact-subject-match");
          continue;
        }
        // 6b: Fuzzy subject match — same sender ≥70% overlap, different sender ≥80%
        const fuzzyMatch = _emailParsedIncidents.find(inc => {
          if (!inc.source || inc.source !== "email" || !openStatuses.has(inc.status)) return false;
          const sim = _subjectSimilarity(normalizedSubject, normalizeSubject(inc.title || ""));
          const sameSender = (inc.reporterEmail || "").toLowerCase() === fromAddr;
          return sameSender ? sim >= 0.7 : sim >= 0.8;
        });
        if (fuzzyMatch) {
          await _appendAsReply(fuzzyMatch, msg, fromAddr, subject, `fuzzy-subject-${Math.round(_subjectSimilarity(normalizedSubject, normalizeSubject(fuzzyMatch.title || "")) * 100)}%`);
          continue;
        }

        // ── Gate 6.5: Sender + time window dedup — same reporter within 10 min + ≥50% subject overlap ──
        const nowMs = Date.now();
        const timeWindowMs = 10 * 60 * 1000; // 10 minutes
        const timeWindowMatch = _emailParsedIncidents.find(inc => {
          if (inc.source !== "email" || !openStatuses.has(inc.status)) return false;
          if ((inc.reporterEmail || "").toLowerCase() !== fromAddr) return false;
          const incTime = inc.createdAt ? new Date(inc.createdAt).getTime() : 0;
          if (nowMs - incTime > timeWindowMs) return false;
          return _subjectSimilarity(normalizedSubject, normalizeSubject(inc.title || "")) >= 0.5;
        });
        if (timeWindowMatch) {
          await _appendAsReply(timeWindowMatch, msg, fromAddr, subject, "sender-time-window-dedup");
          continue;
        }

        // ── Gate 6.7: Rapid same-sender dedup — same reporter within 2 min, no subject check ──
        const rapidWindowMs = 2 * 60 * 1000; // 2 minutes
        const rapidSenderMatch = _emailParsedIncidents.find(inc => {
          if (inc.source !== "email" || !openStatuses.has(inc.status)) return false;
          if ((inc.reporterEmail || "").toLowerCase() !== fromAddr) return false;
          const incTime = inc.createdAt ? new Date(inc.createdAt).getTime() : 0;
          return (nowMs - incTime) <= rapidWindowMs;
        });
        if (rapidSenderMatch) {
          await _appendAsReply(rapidSenderMatch, msg, fromAddr, subject, "rapid-sender-dedup-2min");
          continue;
        }

        // Strip HTML from body to get plain text description
        const rawBody = (msg.body?.content || msg.bodyPreview || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        const description = rawBody.substring(0, 2000);

        // Create incident
        const incId = `INC-EMAIL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const slaMap = getSlaMap();
        const incident = {
          id: incId,
          title: subject.substring(0, 200),
          description,
          status: "New",
          priority: "Sev-C",
          category: "General",
          source: "email",
          reporterName: msg.from?.emailAddress?.name || fromAddr,
          reporterEmail: fromAddr,
          assignedTeam: "Service Desk",
          created: 0,
          slaTarget: slaMap["Sev-C"] || 9,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          emailMessageId: msg.id,
          conversationId: msg.conversationId || null,
          rfcMessageId: rfcMessageId || null,
          activityLog: [{
            id: `AL-EMAIL-${Date.now()}`,
            type: "created",
            user: "Email-to-Ticket Pipeline",
            time: new Date().toISOString(),
            detail: `Auto-created from email: "${subject.substring(0, 100)}" from ${fromAddr}`,
          }],
        };

        await db.upsert("incidents", incId, JSON.stringify(incident));
        await db.audit("incidents", incId, "email_create", JSON.stringify({ from: fromAddr, subject }), "email-pipeline");
        // Update in-batch dedup sets so later emails in same batch are caught by Gate 5 & 6
        _emailParsedIncidents.push(incident);
        _emailMsgIdSet.add(msg.id);
        if (msg.conversationId) _emailConvIdMap.set(msg.conversationId, incident);
        if (rfcMessageId) _emailRfcMsgIdSet.add(rfcMessageId);
        if (wsServer) wsServer.broadcast("incidents", { action: "upsert", collection: "incidents", id: incId, summary: incident.title });
        createdIncidents.push(incId);

        // Mark email as read
        await _markEmailRead(token, sender, msg.id);

        // Phase E1+E3+E4+E5: send confirmation only when gate allows
        const _gate = await shouldSendCustomerConfirmation(fromAddr);
        if (!_gate.send) {
          try { await db.audit("incidents", incId, "email_confirm_skipped", JSON.stringify({ to: fromAddr, reason: _gate.reason }), "email-pipeline"); } catch (e) { structuredLog("warn", "Audit", "audit write failed", { incidentId: incId, action: "email_confirm_skipped", err: e.message }); }
          console.log(`[Email-to-Ticket] Confirmation suppressed for ${incId} → ${fromAddr} (${_gate.reason})`);
        } else {
          await _logConfirmation(fromAddr, incId);
          // Send confirmation to customer
          graphSendMail({
          to: [fromAddr],
          subject: `[VGC ITSM] Incident ${incId} created — ${subject.substring(0, 60)}`,
          isCustomerEmail: true,
          from: senderFor("support"),
          body: `<div style="font-family:Arial,sans-serif;max-width:600px;">
            <div style="background:linear-gradient(135deg,#3B82F6,#06B6D4);padding:16px 20px;border-radius:8px 8px 0 0;">
              <h2 style="margin:0;color:#fff;font-size:18px;">📧 Incident Created from Your Email</h2>
            </div>
            <div style="background:#f8f9fa;padding:20px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
              <p style="margin:0 0 12px;color:#333;">We've received your email and created a support ticket:</p>
              <table style="border-collapse:collapse;width:100%;">
                <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Incident ID</td><td style="padding:8px 12px;">${incId}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Subject</td><td style="padding:8px 12px;">${subject.substring(0, 100).replace(/</g, "&lt;")}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Priority</td><td style="padding:8px 12px;">Sev-C (Medium)</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Assigned Team</td><td style="padding:8px 12px;">Service Desk</td></tr>
              </table>
              <p style="color:#666;font-size:13px;margin-top:16px;">Our team will review your request and respond as soon as possible.</p>
              <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;"/>
              <p style="color:#888;font-size:11px;">VGC Technology Pte Ltd — IT Service Management<br/>
                <a href="https://vgc-itsm1-app.azurewebsites.net/api/email-preferences/unsubscribe?email=${encodeURIComponent(fromAddr)}" style="color:#9ca3af;font-size:10px;">Unsubscribe from auto-confirmations</a>
              </p>
            </div>
          </div>`,
          }).catch(e => console.warn(`[Email-to-Ticket] Confirmation email failed for ${incId}:`, e.message));
        }

        // ─── AI Sentiment Analysis on inbound email (fire-and-forget) ───
        if (AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT) {
          try {
            const sentimentPrompt = `Analyze the sentiment and urgency of this IT support email. Return JSON ONLY (no markdown): { "sentiment": "positive|neutral|frustrated|angry", "urgencyScore": 0-100, "emotionalTone": "brief description", "shouldEscalate": true/false }. Only set shouldEscalate=true if sentiment is "frustrated" or "angry" AND urgencyScore >= 80.`;
            const sentPayload = {
              model: getAIModel("tertiary"),
              input: [{ role: "system", content: sentimentPrompt }, { role: "user", content: `Subject: ${subject}\n\n${description.substring(0, 1000)}` }],
              max_output_tokens: 200
            };
            const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
            const sentReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY } }, (sentRes) => {
              let d = ""; sentRes.on("data", c => d += c);
              sentRes.on("end", async () => {
                try {
                  const sentResult = JSON.parse(d);
                  const sentText = extractAIText(sentResult);
                  const sentData = JSON.parse(sentText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
                  // Update incident with sentiment data
                  const incRow = await db.getOne("incidents", incId);
                  if (incRow) {
                    const inc = JSON.parse(incRow.data);
                    inc.aiSentiment = sentData.sentiment || "neutral";
                    inc.aiSentimentScore = sentData.urgencyScore || 0;
                    inc.aiEmotionalTone = sentData.emotionalTone || "";
                    // Auto-escalate priority if angry/frustrated with high urgency
                    if (sentData.shouldEscalate && inc.priority !== "Sev-A") {
                      const escalationMap = { "Sev-D": "Sev-C", "Sev-C": "Sev-B", "Sev-B": "Sev-A" };
                      const oldPriority = inc.priority;
                      inc.priority = escalationMap[inc.priority] || inc.priority;
                      const slaMap = getSlaMap();
                      inc.slaTarget = slaMap[inc.priority] || inc.slaTarget;
                      inc.activityLog = inc.activityLog || [];
                      inc.activityLog.push({
                        id: `AL-SENT-${Date.now().toString(36)}`, type: "ai_sentiment",
                        user: "AI Sentiment Engine", time: new Date().toISOString(),
                        detail: `Sentiment: ${sentData.sentiment} (urgency: ${sentData.urgencyScore}%). Priority auto-escalated ${oldPriority} → ${inc.priority}. Tone: ${sentData.emotionalTone}`,
                      });
                      console.log(`[AI Sentiment] ${incId}: ${sentData.sentiment} → escalated ${oldPriority} → ${inc.priority}`);
                    }
                    inc.updatedAt = new Date().toISOString();
                    await db.upsert("incidents", incId, JSON.stringify(inc));
                  }
                } catch (parseErr) { console.warn(`[AI Sentiment] Parse error for ${incId}:`, parseErr.message); }
              });
            });
            sentReq.on("error", e => console.warn(`[AI Sentiment] Request failed for ${incId}:`, e.message));
            sentReq.setTimeout(15000, () => { sentReq.destroy(); });
            sentReq.write(JSON.stringify(sentPayload));
            sentReq.end();
          } catch (sentErr) { console.warn("[AI Sentiment] Trigger error:", sentErr.message); }
        }

        // Fire AI auto-triage + assignment pipeline (fire-and-forget)
        if (AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT) {
          try {
            const triagePayload = JSON.stringify({ ticket: incident, requestedBy: "Email-to-Ticket Auto-Triage" });
            const triageReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/auto-triage-assign", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(triagePayload) } }, (triageRes) => {
              let d = ""; triageRes.on("data", c => d += c);
              triageRes.on("end", () => { console.log(`[Email-to-Ticket] AI auto-triage for ${incId}: ${d.substring(0, 200)}`); });
            });
            triageReq.on("error", e => console.warn(`[Email-to-Ticket] AI triage failed for ${incId}:`, e.message));
            triageReq.setTimeout(35000, () => { triageReq.destroy(); });
            triageReq.write(triagePayload);
            triageReq.end();
          } catch (triageErr) { console.warn("[Email-to-Ticket] AI triage error:", triageErr.message); }
        }

        console.log(`[Email-to-Ticket] Created ${incId} from email by ${fromAddr}: "${subject.substring(0, 80)}"`);
      } catch (msgErr) {
        console.warn("[Email-to-Ticket] Failed to process message:", msgErr.message);
      }
    }

    console.log(`[Email-to-Ticket] Processed ${createdIncidents.length} emails → incidents, rejected ${rejectedCount}`);
    return { processed: createdIncidents.length, rejected: rejectedCount, incidents: createdIncidents };
  } catch (err) {
    console.error("[Email-to-Ticket] Pipeline error:", err.message);
    // Distinguish permission errors from other failures
    if (err.message.includes("403") || err.message.includes("AccessDenied")) {
      return { processed: 0, incidents: [], error: "Mail.Read permission not granted to Managed Identity — contact Azure AD admin to enable" };
    }
    return { processed: 0, incidents: [], error: err.message };
  } finally {
    _emailPipelineLock = false;
  }
}

// Helper: Mark an email as read via Graph API
async function _markEmailRead(token, sender, messageId) {
  return new Promise((resolve) => {
    const patchBody = JSON.stringify({ isRead: true });
    const req = https.request({
      hostname: "graph.microsoft.com",
      path: `/v1.0/users/${encodeURIComponent(sender)}/messages/${messageId}`,
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(patchBody),
      },
    }, (resp) => {
      let d = ""; resp.on("data", c => d += c);
      resp.on("end", () => resolve(resp.statusCode === 200));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
    req.write(patchBody);
    req.end();
  });
}


// ─── Phase 4: Route handler references (initialized in start()) ────
let handleZendesk, handleAI, handleCore;
const server = http.createServer(async (req, res) => {
  // Phase T2 — stash req on res so helpers (json, etc.) can negotiate compression.
  res.req = req;
  // CORS headers for API routes
  if (req.url.startsWith("/api/")) {
    const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:8080,http://localhost:4173,http://localhost:5173").split(",").map(s => s.trim());
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  }
  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' https://login.microsoftonline.com https://alcdn.msauth.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com https://*.azure.com https://*.cognitiveservices.azure.com; frame-src https://login.microsoftonline.com;");

  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // ─── Phase 9.1: Correlation ID ─────────────────────────────────────
  const correlationId = req.headers["x-correlation-id"] || crypto.randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);
  req.correlationId = correlationId;

  // ─── Auth & Rate Limiting (API routes only) ────────────────────────
  let authResult = { authenticated: false, user: null, role: "anonymous", skipped: true };
  if (pathname.startsWith("/api/")) {
    authResult = await authMiddleware(req, res, pathname, ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ALLOWED_TENANT_IDS);
    if (authResult.blocked) return; // 429 already sent
  }
  const auth = { authenticated: authResult.authenticated, name: authResult.user, role: authResult.role };


  // ─── Phase 4: Route Delegation ───────────────────────────────────
  // Wrap handler invocation so a thrown handler cannot crash the worker.
  // Without this guard a single bad route caused ERR_HTTP_HEADERS_SENT and
  // the cluster supervisor restarted workers in a tight loop.
  try {
    if (handleCore && await handleCore(req, res, pathname, auth, authResult, urlObj)) return;
    if (handleZendesk && await handleZendesk(req, res, pathname, auth, authResult, urlObj)) return;
    if (handleAI && await handleAI(req, res, pathname, auth, authResult, urlObj)) return;
  } catch (handlerErr) {
    console.error(`[Route] ${req.method} ${pathname} crashed:`, handlerErr && handlerErr.stack || handlerErr);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error", correlationId }));
    } else {
      try { res.end(); } catch {}
    }
    return;
  }

  // ─── Static File Serving ──────────────────────────────────────────────
  const distDir = path.join(__dirname, "dist");
  const hasDistDir = fs.existsSync(distDir);
  const serveRoot = hasDistDir ? distDir : __dirname;
  let filePath = path.resolve(serveRoot, (pathname === "/" ? "index.html" : pathname).replace(/^[\/]+/, ""));
  const ext = path.extname(filePath).toLowerCase();
  // Security: prevent directory traversal
  if (!path.normalize(filePath).startsWith(path.normalize(serveRoot))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  // Don't serve the database file
  if (filePath.endsWith(".db") || filePath.endsWith(".db-wal") || filePath.endsWith(".db-shm")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    // Client may have aborted, or another handler may have already responded
    // (e.g. a route returned true after we entered the static branch). Avoid
    // ERR_HTTP_HEADERS_SENT noise in the logs.
    if (res.headersSent || res.writableEnded) return;
    if (err) {
      // SPA fallback
      fs.readFile(path.join(serveRoot, "index.html"), (e2, html) => {
        if (res.headersSent || res.writableEnded) return;
        if (e2) { res.writeHead(500); return res.end("Server Error"); }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      return;
    }
    const baseHeaders = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000",
    };
    // Phase T1 — gzip/brotli compression for text assets. Node's http server
    // does not negotiate this automatically. Saves ~78% on the 1.5 MB JS bundle.
    const COMPRESSIBLE = new Set([".js", ".css", ".html", ".json", ".svg", ".map"]);
    const accept = (req.headers["accept-encoding"] || "").toLowerCase();
    if (COMPRESSIBLE.has(ext) && data.length > 1024) {
      // In-memory cache to avoid recompressing on every request.
      const cacheKey = filePath + ":" + (accept.includes("br") ? "br" : "gz");
      if (!global.__staticCompressionCache) global.__staticCompressionCache = new Map();
      const cache = global.__staticCompressionCache;
      let entry = cache.get(cacheKey);
      try {
        if (!entry) {
          if (accept.includes("br")) {
            entry = { encoding: "br", buf: zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) };
          } else if (accept.includes("gzip")) {
            entry = { encoding: "gzip", buf: zlib.gzipSync(data, { level: 6 }) };
          }
          if (entry) {
            // Bound cache to ~30 entries to avoid memory creep on dev hot reload.
            if (cache.size > 30) cache.clear();
            cache.set(cacheKey, entry);
          }
        }
      } catch (zErr) {
        // Fall through to uncompressed on any compression error
        entry = null;
      }
      if (entry) {
        res.writeHead(200, { ...baseHeaders, "Content-Encoding": entry.encoding, "Vary": "Accept-Encoding" });
        return res.end(entry.buf);
      }
    }
    res.writeHead(200, baseHeaders);
    res.end(data);
  });
});

// ─── Start Server ───────────────────────────────────────────────────────
// --- Auto KB Draft Generator ---
async function generateKBDraft(incident) {
  if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) return;
  if (!incident.title) return;

  const systemPrompt = `You are a technical writer for VGC Technology's ITSM knowledge base.
Given a resolved IT incident, create a concise KB article that will help agents resolve similar issues faster.

Respond with ONLY valid JSON (no markdown):
{
  "title": "How to: <clear action title>",
  "category": "one of: Network, Hardware, Software, Security, Email, Access Management, Cloud Services, General, End User Computing, Application Support",
  "content": "Step-by-step resolution (numbered list, max 6 steps)",
  "tags": ["tag1","tag2"]
}`;

  const userPrompt = `RESOLVED INCIDENT:
Title: ${incident.title}
Category: ${incident.category || "General"}
Description: ${(incident.description || "").substring(0, 500)}
Resolution: ${(incident.resolution || incident.resolutionNotes || "").substring(0, 500)}
Priority: ${incident.priority || "N/A"}
Assignee: ${incident.assignee || "N/A"}`;

  const payload = {
    model: getAIModel("tertiary"),
    input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    max_output_tokens: 600,
  };

  const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
  const aiResult = await new Promise((resolve, reject) => {
    const aiReq = https.request({
      hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
      method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
    }, (aiRes) => {
      let data = ""; aiRes.on("data", c => data += c);
      aiRes.on("end", () => {
        if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
        else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 300)}`));
      });
    });
    aiReq.on("error", reject);
    aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
    aiReq.write(JSON.stringify(payload));
    aiReq.end();
  });

  const text = extractAIText(aiResult);
  const kb = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  const kbId = `KB-DRAFT-${Date.now().toString(36)}`;
  const kbArticle = {
    id: kbId,
    title: kb.title || `KB Draft: ${incident.title}`,
    category: kb.category || incident.category || "General",
    content: kb.content || "",
    tags: kb.tags || [],
    status: "Draft",
    author: "AI Auto-KB",
    sourceIncident: incident.id,
    created: new Date().toISOString(),
  };
  await db.upsert("kb", kbId, JSON.stringify(kbArticle));
  console.log(`[Auto KB Draft] Created ${kbId} from incident ${incident.id}: "${kbArticle.title}"`);
}
async function start() {
  await initDatabase();

  // Initialize feature flags (DB-backed, hot-reload every 30s)
  try {
    await featureFlags.init(db, { reloadSec: 30 });
    console.log(`[FeatureFlags] Loaded ${featureFlags.list().length} flag(s)`);
  } catch (e) { console.warn("[FeatureFlags] init failed:", e.message); }

  // Phase B3 — start customer-email outbox drainer (60s interval)
  setInterval(_drainCustomerEmailOutbox, 60_000).unref?.();
  console.log("[Outbox Drain] Started (interval=60s)");

  // Start SLA Engine (after DB is initialized)
  // Initialize WebSocket server
  wsServer = new WebSocketServer();
  server.on("upgrade", (req, socket, head) => wsServer.handleUpgrade(req, socket));

  // Initialize Notification Engine
  notifyEngine = new NotificationEngine({ graphSendMail, buildEmailTemplate, wsServer, db });

  // Initialize Cache Layer
  cacheLayer = new CacheLayer({ maxSize: 1000, defaultTTL: 5 * 60 * 1000 });

  // Phase 9 — Incident in-memory index (warmed inside server.listen below)
  incidentIndex = incidentIndexFactory.create({ db });

  // Initialize Analytics Engine (15 min scan — non-critical)
  analyticsEngine = new AnalyticsEngine(db, { cacheTTL: 15 * 60 * 1000 });

  // Initialize Workflow Automation Engine (15 min scan — non-critical)
  workflowEngine = new WorkflowEngine(db, { notifyEngine, wsServer, graphSendMail, interval: 15 * 60 * 1000 });
  workflowEngine._processInboundEmails = processInboundEmails;

  // Phase 10.2: Default 3-tier escalation chain
  workflowEngine.setEscalationChain([
    { level: 1, thresholdMin: 15, notifyRoles: ["engineer"], channels: ["inapp"] },
    { level: 2, thresholdMin: 30, notifyRoles: ["team_lead", "senior_engineer"], channels: ["inapp", "email"] },
    { level: 3, thresholdMin: 60, notifyRoles: ["manager", "director"], channels: ["inapp", "email"] },
  ]);

  // Phase 10.3: Default skill-to-engineer mapping
  workflowEngine.setSkillMap({
    "Network": ["Hlaing Pyae Phyo", "Network Team"],
    "Hardware": ["Desktop Support", "Hlaing Pyae Phyo"],
    "Software": ["Application Support", "Hlaing Pyae Phyo"],
    "Security": ["Security Team", "Hlaing Pyae Phyo"],
    "Email": ["Hlaing Pyae Phyo", "Service Desk"],
    "Cloud Services": ["Cloud Team", "Hlaing Pyae Phyo"],
    "Database": ["Infrastructure", "Hlaing Pyae Phyo"],
    "Access Management": ["Service Desk", "Hlaing Pyae Phyo"],
    "VPN": ["Network Team", "Hlaing Pyae Phyo"],
    "Backup": ["Infrastructure", "Hlaing Pyae Phyo"],
  });

  // Initialize SLA Engine with breach notifications
  slaEngine = new SlaEngine(db, {
    interval: 5 * 60 * 1000,
    onBreach: async (esc) => {
      try {
        if (notifyEngine) {
          await notifyEngine.send({
            channels: ["inapp", "email"],
            subject: `SLA Breach: ${esc.incidentTitle || esc.incidentId}`,
            body: `Priority ${esc.priority} SLA breached \u2014 escalation level ${esc.level}`,
            recipients: [esc.assignee].filter(Boolean),
            metadata: { type: "sla_breach", incidentId: esc.incidentId, level: esc.level }
          });
        }
        if (wsServer) wsServer.broadcast("sla", { action: "breach", ...esc });
      } catch (e) { console.error("[SLA Breach Notify]", e.message); }
    }
  });

  // ─── Phase 4: Build shared context & init route handlers ───────────
  const ctx = {
    // Database & response helpers
    db, json, readBody, parseBody, sendText,
    // AI
    callAI, extractAIText, getAIModel, AI_MODELS, AI_THRESHOLDS,
    AI_AUTONOMY_LEVEL, AI_MONTHLY_BUDGET_USD,
    // Engines
    cacheLayer, wsServer, notifyEngine, slaEngine, workflowEngine, analyticsEngine, incidentIndex,
    // Email & Graph
    buildEmailTemplate, graphSendMail, graphAppCall, graphAppCallBinary, getManagedIdentityToken,
    senderFor, MAIL_FROM, HELPDESK_MAILBOX, CUSTOMER_REDIRECT_TARGET,
    EMAIL_REDIRECT_MODE, EMAIL_REDIRECT_TARGET, INTERNAL_DOMAINS,
    // Feature flags & shadow mode
    featureFlags, shadowMode, shadowWorkflow,
    FEATURE_PDPA, FEATURE_PORTAL, FEATURE_BILLING, FEATURE_SETUP_WIZARD,
    // Helpers
    normalizeCategory, isHighSeverity, safeRecipient,
    piiRedact, redactForAI, logAICall,
    scheduleCsatSurvey, notifyTeamsMajorIncident,
    processInboundEmails, generateKBDraft,
    queueOrSendCustomerEmail,
    shouldSkipAction, trackNewAction, getAiActionsDedupState,
    getSlaMap, getSlaDescription, computeSlaStatus,
    cachedGetAll, cachedGetOne,
    getOrgName, purgeStatus, checkPermission, decodeJWT,
    // Config & constants
    VALID_COLLECTIONS, APP_VERSION, APP_DISPLAY_NAME,
    PORTAL_URL, ORG_NAME, ORG_SHORT_NAME,
    ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_CERT_THUMBPRINT,
    ALLOWED_TENANT_IDS, buildClientAssertion,
    ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN, ZENDESK_WEBHOOK_SECRET,
    AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_MODEL,
    SOLARWINDS_API_KEY, SOLARWINDS_API_HOST,
    LOCAL_USERS, localAuthEnabled,
    MERAKI_API_KEYS, SOPHOS_CLIENT_ID, SOPHOS_CLIENT_SECRET,
    AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP,
    PROD_TEST_MODE, MIME, _zdPushDedup, structuredLog,
    // Mutable state (Zendesk sync)
    zdSyncInProgress, zdLastSyncTime, zdSyncStats,
    // Lazy getter so /api/health can report whether the auto-sync interval is
    // installed without referencing the module-level variable from another file
    // (which previously threw ReferenceError and crashed the worker).
    get zdAutoSyncInterval() { return zdAutoSyncInterval; },
    // Setter functions for mutable config (syncs module-level vars + ctx)
    updateOpenAIConfig: ({ endpoint, key, model }) => {
      if (endpoint) { AZURE_OPENAI_ENDPOINT = endpoint; ctx.AZURE_OPENAI_ENDPOINT = endpoint; }
      if (key) { AZURE_OPENAI_KEY = key; ctx.AZURE_OPENAI_KEY = key; }
      if (model) { AZURE_OPENAI_MODEL = model; ctx.AZURE_OPENAI_MODEL = model; }
    },
    updateSolarWindsConfig: ({ apiKey, apiHost }) => {
      if (apiKey) { SOLARWINDS_API_KEY = apiKey; ctx.SOLARWINDS_API_KEY = apiKey; }
      if (apiHost) { SOLARWINDS_API_HOST = apiHost; ctx.SOLARWINDS_API_HOST = apiHost; }
    },
  };
  handleCore = require("./routes/core")(ctx);
  handleZendesk = require("./routes/zendesk")(ctx);
  handleAI = require("./routes/ai")(ctx);
  console.log("[Phase 4] Route handlers initialized (core, zendesk, ai)");

  server.listen(PORT, async () => {
    const stats = {};
    for (const c of VALID_COLLECTIONS) stats[c] = await db.count(c);
    console.log(`${APP_DISPLAY_NAME} v${APP_VERSION.version} (build ${APP_VERSION.build}) serving on port ${PORT}`);
    console.log(`Database: ${db.label}`);
    console.log(`Collections:`, stats);

    // Phase 9 — incident in-memory index. Wrap db FIRST so any subsequent
    // upsert (seeders, settings restore, etc.) goes through the index.
    try {
      incidentIndex.wrapDb();
      await incidentIndex.warm();
    } catch (e) { console.warn("[IncidentIndex] init failed:", e.message); }

    // Restore persisted settings from DB (OpenAI, SolarWinds)
    try {
      const oaiRow = await db.getOne("tenant_settings", "openai_config");
      if (oaiRow) {
        const cfg = typeof oaiRow.data === "string" ? JSON.parse(oaiRow.data) : oaiRow.data;
        if (cfg.endpoint && !process.env.AZURE_OPENAI_ENDPOINT) AZURE_OPENAI_ENDPOINT = cfg.endpoint;
        if (cfg.apiKey && !process.env.AZURE_OPENAI_KEY) AZURE_OPENAI_KEY = cfg.apiKey;
        if (cfg.model && !process.env.AZURE_OPENAI_MODEL) AZURE_OPENAI_MODEL = cfg.model;
        console.log(`[Settings] Restored OpenAI config from DB. Model=${AZURE_OPENAI_MODEL}`);
      }
      const swRow = await db.getOne("tenant_settings", "solarwinds_config");
      if (swRow) {
        const cfg = typeof swRow.data === "string" ? JSON.parse(swRow.data) : swRow.data;
        if (cfg.apiKey && !process.env.SOLARWINDS_API_KEY) SOLARWINDS_API_KEY = cfg.apiKey;
        if (cfg.apiHost && !process.env.SOLARWINDS_API_HOST) SOLARWINDS_API_HOST = cfg.apiHost;
        console.log(`[Settings] Restored SolarWinds config from DB. Host=${SOLARWINDS_API_HOST}`);
      }
    } catch (e) { console.log("[Settings] Could not restore persisted settings:", e.message); }

    // Seed default KB articles if none exist
    if (stats.kb === 0) {
      const defaultKB = [
        { id: "KB0001", title: "VPN Connection Troubleshooting", category: "Network", content: "1. Check internet connectivity.\n2. Restart VPN client.\n3. Verify credentials.\n4. Try alternate VPN server.\n5. Contact IT if issue persists.", status: "Published", author: "System", created: new Date().toISOString() },
        { id: "KB0002", title: "Password Reset Procedure", category: "Security", content: "1. Go to https://portal.office.com.\n2. Click 'Can't access your account?'\n3. Follow MFA verification steps.\n4. Set new password (min 12 chars).\n5. Update saved passwords.", status: "Published", author: "System", created: new Date().toISOString() },
        { id: "KB0003", title: "New Employee IT Onboarding", category: "General", content: "1. Submit onboarding form via ServiceDesk.\n2. IT provisions laptop, email, and VPN.\n3. Install required software (Teams, Office 365).\n4. Complete security awareness training.\n5. Set up MFA on mobile device.", status: "Published", author: "System", created: new Date().toISOString() },
        { id: "KB0004", title: "Printer Setup Guide", category: "End User Computing", content: "1. Open Settings > Printers & Scanners.\n2. Click 'Add a printer'.\n3. Select network printer from list.\n4. Install driver if prompted.\n5. Print test page to verify.", status: "Published", author: "System", created: new Date().toISOString() },
        { id: "KB0005", title: "Email Signature Configuration", category: "Application Support", content: "1. Open Outlook > File > Options > Mail > Signatures.\n2. Create new signature with company template.\n3. Add name, title, phone, and logo.\n4. Set as default for new messages and replies.\n5. Test by sending email to yourself.", status: "Published", author: "System", created: new Date().toISOString() },
      ];
      for (const kb of defaultKB) {
        await db.upsert("kb", kb.id, JSON.stringify(kb));
      }
      console.log(`[Seed] Created ${defaultKB.length} default KB articles`);
    }

    // Seed enterprise KB documentation articles if KB0010 doesn't exist
    try {
      const kb10 = await db.getOne("kb", "KB0010");
      if (!kb10) {
        const enterpriseKB = require("./kb-enterprise-articles.json");
        for (const kb of enterpriseKB) {
          await db.upsert("kb", kb.id, JSON.stringify(kb));
        }
        console.log(`[Seed] Created ${enterpriseKB.length} enterprise KB articles (KB0010-KB0018)`);
      }
    } catch (e) { console.log("[Seed] Enterprise KB seed skipped:", e.message); }

    // Seed default incident templates if none exist
    if (!stats.incident_templates || stats.incident_templates === 0) {
      const defaultTemplates = [
        { id: "TPL-001", name: "Password Reset", title: "Password Reset Request", category: "Access", priority: "Sev-C", description: "User requires a password reset for their account.", assignee: "", assignmentGroup: "Service Desk" },
        { id: "TPL-002", name: "VPN Connectivity Issue", title: "VPN Connection Failure", category: "Network", priority: "Sev-B", description: "User is unable to connect to the corporate VPN.", assignee: "", assignmentGroup: "Network Team" },
        { id: "TPL-003", name: "New Employee Onboarding", title: "IT Onboarding — New Hire Setup", category: "General", priority: "Sev-D", description: "Set up laptop, email, VPN, and required software for new employee.", assignee: "", assignmentGroup: "Service Desk" },
        { id: "TPL-004", name: "Email / Outlook Issue", title: "Email Not Working — Outlook", category: "Email", priority: "Sev-C", description: "User reports issues with sending or receiving email in Outlook.", assignee: "", assignmentGroup: "Service Desk" },
        { id: "TPL-005", name: "Hardware Failure", title: "Hardware Malfunction Report", category: "Hardware", priority: "Sev-B", description: "A hardware device (laptop, monitor, peripheral) is malfunctioning or not working.", assignee: "", assignmentGroup: "Desktop Support" },
      ];
      for (const tpl of defaultTemplates) {
        await db.upsert("incident_templates", tpl.id, JSON.stringify(tpl));
      }
      console.log(`[Seed] Created ${defaultTemplates.length} default incident templates`);
    }

    // Seed default approval chains if none exist
    if (!stats.approval_chains || stats.approval_chains === 0) {
      const defaultChains = [
        { id: "AC-001", name: "Standard Change Approval", trigger: { collection: "changes", condition: "riskLevel !== 'Low'" }, levels: [{ level: 1, role: "Service Desk Lead", type: "any", timeout: 24 }, { level: 2, role: "Change Manager", type: "all", timeout: 48 }], onTimeout: "escalate", active: true },
        { id: "AC-002", name: "Emergency Change Approval", trigger: { collection: "changes", condition: "type === 'Emergency'" }, levels: [{ level: 1, role: "Change Manager", type: "any", timeout: 4 }], onTimeout: "escalate", active: true },
        { id: "AC-003", name: "High-Value Request Approval", trigger: { collection: "requests", condition: "priority === 'Sev-A' || priority === 'Sev-B'" }, levels: [{ level: 1, role: "Service Desk Lead", type: "any", timeout: 24 }, { level: 2, role: "Tenant Admin", type: "any", timeout: 48 }], onTimeout: "escalate", active: true },
      ];
      for (const chain of defaultChains) {
        await db.upsert("approval_chains", chain.id, JSON.stringify(chain));
      }
      console.log(`[Seed] Created ${defaultChains.length} default approval chains`);
    }

    // Seed email_whitelist from customer domains if empty
    if (!stats.email_whitelist || stats.email_whitelist === 0) {
      try {
        const custRows = await db.getAll("customers");
        const seenDomains = new Set(["vgctechnology.com", "vgcsg.com"]);
        let seeded = 0;
        for (const row of custRows) {
          try {
            const cust = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
            const domain = (cust.email || "").split("@")[1]?.toLowerCase();
            if (domain && !seenDomains.has(domain)) {
              seenDomains.add(domain);
              const wlId = `WL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
              await db.upsert("email_whitelist", wlId, JSON.stringify({
                id: wlId, type: "domain", value: domain,
                label: cust.company || cust.name || domain,
                addedBy: "System (auto-import)", addedAt: new Date().toISOString(),
              }));
              seeded++;
            }
          } catch {}
        }
        // Always add internal domains
        for (const intDomain of ["vgctechnology.com", "vgcsg.com"]) {
          const wlId = `WL-INT-${intDomain.replace(/\./g, "-")}`;
          await db.upsert("email_whitelist", wlId, JSON.stringify({
            id: wlId, type: "domain", value: intDomain,
            label: "VGC Internal", addedBy: "System", addedAt: new Date().toISOString(), internal: true,
          }));
        }
        if (seeded > 0) console.log(`[Seed] Created ${seeded + 2} email whitelist entries (${seeded} customer domains + 2 internal)`);
        else console.log(`[Seed] Created 2 internal email whitelist entries`);
      } catch (e) { console.warn("[Seed] Email whitelist seed failed:", e.message); }
    }

    // ─── Seed SG 2026 Public Holidays ───────────────────────────────
    try {
      const hRow = await db.getOne("sg_holidays", "holidays_2026");
      if (!hRow) {
        const holidays2026 = { year: 2026, holidays: [
          { date: "2026-01-01", name: "New Year's Day" },
          { date: "2026-01-29", name: "Chinese New Year" },
          { date: "2026-01-30", name: "Chinese New Year (Day 2)" },
          { date: "2026-03-31", name: "Hari Raya Puasa" },
          { date: "2026-04-03", name: "Good Friday" },
          { date: "2026-05-01", name: "Labour Day" },
          { date: "2026-05-12", name: "Vesak Day" },
          { date: "2026-06-07", name: "Hari Raya Haji" },
          { date: "2026-08-09", name: "National Day" },
          { date: "2026-10-20", name: "Deepavali" },
          { date: "2026-12-25", name: "Christmas Day" },
        ]};
        await db.upsert("sg_holidays", "holidays_2026", JSON.stringify(holidays2026));
        // Also set holidays in SLA policy
        const existingPolicy = await db.getOne("sla_config", "active_policy");
        const policy = existingPolicy ? JSON.parse(existingPolicy.data) : {};
        if (!policy.holidays || policy.holidays.length === 0) {
          policy.holidays = holidays2026.holidays.map(h => h.date);
          await db.upsert("sla_config", "active_policy", JSON.stringify(policy));
        }
        console.log(`[Seed] Created SG 2026 public holidays (${holidays2026.holidays.length} holidays)`);
      }
    } catch (e) { console.warn("[Seed] SG holidays seed failed:", e.message); }

    // ─── Auto-create setup_completed for existing deployments ───────
    try {
      const setupRow = await db.getOne("tenant_settings", "setup_completed");
      if (!setupRow) {
        const incCount = await db.count("incidents");
        if (incCount > 0) {
          await db.upsert("tenant_settings", "setup_completed", JSON.stringify({ completed: true, at: new Date().toISOString(), auto: true }));
          console.log("[Setup] Existing deployment detected — marked setup as completed");
        }
      }
    } catch (e) { console.warn("[Setup] Auto-complete check failed:", e.message); }

    // ─── SLA Data Migration: Backfill Missing Fields ────────────────
    try {
      const allIncRows = await db.getAll("incidents");
      const slaMap = getSlaMap();
      let backfilled = 0;
      for (const row of allIncRows) {
        try {
          const inc = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (!inc || !inc.id) continue;
          let changed = false;

          // Backfill slaTarget from SLA policy if missing
          if (inc.slaTarget === undefined || inc.slaTarget === null) {
            inc.slaTarget = slaMap[inc.priority] || slaMap["Sev-C"] || 9;
            changed = true;
          }

          // Backfill created if missing (set to 0 for business-hours computation from createdAt)
          if (inc.created === undefined || inc.created === null) {
            inc.created = 0;
            changed = true;
          }

          // Backfill createdAt from activityLog if missing
          if (!inc.createdAt && Array.isArray(inc.activityLog) && inc.activityLog.length > 0) {
            const firstEntry = inc.activityLog.find(a => a.type === "created" || a.type === "sync");
            if (firstEntry && firstEntry.time) {
              inc.createdAt = firstEntry.time;
              changed = true;
            }
          }

          // Backfill resolvedAt for Resolved/Closed incidents
          if ((inc.status === "Resolved" || inc.status === "Closed") && !inc.resolvedAt) {
            // Try to derive from activity log
            if (Array.isArray(inc.activityLog)) {
              const resolveEntry = [...inc.activityLog].reverse().find(a =>
                a.detail && (a.detail.includes("Resolved") || a.detail.includes("Closed") || a.detail.includes("resolved"))
              );
              if (resolveEntry && resolveEntry.time) {
                inc.resolvedAt = resolveEntry.time;
                changed = true;
              }
            }
            // Fallback: use updatedAt or zdLastSync
            if (!inc.resolvedAt) {
              inc.resolvedAt = inc.updatedAt || inc.zdLastSync || new Date().toISOString();
              changed = true;
            }
          }

          if (changed) {
            await db.upsert("incidents", inc.id, JSON.stringify(inc));
            backfilled++;
          }
        } catch {}
      }
      if (backfilled > 0) console.log(`[SLA Migration] Backfilled ${backfilled} incidents with missing SLA fields`);
    } catch (e) { console.warn("[SLA Migration] Failed:", e.message); }

    // ─── Daily AI Knowledge Sync (every 24h) ────────────────────────
    const runDailySync = async () => {
      try {
        console.log("[Daily Sync] Starting AI knowledge sync...");
        const https = require("https");
        const syncReq = require("http").request({ hostname: "localhost", port: PORT, path: "/api/ai/knowledge/sync", method: "POST", headers: { "Content-Type": "application/json" } }, (r) => {
          let data = ""; r.on("data", c => data += c);
          r.on("end", () => console.log("[Daily Sync] Result:", data.substring(0, 200)));
        });
        syncReq.on("error", e => console.warn("[Daily Sync] Error:", e.message));
        syncReq.write("{}"); syncReq.end();
      } catch (e) { console.warn("[Daily Sync] Failed:", e.message); }
    };

    // Hydrate zdLastSyncTime from DB (find latest ZD-synced incident)
    try {
      const allInc = await db.getAll("incidents");
      const zdIncs = allInc
        .map(row => { try { return typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch { return null; } })
        .filter(i => i && i.zdTicketId)
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      if (zdIncs.length > 0 && zdIncs[0].updatedAt) {
        zdLastSyncTime = zdIncs[0].updatedAt;
        console.log(`[ZD Sync] Hydrated zdLastSyncTime from DB: ${zdLastSyncTime}`);
      }
    } catch (e) { console.warn("[ZD Sync] Could not hydrate zdLastSyncTime:", e.message); }

    // Start SLA Engine (scheduler worker only — cron-style work)
    if (IS_SCHEDULER_WORKER) {
      slaEngine.start().catch(err => console.error("[SLA Engine] Start failed:", err.message));

      // Daily SLA history snapshot (every 24h, first run after 5 min)
      const SLA_SNAPSHOT_INTERVAL = 24 * 60 * 60 * 1000;
      const runSlaDailySnapshot = () => {
        if (slaEngine && slaEngine.saveDailySnapshot) {
          slaEngine.saveDailySnapshot().catch(e => console.warn("[SLA Snapshot] Failed:", e.message));
        }
      };
      setTimeout(runSlaDailySnapshot, 5 * 60 * 1000);
      const slaSnapshotInterval = setInterval(runSlaDailySnapshot, SLA_SNAPSHOT_INTERVAL);
      _shutdownIntervals.push(slaSnapshotInterval);
      console.log("[SLA Engine] Daily SLA history snapshots enabled");

      // Start Workflow Engine
      workflowEngine.start().catch(err => console.error("[WorkflowEngine] Start failed:", err.message));
    } else {
      console.log(`[Cluster] Worker idx=${process.env.WORKER_INDEX} skipping SLA/Workflow scheduled jobs`);
    }

    // Wrap SLA Guardian / ZD AutoSync / Cleanup / Purge / Uptime jobs in
    // the scheduler-worker gate too. Previously these ran on every worker,
    // duplicating writes (visible as paired "[Uptime] Running initial snapshot..." etc.).
    if (IS_SCHEDULER_WORKER) {

    // ─── SLA Guardian: Proactive SLA prediction scan (every 15 min) ──
    const SLA_GUARDIAN_INTERVAL = 15 * 60 * 1000; // 15 minutes
    let slaGuardianRunning = false;
    const runSlaGuardian = async () => {
      if (slaGuardianRunning) return;
      slaGuardianRunning = true;
      try {
        const incRows = await db.getAll("incidents");
        const openIncidents = incRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } })
          .filter(i => i && !i._deleted && !["Resolved", "Closed"].includes(i.status));
        if (openIncidents.length === 0) { slaGuardianRunning = false; return; }

        const payload = JSON.stringify({ incidents: openIncidents, requestedBy: "SLA Guardian Cron" });
        const predReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/sla-predict", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (predRes) => {
          let d = ""; predRes.on("data", c => d += c);
          predRes.on("end", () => {
            try {
              const result = JSON.parse(d);
              const atRiskCount = (result.actions || []).length;
              if (atRiskCount > 0 && wsServer) {
                wsServer.broadcast("sla_guardian", { action: "sla_risk_detected", atRiskCount, predictions: result.predictions, source: "scheduled_scan" });
              }
              console.log(`[SLA Guardian] Scan complete: ${openIncidents.length} open tickets, ${result.predictions?.length || 0} at risk, ${atRiskCount} new actions`);
            } catch (parseErr) {
              console.warn("[SLA Guardian] Parse error:", parseErr.message);
            }
            slaGuardianRunning = false;
          });
        });
        predReq.on("error", e => { console.warn("[SLA Guardian] Request error:", e.message); slaGuardianRunning = false; });
        predReq.setTimeout(60000, () => { predReq.destroy(); slaGuardianRunning = false; });
        predReq.write(payload);
        predReq.end();
      } catch (e) {
        console.warn("[SLA Guardian] Scan failed:", e.message);
        slaGuardianRunning = false;
      }
    };
    // Run initial scan after 2 min delay, then every 15 min
    const slaGuardianStartTimer = setTimeout(() => {
      runSlaGuardian();
      const slaGuardianInterval = setInterval(runSlaGuardian, SLA_GUARDIAN_INTERVAL);
      _shutdownIntervals.push(slaGuardianInterval);
    }, 2 * 60 * 1000);
    _shutdownTimeouts.push(slaGuardianStartTimer);
    console.log("[SLA Guardian] Proactive SLA prediction scheduled every 15 minutes");

    // ─── v3.14 Layer 3: Adaptive Zendesk Incremental Sync ──────────
    // Cadence based on open severity load:
    //   60s  if any open Sev-A
    //   120s if any open Sev-B (no Sev-A)
    //   300s otherwise (default)
    if (ZENDESK_SUBDOMAIN && ZENDESK_EMAIL && ZENDESK_API_TOKEN) {
      let _zdCurrentDelay = 300000;
      const computeZdDelay = async () => {
        try {
          const rows = incidentIndex && incidentIndex.size && incidentIndex.size() > 0
            ? incidentIndex.all()
            : (await db.getAll("incidents")).map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
          let hasA = false, hasB = false;
          const openStatuses = new Set(["New", "Open", "In Progress", "Pending"]);
          for (const inc of rows) {
            if (!openStatuses.has(inc.status)) continue;
            if (inc.priority === "Sev-A") { hasA = true; break; }
            if (inc.priority === "Sev-B") hasB = true;
          }
          return hasA ? 60000 : (hasB ? 120000 : 300000);
        } catch { return 300000; }
      };
      const scheduleZdSync = (delay) => {
        _zdCurrentDelay = delay;
        zdAutoSyncInterval = setTimeout(async () => {
          if (zdSyncInProgress) {
            console.log("[ZD AutoSync] Skipped — sync already in progress");
          } else {
            try {
              console.log(`[ZD AutoSync] Starting scheduled incremental sync (cadence ${Math.round(delay/1000)}s)...`);
              const http = require("http");
              const syncReq = http.request({ hostname: "localhost", port: PORT, path: "/api/zendesk/incremental-sync", method: "POST", headers: { "Content-Type": "application/json" } }, (r) => {
                let data = ""; r.on("data", c => data += c);
                r.on("end", () => console.log("[ZD AutoSync] Result:", data.substring(0, 300)));
              });
              syncReq.on("error", e => console.warn("[ZD AutoSync] Error:", e.message));
              syncReq.write("{}"); syncReq.end();
            } catch (e) { console.warn("[ZD AutoSync] Failed:", e.message); }
          }
          const next = await computeZdDelay();
          if (next !== _zdCurrentDelay) console.log(`[ZD AutoSync] Adaptive cadence: ${Math.round(_zdCurrentDelay/1000)}s → ${Math.round(next/1000)}s`);
          scheduleZdSync(next);
        }, delay);
      };
      scheduleZdSync(300000);
      console.log("[ZD AutoSync] Adaptive Zendesk incremental sync scheduled (60s/120s/300s based on open Sev-A/B load)");
    }

    // NOTE: the IS_SCHEDULER_WORKER block remains open here so the periodic
    // cleanup / purge / uptime jobs below also run only on the scheduler worker.
    // (Previously these ran on every worker, doubling DB writes.)
    // -- (the closing brace of `if (IS_SCHEDULER_WORKER) {` is intentionally
    //    moved down past the uptime block below.)

    // ─── Scheduled Queue Cleanup (every 6 hours) ────────────────────
    const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
    const runQueueCleanup = async () => {
      const startTime = Date.now();
      try {
        const maxAgeDays = AI_THRESHOLDS.staleDays;
        const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
        const incRows = await db.getAll("incidents");
        const resolvedIds = new Set();
        for (const r of incRows) {
          try {
            const inc = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            if (inc && ["Resolved", "Closed"].includes(inc.status)) resolvedIds.add(inc.id);
          } catch {}
        }
        const actionRows = await db.getAll("ai_actions");
        let deleted = 0;
        let cappedDel = 0;
        // Collect pending items for potential cap enforcement
        const pendingItems = [];
        for (const r of actionRows) {
          try {
            const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            if (!item || item.status !== "pending_approval") continue;
            const isStale = (item.createdAt && item.createdAt < cutoff);
            const incResolved = item.incidentId && resolvedIds.has(item.incidentId);
            if (isStale || incResolved) {
              // Direct delete instead of dismiss→delete cycle
              await db.deleteOne("ai_actions", item.id);
              deleted++;
            } else {
              pendingItems.push(item);
            }
          } catch {}
        }
        // Cap enforcement: if still over maxPendingTotal, delete oldest by createdAt
        if (pendingItems.length > AI_THRESHOLDS.maxPendingTotal) {
          pendingItems.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
          const excess = pendingItems.length - AI_THRESHOLDS.maxPendingTotal;
          for (let i = 0; i < excess; i++) {
            await db.deleteOne("ai_actions", pendingItems[i].id);
            cappedDel++;
          }
        }
        const totalRemoved = deleted + cappedDel;
        if (totalRemoved > 0) {
          if (cacheLayer) cacheLayer.invalidatePrefix("ai_actions");
          console.log(`[Scheduled Cleanup] Deleted ${deleted} stale + ${cappedDel} over-cap ai_actions (staleDays: ${maxAgeDays}, cap: ${AI_THRESHOLDS.maxPendingTotal}, resolved: ${resolvedIds.size})`);
        } else {
          console.log(`[Scheduled Cleanup] No stale items found`);
        }
        purgeStatus.queueCleanup.lastRun = new Date().toISOString();
        purgeStatus.queueCleanup.lastResult = { deleted, cappedDel, resolvedIncidents: resolvedIds.size, remaining: pendingItems.length - cappedDel, durationMs: Date.now() - startTime };
        purgeStatus.queueCleanup.totalDismissed += totalRemoved;
        purgeStatus.queueCleanup.runCount++;
        purgeStatus.queueCleanup.nextRun = new Date(Date.now() + CLEANUP_INTERVAL).toISOString();
      } catch (e) {
        console.warn("[Scheduled Cleanup] Error:", e.message);
        purgeStatus.queueCleanup.lastRun = new Date().toISOString();
        purgeStatus.queueCleanup.lastResult = { error: e.message };
      }
    };
    const queueCleanupInterval = setInterval(runQueueCleanup, CLEANUP_INTERVAL);
    _shutdownIntervals.push(queueCleanupInterval);

    // ─── Scheduled Log Purge (every 6 hours, after queue cleanup) ───
    const LOG_PURGE_INTERVAL = 6 * 60 * 60 * 1000;
    const runLogPurge = async () => {
      const startTime = Date.now();
      try {
        const keepDays = 2;
        const cutoff = new Date(Date.now() - keepDays * 86400000);
        const logColls = ["escalation_log", "notifications", "email_rejections"];
        const collResults = {};
        for (const coll of logColls) {
          const rows = await db.getAll(coll);
          let deleted = 0;
          for (const r of rows) {
            try {
              const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              const tsRaw = item.timestamp || item.createdAt || item.time || item.created || item.escalatedAt || item.date || item.sentAt || item.rejectedAt || "";
              let isOld = false;
              if (tsRaw) { const d = new Date(tsRaw); isOld = isNaN(d.getTime()) || d < cutoff; }
              else { isOld = true; }
              if (isOld) { await db.deleteOne(coll, r.id || item.id); deleted++; }
            } catch {}
          }
          if (deleted > 0) { collResults[coll] = deleted; console.log(`[Scheduled Purge] ${coll}: deleted ${deleted}/${rows.length} old records`); }
        }
        // Permanently delete dismissed ai_actions/ai_workflow_queue
        for (const coll of ["ai_actions", "ai_workflow_queue", "ai_resolve_queue"]) {
          const rows = await db.getAll(coll);
          let deleted = 0;
          for (const r of rows) {
            try {
              const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              if (item && item.status === "dismissed") { await db.deleteOne(coll, r.id || item.id); deleted++; }
            } catch {}
          }
          if (deleted > 0) { collResults[coll + "_dismissed"] = deleted; console.log(`[Scheduled Purge] ${coll}: deleted ${deleted} dismissed records`); }
        }
        if (cacheLayer) { ["escalation_log", "notifications", "email_rejections", "ai_actions", "ai_workflow_queue", "ai_resolve_queue"].forEach(c => cacheLayer.invalidatePrefix(c)); }
        const totalDeleted = Object.values(collResults).reduce((a, b) => a + b, 0);
        purgeStatus.logPurge.lastRun = new Date().toISOString();
        purgeStatus.logPurge.lastResult = { ...collResults, totalDeleted, durationMs: Date.now() - startTime };
        purgeStatus.logPurge.totalDeleted += totalDeleted;
        purgeStatus.logPurge.runCount++;
        purgeStatus.logPurge.nextRun = new Date(Date.now() + LOG_PURGE_INTERVAL).toISOString();
      } catch (e) {
        console.warn("[Scheduled Purge] Error:", e.message);
        purgeStatus.logPurge.lastRun = new Date().toISOString();
        purgeStatus.logPurge.lastResult = { error: e.message };
      }
    };
    const logPurgeInterval = setInterval(runLogPurge, LOG_PURGE_INTERVAL);
    _shutdownIntervals.push(logPurgeInterval);

    // ─── Scheduled Terminal-Status AI Actions Purge (every 6 hours) ──
    // Deletes auto_applied, auto_approved, approved, executed, rejected records older than 7 days
    const TERMINAL_PURGE_INTERVAL = 6 * 60 * 60 * 1000;
    const TERMINAL_STATUSES = new Set(["auto_applied", "auto_approved", "approved", "executed", "rejected", "failed"]);
    const TERMINAL_KEEP_DAYS = parseInt(process.env.TERMINAL_KEEP_DAYS || "7", 10);
    const MAX_AI_ACTIONS = parseInt(process.env.MAX_AI_ACTIONS || "500", 10); // cap: if still over limit after age-based purge, delete oldest terminal records
    const runTerminalPurge = async () => {
      const startTime = Date.now();
      try {
        const cutoff = new Date(Date.now() - TERMINAL_KEEP_DAYS * 86400000).toISOString();
        const rows = await db.getAll("ai_actions");
        let deleted = 0;

        // Pass 1: delete terminal-status records older than retention
        for (const r of rows) {
          try {
            const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            if (!item) continue;
            if (!TERMINAL_STATUSES.has(item.status)) continue;
            const ts = item.createdAt || item.approvedAt || item.executedAt || "";
            if (ts && ts < cutoff) {
              await db.deleteOne("ai_actions", r.id || item.id);
              deleted++;
            }
          } catch {}
        }

        // Pass 2: if still over MAX_AI_ACTIONS, delete oldest terminal records regardless of age
        let cappedDeleted = 0;
        if (rows.length - deleted > MAX_AI_ACTIONS) {
          const remaining = [];
          const freshRows = await db.getAll("ai_actions");
          for (const r of freshRows) {
            try {
              const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              if (item && TERMINAL_STATUSES.has(item.status)) {
                remaining.push({ id: r.id || item.id, ts: item.createdAt || item.approvedAt || "1970-01-01" });
              }
            } catch {}
          }
          remaining.sort((a, b) => a.ts.localeCompare(b.ts)); // oldest first
          const excess = freshRows.length - MAX_AI_ACTIONS;
          for (let i = 0; i < Math.min(excess, remaining.length); i++) {
            await db.deleteOne("ai_actions", remaining[i].id);
            cappedDeleted++;
          }
        }

        if (deleted > 0 || cappedDeleted > 0) {
          if (cacheLayer) cacheLayer.invalidatePrefix("ai_actions");
          console.log(`[Terminal Purge] Deleted ${deleted} old terminal-status ai_actions (>${TERMINAL_KEEP_DAYS}d) + ${cappedDeleted} cap-overflow`);
        } else {
          console.log(`[Terminal Purge] No terminal-status records to purge`);
        }
        purgeStatus.terminalPurge.lastRun = new Date().toISOString();
        purgeStatus.terminalPurge.lastResult = { deletedAge: deleted, deletedCap: cappedDeleted, total: deleted + cappedDeleted, durationMs: Date.now() - startTime };
        purgeStatus.terminalPurge.totalDeleted += deleted + cappedDeleted;
        purgeStatus.terminalPurge.runCount++;
        purgeStatus.terminalPurge.nextRun = new Date(Date.now() + TERMINAL_PURGE_INTERVAL).toISOString();
      } catch (e) {
        console.warn("[Terminal Purge] Error:", e.message);
        purgeStatus.terminalPurge.lastRun = new Date().toISOString();
        purgeStatus.terminalPurge.lastResult = { error: e.message };
      }
    };
    const terminalPurgeInterval = setInterval(runTerminalPurge, TERMINAL_PURGE_INTERVAL);
    _shutdownIntervals.push(terminalPurgeInterval);

    // ─── Scheduled Audit Log Purge (every 6 hours, keep 30 days) ────
    const AUDIT_PURGE_INTERVAL = 6 * 60 * 60 * 1000;
    const AUDIT_KEEP_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS || "30", 10);
    const runAuditPurge = async () => {
      const startTime = Date.now();
      try {
        let deleted = 0;
        if (db.pruneAudit) {
          deleted = await db.pruneAudit(AUDIT_KEEP_DAYS);
        } else {
          // Fallback: load and delete old audit records manually
          const audits = await db.getAllAudit(100000);
          const cutoff = new Date(Date.now() - AUDIT_KEEP_DAYS * 86400000);
          for (const a of audits) {
            const ts = a.timestamp || a.created;
            if (ts && new Date(ts) < cutoff) {
              // audit_log uses auto-increment id, no deleteOne via collection
              deleted++;
            }
          }
        }
        if (deleted > 0) {
          console.log(`[Audit Purge] Pruned ${deleted} audit_log records older than ${AUDIT_KEEP_DAYS} days`);
        } else {
          console.log(`[Audit Purge] No old audit records to purge`);
        }
        purgeStatus.auditPurge.lastRun = new Date().toISOString();
        purgeStatus.auditPurge.lastResult = { deleted, keepDays: AUDIT_KEEP_DAYS, durationMs: Date.now() - startTime };
        purgeStatus.auditPurge.totalDeleted += deleted;
        purgeStatus.auditPurge.runCount++;
        purgeStatus.auditPurge.nextRun = new Date(Date.now() + AUDIT_PURGE_INTERVAL).toISOString();
      } catch (e) {
        console.warn("[Audit Purge] Error:", e.message);
        purgeStatus.auditPurge.lastRun = new Date().toISOString();
        purgeStatus.auditPurge.lastResult = { error: e.message };
      }
    };
    const auditPurgeInterval = setInterval(runAuditPurge, AUDIT_PURGE_INTERVAL);
    _shutdownIntervals.push(auditPurgeInterval);

    // Run once on startup with staggered delays
    setTimeout(() => {
      console.log("[Scheduled Cleanup] Running initial cleanup...");
      runQueueCleanup();
    }, 60000);
    setTimeout(() => {
      console.log("[Scheduled Purge] Running initial log purge...");
      runLogPurge();
    }, 90000);
    setTimeout(() => {
      console.log("[Terminal Purge] Running initial terminal-status purge...");
      runTerminalPurge();
    }, 120000);
    setTimeout(() => {
      console.log("[Audit Purge] Running initial audit log purge...");
      runAuditPurge();
    }, 150000);

    // ─── Uptime Snapshot (hourly) ───────────────────────────────────
    const UPTIME_INTERVAL = 60 * 60 * 1000; // 1 hour
    const runUptimeSnapshot = async () => {
      try {
        let dbOk = false;
        try { dbOk = await db.ping(); } catch {}
        const slaOk = slaEngine ? !!slaEngine.timer : false;
        const allOk = dbOk && slaOk;
        const snapshot = {
          id: `uptime_${Date.now()}`,
          timestamp: new Date().toISOString(),
          status: allOk ? "ok" : (dbOk ? "degraded" : "down"),
          components: {
            database: dbOk ? "ok" : "down",
            slaEngine: slaOk ? "ok" : "stopped",
            wsConnections: wsServer ? wsServer.getStats().totalConnections : 0,
          },
          processUptime: Math.round(process.uptime()),
          memoryMB: Math.round(process.memoryUsage().rss / 1048576),
        };
        await db.upsert("uptime_log", snapshot.id, JSON.stringify(snapshot));
        console.log(`[Uptime] Snapshot: ${snapshot.status} (db=${dbOk}, sla=${slaOk})`);

        // Prune uptime_log older than 90 days (batch limit to avoid large scans)
        const cutoff90 = Date.now() - 90 * 86400000;
        const allLogs = await db.getAll("uptime_log");
        let pruned = 0;
        const PRUNE_BATCH = 100;
        for (const r of allLogs) {
          if (pruned >= PRUNE_BATCH) break;
          try {
            const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            if (item && item.timestamp && new Date(item.timestamp).getTime() < cutoff90) {
              await db.deleteOne("uptime_log", r.id || item.id);
              pruned++;
            }
          } catch {}
        }
        if (pruned > 0) console.log(`[Uptime] Pruned ${pruned} snapshots older than 90 days${pruned >= PRUNE_BATCH ? " (batch limit reached, more next cycle)" : ""}`);
      } catch (e) {
        console.warn("[Uptime] Snapshot error:", e.message);
      }
    };
    const uptimeInterval = setInterval(runUptimeSnapshot, UPTIME_INTERVAL);
    _shutdownIntervals.push(uptimeInterval);
    setTimeout(() => {
      console.log("[Uptime] Running initial snapshot...");
      runUptimeSnapshot();
    }, 30000);
    console.log("[Uptime] Hourly uptime snapshots enabled");

    // Set initial nextRun times
    purgeStatus.queueCleanup.nextRun = new Date(Date.now() + 60000).toISOString();
    purgeStatus.logPurge.nextRun = new Date(Date.now() + 90000).toISOString();
    purgeStatus.terminalPurge.nextRun = new Date(Date.now() + 120000).toISOString();
    purgeStatus.auditPurge.nextRun = new Date(Date.now() + 150000).toISOString();
    console.log("[Scheduled Cleanup] Queue auto-cleanup every 6 hours");
    console.log("[Scheduled Purge] Log auto-purge every 6 hours (keep 2 days)");
    console.log("[Terminal Purge] Terminal-status purge every 6 hours (keep 7 days, cap 500)");
    console.log("[Audit Purge] Audit log purge every 6 hours (keep " + AUDIT_KEEP_DAYS + " days)");

    // ─── Daily AI Knowledge Sync (every 6h, first run 5 min after boot) ──
    // Scans recent tickets/email bodies and refreshes/creates KB articles
    // via the existing /api/ai/knowledge/sync endpoint (incidentIndex.js).
    const KB_SYNC_INTERVAL = 6 * 60 * 60 * 1000;
    const kbSyncTimer = setTimeout(() => {
      runDailySync();
      const kbSyncInterval = setInterval(runDailySync, KB_SYNC_INTERVAL);
      _shutdownIntervals.push(kbSyncInterval);
    }, 5 * 60 * 1000);
    _shutdownTimeouts.push(kbSyncTimer);
    console.log("[KB AI Sync] AI knowledge auto-refresh every 6 hours (first run in 5 min)");
    } else {
      console.log(`[Cluster] Worker idx=${process.env.WORKER_INDEX} skipping cleanup/purge/uptime jobs`);
    }
  });
}
start().catch(err => { console.error("Fatal startup error:", err); process.exit(1); });

// Graceful shutdown
const _gracefulShutdown = (signal) => {
  console.log(`[Shutdown] Received ${signal || "signal"}, draining...`);
  // Stop accepting new requests, drain in-flight ones
  let exited = false;
  const finalize = () => {
    if (exited) return;
    exited = true;
    try { _shutdownIntervals.forEach(h => { try { clearInterval(h); } catch {} }); } catch {}
    try { _shutdownTimeouts.forEach(h => { try { clearTimeout(h); } catch {} }); } catch {}
    if (zdAutoSyncInterval) clearInterval(zdAutoSyncInterval);
    if (workflowEngine) workflowEngine.stop();
    if (cacheLayer) cacheLayer.stop();
    if (wsServer) wsServer.stop();
    if (slaEngine) slaEngine.stop();
    db.close();
    console.log("[Shutdown] Complete");
    process.exit(0);
  };
  try { server.close(finalize); } catch { finalize(); }
  // Force-exit fallback if drain takes too long
  setTimeout(() => { console.warn("[Shutdown] Force-exit after 10s drain timeout"); finalize(); }, 10000).unref?.();
};
process.on("SIGINT", () => _gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => _gracefulShutdown("SIGTERM"));
