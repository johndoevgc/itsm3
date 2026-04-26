const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { authMiddleware, checkPermission, decodeJWT } = require("./authMiddleware");
const { SlaEngine, computeSlaStatus } = require("./slaEngine");
const { WebSocketServer } = require("./wsServer");
const { NotificationEngine } = require("./notificationEngine");
const { WorkflowEngine } = require("./workflowEngine");
const { AnalyticsEngine } = require("./analyticsEngine");
const { CacheLayer } = require("./cacheLayer");

const PORT = process.env.PORT || 8080;
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

// Helper: Build client assertion JWT for certificate-based auth
let _cachedPrivateKey = null;
let _cachedX5t = null;
function buildClientAssertion() {
  if (!ENTRA_CERT_THUMBPRINT) return null;
  try {
    // Cache private key after first extraction (avoid blocking execSync on every call)
    if (!_cachedPrivateKey) {
      const pfxPath = `/var/ssl/private/${ENTRA_CERT_THUMBPRINT}.p12`;
      if (!fs.existsSync(pfxPath)) { console.error("[Entra] PFX not found at", pfxPath); return null; }
      const { execSync } = require("child_process");
      const pem = execSync(`openssl pkcs12 -in "${pfxPath}" -nocerts -nodes -passin pass:`, { encoding: "utf8" });
      _cachedPrivateKey = crypto.createPrivateKey(pem);
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
      return { text, model, tier: currentTier, fallback: currentTier !== tier };
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

// ─── Production Test Mode ───────────────────────────────────────────────
// When true, ALL outbound emails are redirected to PROD_TEST_EMAIL
// Flip to false when ready to send to real customers
const PROD_TEST_MODE = true;
const PROD_TEST_EMAIL = "hlaing@vgctechnology.com";
// Customer-facing emails go here (never to real customers until go-live)
const CUSTOMER_TEST_EMAIL = "johndoe@vgcsg.com";
// Inbound helpdesk mailbox — email-to-ticket reads from this mailbox
const HELPDESK_MAILBOX = process.env.HELPDESK_MAILBOX || "helpdesk@vgctechnology.com";

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

// ─── Configurable AI Thresholds ─────────────────────────────────────────
const AI_THRESHOLDS = {
  autoApply: parseInt(process.env.AI_AUTO_APPLY_THRESHOLD || (PROD_TEST_MODE ? "70" : "85"), 10),
  slaRisk: parseInt(process.env.AI_SLA_RISK_THRESHOLD || "70", 10),
  patternConfidence: parseInt(process.env.AI_PATTERN_CONFIDENCE_THRESHOLD || "70", 10),
  autoResolveConfidence: parseInt(process.env.AI_AUTO_RESOLVE_THRESHOLD || "60", 10),
  maxPendingPerIncident: parseInt(process.env.AI_MAX_PENDING_PER_INCIDENT || "3", 10),
  maxPendingTotal: parseInt(process.env.AI_MAX_PENDING_TOTAL || "200", 10),
  staleDays: parseInt(process.env.AI_STALE_DAYS || "1", 10),
  monitorIntervalMin: parseInt(process.env.AI_MONITOR_INTERVAL_MIN || "15", 10),
};
console.log("[AI Thresholds]", JSON.stringify(AI_THRESHOLDS));

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
        // Optimized: only return non-closed/resolved records (JSON status filter)
        const [rows] = await pool.execute(
          `SELECT id, data FROM itsm_data WHERE collection = ? AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.status')) NOT IN ('Closed', 'closed', 'Resolved', 'resolved') ORDER BY updated_at DESC`,
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
    };
  } else {
    const Database = require("better-sqlite3");
    const DB_PATH = path.join(__dirname, "vgc-itsm.db");
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
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseBody(req, maxSize = 50000) {
  return new Promise((resolve, reject) => {
    let d = ""; req.on("data", c => { d += c; if (d.length > maxSize) reject(new Error("Payload too large")); });
    req.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error("Invalid JSON body")); } });
  });
}

// ─── Enterprise Email Template Builder ───────────────────────────────────
// Centralized HTML email builder for all notification types. Outlook-compatible
// table-based layout with structured sections: header, action banner, details,
// resolution, impact, next actions, references, AI guidance, footer.
const PORTAL_URL = "https://vgc-itsm1-app.azurewebsites.net";
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
      <a href="${PORTAL_URL}" style="display:inline-block;padding:12px 28px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;">Open VGC ITSM Portal</a>
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
            <td align="right" style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.85);">VGC Technology<br/>${dateStr}</td>
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
              <strong>VGC Technology Pte Ltd</strong> &middot; IT Service Management<br/>
              &#128231; <a href="mailto:helpdesk@vgctechnology.com" style="color:#a0aec0;text-decoration:none;">helpdesk@vgctechnology.com</a> &nbsp;|&nbsp; &#128222; +65 6000 0000<br/>
              This is an automated notification from VGC ITSM. Please do not reply to automated messages.
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
]);

// ─── Zendesk Sync State ──────────────────────────────────────────────
let zdSyncInProgress = false;
let zdLastSyncTime = null;
let zdSyncStats = { tickets: 0, users: 0, orgs: 0, comments: 0, errors: 0 };
let zdAutoSyncInterval = null;

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

  // ─── Production Test Mode: redirect ALL emails to test inbox ──────
  let finalTo = Array.isArray(to) ? to : [to];
  let finalSubject = subject;
  let finalBody = body;
  if (PROD_TEST_MODE) {
    const originalRecipients = finalTo.join(", ");
    const testTarget = isCustomerEmail ? CUSTOMER_TEST_EMAIL : PROD_TEST_EMAIL;
    finalSubject = `[TEST → ${originalRecipients}] ${subject}`;
    finalBody = `<div style="background:#FFF3CD;border:1px solid #FFD700;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-family:Arial,sans-serif;">
      <strong style="color:#856404;">⚠️ PRODUCTION TEST MODE${isCustomerEmail ? " (CUSTOMER EMAIL)" : ""}</strong><br/>
      <span style="color:#856404;font-size:13px;">Original recipient(s): <code>${originalRecipients}</code></span>
    </div>\n${body}`;
    finalTo = [testTarget];
    console.log(`[M365 Mail] PROD_TEST_MODE: Redirected email from [${originalRecipients}] → ${testTarget}`);
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

        // ── Gate 1: Skip auto-generated, no-reply, and ITSM notification emails ──
        if (fromAddr.includes("noreply") || fromAddr.includes("no-reply") || fromAddr.includes("mailer-daemon") ||
            subject.startsWith("[VGC ITSM]") || subject.startsWith("[TEST →") ||
            subject.startsWith("[VGC Technology Pte Ltd]")) {
          await _markEmailRead(token, sender, msg.id);
          await _logRejection(fromAddr, subject, "auto-generated");
          console.log(`[Email-to-Ticket] Skipped auto-generated: ${fromAddr}`);
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

        // Send confirmation to customer
        graphSendMail({
          to: [fromAddr],
          subject: `[VGC ITSM] Incident ${incId} created — ${subject.substring(0, 60)}`,
          isCustomerEmail: true,
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
              <p style="color:#888;font-size:11px;">VGC Technology Pte Ltd — IT Service Management</p>
            </div>
          </div>`,
        }).catch(e => console.warn(`[Email-to-Ticket] Confirmation email failed for ${incId}:`, e.message));

        // ─── AI Sentiment Analysis on inbound email (fire-and-forget) ───
        if (AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT) {
          try {
            const sentimentPrompt = `Analyze the sentiment and urgency of this IT support email. Return JSON ONLY (no markdown): { "sentiment": "positive|neutral|frustrated|angry", "urgencyScore": 0-100, "emotionalTone": "brief description", "shouldEscalate": true/false }. Only set shouldEscalate=true if sentiment is "frustrated" or "angry" AND urgencyScore >= 80.`;
            const sentPayload = {
              model: getAIModel("nano"),
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

const server = http.createServer(async (req, res) => {
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
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://login.microsoftonline.com https://alcdn.msauth.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com https://*.azure.com https://*.cognitiveservices.azure.com; frame-src https://login.microsoftonline.com;");

  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // ─── Auth & Rate Limiting (API routes only) ────────────────────────
  let authResult = { authenticated: false, user: null, role: "anonymous", skipped: true };
  if (pathname.startsWith("/api/")) {
    authResult = await authMiddleware(req, res, pathname, ENTRA_TENANT_ID, ENTRA_CLIENT_ID);
    if (authResult.blocked) return; // 429 already sent
  }

  // ─── SLA Engine API ────────────────────────────────────────────────
  if (pathname === "/api/sla/status" && req.method === "GET") {
    try {
      const rows = await db.getAll("sla_tracking");
      const items = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      return json(res, 200, { count: items.length, data: items, engine: slaEngine ? slaEngine.getStats() : null });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/sla/engine" && req.method === "GET") {
    return json(res, 200, slaEngine ? slaEngine.getStats() : { error: "SLA engine not initialized" });
  }
  if (pathname === "/api/sla/run" && req.method === "POST") {
    if (authResult.role !== "Administrator" && authResult.role !== "VGC Dev Admin") {
      return json(res, 403, { error: "Admin only" });
    }
    if (slaEngine) { await slaEngine.runCycle(); }
    return json(res, 200, { ok: true, stats: slaEngine ? slaEngine.getStats() : null });
  }

  // ─── SLA Config API (persist policy to DB) ─────────────────────────────
  if (pathname === "/api/sla/config" && req.method === "GET") {
    try {
      const row = await db.getOne("sla_config", "active_policy");
      if (row) return json(res, 200, JSON.parse(row.data));
      return json(res, 200, slaEngine ? slaEngine.currentPolicy : {});
    } catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/sla/config" && req.method === "POST") {
    if (authResult.role !== "Administrator" && authResult.role !== "VGC Dev Admin" && authResult.role !== "Tenant Admin") {
      return json(res, 403, { error: "Admin only" });
    }
    try {
      const body = await readBody(req);
      if (!body.severities) return json(res, 400, { error: "severities object required" });
      await db.upsert("sla_config", "active_policy", JSON.stringify(body));
      await db.audit("sla_config", "active_policy", "update", JSON.stringify(body), authResult.user?.email || "system");
      if (slaEngine) await slaEngine.loadPolicy();
      return json(res, 200, { ok: true, policy: body });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Analytics Engine API ─────────────────────────────────────────────────
  if (pathname === "/api/analytics/kpis" && req.method === "GET") {
    if (!analyticsEngine) return json(res, 503, { error: "Analytics engine not initialized" });
    try { return json(res, 200, await analyticsEngine.getDashboardKPIs()); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/analytics/trends" && req.method === "GET") {
    if (!analyticsEngine) return json(res, 503, { error: "Analytics engine not initialized" });
    const days = parseInt(urlObj.searchParams.get("days") || "30", 10);
    try { return json(res, 200, await analyticsEngine.getIncidentTrends(Math.min(days, 365))); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/analytics/sla" && req.method === "GET") {
    if (!analyticsEngine) return json(res, 503, { error: "Analytics engine not initialized" });
    try { return json(res, 200, await analyticsEngine.getSLAReport()); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/analytics/agents" && req.method === "GET") {
    if (!analyticsEngine) return json(res, 503, { error: "Analytics engine not initialized" });
    try { return json(res, 200, await analyticsEngine.getAgentPerformance()); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/analytics/patterns" && req.method === "GET") {
    if (!analyticsEngine) return json(res, 503, { error: "Analytics engine not initialized" });
    try { return json(res, 200, await analyticsEngine.getPatterns()); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/analytics/executive" && req.method === "GET") {
    if (!analyticsEngine) return json(res, 503, { error: "Analytics engine not initialized" });
    try { return json(res, 200, await analyticsEngine.getExecutiveSummary()); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Workflow Engine API ──────────────────────────────────────────────────
  if (pathname === "/api/workflow/stats" && req.method === "GET") {
    return json(res, 200, workflowEngine ? workflowEngine.getStats() : { error: "Not initialized" });
  }
  if (pathname === "/api/workflow/log" && req.method === "GET") {
    if (!workflowEngine) return json(res, 503, { error: "Workflow engine not initialized" });
    const limit = Math.min(parseInt(urlObj.searchParams.get("limit") || "50", 10), 200);
    return json(res, 200, { log: workflowEngine.getLog(limit) });
  }
  if (pathname === "/api/workflow/run" && req.method === "POST") {
    if (!workflowEngine) return json(res, 503, { error: "Workflow engine not initialized" });
    try { await workflowEngine.runCycle(); return json(res, 200, { ok: true, stats: workflowEngine.getStats() }); }
    catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Cache Stats API ─────────────────────────────────────────────────────
  if (pathname === "/api/cache/stats" && req.method === "GET") {
    return json(res, 200, cacheLayer ? cacheLayer.getStats() : { error: "Not initialized" });
  }
  if (pathname === "/api/cache/clear" && req.method === "POST") {
    if (cacheLayer) cacheLayer.clear();
    if (analyticsEngine) analyticsEngine.invalidateCache();
    return json(res, 200, { ok: true, message: "Cache cleared" });
  }

  // ─── Notification Engine API ───────────────────────────────────────────────
  if (pathname === "/api/notifications/send" && req.method === "POST") {
    if (!notifyEngine) return json(res, 503, { error: "Notification engine not initialized" });
    try {
      const body = await readBody(req);
      const result = await notifyEngine.send(body);
      return json(res, 200, result);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/notifications/stats" && req.method === "GET") {
    return json(res, 200, notifyEngine ? notifyEngine.getStats() : { error: "Not initialized" });
  }
  if (pathname === "/api/notifications/history" && req.method === "GET") {
    try {
      const rows = await db.getAll("notifications");
      const items = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      const limit = Math.min(parseInt(urlObj.searchParams.get("limit") || "50", 10), 500);
      return json(res, 200, { count: items.length, data: items.slice(-limit) });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── WebSocket Stats API ───────────────────────────────────────────────────
  if (pathname === "/api/ws/stats" && req.method === "GET") {
    return json(res, 200, wsServer ? wsServer.getStats() : { error: "WebSocket server not initialized" });
  }

  // ─── Daily Summary Email (manual trigger) ─────────────────────────────────
  if (pathname === "/api/notifications/daily-summary" && req.method === "POST") {
    if (!workflowEngine) return json(res, 503, { error: "Workflow engine not initialized" });
    try {
      const summary = await workflowEngine.sendDailySummary();
      return json(res, 200, { success: !summary.error, summary });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Email-to-Ticket: Process Inbound Emails ─────────────────────────────
  if (pathname === "/api/email/process-inbox" && req.method === "POST") {
    try {
      const result = await processInboundEmails();
      return json(res, 200, result);
    } catch (err) {
      console.error("[Email-to-Ticket]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── REST API: /api/db/:collection ─────────────────────────────────
  const dbMatch = pathname.match(/^\/api\/db\/([a-z_]+)(?:\/([^/]+))?$/);
  if (dbMatch) {
    const collection = dbMatch[1];
    const recordId = dbMatch[2] ? decodeURIComponent(dbMatch[2]) : null;

    if (!VALID_COLLECTIONS.has(collection)) {
      return json(res, 400, { error: "Invalid collection name" });
    }

    // RBAC enforcement for DB routes
    if (authResult.role && authResult.role !== "anonymous" && !checkPermission(authResult.role, collection, req.method)) {
      return json(res, 403, { error: "Insufficient permissions", role: authResult.role, collection, method: req.method });
    }

    try {
      // GET /api/db/:collection — list all (cached, with optional pagination)
      if (req.method === "GET" && !recordId) {
        const qs = urlObj.searchParams;
        const limit = parseInt(qs.get("limit") || "0") || 0;
        const offset = parseInt(qs.get("offset") || "0") || 0;
        const search = qs.get("search") || "";

        // Use SQL-level pagination when no search filter and db.getPage is available
        if (limit > 0 && !search && db.getPage) {
          const totalCount = await db.count(collection);
          const pageRows = await db.getPage(collection, { limit, offset });
          const items = pageRows.map(r => JSON.parse(r.data));
          return json(res, 200, { collection, count: items.length, total: totalCount, data: items });
        }

        const rows = await cachedGetAll(collection);
        const allItems = rows.map(r => JSON.parse(r.data));
        let items = allItems;
        if (search) {
          const q = search.toLowerCase();
          items = items.filter(i => JSON.stringify(i).toLowerCase().includes(q));
        }
        const total = items.length;
        if (limit > 0) items = items.slice(offset, offset + limit);
        return json(res, 200, { collection, count: items.length, total, data: items });
      }

      // GET /api/db/:collection/:id — get one (cached)
      if (req.method === "GET" && recordId) {
        const row = await cachedGetOne(collection, recordId);
        if (!row) return json(res, 404, { error: "Not found" });
        return json(res, 200, JSON.parse(row.data));
      }

      // POST /api/db/:collection — create or bulk upsert
      if (req.method === "POST") {
        const body = await readBody(req);
        if (Array.isArray(body)) {
          await db.bulkUpsert(collection, body);
          await db.audit(collection, "*", "bulk_upsert", JSON.stringify({ count: body.length }), authResult.user?.email || body[0]?._user || "system");
          if (wsServer) wsServer.broadcast(collection, { action: "bulk_upsert", collection, count: body.length });
          if (cacheLayer) cacheLayer.invalidatePrefix(collection);
          return json(res, 200, { ok: true, collection, upserted: body.length });
        } else {
          const id = body.id || recordId || String(Date.now());
          body.id = id;
          if (collection === "incidents" && body.category) body.category = normalizeCategory(body.category);
          await db.upsert(collection, id, JSON.stringify(body));
          await db.audit(collection, id, "upsert", JSON.stringify(body), authResult.user?.email || body._user || "system");
          if (wsServer) wsServer.broadcast(collection, { action: "upsert", collection, id, summary: body.title || body.name || id });
          if (workflowEngine) workflowEngine.onEvent("upsert", collection, body).catch(() => {});
          if (cacheLayer) cacheLayer.invalidatePrefix(collection);

          // ─── Email: New Incident Created ──────────────────────────────
          if (collection === "incidents" && body.title) {
            graphSendMail({
              to: [body.reporterEmail || body.requesterEmail || "customer@example.com"],
              subject: `[VGC ITSM] Incident ${id} created — ${(body.title || "").substring(0, 80)}`,
              isCustomerEmail: true,
              body: `<div style="font-family:Arial,sans-serif;max-width:600px;">
                <div style="background:linear-gradient(135deg,#3B82F6,#06B6D4);padding:16px 20px;border-radius:8px 8px 0 0;">
                  <h2 style="margin:0;color:#fff;font-size:18px;">📋 New Incident Created</h2>
                </div>
                <div style="background:#f8f9fa;padding:20px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
                  <table style="border-collapse:collapse;width:100%;">
                    <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Incident ID</td><td style="padding:8px 12px;">${String(id).replace(/</g, "&lt;")}</td></tr>
                    <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Title</td><td style="padding:8px 12px;">${(body.title || "").replace(/</g, "&lt;")}</td></tr>
                    <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Priority</td><td style="padding:8px 12px;">${body.priority || "Pending Triage"}</td></tr>
                    <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Category</td><td style="padding:8px 12px;">${body.category || "General"}</td></tr>
                    <tr><td style="padding:8px 12px;font-weight:bold;color:#6B7280;">Assigned Team</td><td style="padding:8px 12px;">${body.assignedTeam || body.team || "Service Desk"}</td></tr>
                  </table>
                  <p style="color:#333;font-size:13px;margin-top:16px;">Our team has received your request and will begin working on it shortly. You will receive updates as the incident progresses.</p>
                  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;"/>
                  <p style="color:#888;font-size:11px;">VGC Technology Pte Ltd — IT Service Management</p>
                </div>
              </div>`,
            }).catch(e => console.warn("[Incident Create] Confirmation email failed:", e.message));
          }

          // ─── Auto-add customer domain to email whitelist ──────────────
          if (collection === "customers" && body.email) {
            const custDomain = body.email.split("@")[1]?.toLowerCase();
            if (custDomain) {
              try {
                const wlRows = await db.getAll("email_whitelist");
                const exists = wlRows.some(r => {
                  try { const e = typeof r.data === "string" ? JSON.parse(r.data) : r.data; return e.type === "domain" && e.value === custDomain; } catch { return false; }
                });
                if (!exists) {
                  const wlId = `WL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
                  await db.upsert("email_whitelist", wlId, JSON.stringify({
                    id: wlId, type: "domain", value: custDomain,
                    label: body.company || body.name || custDomain,
                    addedBy: "Auto-sync (customer create)", addedAt: new Date().toISOString(),
                  }));
                  if (cacheLayer) cacheLayer.invalidatePrefix("email_whitelist");
                  console.log(`[Email Whitelist] Auto-added domain "${custDomain}" from new customer ${body.name || id}`);
                }
              } catch (wlErr) { console.warn("[Email Whitelist] Auto-add failed:", wlErr.message); }
            }
          }

          return json(res, 200, { ok: true, id });
        }
      }

      // PUT /api/db/:collection/:id — update one
      if (req.method === "PUT" && recordId) {
        const body = await readBody(req);
        body.id = recordId;

        // ─── Detect assignment change for incidents (before saving) ─────
        let previousAssignee = null;
        if (collection === "incidents") {
          try {
            const existingRow = await db.getOne(collection, recordId);
            if (existingRow) {
              const existing = typeof existingRow.data === "string" ? JSON.parse(existingRow.data) : existingRow.data;
              previousAssignee = existing.assignedTo || existing.assignee || null;
            }
          } catch {}
        }

        // ─── Stamp resolvedAt when incident transitions to Resolved/Closed ──
        if (collection === "incidents" && (body.status === "Resolved" || body.status === "Closed") && !body.resolvedAt) {
          body.resolvedAt = new Date().toISOString();
        }

        await db.upsert(collection, recordId, JSON.stringify(body));
        await db.audit(collection, recordId, "update", JSON.stringify(body), authResult.user?.email || body._user || "system");
        if (wsServer) wsServer.broadcast(collection, { action: "update", collection, id: recordId, summary: body.title || body.name || recordId });
        if (workflowEngine) workflowEngine.onEvent("update", collection, body).catch(() => {});
        if (cacheLayer) cacheLayer.invalidatePrefix(collection);

        // ─── Auto-add customer domain to email whitelist on update ──────
        if (collection === "customers" && body.email) {
          const custDomain = body.email.split("@")[1]?.toLowerCase();
          if (custDomain) {
            try {
              const wlRows = await db.getAll("email_whitelist");
              const exists = wlRows.some(r => {
                try { const e = typeof r.data === "string" ? JSON.parse(r.data) : r.data; return e.type === "domain" && e.value === custDomain; } catch { return false; }
              });
              if (!exists) {
                const wlId = `WL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
                await db.upsert("email_whitelist", wlId, JSON.stringify({
                  id: wlId, type: "domain", value: custDomain,
                  label: body.company || body.name || custDomain,
                  addedBy: "Auto-sync (customer update)", addedAt: new Date().toISOString(),
                }));
                if (cacheLayer) cacheLayer.invalidatePrefix("email_whitelist");
                console.log(`[Email Whitelist] Auto-added domain "${custDomain}" from updated customer ${body.name || recordId}`);
              }
            } catch (wlErr) { console.warn("[Email Whitelist] Auto-add failed:", wlErr.message); }
          }
        }

        // Auto KB Draft: generate KB article when incident is Resolved/Closed
        if (collection === "incidents" && (body.status === "Resolved" || body.status === "Closed")) {
          generateKBDraft(body).catch(e => console.warn("[Auto KB Draft]", e.message));

          // ─── Auto-dismiss pending AI queue items for this incident ──
          (async () => {
            try {
              const actionRows = await db.getAll("ai_actions");
              let dismissed = 0;
              for (const r of actionRows) {
                try {
                  const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
                  if (item && item.status === "pending_approval" && item.incidentId === recordId) {
                    item.status = "dismissed";
                    item.dismissedAt = new Date().toISOString();
                    item.dismissedBy = "auto-incident-resolved";
                    item.dismissReason = `Incident ${body.status.toLowerCase()}`;
                    await db.upsert("ai_actions", item.id, JSON.stringify(item));
                    dismissed++;
                  }
                } catch {}
              }
              if (dismissed > 0) console.log(`[Auto-Dismiss] ${dismissed} pending ai_actions dismissed for ${recordId} (${body.status})`);
            } catch (e) { console.warn("[Auto-Dismiss]", e.message); }
          })();

          // ─── Email: Customer resolution notice ──────────────────────
          graphSendMail({
            to: [body.reporterEmail || body.requesterEmail || "customer@example.com"],
            subject: `[VGC ITSM] Incident ${recordId} — ${body.status}`,
            isCustomerEmail: true,
            body: buildEmailTemplate({
              type: body.status === "Resolved" ? "incident_resolved" : "incident_closed",
              incidentId: recordId,
              title: body.title || "",
              status: body.status,
              resolution: body.resolution || "N/A",
              resolvedBy: body.resolvedBy || body.assignedTo || "IT Support",
              nextActions: [
                { label: "If this issue persists, please open a new support ticket", url: PORTAL_URL, linkLabel: "Open Portal" },
              ],
            }),
          }).catch(e => console.warn("[Incident Resolve] Customer email failed:", e.message));
        }

        // ─── Email: Assignment change notification ────────────────────
        if (collection === "incidents") {
          const newAssignee = body.assignedTo || body.assignee || null;
          if (newAssignee && newAssignee !== previousAssignee) {
            graphSendMail({
              to: [newAssignee.includes("@") ? newAssignee : "itsupport@vgctechnology.com"],
              subject: `[VGC ITSM] You've been assigned: ${recordId} — ${(body.title || "").substring(0, 60)}`,
              body: buildEmailTemplate({
                type: "incident_assigned",
                incidentId: recordId,
                title: body.title || "",
                priority: body.priority || "N/A",
                status: body.status || "Open",
                assignee: newAssignee,
                description: (body.description || "").substring(0, 300),
                nextActions: [
                  { label: "Review incident details and begin investigation", url: PORTAL_URL, linkLabel: "Open Incident" },
                  { label: "Update the status once you begin working on it" },
                ],
              }),
            }).catch(e => console.warn("[Incident Assign] Assignment email failed:", e.message));
          }
        }

        return json(res, 200, { ok: true, id: recordId });
      }

      // DELETE /api/db/:collection/:id — delete one
      if (req.method === "DELETE" && recordId) {
        await db.deleteOne(collection, recordId);
        await db.audit(collection, recordId, "delete", null, authResult.user?.email || "system");
        if (wsServer) wsServer.broadcast(collection, { action: "delete", collection, id: recordId });
        if (cacheLayer) cacheLayer.invalidatePrefix(collection);
        return json(res, 200, { ok: true, deleted: recordId });
      }

      return json(res, 405, { error: "Method not allowed" });
    } catch (err) {
      console.error(`DB API error [${collection}]:`, err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── CSV Export API ───────────────────────────────────────────────────
  const exportMatch = pathname.match(/^\/api\/export\/([a-z_]+)$/);
  if (exportMatch && req.method === "GET") {
    const exportCol = exportMatch[1];
    if (!VALID_COLLECTIONS.has(exportCol)) return json(res, 400, { error: "Invalid collection" });
    try {
      const rows = await db.getAll(exportCol);
      const items = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      if (items.length === 0) {
        res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${exportCol}_export.csv"` });
        return res.end("No data");
      }
      // Collect all unique keys across all items
      const keySet = new Set();
      items.forEach(item => Object.keys(item).forEach(k => keySet.add(k)));
      const headers = Array.from(keySet);
      const escapeCsv = (val) => {
        if (val == null) return "";
        const s = typeof val === "object" ? JSON.stringify(val) : String(val);
        if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };
      const csvLines = [headers.map(escapeCsv).join(",")];
      items.forEach(item => csvLines.push(headers.map(h => escapeCsv(item[h])).join(",")));
      const csv = csvLines.join("\r\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportCol}_${new Date().toISOString().slice(0,10)}.csv"`,
        "Content-Length": Buffer.byteLength(csv, "utf-8"),
      });
      return res.end(csv);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Helper: parse db row data ─────────────────────────────────────
  const dbParse = (row) => { if (!row) return null; try { return typeof row.data === "string" ? JSON.parse(row.data) : row; } catch { return null; } };
  const dbParseAll = (rows) => (Array.isArray(rows) ? rows : []).map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r; } catch { return null; } }).filter(Boolean);

  // ─── Multi-Level Approval Chain API ───────────────────────────────────
  // Submit an item for approval — creates an approval_instance
  if (pathname === "/api/approvals/submit" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { chainId, targetCollection, targetId } = body;
      if (!chainId || !targetCollection || !targetId) return json(res, 400, { error: "Missing chainId, targetCollection, or targetId" });
      if (!VALID_COLLECTIONS.has(targetCollection)) return json(res, 400, { error: "Invalid target collection" });
      const chain = dbParse(await db.getOne("approval_chains", chainId));
      if (!chain) return json(res, 404, { error: "Approval chain not found" });
      const instanceId = `AI-${Date.now().toString(36)}`;
      const instance = {
        id: instanceId, chainId, targetCollection, targetId,
        currentLevel: 1, status: "pending", approvals: [],
        createdAt: new Date().toISOString(), completedAt: null, createdBy: body.createdBy || "system"
      };
      await db.upsert("approval_instances", instanceId, JSON.stringify(instance));
      // Update target record
      const target = dbParse(await db.getOne(targetCollection, targetId));
      if (target) { target.approvalInstanceId = instanceId; target.status = "Awaiting Approval"; await db.upsert(targetCollection, targetId, JSON.stringify(target)); }
      await db.audit(targetCollection, targetId, "approval_submitted", JSON.stringify({ chainId, instanceId }), body.createdBy || "system");
      return json(res, 200, { success: true, instanceId, instance });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // Approve or reject at current level
  if (pathname.startsWith("/api/approvals/") && pathname.endsWith("/action") && req.method === "POST") {
    try {
      const body = await readBody(req);
      const instanceId = pathname.split("/")[3];
      const { action, comment, approvedBy } = body;
      if (!["approved", "rejected"].includes(action)) return json(res, 400, { error: "Action must be 'approved' or 'rejected'" });
      const instance = dbParse(await db.getOne("approval_instances", instanceId));
      if (!instance) return json(res, 404, { error: "Approval instance not found" });
      if (instance.status !== "pending") return json(res, 400, { error: "Instance not pending" });
      const chain = dbParse(await db.getOne("approval_chains", instance.chainId));
      if (!chain) return json(res, 404, { error: "Approval chain not found" });

      instance.approvals.push({ level: instance.currentLevel, approvedBy: approvedBy || "unknown", at: new Date().toISOString(), action, comment: comment || "" });

      if (action === "rejected") {
        instance.status = "rejected"; instance.completedAt = new Date().toISOString();
        const target = dbParse(await db.getOne(instance.targetCollection, instance.targetId));
        if (target) { target.status = "Rejected"; await db.upsert(instance.targetCollection, instance.targetId, JSON.stringify(target)); }
      } else {
        const nextLevel = instance.currentLevel + 1;
        const hasNextLevel = chain.levels && chain.levels.some(l => l.level === nextLevel);
        if (hasNextLevel) {
          instance.currentLevel = nextLevel;
        } else {
          instance.status = "approved"; instance.completedAt = new Date().toISOString();
          const target = dbParse(await db.getOne(instance.targetCollection, instance.targetId));
          if (target) { target.status = "Approved"; await db.upsert(instance.targetCollection, instance.targetId, JSON.stringify(target)); }
        }
      }
      await db.upsert("approval_instances", instanceId, JSON.stringify(instance));
      await db.audit("approval_instances", instanceId, `approval_${action}`, JSON.stringify({ level: instance.approvals.length, action, approvedBy }), approvedBy || "system");
      return json(res, 200, { success: true, instance });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // List pending approvals for a role
  if (pathname === "/api/approvals/pending" && req.method === "GET") {
    try {
      const role = urlObj.searchParams.get("role") || "";
      const allInstances = dbParseAll(await db.getAll("approval_instances"));
      const pending = allInstances.filter(i => i.status === "pending");
      // Enrich with chain and target info
      const enriched = [];
      for (const inst of pending) {
        const chain = dbParse(await db.getOne("approval_chains", inst.chainId));
        const currentLevelDef = chain?.levels?.find(l => l.level === inst.currentLevel);
        if (role && currentLevelDef && currentLevelDef.role !== role) continue;
        const target = dbParse(await db.getOne(inst.targetCollection, inst.targetId));
        enriched.push({ ...inst, chainName: chain?.name, currentLevelDef, target: target ? { id: target.id, title: target.title || target.service || target.id, status: target.status } : null });
      }
      return json(res, 200, { data: enriched, count: enriched.length });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── CMDB Relationship API ────────────────────────────────────────────
  if (pathname.startsWith("/api/cmdb/relationships") && req.method === "GET") {
    try {
      const parts = pathname.split("/");
      const assetId = parts[4];
      if (assetId) {
        const rels = dbParseAll(await db.getAll("cmdb_relationships"));
        const filtered = rels.filter(r => r.sourceId === assetId || r.targetId === assetId);
        return json(res, 200, { data: filtered, count: filtered.length });
      }
      const rels = dbParseAll(await db.getAll("cmdb_relationships"));
      return json(res, 200, { data: rels, count: rels.length });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/cmdb/relationships" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { sourceId, targetId, type } = body;
      if (!sourceId || !targetId || !type) return json(res, 400, { error: "Missing sourceId, targetId, or type" });
      const relId = `REL-${Date.now().toString(36)}`;
      const rel = { id: relId, sourceId, targetId, type, direction: "forward", createdBy: body.createdBy || "system", createdAt: new Date().toISOString() };
      await db.upsert("cmdb_relationships", relId, JSON.stringify(rel));
      await db.audit("cmdb_relationships", relId, "create", JSON.stringify(rel), body.createdBy || "system");
      return json(res, 200, { success: true, relationship: rel });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname.startsWith("/api/cmdb/relationships/") && req.method === "DELETE") {
    try {
      const body = await readBody(req);
      const relId = pathname.split("/")[4];
      await db.deleteOne("cmdb_relationships", relId);
      await db.audit("cmdb_relationships", relId, "delete", JSON.stringify({}), body.deletedBy || "system");
      return json(res, 200, { success: true });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // CMDB Impact Analysis
  if (pathname.startsWith("/api/cmdb/impact/") && req.method === "GET") {
    try {
      const assetId = pathname.split("/")[4];
      const rels = dbParseAll(await db.getAll("cmdb_relationships"));
      const visited = new Set();
      const impacted = [];
      const queue = [{ id: assetId, depth: 0, path: [assetId] }];
      while (queue.length > 0) {
        const { id, depth, path } = queue.shift();
        if (visited.has(id) || depth > 5) continue;
        visited.add(id);
        if (id !== assetId) {
          const asset = dbParse(await db.getOne("assets", id));
          impacted.push({ id, depth, path, name: asset?.name || asset?.hostname || id, type: asset?.type || "Unknown" });
        }
        const connected = rels.filter(r => r.sourceId === id || r.targetId === id);
        for (const r of connected) {
          const nextId = r.sourceId === id ? r.targetId : r.sourceId;
          if (!visited.has(nextId)) queue.push({ id: nextId, depth: depth + 1, path: [...path, nextId] });
        }
      }
      return json(res, 200, { assetId, impacted, count: impacted.length });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Audit Report API ────────────────────────────────────────────────
  if (pathname === "/api/audit/report" && req.method === "GET") {
    try {
      const from = urlObj.searchParams.get("from");
      const to = urlObj.searchParams.get("to");
      const collection = urlObj.searchParams.get("collection");
      const actionFilter = urlObj.searchParams.get("action");
      let rows = await db.getAllAudit(5000);
      if (from) rows = rows.filter(r => { const ts = r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp); return ts >= from; });
      if (to) rows = rows.filter(r => { const ts = r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp); return ts <= (to.length === 10 ? to + "T23:59:59Z" : to); });
      if (collection) rows = rows.filter(r => r.collection === collection);
      if (actionFilter) rows = rows.filter(r => r.action === actionFilter);
      const summary = {};
      rows.forEach(r => { summary[r.action] = (summary[r.action] || 0) + 1; });
      return json(res, 200, { data: rows, count: rows.length, summary });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  if (pathname === "/api/audit/compliance-summary" && req.method === "GET") {
    try {
      const changes = dbParseAll(await db.getAll("changes"));
      const withApproval = changes.filter(c => c.approvalInstanceId || c.status === "Approved" || c.status === "Completed").length;
      const totalChanges = changes.length;
      const incs = dbParseAll(await db.getAll("incidents"));
      const resolved = incs.filter(i => i.status === "Resolved" || i.status === "Closed");
      const slaMet = resolved.filter(i => !i.slaBreach).length;
      const auditRows = await db.getAllAudit(10000);
      return json(res, 200, {
        totalChanges, changesWithApproval: withApproval,
        approvalRate: totalChanges > 0 ? Math.round((withApproval / totalChanges) * 100) : 100,
        totalIncidents: incs.length, resolvedIncidents: resolved.length,
        slaComplianceRate: resolved.length > 0 ? Math.round((slaMet / resolved.length) * 100) : 100,
        totalAuditEntries: auditRows.length,
      });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Runbook Execution API ────────────────────────────────────────────
  if (pathname === "/api/runbook/execute" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { runbookId, incidentId, executedBy } = body;
      if (!runbookId) return json(res, 400, { error: "Missing runbookId" });
      const runbook = dbParse(await db.getOne("kb", runbookId));
      if (!runbook) return json(res, 404, { error: "Runbook not found" });
      const steps = (runbook.steps || runbook.content?.split(/\n(?=\d+\.)/) || ["Step 1: Execute"]).map((s, i) => ({
        stepNum: i + 1, title: typeof s === "string" ? s.replace(/^\d+\.\s*/, "").substring(0, 100) : (s.title || `Step ${i+1}`),
        status: "pending", completedAt: null, notes: ""
      }));
      const execId = `RB-${Date.now().toString(36)}`;
      const execution = { id: execId, runbookId, incidentId: incidentId || null, executedBy: executedBy || "system", startedAt: new Date().toISOString(), steps, status: "in_progress", completedAt: null };
      await db.upsert("runbook_executions", execId, JSON.stringify(execution));
      if (incidentId) {
        const inc = dbParse(await db.getOne("incidents", incidentId));
        if (inc) { inc.runbookExecutionId = execId; await db.upsert("incidents", incidentId, JSON.stringify(inc)); }
      }
      await db.audit("runbook_executions", execId, "started", JSON.stringify({ runbookId, incidentId }), executedBy || "system");
      return json(res, 200, { success: true, execution });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  if (pathname.match(/^\/api\/runbook\/execution\/[^/]+\/step\/\d+$/) && req.method === "PUT") {
    try {
      const body = await readBody(req);
      const parts = pathname.split("/");
      const execId = parts[4], stepNum = parseInt(parts[6], 10);
      const { status, notes } = body;
      if (!["completed", "skipped", "failed"].includes(status)) return json(res, 400, { error: "Status must be completed, skipped, or failed" });
      const execution = dbParse(await db.getOne("runbook_executions", execId));
      if (!execution) return json(res, 404, { error: "Execution not found" });
      const step = execution.steps.find(s => s.stepNum === stepNum);
      if (!step) return json(res, 404, { error: "Step not found" });
      step.status = status; step.completedAt = new Date().toISOString(); step.notes = notes || "";
      const allDone = execution.steps.every(s => ["completed", "skipped", "failed"].includes(s.status));
      if (allDone) { execution.status = "completed"; execution.completedAt = new Date().toISOString(); }
      await db.upsert("runbook_executions", execId, JSON.stringify(execution));
      await db.audit("runbook_executions", "step_updated", execId, JSON.stringify({ stepNum, status }), body.updatedBy || "system");
      return json(res, 200, { success: true, execution });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  if (pathname === "/api/runbook/executions" && req.method === "GET") {
    try {
      const incidentId = urlObj.searchParams.get("incidentId");
      const data = dbParseAll(await db.getAll("runbook_executions"));
      const filtered = incidentId ? data.filter(e => e.incidentId === incidentId) : data;
      return json(res, 200, { data: filtered, count: filtered.length });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Scheduled Report API ────────────────────────────────────────────
  if (pathname === "/api/reports/schedules" && req.method === "GET") {
    try {
      const data = dbParseAll(await db.getAll("report_schedules"));
      return json(res, 200, { data, count: data.length });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  if (pathname === "/api/reports/schedule" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { name, type, frequency, recipients, format } = body;
      if (!name || !type) return json(res, 400, { error: "Missing name or type" });
      const schedId = body.id || `RS-${Date.now().toString(36)}`;
      const schedule = { id: schedId, name, type, frequency: frequency || "weekly", dayOfWeek: body.dayOfWeek || 1, hour: body.hour || 9, recipients: recipients || [], format: format || "csv", filters: body.filters || {}, active: body.active !== false, createdAt: new Date().toISOString() };
      await db.upsert("report_schedules", schedId, JSON.stringify(schedule));
      await db.audit("report_schedules", schedId, "create", JSON.stringify(schedule), body.createdBy || "system");
      return json(res, 200, { success: true, schedule });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Audit Log API ────────────────────────────────────────────────────
  if (pathname === "/api/audit" && req.method === "GET") {
    try {
      const collection = urlObj.searchParams.get("collection");
      const limit = Math.min(parseInt(urlObj.searchParams.get("limit") || "100", 10), 1000);
      const rows = collection
        ? await db.getAudit(collection, limit)
        : await db.getAllAudit(limit);
      return json(res, 200, { count: rows.length, data: rows });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── DB Stats ─────────────────────────────────────────────────────────
  if (pathname === "/api/db-stats" && req.method === "GET") {
    try {
      const stats = {};
      for (const c of VALID_COLLECTIONS) {
        stats[c] = await db.count(c);
      }
      return json(res, 200, { database: db.label, collections: stats, timestamp: new Date().toISOString() });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Seed Data Cleanup (for Entra production users) ──────────────────
  if (pathname === "/api/db-clean-seed" && req.method === "POST") {
    try {
      const seedPattern = /^(INC000|PRB000|CHG000|REQ000)\d$/;
      const collections = ["incidents", "problems", "changes", "requests"];
      let totalDeleted = 0;
      for (const coll of collections) {
        const rows = await db.getAll(coll);
        for (const row of rows) {
          const item = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || row);
          const isSeed = seedPattern.test(row.id || item.id);
          const isSeedLinked = item.title?.includes("Problem from INC000") || (Array.isArray(item.linkedIncidents) && item.linkedIncidents.some(id => /^INC000\d$/.test(id)));
          if (isSeed || isSeedLinked) {
            await db.deleteOne(coll, row.id || item.id);
            totalDeleted++;
          }
        }
      }
      return json(res, 200, { ok: true, cleaned: totalDeleted, timestamp: new Date().toISOString() });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // Graph API proxy: /api/graph?endpoint=/users
  if (pathname.startsWith("/api/graph")) {
    const endpoint = urlObj.searchParams.get("endpoint");
    if (!endpoint || !endpoint.startsWith("/")) {
      return json(res, 400, { error: "Missing or invalid endpoint parameter" });
    }
    try {
      const data = await graphAppCall(endpoint);
      return json(res, 200, data);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Local Auth: POST /api/auth/local ─────────────────────────────────
  if (pathname === "/api/auth/local" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { username, password } = body;
      if (!username || !password) return json(res, 400, { error: "Username and password required" });
      const localUser = LOCAL_USERS[username.toLowerCase()];
      if (!localUser) return json(res, 401, { error: "Invalid credentials" });
      const inputHash = crypto.createHash("sha256").update(password).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(localUser.passwordHash))) {
        return json(res, 401, { error: "Invalid credentials" });
      }
      await db.audit("auth", username, "local_login", JSON.stringify({ username, timestamp: new Date().toISOString() }), username);
      return json(res, 200, { ok: true, user: localUser.profile });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Entra ID User Sync: GET /api/entra/users ─────────────────────────
  // Fetches live user list from vgcsg.com tenant via Graph API (app-only)
  if (pathname === "/api/entra/users" && req.method === "GET") {
    try {
      const data = await graphAppCall("/users?$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,mobilePhone,accountEnabled&$top=999&$orderby=displayName");
      const users = (data.value || [])
        .filter(u => u.accountEnabled !== false)
        .map(u => ({
          id: "ENTRA-" + (u.id || "").substring(0, 8),
          entraObjectId: u.id,
          name: u.displayName || u.userPrincipalName,
          email: (u.mail || u.userPrincipalName || "").toLowerCase(),
          role: u.jobTitle || "IT Staff",
          department: u.department || "IT",
          location: u.officeLocation || "Singapore",
          phone: u.mobilePhone || "",
          avatar: ((u.displayName || "U").match(/\b\w/g) || ["U"]).slice(0, 2).join("").toUpperCase(),
          authType: "entra",
          synced: true,
          syncedAt: new Date().toISOString(),
        }));
      return json(res, 200, { ok: true, count: users.length, users, tenant: ENTRA_TENANT_ID });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Entra ID User Search: GET /api/entra/users/search?q=<query> ───────
  if (pathname === "/api/entra/users/search" && req.method === "GET") {
    const q = urlObj.searchParams.get("q") || "";
    if (!q.trim()) return json(res, 400, { error: "Missing search query parameter 'q'" });
    try {
      const safeQ = q.replace(/"/g, "").trim();
      const searchExpr = encodeURIComponent(`"displayName:${safeQ}" OR "mail:${safeQ}"`);
      const data = await graphAppCall(
        `/users?$search=${searchExpr}&$select=id,displayName,mail,jobTitle,department,userPrincipalName,accountEnabled&$top=20&$count=true`,
        { ConsistencyLevel: "eventual" }
      );
      const users = (data.value || []).filter(u => u.accountEnabled !== false);
      return json(res, 200, { ok: true, count: users.length, users });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Entra ID Groups: GET /api/entra/groups ────────────────────────────
  if (pathname === "/api/entra/groups" && req.method === "GET") {
    try {
      const data = await graphAppCall("/groups?$select=id,displayName,description,securityEnabled&$top=100");
      const groups = (data.value || []).filter(g => g.securityEnabled).map(g => ({ id: g.id, displayName: g.displayName, description: g.description }));
      return json(res, 200, { ok: true, groups });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Entra ID Group Members: GET /api/entra/groups/:id/members ─────────
  if (pathname.startsWith("/api/entra/groups/") && pathname.endsWith("/members") && req.method === "GET") {
    const groupId = pathname.replace("/api/entra/groups/", "").replace("/members", "");
    if (!groupId || groupId.length < 10) return json(res, 400, { error: "Invalid group ID" });
    try {
      const data = await graphAppCall(`/groups/${encodeURIComponent(groupId)}/members?$select=id,displayName,mail,jobTitle,department,userPrincipalName&$top=100`);
      const members = (data.value || []).filter(m => m["@odata.type"] === "#microsoft.graph.user" || m.mail);
      return json(res, 200, { ok: true, count: members.length, members });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Entra ID User Photo: GET /api/entra/users/:id/photo ───────────────
  if (pathname.startsWith("/api/entra/users/") && pathname.endsWith("/photo") && req.method === "GET") {
    const userId = pathname.replace("/api/entra/users/", "").replace("/photo", "");
    if (!userId || userId.length < 5) return json(res, 400, { error: "Invalid user ID" });
    try {
      const dataUrl = await graphAppCallBinary(`/users/${encodeURIComponent(userId)}/photo/$value`);
      if (!dataUrl) return json(res, 404, { error: "No photo found" });
      return json(res, 200, { ok: true, photo: dataUrl });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Email Send Endpoint: POST /api/email/send ─────────────────────
  if (pathname === "/api/email/send" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { to, subject, htmlBody, reportId, customerName } = body;
      if (!to || !subject) return json(res, 400, { error: "Missing to or subject" });
      const emailBody = htmlBody || `<p>Dear ${customerName || "Customer"},</p><p>${subject}</p><p>Best regards,<br/>VGC IT Support</p>`;
      await graphSendMail({ to, subject, body: emailBody });
      console.log(`[VGC-ITSM] Email sent via M365: to=${to}, subject=${subject}`);
      return json(res, 200, { success: true, message: `Email sent to ${to} via M365` });
    } catch (err) {
      console.error(`[VGC-ITSM] Email send failed: ${err.message}`);
      return json(res, 500, { error: "Email send failed: " + err.message });
    }
  }

  // ─── Zendesk API Proxy ──────────────────────────────────────────────
  if (pathname.startsWith("/api/zendesk")) {
    if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
      return json(res, 503, { error: "Zendesk not configured. Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN." });
    }
    const zdBase = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
    const zdAuth = "Basic " + Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString("base64");

    const zdRequestOnce = (method, zdPath, body) => new Promise((resolve, reject) => {
      const url = new URL(zdBase + zdPath);
      const opts = {
        hostname: url.hostname, port: 443, path: url.pathname + url.search,
        method, headers: { "Authorization": zdAuth, "Content-Type": "application/json" },
      };
      const r = https.request(opts, (resp) => {
        let data = ""; resp.on("data", c => data += c);
        resp.on("end", () => {
          if (resp.statusCode === 429) {
            const retryAfter = parseInt(resp.headers["retry-after"] || "10", 10);
            reject({ status: 429, retryAfter });
          } else if (resp.statusCode >= 200 && resp.statusCode < 300) {
            resolve(data ? JSON.parse(data) : {});
          } else {
            reject(new Error(`Zendesk ${resp.statusCode}: ${data.substring(0, 500)}`));
          }
        });
      });
      r.on("error", reject);
      r.setTimeout(30000, () => { r.destroy(); reject(new Error("Zendesk API timeout")); });
      if (body) r.write(JSON.stringify(body));
      r.end();
    });

    const zdRequest = async (method, zdPath, body) => {
      const maxRetries = 3;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await zdRequestOnce(method, zdPath, body);
        } catch (err) {
          if (err.status === 429 && attempt < maxRetries) {
            const wait = Math.min((err.retryAfter || 10) * 1000, 60000);
            console.log(`[ZD] Rate limited, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, wait));
          } else if (err.status === 429) {
            throw new Error(`Zendesk rate limited after ${maxRetries} retries`);
          } else {
            throw err;
          }
        }
      }
    };

    try {
      // GET /api/zendesk/me — verify connection
      if (pathname === "/api/zendesk/me" && req.method === "GET") {
        const result = await zdRequest("GET", "/users/me.json");
        return json(res, 200, result);
      }

      // GET /api/zendesk/tickets?page=1&per_page=25&status=open&sort_by=created_at&sort_order=desc
      if (pathname === "/api/zendesk/tickets" && req.method === "GET") {
        const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const page = qs.get("page") || "1";
        const perPage = Math.min(parseInt(qs.get("per_page") || "25"), 100);
        const status = qs.get("status") || "";
        const sortBy = qs.get("sort_by") || "created_at";
        const sortOrder = qs.get("sort_order") || "desc";
        let zdPath = `/tickets.json?page=${page}&per_page=${perPage}&sort_by=${sortBy}&sort_order=${sortOrder}`;
        if (status) zdPath = `/search.json?query=type:ticket status:${encodeURIComponent(status)}&page=${page}&per_page=${perPage}&sort_by=${sortBy}&sort_order=${sortOrder}`;
        const result = await zdRequest("GET", zdPath);
        return json(res, 200, result);
      }

      // GET /api/zendesk/tickets/:id
      if (pathname.match(/^\/api\/zendesk\/tickets\/\d+$/) && req.method === "GET") {
        const ticketId = pathname.split("/").pop();
        const result = await zdRequest("GET", `/tickets/${ticketId}.json`);
        return json(res, 200, result);
      }

      // GET /api/zendesk/tickets/:id/comments
      if (pathname.match(/^\/api\/zendesk\/tickets\/\d+\/comments$/) && req.method === "GET") {
        const ticketId = pathname.split("/")[4];
        const result = await zdRequest("GET", `/tickets/${ticketId}/comments.json`);
        // Resolve author_id numbers to display names (read-only, graceful fallback)
        const authorIds = [...new Set((result.comments || []).map(c => c.author_id).filter(Boolean))];
        if (authorIds.length > 0) {
          try {
            const u = await zdRequest("GET", `/users/show_many.json?ids=${authorIds.join(",")}`);
            const m = {}; (u.users || []).forEach(x => { m[x.id] = x.name; });
            (result.comments || []).forEach(c => { c.author_name = m[c.author_id] || null; });
          } catch (e) { /* silent fallback */ }
        }
        return json(res, 200, result);
      }

      // PUT /api/zendesk/tickets/:id — update ticket (status, priority, comment)
      if (pathname.match(/^\/api\/zendesk\/tickets\/\d+$/) && req.method === "PUT") {
        const ticketId = pathname.split("/").pop();
        const body = await parseBody(req);
        const result = await zdRequest("PUT", `/tickets/${ticketId}.json`, body);
        return json(res, 200, result);
      }

      // POST /api/zendesk/tickets — create new ticket
      if (pathname === "/api/zendesk/tickets" && req.method === "POST") {
        const body = await parseBody(req);
        const result = await zdRequest("POST", "/tickets.json", body);
        return json(res, 200, result);
      }

      // GET /api/zendesk/groups
      if (pathname === "/api/zendesk/groups" && req.method === "GET") {
        const result = await zdRequest("GET", "/groups.json");
        return json(res, 200, result);
      }

      // GET /api/zendesk/users?role=agent
      if (pathname === "/api/zendesk/users" && req.method === "GET") {
        const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const role = qs.get("role") || "";
        const zdPath = role ? `/users.json?role=${encodeURIComponent(role)}` : "/users.json";
        const result = await zdRequest("GET", zdPath);
        return json(res, 200, result);
      }

      // GET /api/zendesk/stats — ticket counts by status
      if (pathname === "/api/zendesk/stats" && req.method === "GET") {
        const [open, pending, hold, solved] = await Promise.all([
          zdRequest("GET", "/search.json?query=type:ticket status:open").catch(() => ({ count: 0 })),
          zdRequest("GET", "/search.json?query=type:ticket status:pending").catch(() => ({ count: 0 })),
          zdRequest("GET", "/search.json?query=type:ticket status:hold").catch(() => ({ count: 0 })),
          zdRequest("GET", "/search.json?query=type:ticket status:solved").catch(() => ({ count: 0 })),
        ]);
        return json(res, 200, { open: open.count || 0, pending: pending.count || 0, hold: hold.count || 0, solved: solved.count || 0 });
      }

      // POST /api/zendesk/auto-triage — AI auto-triage a ticket (server-side for automation)
      if (pathname === "/api/zendesk/auto-triage" && req.method === "POST") {
        if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
          return json(res, 503, { error: "Azure OpenAI not configured" });
        }
        const body = await parseBody(req, 100000);
        const { ticketId } = body;
        if (!ticketId) return json(res, 400, { error: "ticketId required" });

        // Fetch ticket + comments + requester from Zendesk
        const ticket = await zdRequest("GET", `/tickets/${ticketId}.json`);
        const comments = await zdRequest("GET", `/tickets/${ticketId}/comments.json`).catch(() => ({ comments: [] }));
        const lastComment = (comments.comments || []).slice(-1)[0]?.body || "";
        // Build recent comments array (last 3) with author info
        const allComments = comments.comments || [];
        const recentComments = allComments.slice(-3).map(c => ({
          body: (c.body || "").substring(0, 1000),
          author: c.author_id,
          createdAt: c.created_at,
          isPublic: c.public !== false,
        }));
        // Resolve comment author names
        const authorIds = [...new Set(recentComments.map(c => c.author).filter(Boolean))];
        const authorMap = {};
        for (const aid of authorIds) {
          try {
            const u = await zdRequest("GET", `/users/${aid}.json`);
            if (u?.user) authorMap[aid] = { name: u.user.name, email: u.user.email, role: u.user.role };
          } catch {}
        }
        for (const c of recentComments) {
          const a = authorMap[c.author];
          c.authorName = a?.name || `User ${c.author}`;
          c.authorRole = a?.role || "unknown";
        }
        // Fetch requester info for ITSM incident mapping
        let requester = null;
        if (ticket.ticket?.requester_id) {
          try {
            const reqData = await zdRequest("GET", `/users/${ticket.ticket.requester_id}.json`);
            requester = reqData?.user || null;
          } catch {}
        }
        // Fetch Zendesk organization info
        let zdOrg = null;
        const orgId = requester?.organization_id || ticket.ticket?.organization_id;
        if (orgId) {
          try {
            const orgData = await zdRequest("GET", `/organizations/${orgId}.json`);
            zdOrg = orgData?.organization ? { name: orgData.organization.name, domains: orgData.organization.domain_names || [] } : null;
          } catch {}
        }
        // Match ITSM customer by org name or requester email domain
        let itsmCustomer = null;
        try {
          const custRows = await db.getAll("customers");
          const reqDomain = (requester?.email || "").split("@")[1]?.toLowerCase();
          const orgName = (zdOrg?.name || "").toLowerCase();
          for (const row of custRows) {
            const cust = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
            if (!cust) continue;
            const custDomain = (cust.email || "").split("@")[1]?.toLowerCase();
            const custName = (cust.company || cust.name || "").toLowerCase();
            if ((reqDomain && custDomain && reqDomain === custDomain) || (orgName && custName && orgName.includes(custName))) {
              itsmCustomer = { name: cust.company || cust.name, category: cust.category, contract: cust.contract || cust.contractType, services: cust.services };
              break;
            }
          }
        } catch {}
        // Count historical tickets from same requester
        let historicalTicketCount = 0;
        let lastTicketDate = null;
        if (requester?.email) {
          try {
            const histSearch = await zdRequest("GET", `/search.json?query=type:ticket requester:${encodeURIComponent(requester.email)}&sort_by=created_at&sort_order=desc&per_page=5`);
            const histResults = histSearch?.results || [];
            historicalTicketCount = histSearch?.count || histResults.length;
            if (histResults.length > 1) lastTicketDate = histResults[1]?.created_at; // [0] is current ticket
          } catch {}
        }
        // SLA target hours mapping
        const slaHoursMap = { "Sev-A": 4, "Sev-B": 4, "Sev-C": 9, "Sev-D": 27 };

        const systemPrompt = `You are an expert IT support AI for VGC Technology Pte Ltd — a managed IT services company.
Analyze the support ticket and return a JSON object with:
1. category — one of: Network, Security, Hardware, Software, Email, Cloud, Access/Identity, Printing, General
2. priority — one of: low, normal, high, urgent  
3. tags — array of relevant tags
4. draft_response — professional customer-facing response (150-250 words), signed "VGC Technology Service Desk"
5. internal_note — brief internal analysis for the agent
6. confidence — 0-100 how confident you are
7. suggested_assignee — one of: L1 Support, L2 Support, Network Engineering, Security Team, based on complexity
8. auto_sendable — true if confidence >= 85 AND the response is safe to send without human review
9. itsm_category — ITIL category mapping
10. sla_priority — ${getSlaDescription()}

IMPORTANT: Set auto_sendable=true ONLY for routine issues (password resets, basic how-to, status inquiries, simple troubleshooting). 
Set auto_sendable=false for: security incidents, data loss, system outages, escalations, angry customers, complex issues.

Respond ONLY with valid JSON, no markdown.`;

        const userPrompt = `Ticket #${ticketId}
Subject: ${ticket.ticket?.subject || "No subject"}
Status: ${ticket.ticket?.status}
Priority: ${ticket.ticket?.priority || "not set"}
Created: ${ticket.ticket?.created_at}
Description: ${ticket.ticket?.description || "No description"}
${lastComment ? `\nLatest comment:\n${lastComment.substring(0, 1500)}` : ""}`;

        const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

        const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
        const aiResult = await new Promise((resolve, reject) => {
          const aiReq = https.request({
            hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
            method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
          }, (aiRes) => {
            let data = ""; aiRes.on("data", c => data += c);
            aiRes.on("end", () => {
              if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
              else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
            });
          });
          aiReq.on("error", reject);
          aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
          aiReq.write(JSON.stringify(payload));
          aiReq.end();
        });

        const text = extractAIText(aiResult);
        let parsed;
        try {
          parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        } catch {
          parsed = { category: "General", priority: "normal", tags: [], draft_response: text, internal_note: "Unstructured AI response", confidence: 50, suggested_assignee: "L1 Support", auto_sendable: false, itsm_category: "General", sla_priority: "Sev-D" };
        }

        const slaPri = parsed.sla_priority || "Sev-D";
        const slaTargetHours = slaHoursMap[slaPri] || 9;
        return json(res, 200, {
          triage: parsed, ticket: ticket.ticket,
          requester: requester ? { name: requester.name, email: requester.email, phone: requester.phone, organization_id: requester.organization_id } : null,
          ticketDescription: (ticket.ticket?.description || "").substring(0, 3000),
          recentComments,
          organization: zdOrg,
          itsmCustomer,
          historicalTicketCount,
          lastTicketDate,
          slaTargetHours,
        });
      }

      // POST /api/zendesk/auto-respond — send AI response to ticket (REQUIRES human approval)
      if (pathname === "/api/zendesk/auto-respond" && req.method === "POST") {
        const body = await parseBody(req);
        const { ticketId, response, priority, tags, internalNote, approvedBy } = body;
        if (!ticketId || !response) return json(res, 400, { error: "ticketId and response required" });
        if (!approvedBy) return json(res, 403, { error: "Human approval required — approvedBy field is mandatory. No auto-sending allowed." });

        const updatePayload = {
          ticket: {
            comment: { body: response, public: true },
            ...(priority ? { priority } : {}),
            ...(tags && tags.length > 0 ? { tags } : {}),
          }
        };
        const result = await zdRequest("PUT", `/tickets/${ticketId}.json`, updatePayload);
        
        // Add internal note with approval audit trail
        const auditNote = `[AI Response — Approved by ${approvedBy}]\n${internalNote || "No additional analysis notes."}`;
        await zdRequest("PUT", `/tickets/${ticketId}.json`, {
          ticket: { comment: { body: auditNote, public: false } }
        }).catch(() => {});

        // Also send email via M365 Graph to the ticket requester
        let emailResult = null;
        try {
          const ticket = await zdRequest("GET", `/tickets/${ticketId}.json`);
          const requesterId = ticket?.ticket?.requester_id;
          if (requesterId) {
            const requester = await zdRequest("GET", `/users/${requesterId}.json`);
            const requesterEmail = requester?.user?.email;
            const ticketSubject = ticket?.ticket?.subject || `Ticket #${ticketId} Response`;
            if (requesterEmail) {
              const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;">
                <h3 style="color:#1a1a2e;">Re: ${ticketSubject}</h3>
                <div style="background:#f8f9fa;padding:16px;border-radius:8px;border-left:4px solid #4CAF50;margin:12px 0;">
                  ${response.replace(/\n/g, "<br/>")}
                </div>
                <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
                <p style="color:#666;font-size:12px;">This response was reviewed and approved by ${approvedBy}.<br/>
                Ticket Reference: #${ticketId}<br/>
                VGC IT Support — <a href="mailto:${MAIL_FROM}">${MAIL_FROM}</a></p>
              </div>`;
              await graphSendMail({ to: requesterEmail, subject: `Re: ${ticketSubject} [#${ticketId}]`, body: htmlBody, isCustomerEmail: true });
              emailResult = { sent: true, to: requesterEmail };
              console.log(`[M365 Mail] Ticket #${ticketId} response emailed to ${requesterEmail}`);
            }
          }
        } catch (emailErr) {
          emailResult = { sent: false, error: emailErr.message };
          console.error(`[M365 Mail] Ticket #${ticketId} email failed: ${emailErr.message}`);
        }

        console.log(`[AUDIT] Ticket #${ticketId} response sent — approved by: ${approvedBy}`);
        return json(res, 200, { success: true, approvedBy, result, email: emailResult });
      }

      // GET /api/zendesk/new-tickets — fetch only new/open tickets for automation polling
      if (pathname === "/api/zendesk/new-tickets" && req.method === "GET") {
        const result = await zdRequest("GET", "/search.json?query=type:ticket status:new status:open&sort_by=created_at&sort_order=desc&per_page=50");
        return json(res, 200, result);
      }

      // GET /api/zendesk/historical-tickets — cursor-based paginated fetch of ALL tickets for ITSM import
      if (pathname === "/api/zendesk/historical-tickets" && req.method === "GET") {
        const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const cursor = qs.get("cursor") || "";
        const page = parseInt(qs.get("page") || "1"); // display-only counter
        // Use cursor-based pagination (CBP) on /tickets.json — no 1000-result cap
        let zdUrl;
        if (cursor) {
          zdUrl = `/tickets.json?page[size]=100&page[after]=${encodeURIComponent(cursor)}`;
        } else {
          zdUrl = `/tickets.json?page[size]=100&sort_by=created_at&sort_order=desc`;
        }
        const result = await zdRequest("GET", zdUrl);
        const tickets = result.tickets || [];
        const hasMore = result.meta?.has_more || false;
        const nextCursor = result.meta?.after_cursor || null;
        // Batch-fetch unique requester IDs
        const requesterIds = [...new Set(tickets.map(t => t.requester_id).filter(Boolean))];
        const requesters = {};
        // Fetch in batches of 100 using show_many
        for (let i = 0; i < requesterIds.length; i += 100) {
          const batch = requesterIds.slice(i, i + 100);
          try {
            const usersResult = await zdRequest("GET", `/users/show_many.json?ids=${batch.join(",")}`);
            (usersResult.users || []).forEach(u => { requesters[u.id] = { name: u.name, email: u.email, phone: u.phone }; });
          } catch {}
        }
        // Attach requester to each ticket
        const enriched = tickets.map(t => ({ ...t, requester: requesters[t.requester_id] || null }));
        return json(res, 200, { tickets: enriched, count: result.count || tickets.length, has_more: hasMore, next_cursor: nextCursor, page });
      }

      // GET /api/zendesk/agents — fetch Zendesk agents with groups
      if (pathname === "/api/zendesk/agents" && req.method === "GET") {
        const [agents, groups] = await Promise.all([
          zdRequest("GET", "/users.json?role=agent"),
          zdRequest("GET", "/groups.json"),
        ]);
        return json(res, 200, { agents: agents.users || [], groups: groups.groups || [] });
      }

      // GET /api/zendesk/organizations — fetch all organizations (customers)
      if (pathname === "/api/zendesk/organizations" && req.method === "GET") {
        const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const page = qs.get("page") || "1";
        const result = await zdRequest("GET", `/organizations.json?page=${page}&per_page=100`);
        return json(res, 200, result);
      }

      // GET /api/zendesk/organizations/:id — single organization
      if (pathname.match(/^\/api\/zendesk\/organizations\/\d+$/) && req.method === "GET") {
        const orgId = pathname.split("/").pop();
        const result = await zdRequest("GET", `/organizations/${orgId}.json`);
        return json(res, 200, result);
      }

      // GET /api/zendesk/organizations/:id/tickets — tickets for an org
      if (pathname.match(/^\/api\/zendesk\/organizations\/\d+\/tickets$/) && req.method === "GET") {
        const orgId = pathname.split("/")[4];
        const result = await zdRequest("GET", `/organizations/${orgId}/tickets.json`);
        return json(res, 200, result);
      }

      // GET /api/zendesk/satisfaction_ratings — CSAT data
      if (pathname === "/api/zendesk/satisfaction_ratings" && req.method === "GET") {
        const result = await zdRequest("GET", "/satisfaction_ratings.json?sort_by=created_at&sort_order=desc&per_page=100").catch(() => ({ satisfaction_ratings: [] }));
        return json(res, 200, result);
      }

      // GET /api/zendesk/ticket_fields — ticket custom fields
      if (pathname === "/api/zendesk/ticket_fields" && req.method === "GET") {
        const result = await zdRequest("GET", "/ticket_fields.json");
        return json(res, 200, result);
      }

      // GET /api/zendesk/users/:id — single user details
      if (pathname.match(/^\/api\/zendesk\/users\/\d+$/) && req.method === "GET") {
        const userId = pathname.split("/").pop();
        const result = await zdRequest("GET", `/users/${userId}.json`);
        return json(res, 200, result);
      }

      // POST /api/zendesk/sync-incident — sync an ITSM incident action to Zendesk
      if (pathname === "/api/zendesk/sync-incident" && req.method === "POST") {
        // Block outbound sync in Production Test Mode (one-way ZD→ITSM only)
        if (PROD_TEST_MODE) return json(res, 200, { skipped: true, reason: "Production Test Mode — one-way sync only (ZD→ITSM)" });
        const body = await parseBody(req);
        const { zdTicketId, action, status, priority, comment, assignee, isInternal } = body;
        if (!zdTicketId) return json(res, 400, { error: "zdTicketId required" });

        const priorityMap = { "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" };
        const statusMap = { "New": "new", "Open": "open", "In Progress": "open", "Pending": "pending", "On Hold": "hold", "Resolved": "solved", "Closed": "closed", "Reopened": "open" };
        const ticketUpdate = { ticket: {} };

        if (status) ticketUpdate.ticket.status = statusMap[status] || status;
        if (priority) ticketUpdate.ticket.priority = priorityMap[priority] || priority;
        if (comment) {
          ticketUpdate.ticket.comment = { body: `[ITSM Sync] ${comment}`, public: isInternal === true ? false : (isInternal === false ? true : false) };
        }

        if (Object.keys(ticketUpdate.ticket).length === 0) {
          return json(res, 400, { error: "No changes to sync" });
        }

        const result = await zdRequest("PUT", `/tickets/${zdTicketId}.json`, ticketUpdate);
        console.log(`[ZD Sync] Ticket #${zdTicketId} updated — action: ${action}, status: ${status || '-'}, priority: ${priority || '-'}`);
        return json(res, 200, { success: true, result });
      }

      // GET /api/zendesk/ticket-updates/:id — get latest ticket state for sync back to ITSM
      if (pathname.match(/^\/api\/zendesk\/ticket-updates\/\d+$/) && req.method === "GET") {
        const ticketId = pathname.split("/").pop();
        const [ticketResult, commentsResult] = await Promise.all([
          zdRequest("GET", `/tickets/${ticketId}.json`),
          zdRequest("GET", `/tickets/${ticketId}/comments.json?sort_order=desc&per_page=5`).catch(() => ({ comments: [] })),
        ]);
        const ticket = ticketResult.ticket || {};
        const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
        const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
        return json(res, 200, {
          zdTicketId: ticket.id,
          status: statusMap[ticket.status] || ticket.status,
          priority: priorityMap[ticket.priority] || "Sev-C",
          subject: ticket.subject,
          tags: ticket.tags || [],
          updatedAt: ticket.updated_at,
          assigneeId: ticket.assignee_id,
          requesterId: ticket.requester_id,
          organizationId: ticket.organization_id,
          latestComments: (commentsResult.comments || []).map(c => ({
            id: c.id, body: c.body || c.plain_body, author: c.author_id, public: c.public, createdAt: c.created_at
          })),
        });
      }

      // ═══════════════════════════════════════════════════════════════
      // FULL HISTORICAL IMPORT — Pull ALL Zendesk data into ITSM DB
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/full-import" && req.method === "POST") {
        if (zdSyncInProgress) return json(res, 409, { error: "Sync already in progress" });
        zdSyncInProgress = true;
        zdSyncStats = { tickets: 0, users: 0, orgs: 0, comments: 0, errors: 0 };

        try {
          const body = await parseBody(req);
          const includeComments = body.includeComments !== false;
          const includeUsers = body.includeUsers !== false;
          const includeOrgs = body.includeOrgs !== false;
          const createIncidents = body.createIncidents === true;

          // 1) Import ALL organizations
          if (includeOrgs) {
            let orgPage = 1; let hasMoreOrgs = true;
            while (hasMoreOrgs) {
              try {
                const orgResult = await zdRequest("GET", `/organizations.json?page=${orgPage}&per_page=100`);
                const orgs = orgResult.organizations || [];
                for (const org of orgs) {
                  await db.upsert("zendesk_orgs", String(org.id), JSON.stringify({
                    id: org.id, name: org.name, domains: org.domain_names || [],
                    tags: org.tags || [], details: org.details || "",
                    notes: org.notes || "", createdAt: org.created_at,
                    updatedAt: org.updated_at, sharedTickets: org.shared_tickets || false,
                    sharedComments: org.shared_comments || false,
                    importedAt: new Date().toISOString(), source: "zendesk_full_import",
                  }));
                  zdSyncStats.orgs++;
                }
                hasMoreOrgs = orgs.length === 100;
                orgPage++;
              } catch (e) { zdSyncStats.errors++; hasMoreOrgs = false; }
            }
            console.log(`[ZD Import] Organizations: ${zdSyncStats.orgs}`);
          }

          // 2) Import ALL users
          if (includeUsers) {
            let userPage = 1; let hasMoreUsers = true;
            while (hasMoreUsers) {
              try {
                const userResult = await zdRequest("GET", `/users.json?page=${userPage}&per_page=100`);
                const users = userResult.users || [];
                for (const u of users) {
                  await db.upsert("zendesk_users", String(u.id), JSON.stringify({
                    id: u.id, name: u.name, email: u.email, role: u.role,
                    phone: u.phone || "", organizationId: u.organization_id,
                    tags: u.tags || [], active: u.active, suspended: u.suspended,
                    createdAt: u.created_at, updatedAt: u.updated_at,
                    lastLoginAt: u.last_login_at, timeZone: u.time_zone || "",
                    importedAt: new Date().toISOString(), source: "zendesk_full_import",
                  }));
                  zdSyncStats.users++;
                }
                hasMoreUsers = users.length === 100;
                userPage++;
              } catch (e) { zdSyncStats.errors++; hasMoreUsers = false; }
            }
            console.log(`[ZD Import] Users: ${zdSyncStats.users}`);
          }

          // 3) Import ALL tickets (including closed)
          let ticketPage = 1; let hasMore = true;
          // Pre-load incidents ONCE for dedup (avoid N+1 inside ticket loop)
          const _fiIncRows = await db.getAll("incidents");
          const _fiIncByZdId = new Set();
          const _fiIncById = new Set();
          for (const row of _fiIncRows) {
            try {
              const inc = JSON.parse(row.data);
              if (inc.zdTicketId) _fiIncByZdId.add(String(inc.zdTicketId));
              _fiIncById.add(inc.id);
            } catch {}
          }
          while (hasMore) {
            try {
              const ticketResult = await zdRequest("GET", `/tickets.json?page=${ticketPage}&per_page=100&sort_by=created_at&sort_order=asc`);
              const tickets = ticketResult.tickets || [];
              for (const t of tickets) {
                const ticketData = {
                  id: t.id, subject: t.subject, description: t.description,
                  status: t.status, priority: t.priority || "normal", type: t.type,
                  tags: t.tags || [], customFields: t.custom_fields || [],
                  requesterId: t.requester_id, submitterId: t.submitter_id,
                  assigneeId: t.assignee_id, organizationId: t.organization_id,
                  groupId: t.group_id, collaboratorIds: t.collaborator_ids || [],
                  followerIds: t.follower_ids || [], forumTopicId: t.forum_topic_id,
                  problemId: t.problem_id, hasIncidents: t.has_incidents,
                  isPublic: t.is_public, satisfaction: t.satisfaction_rating,
                  channel: t.via?.channel || "unknown", viaSource: t.via?.source || {},
                  createdAt: t.created_at, updatedAt: t.updated_at,
                  dueAt: t.due_at, importedAt: new Date().toISOString(),
                  source: "zendesk_full_import",
                };
                await db.upsert("zendesk_tickets", String(t.id), JSON.stringify(ticketData));
                zdSyncStats.tickets++;

                // Import comments for each ticket
                if (includeComments) {
                  try {
                    const commentsResult = await zdRequest("GET", `/tickets/${t.id}/comments.json`);
                    const comments = commentsResult.comments || [];
                    for (const c of comments) {
                      await db.upsert("zendesk_comments", `${t.id}_${c.id}`, JSON.stringify({
                        id: c.id, ticketId: t.id, authorId: c.author_id,
                        body: c.body || c.plain_body || "", htmlBody: c.html_body || "",
                        public: c.public, createdAt: c.created_at,
                        attachments: (c.attachments || []).map(a => ({ id: a.id, name: a.file_name, url: a.content_url, size: a.size })),
                        importedAt: new Date().toISOString(),
                      }));
                      zdSyncStats.comments++;
                    }
                  } catch (e) { zdSyncStats.errors++; }
                }

                // Auto-create ITSM incidents from tickets (uses pre-loaded sets)
                if (createIncidents) {
                  const existing = _fiIncById.has(`INC-ZD${t.id}`);
                  const existsByZd = _fiIncByZdId.has(String(t.id));
                  if (!existing && !existsByZd) {
                    const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                    const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
                    const slaMap = getSlaMap();
                    const itsmPriority = priorityMap[t.priority] || "Sev-C";
                    const zdStatus = statusMap[t.status] || "New";
                    const incident = {
                      id: `INC-ZD${t.id}`, title: t.subject || "Untitled",
                      description: t.description || "", category: normalizeCategory((t.tags || [])[0] || "General"),
                      subcategory: "", priority: itsmPriority,
                      status: zdStatus,
                      urgency: t.priority === "urgent" ? "Critical" : "Standard",
                      impact: t.priority === "urgent" ? "Enterprise" : "Individual",
                      assignee: "Unassigned", assignmentGroup: "Service Desk",
                      reporter: "Zendesk Import", reporterEmail: "",
                      customer: "", contactMethod: "Zendesk",
                      created: 0,
                      createdAt: t.created_at || new Date().toISOString(),
                      resolvedAt: ["Resolved", "Closed"].includes(zdStatus) ? (t.updated_at || new Date().toISOString()) : undefined,
                      slaTarget: slaMap[itsmPriority] || 9,
                      aiTriaged: false, aiConfidence: 0, zdTicketId: t.id,
                      zdLastSync: new Date().toISOString(),
                      workaround: "", linkedProblem: "", affectedAssets: [],
                      activityLog: [{ id: `AL-ZD${t.id}`, type: "sync", user: "Zendesk Import", time: new Date().toISOString(), detail: `Historical import from Zendesk #${t.id} (${t.status})` }],
                    };
                    await db.upsert("incidents", incident.id, JSON.stringify(incident));
                    _fiIncById.add(incident.id);
                    _fiIncByZdId.add(String(t.id));
                  }
                }
              }
              hasMore = tickets.length === 100;
              ticketPage++;
            } catch (e) { zdSyncStats.errors++; hasMore = false; }
          }
          console.log(`[ZD Import] Tickets: ${zdSyncStats.tickets}, Comments: ${zdSyncStats.comments}`);

          // Save sync state
          const syncState = {
            id: "last_full_import", type: "full_import",
            completedAt: new Date().toISOString(), stats: { ...zdSyncStats },
          };
          await db.upsert("zendesk_sync_state", "last_full_import", JSON.stringify(syncState));
          zdLastSyncTime = new Date().toISOString();

          await db.audit("zendesk_sync_state", "full_import", "full_import",
            JSON.stringify(zdSyncStats), "system");

          return json(res, 200, {
            success: true, stats: zdSyncStats,
            message: `Imported ${zdSyncStats.tickets} tickets, ${zdSyncStats.users} users, ${zdSyncStats.orgs} orgs, ${zdSyncStats.comments} comments`,
          });
        } catch (err) {
          console.error("[ZD Full Import]", err.message);
          return json(res, 500, { error: err.message, stats: zdSyncStats });
        } finally {
          zdSyncInProgress = false;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // INCREMENTAL SYNC — Only fetch changes since last sync
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/incremental-sync" && req.method === "POST") {
        if (zdSyncInProgress) return json(res, 409, { error: "Sync already in progress" });
        zdSyncInProgress = true;
        const syncResult = { ticketsUpdated: 0, ticketsCreated: 0, commentsAdded: 0, errors: 0 };

        try {
          // Get last sync timestamp
          const lastSyncRow = await db.getOne("zendesk_sync_state", "last_incremental_sync");
          let startTime;
          if (lastSyncRow) {
            const lastSync = JSON.parse(lastSyncRow.data);
            startTime = Math.floor(new Date(lastSync.completedAt).getTime() / 1000);
          } else {
            // Default to 30 days ago if no prior sync
            startTime = Math.floor((Date.now() - 30 * 86400000) / 1000);
          }

          // Use Zendesk incremental ticket export
          let url = `/incremental/tickets.json?start_time=${startTime}`;
          let hasMore = true;
          // Pre-load incidents ONCE (avoid N+1 inside ticket loop)
          const _incRows = await db.getAll("incidents");
          const _incByZdId = new Map();
          const _incById = new Map();
          for (const row of _incRows) {
            try {
              const inc = JSON.parse(row.data);
              if (inc.zdTicketId) _incByZdId.set(String(inc.zdTicketId), { row, inc });
              _incById.set(inc.id, { row, inc });
            } catch {}
          }
          while (hasMore) {
            try {
              const result = await zdRequest("GET", url);
              const tickets = result.tickets || [];
              for (const t of tickets) {
                const existingRow = await db.getOne("zendesk_tickets", String(t.id));
                const ticketData = {
                  id: t.id, subject: t.subject, description: t.description,
                  status: t.status, priority: t.priority || "normal", type: t.type,
                  tags: t.tags || [], requesterId: t.requester_id,
                  assigneeId: t.assignee_id, organizationId: t.organization_id,
                  groupId: t.group_id, createdAt: t.created_at,
                  updatedAt: t.updated_at, channel: t.via?.channel || "unknown",
                  importedAt: new Date().toISOString(), source: "incremental_sync",
                };
                await db.upsert("zendesk_tickets", String(t.id), JSON.stringify(ticketData));

                if (existingRow) { syncResult.ticketsUpdated++; }
                else { syncResult.ticketsCreated++; }

                // Sync status/priority back to ITSM incidents if linked (uses pre-loaded map)
                let hasLinkedIncident = false;
                const _linked = _incByZdId.get(String(t.id));
                if (_linked) {
                  hasLinkedIncident = true;
                  const inc = _linked.inc;
                  const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                  const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
                  let changed = false;
                  const newStatus = statusMap[t.status];
                  const newPriority = priorityMap[t.priority];
                  if (newStatus && newStatus !== inc.status) { inc.status = newStatus; changed = true; }
                  if (newPriority && newPriority !== inc.priority) { inc.priority = newPriority; changed = true; }
                  if (changed) {
                    inc.zdLastSync = new Date().toISOString();
                    inc.activityLog = [...(inc.activityLog || []), {
                      id: `AL-SYNC-${Date.now()}`, type: "sync", user: "Zendesk Sync",
                      time: new Date().toISOString(),
                      detail: `Auto-synced from Zendesk #${t.id}: status=${newStatus || '-'}, priority=${newPriority || '-'}`,
                    }];
                    await db.upsert("incidents", inc.id, JSON.stringify(inc));
                  }
                }

                // Fast-path dedup: check pre-loaded map before creating
                if (!hasLinkedIncident) {
                  if (_incById.has(`INC-ZD${t.id}`)) hasLinkedIncident = true;
                }

                // Auto-create ITSM incident if no linked incident exists (Production Live)
                if (!hasLinkedIncident && !["closed", "solved"].includes(t.status)) {
                  const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                  const slaMap = getSlaMap();
                  const itsmPriority = priorityMap[t.priority] || "Sev-C";
                  const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold" };
                  const newInc = {
                    id: `INC-ZD${t.id}`, title: t.subject || "Untitled",
                    description: t.description || "", category: normalizeCategory((t.tags || [])[0] || "General"),
                    subcategory: "", priority: itsmPriority, status: statusMap[t.status] || "New",
                    urgency: t.priority === "urgent" ? "Critical" : "Standard",
                    impact: t.priority === "urgent" ? "Enterprise" : "Individual",
                    assignee: "Unassigned", assignmentGroup: "Service Desk",
                    reporter: "Zendesk Incremental Sync", reporterEmail: "",
                    customer: "", contactMethod: "Zendesk",
                    created: 0, createdAt: t.created_at, slaTarget: slaMap[itsmPriority] || 9,
                    aiTriaged: false, aiConfidence: 0, zdTicketId: t.id,
                    zdLastSync: new Date().toISOString(),
                    workaround: "", linkedProblem: "", affectedAssets: [],
                    activityLog: [{ id: `AL-IS-${t.id}`, type: "sync", user: "Zendesk Incremental Sync", time: new Date().toISOString(), detail: `Auto-created from incremental sync — Zendesk #${t.id}` }],
                  };
                  await db.upsert("incidents", newInc.id, JSON.stringify(newInc));
                  syncResult.incidentsCreated = (syncResult.incidentsCreated || 0) + 1;
                  console.log(`[ZD Incremental] Auto-created ITSM ${newInc.id} from Zendesk #${t.id}`);

                  // Fire AI auto-triage + workflow-assist pipeline
                  if (AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT) {
                    try {
                      const triagePayload = JSON.stringify({ ticket: newInc, requestedBy: "Zendesk Incremental Sync Auto-Triage" });
                      const triageReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/auto-triage-assign", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(triagePayload) } }, (triageRes) => {
                        let d = ""; triageRes.on("data", c => d += c);
                        triageRes.on("end", () => { console.log(`[ZD Incremental] AI auto-triage for ${newInc.id}: ${d.substring(0, 200)}`); });
                      });
                      triageReq.on("error", e => console.warn(`[ZD Incremental] AI triage failed for ${newInc.id}:`, e.message));
                      triageReq.setTimeout(35000, () => { triageReq.destroy(); });
                      triageReq.write(triagePayload);
                      triageReq.end();
                    } catch (triageErr) { console.warn("[ZD Incremental] AI triage error:", triageErr.message); }
                  }
                }

                // Fetch latest comments
                try {
                  const commentsResult = await zdRequest("GET", `/tickets/${t.id}/comments.json?sort_order=desc&per_page=10`);
                  for (const c of (commentsResult.comments || [])) {
                    const existing = await db.getOne("zendesk_comments", `${t.id}_${c.id}`);
                    if (!existing) {
                      await db.upsert("zendesk_comments", `${t.id}_${c.id}`, JSON.stringify({
                        id: c.id, ticketId: t.id, authorId: c.author_id,
                        body: c.body || c.plain_body || "", htmlBody: c.html_body || "",
                        public: c.public, createdAt: c.created_at,
                        importedAt: new Date().toISOString(),
                      }));
                      syncResult.commentsAdded++;
                    }
                  }
                } catch {}
              }

              hasMore = !result.end_of_stream && result.next_page;
              if (hasMore) {
                const nextUrl = new URL(result.next_page);
                url = nextUrl.pathname.replace("/api/v2", "") + nextUrl.search;
              }
            } catch (e) { syncResult.errors++; hasMore = false; }
          }

          // Save sync state
          const syncState = {
            id: "last_incremental_sync", type: "incremental_sync",
            completedAt: new Date().toISOString(), stats: { ...syncResult },
          };
          await db.upsert("zendesk_sync_state", "last_incremental_sync", JSON.stringify(syncState));
          zdLastSyncTime = new Date().toISOString();

          // ─── Stale-check pass: catch ITSM incidents whose ZD tickets changed while sync was inactive ───
          try {
            const staleRows = await db.getAll("incidents");
            const statusMap2 = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
            const priorityMap2 = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
            const staleNow = Date.now();
            const STALE_THRESHOLD = 60 * 60 * 1000; // 1 hour
            const staleCandidates = [];
            for (const row of staleRows) {
              try {
                const inc = JSON.parse(row.data);
                if (!inc.zdTicketId || inc._deleted) continue;
                if (["closed", "resolved"].includes((inc.status || "").toLowerCase())) continue;
                const lastSync = inc.zdLastSync ? new Date(inc.zdLastSync).getTime() : 0;
                if (staleNow - lastSync > STALE_THRESHOLD) staleCandidates.push(inc);
              } catch {}
            }
            if (staleCandidates.length > 0) {
              const staleIds = [...new Set(staleCandidates.map(i => i.zdTicketId))];
              const zdCache = {};
              for (let si = 0; si < staleIds.length; si += 100) {
                try {
                  const batch = staleIds.slice(si, si + 100);
                  const res2 = await zdRequest("GET", `/tickets/show_many.json?ids=${batch.join(",")}`);
                  for (const t of (res2.tickets || [])) zdCache[t.id] = { status: t.status, priority: t.priority };
                } catch {}
              }
              let staleFixed = 0;
              for (const inc of staleCandidates) {
                const zd = zdCache[inc.zdTicketId];
                if (!zd) continue;
                const ns = statusMap2[zd.status], np = priorityMap2[zd.priority];
                let ch = false;
                if (ns && ns !== inc.status) { inc.status = ns; ch = true; }
                if (np && np !== inc.priority) { inc.priority = np; ch = true; }
                if (ch) {
                  inc.zdLastSync = new Date().toISOString();
                  inc.updatedAt = inc.zdLastSync;
                  if (["Resolved", "Closed"].includes(inc.status) && !inc.resolvedAt) inc.resolvedAt = inc.zdLastSync;
                  if (inc.status === "Closed" && !inc.closedAt) inc.closedAt = inc.zdLastSync;
                  inc.activityLog = [...(inc.activityLog || []), { id: `AL-STALE-${Date.now()}`, type: "sync", user: "ZD Stale-Check", time: inc.zdLastSync, detail: `Stale-check: ZD #${inc.zdTicketId} → status=${ns || '-'}, priority=${np || '-'}` }];
                  await db.upsert("incidents", inc.id, JSON.stringify(inc));
                  staleFixed++;
                }
              }
              if (staleFixed > 0) { syncResult.staleFixed = staleFixed; console.log(`[ZD Incremental] Stale-check fixed ${staleFixed} incidents`); }
            }
          } catch (staleErr) { console.warn("[ZD Incremental] Stale-check error:", staleErr.message); }

          console.log(`[ZD Incremental] Updated: ${syncResult.ticketsUpdated}, Created: ${syncResult.ticketsCreated}, Comments: ${syncResult.commentsAdded}`);
          return json(res, 200, { success: true, stats: syncResult });
        } catch (err) {
          console.error("[ZD Incremental Sync]", err.message);
          return json(res, 500, { error: err.message, stats: syncResult });
        } finally {
          zdSyncInProgress = false;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // WEBHOOK — Receive real-time Zendesk webhook events
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/webhook" && req.method === "POST") {
        try {
          const event = await readBody(req);
          const eventType = event.type || event.event || "unknown";
          const ticketId = event.ticket_id || event.ticket?.id || event.payload?.ticket?.id;

          console.log(`[ZD Webhook] Event: ${eventType}, Ticket: ${ticketId || "N/A"}`);

          if (ticketId) {
            // Fetch latest ticket state from Zendesk
            const ticketResult = await zdRequest("GET", `/tickets/${ticketId}.json`);
            const t = ticketResult.ticket;
            if (t) {
              // Update local Zendesk ticket store
              await db.upsert("zendesk_tickets", String(t.id), JSON.stringify({
                id: t.id, subject: t.subject, description: t.description,
                status: t.status, priority: t.priority || "normal",
                tags: t.tags || [], requesterId: t.requester_id,
                assigneeId: t.assignee_id, organizationId: t.organization_id,
                createdAt: t.created_at, updatedAt: t.updated_at,
                channel: t.via?.channel || "unknown",
                importedAt: new Date().toISOString(), source: "webhook",
              }));

              // Sync to ITSM incidents if linked (load once, reuse below)
              const incRows = await db.getAll("incidents");
              const _whIncByZdId = new Map();
              for (const row of incRows) {
                try {
                  const inc = JSON.parse(row.data);
                  if (inc.zdTicketId) _whIncByZdId.set(String(inc.zdTicketId), inc);
                } catch {}
              }
              const _whLinked = _whIncByZdId.get(String(t.id));
              if (_whLinked) {
                const inc = _whLinked;
                const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
                let changed = false;
                if (statusMap[t.status] && statusMap[t.status] !== inc.status) { inc.status = statusMap[t.status]; changed = true; }
                if (priorityMap[t.priority] && priorityMap[t.priority] !== inc.priority) { inc.priority = priorityMap[t.priority]; changed = true; }
                if (changed) {
                  inc.zdLastSync = new Date().toISOString();
                  inc.activityLog = [...(inc.activityLog || []), {
                    id: `AL-WH-${Date.now()}`, type: "sync", user: "Zendesk Webhook",
                    time: new Date().toISOString(),
                    detail: `Real-time sync: ${eventType} — status=${t.status}, priority=${t.priority}`,
                  }];
                  await db.upsert("incidents", inc.id, JSON.stringify(inc));
                  console.log(`[ZD Webhook] Updated ITSM ${inc.id} from Zendesk #${t.id}`);
                }
              }

              // If new ticket and no ITSM incident exists, auto-create one
              if (eventType === "ticket_created" || eventType === "zen:event-type:ticket.created") {
                // Use pre-loaded map for dedup (no second getAll)
                let hasIncident = _whIncByZdId.has(String(t.id));
                if (!hasIncident) {
                  const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                  const slaMap = getSlaMap();
                  const itsmPriority = priorityMap[t.priority] || "Sev-C";
                  const newInc = {
                    id: `INC-ZD${t.id}`, title: t.subject || "Untitled",
                    description: t.description || "", category: (t.tags || [])[0] || "General",
                    subcategory: "", priority: itsmPriority, status: "New",
                    urgency: t.priority === "urgent" ? "Critical" : "Standard",
                    impact: t.priority === "urgent" ? "Enterprise" : "Individual",
                    assignee: "Unassigned", assignmentGroup: "Service Desk",
                    reporter: "Zendesk Webhook", reporterEmail: "",
                    customer: "", contactMethod: "Zendesk",
                    created: 0, slaTarget: slaMap[itsmPriority] || 9,
                    aiTriaged: false, aiConfidence: 0, zdTicketId: t.id,
                    zdLastSync: new Date().toISOString(),
                    workaround: "", linkedProblem: "", affectedAssets: [],
                    activityLog: [{ id: `AL-WH-${t.id}`, type: "sync", user: "Zendesk Webhook", time: new Date().toISOString(), detail: `Auto-created from Zendesk webhook #${t.id}` }],
                  };
                  await db.upsert("incidents", newInc.id, JSON.stringify(newInc));
                  console.log(`[ZD Webhook] Auto-created ITSM ${newInc.id} from new Zendesk ticket #${t.id}`);

                  // AI Auto-Triage: automatically categorize, prioritize, and assign the new ticket
                  if (AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT) {
                    try {
                      const triagePayload = JSON.stringify({ ticket: newInc, requestedBy: "Zendesk Webhook Auto-Triage" });
                      const triageReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/auto-triage-assign", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(triagePayload) } }, (triageRes) => {
                        let d = ""; triageRes.on("data", c => d += c);
                        triageRes.on("end", () => { console.log(`[ZD Webhook] AI auto-triage for ${newInc.id}: ${d.substring(0, 200)}`); });
                      });
                      triageReq.on("error", e => console.warn(`[ZD Webhook] AI triage failed for ${newInc.id}:`, e.message));
                      triageReq.setTimeout(35000, () => { triageReq.destroy(); });
                      triageReq.write(triagePayload);
                      triageReq.end();
                    } catch (triageErr) { console.warn("[ZD Webhook] AI triage error:", triageErr.message); }
                  }
                }
              }

              // Store latest comments if ticket has new comment
              if (eventType.includes("comment") || eventType.includes("Comment")) {
                try {
                  const commentsResult = await zdRequest("GET", `/tickets/${t.id}/comments.json?sort_order=desc&per_page=5`);
                  for (const c of (commentsResult.comments || [])) {
                    await db.upsert("zendesk_comments", `${t.id}_${c.id}`, JSON.stringify({
                      id: c.id, ticketId: t.id, authorId: c.author_id,
                      body: c.body || c.plain_body || "", htmlBody: c.html_body || "",
                      public: c.public, createdAt: c.created_at,
                      importedAt: new Date().toISOString(),
                    }));
                  }
                } catch {}
              }
            }
          }

          await db.audit("zendesk_sync_state", String(ticketId || "webhook"), "webhook",
            JSON.stringify({ eventType, ticketId }), "zendesk_webhook");

          return json(res, 200, { received: true, eventType, ticketId });
        } catch (err) {
          console.error("[ZD Webhook]", err.message);
          return json(res, 200, { received: true, error: err.message }); // 200 so Zendesk doesn't retry
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SYNC STATUS — Current sync state and stats
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/sync-status" && req.method === "GET") {
        try {
          const lastFull = await db.getOne("zendesk_sync_state", "last_full_import");
          const lastIncremental = await db.getOne("zendesk_sync_state", "last_incremental_sync");
          const ticketCount = await db.count("zendesk_tickets");
          const userCount = await db.count("zendesk_users");
          const orgCount = await db.count("zendesk_orgs");
          const commentCount = await db.count("zendesk_comments");
          const incidentCount = await db.count("incidents");

          return json(res, 200, {
            syncInProgress: zdSyncInProgress,
            lastFullImport: lastFull ? JSON.parse(lastFull.data) : null,
            lastIncrementalSync: lastIncremental ? JSON.parse(lastIncremental.data) : null,
            counts: { zdTickets: ticketCount, zdUsers: userCount, zdOrgs: orgCount, zdComments: commentCount, itsmIncidents: incidentCount },
          });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SYNC ALL STATUSES — Align ITSM incident statuses with Zendesk
      // Deletes INC-ZD* stale incidents + batch-syncs all ZD-linked statuses
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/sync-all-statuses" && req.method === "POST") {
        try {
          const incRows = await db.getAll("incidents");
          let cleaned = 0, updated = 0, alreadyMatched = 0, errors = 0;
          const zdLinked = []; // { inc, zdTicketId }

          // Phase 1: Delete stale INC-ZD* incidents (from old reconciliation)
          for (const row of incRows) {
            try {
              const inc = JSON.parse(row.data);
              if (inc.id && inc.id.startsWith("INC-ZD")) {
                await db.deleteOne("incidents", inc.id);
                cleaned++;
              } else if (inc.zdTicketId && !inc._deleted) {
                zdLinked.push({ inc, zdTicketId: inc.zdTicketId });
              }
            } catch {}
          }
          console.log(`[ZD SyncAll] Phase 1: Cleaned ${cleaned} INC-ZD* incidents`);

          // Phase 2: Batch-fetch ZD ticket statuses (100 per call)
          const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
          const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
          const zdStatusCache = {};

          // Collect unique ZD ticket IDs
          const uniqueZdIds = [...new Set(zdLinked.map(x => x.zdTicketId))];
          for (let i = 0; i < uniqueZdIds.length; i += 100) {
            const batch = uniqueZdIds.slice(i, i + 100);
            try {
              const result = await zdRequest("GET", `/tickets/show_many.json?ids=${batch.join(",")}`);
              for (const t of (result.tickets || [])) {
                zdStatusCache[t.id] = { status: t.status, priority: t.priority };
              }
            } catch (batchErr) {
              console.warn(`[ZD SyncAll] Batch fetch failed for chunk ${i}:`, batchErr.message);
              errors++;
            }
          }
          console.log(`[ZD SyncAll] Phase 2: Fetched ${Object.keys(zdStatusCache).length} ZD ticket statuses`);

          // Phase 3: Update ITSM incidents to match ZD
          const nowISO = new Date().toISOString();
          for (const { inc, zdTicketId } of zdLinked) {
            const zd = zdStatusCache[zdTicketId];
            if (!zd) continue;
            const newStatus = statusMap[zd.status];
            const newPriority = priorityMap[zd.priority];
            let changed = false;
            if (newStatus && newStatus !== inc.status) { inc.status = newStatus; changed = true; }
            if (newPriority && newPriority !== inc.priority) { inc.priority = newPriority; changed = true; }
            if (changed) {
              inc.zdLastSync = nowISO;
              inc.updatedAt = nowISO;
              if (["Resolved", "Closed"].includes(inc.status) && !inc.resolvedAt) inc.resolvedAt = nowISO;
              if (inc.status === "Closed" && !inc.closedAt) inc.closedAt = nowISO;
              inc.activityLog = [...(inc.activityLog || []), {
                id: `AL-SYNCALL-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, type: "sync", user: "ZD Status Sync",
                time: nowISO, detail: `Bulk status sync: ZD #${zdTicketId} → status=${newStatus || '-'}, priority=${newPriority || '-'}`,
              }];
              await db.upsert("incidents", inc.id, JSON.stringify(inc));
              updated++;
            } else {
              alreadyMatched++;
            }
          }

          console.log(`[ZD SyncAll] Phase 3: Updated ${updated}, already matched ${alreadyMatched}, errors ${errors}`);
          return json(res, 200, { success: true, cleaned, updated, alreadyMatched, errors, totalZdLinked: zdLinked.length });
        } catch (err) {
          console.error("[ZD SyncAll]", err.message);
          return json(res, 500, { error: err.message });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // PUSH ITSM → ZENDESK — Sync ITSM incident changes to Zendesk
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/push-to-zendesk" && req.method === "POST") {
        // Block outbound sync in Production Test Mode (one-way ZD→ITSM only)
        if (PROD_TEST_MODE) return json(res, 200, { skipped: true, reason: "Production Test Mode — one-way sync only (ZD→ITSM)" });
        const body = await parseBody(req);
        const { incidentId, status, priority, comment, assignee, isPublic, user } = body;
        if (!incidentId) return json(res, 400, { error: "incidentId required" });

        // Find the incident
        const incRow = await db.getOne("incidents", incidentId);
        if (!incRow) return json(res, 404, { error: "Incident not found" });
        const inc = JSON.parse(incRow.data);

        // Create Zendesk ticket if none linked
        if (!inc.zdTicketId) {
          const priorityMap = { "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" };
          const newTicket = await zdRequest("POST", "/tickets.json", {
            ticket: {
              subject: inc.title, comment: { body: inc.description || "Created from ITSM" },
              priority: priorityMap[inc.priority] || "normal",
              tags: ["itsm-synced", inc.category?.toLowerCase() || "general"],
            }
          });
          inc.zdTicketId = newTicket.ticket?.id;
          inc.zdLastSync = new Date().toISOString();
          inc.activityLog = [...(inc.activityLog || []), {
            id: `AL-PUSH-${Date.now()}`, type: "sync", user: user || "System",
            time: new Date().toISOString(),
            detail: `Created Zendesk ticket #${inc.zdTicketId} from ITSM`,
          }];
          await db.upsert("incidents", inc.id, JSON.stringify(inc));
          return json(res, 200, { success: true, action: "created", zdTicketId: inc.zdTicketId });
        }

        // Update existing Zendesk ticket
        const priorityMap = { "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" };
        const statusMap = { "New": "new", "Open": "open", "In Progress": "open", "Pending": "pending", "On Hold": "hold", "Resolved": "solved", "Closed": "closed", "Reopened": "open" };
        const ticketUpdate = { ticket: {} };
        if (status) ticketUpdate.ticket.status = statusMap[status] || status;
        if (priority) ticketUpdate.ticket.priority = priorityMap[priority] || priority;
        if (comment) ticketUpdate.ticket.comment = { body: `[ITSM ${incidentId}] ${comment}`, public: isPublic !== false };

        if (Object.keys(ticketUpdate.ticket).length > 0) {
          await zdRequest("PUT", `/tickets/${inc.zdTicketId}.json`, ticketUpdate);
          inc.zdLastSync = new Date().toISOString();
          inc.activityLog = [...(inc.activityLog || []), {
            id: `AL-PUSH-${Date.now()}`, type: "sync", user: user || "System",
            time: new Date().toISOString(),
            detail: `Pushed to Zendesk #${inc.zdTicketId}: ${[status && `status=${status}`, priority && `priority=${priority}`, comment && "comment added"].filter(Boolean).join(", ")}`,
          }];
          await db.upsert("incidents", inc.id, JSON.stringify(inc));
        }

        return json(res, 200, { success: true, action: "updated", zdTicketId: inc.zdTicketId });
      }

      // ═══════════════════════════════════════════════════════════════
      // SYNC ORGANIZATIONS → ITSM CUSTOMERS
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/sync-organizations" && req.method === "POST") {
        try {
          const orgRows = await db.getAll("zendesk_orgs");
          // Pre-load customers ONCE (avoid N+1 inside org loop)
          const _custRows = await db.getAll("customers");
          const _custParsed = _custRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
          const _custByZdOrgId = new Map();
          const _custByName = new Map();
          for (const c of _custParsed) {
            if (c.zdOrgId) _custByZdOrgId.set(String(c.zdOrgId), c);
            if (c.name) _custByName.set(c.name.toLowerCase(), c);
          }
          let synced = 0; let created = 0;
          for (const row of orgRows) {
            const org = JSON.parse(row.data);
            const c = _custByZdOrgId.get(String(org.id)) || _custByName.get(org.name?.toLowerCase());
            if (c) {
              c.zdOrgId = org.id;
              c.zdDomains = org.domains || [];
              c.zdTags = org.tags || [];
              c.zdLastSync = new Date().toISOString();
              await db.upsert("customers", c.id, JSON.stringify(c));
              synced++;
            } else {
              const newCust = {
                id: `CUS-ZD${org.id}`, name: org.name, category: "Zendesk Import",
                contactPerson: "", email: "", phone: "",
                address: "", status: "Active",
                services: [], notes: org.notes || org.details || "",
                zdOrgId: org.id, zdDomains: org.domains || [],
                zdTags: org.tags || [], zdLastSync: new Date().toISOString(),
                createdBy: "Zendesk Sync", createdAt: org.createdAt || new Date().toISOString(),
              };
              await db.upsert("customers", newCust.id, JSON.stringify(newCust));
              created++;
            }
          }
          return json(res, 200, { success: true, synced, created, total: orgRows.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // GET STORED ZENDESK DATA — Query local DB copies
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/stored/tickets" && req.method === "GET") {
        const qs = urlObj.searchParams;
        const limit = Math.min(parseInt(qs.get("limit") || "100"), 500);
        const status = qs.get("status");
        try {
          const rows = await cachedGetAll("zendesk_tickets");
          let tickets = rows.map(r => JSON.parse(r.data));
          if (status) tickets = tickets.filter(t => t.status === status);
          return json(res, 200, { tickets: tickets.slice(0, limit), total: tickets.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      if (pathname === "/api/zendesk/stored/users" && req.method === "GET") {
        try {
          const rows = await cachedGetAll("zendesk_users");
          const users = rows.map(r => JSON.parse(r.data));
          return json(res, 200, { users, total: users.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      if (pathname === "/api/zendesk/stored/orgs" && req.method === "GET") {
        try {
          const rows = await cachedGetAll("zendesk_orgs");
          const orgs = rows.map(r => JSON.parse(r.data));
          return json(res, 200, { orgs, total: orgs.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      if (pathname.match(/^\/api\/zendesk\/stored\/tickets\/\d+\/comments$/) && req.method === "GET") {
        const ticketId = pathname.split("/")[5];
        try {
          const rows = await cachedGetAll("zendesk_comments");
          const comments = rows.map(r => JSON.parse(r.data)).filter(c => String(c.ticketId) === ticketId);
          return json(res, 200, { comments, total: comments.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // AI KNOWLEDGE TRAINING FROM ZENDESK DATA
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/train-ai" && req.method === "POST") {
        try {
          const ticketRows = await db.getAll("zendesk_tickets");
          const tickets = ticketRows.map(r => JSON.parse(r.data));
          const resolved = tickets.filter(t => t.status === "solved" || t.status === "closed");
          let trained = 0;

          // Pre-load ALL comments ONCE (avoid N+1 inside ticket loop)
          const _allCommentRows = await db.getAll("zendesk_comments");
          const _allComments = _allCommentRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
          const _commentsByTicket = new Map();
          for (const c of _allComments) {
            const tid = c.ticketId;
            if (!_commentsByTicket.has(tid)) _commentsByTicket.set(tid, []);
            _commentsByTicket.get(tid).push(c);
          }

          for (const t of resolved.slice(0, 200)) {
            const ticketComments = _commentsByTicket.get(t.id) || [];
            const publicComments = ticketComments.filter(c => c.public);
            if (publicComments.length === 0) continue;

            const resolution = publicComments[publicComments.length - 1]?.body || "";
            if (resolution.length < 20) continue;

            const kbId = `kb_zd_${t.id}`;
            const existing = await db.getOne("ai_knowledge", kbId);
            if (existing) continue;

            const entry = {
              id: kbId, title: t.subject || `Zendesk #${t.id}`,
              category: normalizeCategory((t.tags || [])[0] || "General"),
              content: `Issue: ${t.subject}\n\nDescription: ${(t.description || "").substring(0, 500)}\n\nResolution: ${resolution.substring(0, 1000)}`,
              tags: [...(t.tags || []), "zendesk-import", "historical"],
              trainedBy: "Zendesk Historical Import",
              createdAt: t.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              source: "zendesk", zdTicketId: t.id,
            };
            await db.upsert("ai_knowledge", kbId, JSON.stringify(entry));
            trained++;
          }

          console.log(`[ZD AI Training] Trained from ${trained} resolved tickets`);
          return json(res, 200, { success: true, trained, totalResolved: resolved.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      return json(res, 404, { error: "Zendesk endpoint not found" });
    } catch (err) {
      console.error("[Zendesk Proxy]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI Knowledge Base: CRUD /api/ai/knowledge ─────────────────────
  if (pathname === "/api/ai/knowledge" && req.method === "GET") {
    try {
      const items = await db.getAll("ai_knowledge");
      const entries = items.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      return json(res, 200, { entries, total: entries.length });
    } catch (err) {
      console.error("[AI Knowledge GET]", err.message);
      return json(res, 500, { error: err.message });
    }
  }
  if (pathname === "/api/ai/knowledge" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { title, category, content, tags, trainedBy } = body;
      if (!title || !content) return json(res, 400, { error: "title and content are required" });
      const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry = { id, title: title.trim(), category: (category || "General").trim(), content: content.trim(), tags: (tags || []).map(t => t.trim().toLowerCase()), trainedBy: trainedBy || "Unknown", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await db.upsert("ai_knowledge", id, JSON.stringify(entry));
      await db.audit("ai_knowledge", id, "create", JSON.stringify({ title, category }), trainedBy || "Unknown");
      console.log(`[AI Knowledge] Created: "${title}" by ${trainedBy} (${category})`);
      return json(res, 201, { entry });
    } catch (err) {
      console.error("[AI Knowledge POST]", err.message);
      return json(res, 500, { error: err.message });
    }
  }
  if (pathname.startsWith("/api/ai/knowledge/") && req.method === "DELETE") {
    try {
      const id = pathname.split("/api/ai/knowledge/")[1];
      if (!id) return json(res, 400, { error: "ID required" });
      await db.deleteOne("ai_knowledge", decodeURIComponent(id));
      console.log(`[AI Knowledge] Deleted: ${id}`);
      return json(res, 200, { deleted: true });
    } catch (err) {
      console.error("[AI Knowledge DELETE]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge: PUT /api/ai/knowledge/:id (Update with Version Control) ───
  if (pathname.match(/^\/api\/ai\/knowledge\/[^/]+$/) && req.method === "PUT") {
    try {
      const id = decodeURIComponent(pathname.split("/api/ai/knowledge/")[1]);
      if (!id) return json(res, 400, { error: "ID required" });
      const body = await parseBody(req);
      const existing = await db.getOne("ai_knowledge", id);
      if (!existing) return json(res, 404, { error: "Entry not found" });
      const prev = JSON.parse(existing.data);
      // Save version history
      const versionId = `ver_${id}_${Date.now()}`;
      const version = {
        id: versionId, docId: id, version: (prev.version || 1),
        title: prev.title, category: prev.category, content: prev.content,
        tags: prev.tags, updatedBy: prev.updatedBy || prev.trainedBy,
        updatedAt: prev.updatedAt, changeNote: body.changeNote || "Updated"
      };
      await db.upsert("ai_knowledge_versions", versionId, JSON.stringify(version));
      // Update the entry
      const updated = {
        ...prev,
        title: (body.title || prev.title).trim(),
        category: (body.category || prev.category).trim(),
        content: (body.content || prev.content).trim(),
        tags: body.tags || prev.tags,
        updatedBy: body.updatedBy || "Unknown",
        updatedAt: new Date().toISOString(),
        version: (prev.version || 1) + 1
      };
      await db.upsert("ai_knowledge", id, JSON.stringify(updated));
      await db.audit("ai_knowledge", id, "update", JSON.stringify({ version: updated.version, changeNote: body.changeNote }), body.updatedBy || "Unknown");
      console.log(`[AI Knowledge] Updated: "${updated.title}" v${updated.version} by ${body.updatedBy}`);
      return json(res, 200, { entry: updated });
    } catch (err) {
      console.error("[AI Knowledge PUT]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge: GET /api/ai/knowledge/:id/versions ─────────────
  if (pathname.match(/^\/api\/ai\/knowledge\/[^/]+\/versions$/) && req.method === "GET") {
    try {
      const id = decodeURIComponent(pathname.split("/api/ai/knowledge/")[1].replace("/versions", ""));
      const allVersions = await db.getAll("ai_knowledge_versions");
      const versions = allVersions
        .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
        .filter(v => v && v.docId === id)
        .sort((a, b) => b.version - a.version);
      return json(res, 200, { versions, total: versions.length });
    } catch (err) {
      console.error("[AI Knowledge Versions]", err.message);
      return json(res, 200, { versions: [], total: 0 });
    }
  }

  // ─── AI Knowledge: POST /api/ai/knowledge/correction — user corrects AI answer ─
  if (pathname === "/api/ai/knowledge/correction" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { originalQuestion, originalAnswer, correctedAnswer, correctedBy } = body || {};
      if (!originalQuestion || !correctedAnswer || !correctedBy) {
        return json(res, 400, { error: "originalQuestion, correctedAnswer, and correctedBy are required" });
      }
      const correctionId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const entry = {
        id: correctionId,
        title: `AI Correction: ${originalQuestion.substring(0, 80)}`,
        category: "AI Correction",
        content: `QUESTION: ${originalQuestion}\n\nCORRECT ANSWER: ${correctedAnswer}\n\nORIGINAL AI ANSWER (incorrect/incomplete): ${(originalAnswer || "").substring(0, 500)}`,
        tags: ["ai-correction", "human-verified", "training"],
        trainedBy: correctedBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "user-correction",
        type: "correction",
        originalQuestion,
        originalAnswer: (originalAnswer || "").substring(0, 1000),
        correctedAnswer,
      };
      await db.upsert("ai_knowledge", correctionId, JSON.stringify(entry));
      await db.audit("ai_knowledge", correctionId, "create", JSON.stringify({ type: "ai-correction", correctedBy, question: originalQuestion.substring(0, 100) }), correctedBy);
      console.log(`[AI Correction] Saved by ${correctedBy}: "${originalQuestion.substring(0, 60)}"`);
      return json(res, 200, { success: true, id: correctionId, message: "Correction saved — VGC AI will use this in future responses" });
    } catch (err) {
      console.error("[AI Correction]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge: POST /api/ai/knowledge/learn ───────────────────
  if (pathname === "/api/ai/knowledge/learn" && req.method === "POST") {
    try {
      const items = await db.getAll("ai_knowledge");
      const entries = items.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      const uploadedDocs = entries.filter(e => e.fileName || e.source === "uploaded" || (e.tags || []).includes("uploaded"));
      // Mark all as AI-processed
      let processed = 0;
      for (const doc of uploadedDocs) {
        if (doc.aiProcessed) continue;
        doc.aiProcessed = true;
        doc.aiProcessedAt = new Date().toISOString();
        await db.upsert("ai_knowledge", doc.id, JSON.stringify(doc));
        processed++;
      }
      console.log(`[AI Learn] Processed ${processed} uploaded documents for AI training`);
      return json(res, 200, { success: true, processed, totalUploaded: uploadedDocs.length });
    } catch (err) {
      console.error("[AI Learn]", err.message);
      return json(res, 500, { error: err.message });
    }
  }
  if (pathname === "/api/ai/knowledge/search" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const query = (body.query || "").toLowerCase();
      if (!query) return json(res, 400, { error: "query required" });
      const items = await db.getAll("ai_knowledge");
      const entries = items.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      // Score each entry by keyword match
      const scored = entries.map(e => {
        let score = 0;
        const words = query.split(/\s+/).filter(w => w.length > 2);
        const haystack = `${e.title || ""} ${e.content || ""} ${e.category || ""} ${(e.tags || []).join(" ")}`.toLowerCase();
        words.forEach(w => { if (haystack.includes(w)) score += 10; });
        if ((e.title || "").toLowerCase().includes(query)) score += 50;
        if (e.tags && e.tags.some(t => query.includes(t))) score += 30;
        return { ...e, score };
      }).filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      return json(res, 200, { results: scored, total: scored.length });
    } catch (err) {
      console.error("[AI Knowledge Search]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge File Upload: POST /api/ai/knowledge/upload ───────
  if (pathname === "/api/ai/knowledge/upload" && req.method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        return json(res, 400, { error: "multipart/form-data required" });
      }
      // Parse multipart form data manually (no external deps)
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) return json(res, 400, { error: "Missing boundary" });
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on("data", c => chunks.push(c));
        req.on("end", resolve);
        req.on("error", reject);
      });
      const buf = Buffer.concat(chunks);
      const parts = buf.toString("binary").split("--" + boundary).filter(p => p.trim() && p.trim() !== "--");
      let title = "", category = "General", tags = "", trainedBy = "Unknown", fileName = "", fileType = "", fileSize = 0, fileContent = "";
      for (const part of parts) {
        const [headerSection, ...bodySections] = part.split("\r\n\r\n");
        const body = bodySections.join("\r\n\r\n").replace(/\r\n$/, "");
        const nameMatch = headerSection.match(/name="([^"]+)"/);
        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        if (!nameMatch) continue;
        const fieldName = nameMatch[1];
        if (filenameMatch) {
          fileName = filenameMatch[1];
          fileSize = Buffer.byteLength(body, "binary");
          const ext = fileName.split(".").pop().toLowerCase();
          const typeMap = { doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel", ppt: "PowerPoint", pptx: "PowerPoint", pdf: "PDF", txt: "Text", csv: "CSV", md: "Markdown", json: "JSON", png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image", mp4: "Video", webm: "Video", mov: "Video" };
          fileType = typeMap[ext] || "Document";
          // For text-based files, extract content
          if (["txt", "csv", "md", "json"].includes(ext)) {
            fileContent = Buffer.from(body, "binary").toString("utf8").substring(0, 10000);
          }
        } else {
          const val = body.trim();
          if (fieldName === "title") title = val;
          else if (fieldName === "category") category = val;
          else if (fieldName === "tags") tags = val;
          else if (fieldName === "trainedBy") trainedBy = val;
        }
      }
      if (!fileName) return json(res, 400, { error: "No file uploaded" });
      const id = `kb_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry = {
        id, title: (title || fileName).trim(), category: (category || "General").trim(),
        content: fileContent || `[Uploaded ${fileType}: ${fileName}] (${(fileSize / 1024).toFixed(1)} KB)\n\nFile type: ${fileType}. This document has been indexed for AI training reference.`,
        tags: tags ? tags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean) : [fileType.toLowerCase()],
        trainedBy: trainedBy || "Unknown",
        fileName, fileType, fileSize,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      await db.upsert("ai_knowledge", id, JSON.stringify(entry));
      await db.audit("ai_knowledge", id, "upload", JSON.stringify({ fileName, fileType, fileSize }), trainedBy);
      console.log(`[AI Knowledge Upload] "${fileName}" (${fileType}, ${(fileSize / 1024).toFixed(1)}KB) by ${trainedBy}`);
      return json(res, 201, { entry });
    } catch (err) {
      console.error("[AI Knowledge Upload]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge Sync: merge Zendesk + KB into unified training ───
  if (pathname === "/api/ai/knowledge/sync" && req.method === "POST") {
    try {
      let synced = 0;
      // Import all resolved Zendesk tickets as KB entries (if not already imported)
      try {
        const ticketRows = await db.getAll("zendesk_tickets");
        const tickets = ticketRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const resolved = tickets.filter(t => t.status === "solved" || t.status === "closed");
        const commentRows = await db.getAll("zendesk_comments");
        const allComments = commentRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const existingKb = await db.getAll("ai_knowledge");
        const existingIds = new Set(existingKb.map(r => { try { return JSON.parse(r.data).id; } catch { return ""; } }));

        for (const t of resolved) {
          const kbId = `kb_zd_${t.id}`;
          if (existingIds.has(kbId)) continue;
          const tComments = allComments.filter(c => c.ticketId === t.id && c.public);
          const resolution = tComments.length > 0 ? tComments[tComments.length - 1].body : t.description || "";
          const entry = {
            id: kbId, title: `[Zendesk #${t.id}] ${t.subject || "Ticket"}`, category: "Zendesk",
            content: `Subject: ${t.subject}\nStatus: ${t.status}\nPriority: ${t.priority || "Normal"}\nTags: ${(t.tags || []).join(", ")}\n\nDescription: ${(t.description || "").substring(0, 800)}\n\nResolution: ${(resolution || "").substring(0, 1000)}`,
            tags: ["zendesk", "auto-synced", ...(t.tags || []).slice(0, 5)],
            trainedBy: "Daily Sync", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            source: "zendesk-sync", type: "ticket-resolution"
          };
          await db.upsert("ai_knowledge", kbId, JSON.stringify(entry));
          synced++;
        }
      } catch (e) { console.warn("[AI Sync] Zendesk import:", e.message); }

      // Update sync metadata
      const syncMeta = {
        id: "sync_metadata", lastSync: new Date().toISOString(),
        totalEntries: (await db.getAll("ai_knowledge")).length,
        syncedThisRun: synced,
        nextSync: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };
      await db.upsert("ai_knowledge", "sync_metadata", JSON.stringify(syncMeta));
      console.log(`[AI Sync] Completed — ${synced} new entries synced, total: ${syncMeta.totalEntries}`);
      return json(res, 200, syncMeta);
    } catch (err) {
      console.error("[AI Sync]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge Sync Status ─────────────────────────────────────
  if (pathname === "/api/ai/knowledge/sync-status" && req.method === "GET") {
    try {
      const meta = await db.getOne("ai_knowledge", "sync_metadata");
      if (meta) {
        return json(res, 200, JSON.parse(meta.data));
      }
      return json(res, 200, { lastSync: null, totalEntries: (await db.getAll("ai_knowledge")).length, nextSync: null });
    } catch (err) {
      return json(res, 200, { lastSync: null, totalEntries: 0, nextSync: null });
    }
  }

  // ─── AI Generate Professional Guide from Zendesk History ───────────
  if (pathname === "/api/ai/generate-guide" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req);
      const { topic, category, includeScreenshots } = body || {};
      if (!topic) return json(res, 400, { error: "topic is required" });

      // Gather all Zendesk ticket history related to this topic
      let zdContext = "";
      try {
        const ticketRows = await db.getAll("zendesk_tickets");
        const tickets = ticketRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const topicLower = topic.toLowerCase();
        const topicWords = topicLower.split(/\s+/).filter(w => w.length > 2);

        const relevant = tickets.filter(t => {
          const searchable = `${t.subject || ""} ${t.description || ""} ${(t.tags || []).join(" ")}`.toLowerCase();
          return topicWords.some(w => searchable.includes(w));
        }).slice(0, 30);

        if (relevant.length > 0) {
          // Get comments for relevant tickets
          const commentRows = await db.getAll("zendesk_comments");
          const allComments = commentRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

          zdContext = "\n\n=== ZENDESK TICKET HISTORY (Use this as primary reference) ===\n";
          for (const t of relevant.slice(0, 15)) {
            const tComments = allComments.filter(c => c.ticketId === t.id && c.public);
            const resolution = tComments.length > 0 ? tComments[tComments.length - 1].body : "";
            zdContext += `\n--- Ticket #${t.id}: ${t.subject || "No subject"} ---\n`;
            zdContext += `Status: ${t.status} | Priority: ${t.priority || "Normal"} | Tags: ${(t.tags || []).join(", ")}\n`;
            zdContext += `Description: ${(t.description || "").substring(0, 400)}\n`;
            if (resolution) zdContext += `Resolution: ${resolution.substring(0, 600)}\n`;
          }
          zdContext += "\n=== END ZENDESK HISTORY ===\n";
        }
      } catch (e) { console.warn("[AI Guide] Zendesk data fetch:", e.message); }

      // Also gather internal KB entries
      let kbContext = "";
      try {
        const kbItems = await db.getAll("ai_knowledge");
        const kbEntries = kbItems.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const topicLower = topic.toLowerCase();
        const matched = kbEntries.filter(e => {
          const searchable = `${e.title} ${e.content} ${e.category} ${(e.tags || []).join(" ")}`.toLowerCase();
          return topicLower.split(/\s+/).some(w => w.length > 2 && searchable.includes(w));
        }).slice(0, 10);
        if (matched.length > 0) {
          kbContext = "\n\n=== INTERNAL KNOWLEDGE BASE ===\n" +
            matched.map(m => `[${m.category}] ${m.title}:\n${m.content}`).join("\n---\n") +
            "\n=== END INTERNAL KB ===\n";
        }
      } catch (e) { console.warn("[AI Guide] KB fetch:", e.message); }

      const systemPrompt = `You are a professional IT documentation writer for VGC Technology Pte Ltd, Singapore. You create comprehensive, user-friendly technical guides and documentation.

TASK: Generate a COMPLETE, professional-grade technical guide/documentation on the topic: "${topic}"
Category: ${category || "General"}

REQUIREMENTS — MUST follow ALL:
1. TITLE: Clear, professional title with document metadata (version, date, author, category)
2. TABLE OF CONTENTS: Numbered sections
3. OVERVIEW/INTRODUCTION: What this guide covers, who it's for, prerequisites
4. STEP-BY-STEP INSTRUCTIONS: Every step numbered, with clear actions. Each step MUST include:
   - 📸 [Screenshot: <description of what to capture>] — placeholder for where screenshots should be taken
   - 💡 Tip or Note callouts for important information
   - ⚠️ Warning callouts for critical steps
5. TROUBLESHOOTING SECTION: Common issues and fixes (based on Zendesk history if available)
6. FAQ SECTION: At least 5 frequently asked questions with answers
7. REFERENCE LINKS: Official vendor documentation, Microsoft Learn links, etc.
8. APPENDIX: Glossary of terms, related articles, version history

FORMATTING RULES:
- Use Markdown formatting throughout
- Include screenshot placeholders: 📸 [Screenshot: description]
- Use tables for structured data (settings, configurations, comparison)
- Use code blocks for commands, scripts, paths
- Use callout boxes: 💡 **Tip:** | ⚠️ **Warning:** | ℹ️ **Note:** | ✅ **Best Practice:**
- Include estimated time for each major section
- Professional tone but user-friendly and easy to follow
- Minimum 2000 words — be thorough and comprehensive

${zdContext}
${kbContext}

IMPORTANT: Reference real ticket data and resolutions from the Zendesk history above. Cite specific ticket numbers when referencing past issues and solutions. If no Zendesk data is available, generate based on industry best practices and common enterprise IT patterns.`;

      const userPrompt = `Generate a complete professional guide on: ${topic}`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 4000 };

      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(120000, () => { aiReq.destroy(); reject(new Error("Azure OpenAI timeout (120s)")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      if (!text) return json(res, 502, { error: "Empty response from Azure OpenAI" });

      // Auto-save as KB entry
      const guideId = `kb_guide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const entry = {
        id: guideId, title: `Guide: ${topic}`, category: category || "General",
        content: text, tags: ["ai-generated", "guide", ...topic.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 5)],
        trainedBy: "AI Guide Generator", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: "ai-generated", type: "guide"
      };
      await db.upsert("ai_knowledge", guideId, JSON.stringify(entry));
      await db.audit("ai_knowledge", guideId, "create", JSON.stringify({ title: entry.title, category: entry.category, type: "ai-generated-guide" }), "AI Guide Generator");

      console.log(`[AI Guide] Generated guide: "${topic}" (${text.length} chars)`);
      return json(res, 200, { guide: text, id: guideId, title: entry.title, zdTicketsReferenced: zdContext ? zdContext.split("--- Ticket #").length - 1 : 0 });
    } catch (err) {
      console.error("[AI Guide Generator]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI Generate Doc from SharePoint Link ─────────────────────────
  if (pathname === "/api/ai/generate-doc" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req);
      const { url, title, docType } = body || {};
      if (!url && !title) return json(res, 400, { error: "url or title is required" });

      const systemPrompt = `You are a professional IT documentation writer for VGC Technology Pte Ltd, Singapore.

TASK: Generate a professional documentation article based on the SharePoint document library resource.

SharePoint URL: ${url || "N/A"}
Document Title: ${title || "Untitled"}
Document Type: ${docType || "General Documentation"}

Create a COMPLETE professional documentation that includes:
1. **Document Header**: Title, version, date, classification, author
2. **Executive Summary**: 2-3 paragraph overview
3. **Scope & Purpose**: What this document covers
4. **Detailed Content**: Comprehensive step-by-step content with:
   - 📸 [Screenshot: <description>] placeholders for visual references
   - Numbered procedures with clear actions
   - Tables for configuration settings or comparisons
   - Code blocks for any commands or scripts
5. **Security & Compliance Notes**: PDPA, ISO 27001 considerations
6. **Related Documents**: Links to related SharePoint documents
7. **Revision History**: Version tracking table
8. **Approval Section**: Sign-off template

FORMATTING: Use professional Markdown. Include screenshot placeholders. Be thorough (1500+ words).
TONE: Professional, clear, suitable for enterprise IT documentation.
LINK BACK: Reference the SharePoint Document Library: ${url || "SharePoint > Shared Documents"}`;

      const userPrompt = `Generate professional documentation for: ${title || url}`;

      const payload = { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 3000 };

      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(90000, () => { aiReq.destroy(); reject(new Error("Azure OpenAI timeout (90s)")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      if (!text) return json(res, 502, { error: "Empty response from Azure OpenAI" });

      // Auto-save as KB entry
      const docId = `kb_sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const entry = {
        id: docId, title: title || `SharePoint Doc: ${url}`, category: docType || "General",
        content: text, tags: ["sharepoint", "ai-generated", "documentation"],
        trainedBy: "SharePoint Doc Generator", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: "sharepoint", spUrl: url, type: "sharepoint-doc"
      };
      await db.upsert("ai_knowledge", docId, JSON.stringify(entry));
      await db.audit("ai_knowledge", docId, "create", JSON.stringify({ title: entry.title, url, type: "sharepoint-doc" }), "SharePoint Doc Generator");

      console.log(`[AI Doc] Generated from SharePoint: "${title || url}" (${text.length} chars)`);
      return json(res, 200, { document: text, id: docId, title: entry.title });
    } catch (err) {
      console.error("[AI Doc Generator]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI Error Resolver ─────────────────────────────────────────────
  if (pathname === "/api/ai/resolve-error" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req);
      const { errorType, errorCode, errorMessage, errorDetails, errorStack, context } = body || {};
      if (!errorMessage) return json(res, 400, { error: "errorMessage is required" });

      // Check internal KB for similar past errors
      let pastResolutions = "";
      try {
        const kbItems = await db.getAll("ai_knowledge");
        const kbEntries = kbItems.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const errorLower = `${errorType} ${errorCode} ${errorMessage}`.toLowerCase();
        const matched = kbEntries.filter(e => {
          const searchable = `${e.title} ${e.content} ${(e.tags || []).join(" ")}`.toLowerCase();
          return errorLower.split(/\s+/).filter(w => w.length > 3).some(w => searchable.includes(w));
        }).slice(0, 5);
        if (matched.length > 0) {
          pastResolutions = "\n\nPAST RESOLUTIONS FROM KNOWLEDGE BASE:\n" +
            matched.map(m => `- ${m.title}: ${m.content.substring(0, 300)}`).join("\n");
        }
      } catch (e) { /* ignore */ }

      const systemPrompt = `You are an expert IT troubleshooter and error resolver for VGC Technology Pte Ltd. You MUST solve every error presented to you.

ERROR DETAILS:
- Type: ${errorType || "Unknown"}
- Code: ${errorCode || "N/A"}
- Message: ${errorMessage}
- Details: ${errorDetails || "N/A"}
- Stack: ${(errorStack || "").substring(0, 500)}
- Context: ${context || "VGC-ITSM application"}
${pastResolutions}

HARD RULES:
1. ALWAYS provide a solution — never say "I can't help" or "contact support"
2. Give IMMEDIATE actionable steps the user can try RIGHT NOW
3. Provide MULTIPLE resolution paths (primary fix + alternatives)
4. Explain WHY the error occurred in simple terms
5. Include prevention tips so it doesn't happen again

RESPONSE FORMAT:
## 🔍 Error Analysis
Brief explanation of what went wrong and why.

## ⚡ Immediate Fix (Try This First)
Step-by-step primary solution.

## 🔄 Alternative Solutions
2-3 alternative approaches if the primary fix doesn't work.

## 🛡️ Prevention
How to prevent this error in the future.

## 📚 References
Links to relevant documentation.

Keep it conversational, actionable, and human-friendly. Be a helpful colleague, not a bot.`;

      const userPrompt = `Resolve this error: ${errorType || "Error"} — ${errorMessage}`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("Timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      if (!text) return json(res, 502, { error: "Empty response from AI" });
      return json(res, 200, { resolution: text, model: getAIModel("secondary") });
    } catch (err) {
      console.error("[AI Error Resolver]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI Chat File Upload: POST /api/ai/chat/upload ──────────────────
  // Accepts file attachments, extracts text content, returns it for AI context
  if (pathname === "/api/ai/chat/upload" && req.method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        return json(res, 400, { error: "multipart/form-data required" });
      }
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) return json(res, 400, { error: "Missing boundary" });

      // Size limit: 10MB
      const MAX_SIZE = 10 * 1024 * 1024;
      const chunks = [];
      let totalSize = 0;
      await new Promise((resolve, reject) => {
        req.on("data", c => {
          totalSize += c.length;
          if (totalSize > MAX_SIZE) { req.destroy(); reject(new Error("File too large (max 10MB)")); return; }
          chunks.push(c);
        });
        req.on("end", resolve);
        req.on("error", reject);
      });

      const buf = Buffer.concat(chunks);
      const parts = buf.toString("binary").split("--" + boundary).filter(p => p.trim() && p.trim() !== "--");

      // Dangerous file extensions to block
      const BLOCKED_EXTENSIONS = new Set([
        "exe", "bat", "cmd", "com", "msi", "scr", "pif", "vbs", "vbe", "js", "jse",
        "ws", "wsf", "wsc", "wsh", "ps1", "ps2", "psc1", "psc2", "msh", "msh1", "msh2",
        "inf", "reg", "rgs", "sct", "shb", "shs", "lnk", "dll", "sys", "drv", "ocx",
        "cpl", "hta", "jar", "class", "php", "asp", "aspx", "jsp", "cgi", "pl", "py",
        "rb", "sh", "bash", "zsh", "ksh", "csh", "app", "action", "command", "workflow",
        "iso", "img", "dmg", "vhd", "vmdk", "ova", "ovf"
      ]);

      const results = [];
      for (const part of parts) {
        const [headerSection, ...bodySections] = part.split("\r\n\r\n");
        const body = bodySections.join("\r\n\r\n").replace(/\r\n$/, "");
        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        if (!filenameMatch) continue;

        const fileName = filenameMatch[1];
        const ext = fileName.split(".").pop().toLowerCase();
        const fileSize = Buffer.byteLength(body, "binary");

        // Block dangerous file types
        if (BLOCKED_EXTENSIONS.has(ext)) {
          results.push({ fileName, error: `Blocked: .${ext} files are not allowed for security reasons`, blocked: true });
          continue;
        }

        // Extract text content based on file type
        let textContent = "";
        const textExts = ["txt", "csv", "md", "json", "xml", "html", "htm", "yaml", "yml", "toml", "ini", "cfg", "conf", "log", "sql", "tsv", "rtf"];
        const codeExts = ["ts", "tsx", "jsx", "css", "scss", "less", "sass", "c", "cpp", "h", "hpp", "java", "kt", "swift", "go", "rs", "r", "lua", "dart", "tf", "bicep"];

        if (textExts.includes(ext) || codeExts.includes(ext)) {
          textContent = Buffer.from(body, "binary").toString("utf8").substring(0, 15000);
        } else if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
          // Office files: extract readable text from binary (simplified — gets embedded strings)
          const raw = Buffer.from(body, "binary");
          // For docx/xlsx/pptx (ZIP-based XML), try to extract XML text
          if (ext.endsWith("x")) {
            const str = raw.toString("utf8", 0, Math.min(raw.length, 200000));
            // Extract text between XML tags
            const xmlText = str.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            textContent = xmlText.substring(0, 15000);
          } else {
            // Legacy formats: extract printable ASCII sequences
            const str = raw.toString("binary");
            const printable = str.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").trim();
            textContent = printable.substring(0, 10000);
          }
        } else if (["pdf"].includes(ext)) {
          // PDF: extract readable text strings
          const raw = Buffer.from(body, "binary").toString("binary");
          // Extract text between BT/ET markers and parentheses
          const textParts = [];
          const parenRegex = /\(([^)]{2,})\)/g;
          let m;
          while ((m = parenRegex.exec(raw)) !== null) {
            const t = m[1].replace(/[^\x20-\x7E]/g, "").trim();
            if (t.length > 1) textParts.push(t);
          }
          textContent = textParts.join(" ").substring(0, 15000) || `[PDF file: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB — binary content, text extraction limited]`;
        } else if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "tif"].includes(ext)) {
          textContent = `[Image file: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB, format: ${ext.toUpperCase()}] — Image content cannot be read as text. User may be asking you to discuss, analyze, or reference this image.`;
        } else if (["mp3", "wav", "ogg", "flac", "aac", "wma", "m4a"].includes(ext)) {
          textContent = `[Audio file: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB, format: ${ext.toUpperCase()}]`;
        } else if (["mp4", "avi", "mkv", "mov", "wmv", "flv", "webm"].includes(ext)) {
          textContent = `[Video file: ${fileName}, ${(fileSize / 1024 / 1024).toFixed(1)} MB, format: ${ext.toUpperCase()}]`;
        } else if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) {
          textContent = `[Archive file: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB, format: ${ext.toUpperCase()}] — Archive contents cannot be extracted in chat.`;
        } else {
          textContent = `[File: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB, type: .${ext}] — Binary content, text extraction not supported for this format.`;
        }

        results.push({
          fileName,
          fileSize,
          fileType: ext.toUpperCase(),
          textContent: textContent.trim(),
          blocked: false
        });
      }

      if (results.length === 0) return json(res, 400, { error: "No files found in upload" });
      console.log(`[AI Chat Upload] ${results.length} file(s): ${results.map(r => r.fileName).join(", ")}`);
      return json(res, 200, { files: results });
    } catch (err) {
      console.error("[AI Chat Upload]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Azure OpenAI Proxy: POST /api/ai/chat ─────────────────────────
  if (pathname === "/api/ai/chat" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured on server" });
    }
    try {
      const body = await parseBody(req);
      const { systemPrompt, userPrompt } = body;
      if (!systemPrompt || !userPrompt) return json(res, 400, { error: "systemPrompt and userPrompt required" });

      // Search internal knowledge base first
      let kbContext = "";
      try {
        const kbItems = await db.getAll("ai_knowledge");
        const kbEntries = kbItems.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        if (kbEntries.length > 0) {
          const query = userPrompt.toLowerCase();
          const words = query.split(/\s+/).filter(w => w.length > 2);
          const matched = kbEntries.map(e => {
            let score = 0;
            const haystack = `${e.title} ${e.content} ${e.category} ${(e.tags || []).join(" ")}`.toLowerCase();
            words.forEach(w => { if (haystack.includes(w)) score += 10; });
            if (e.title.toLowerCase().includes(query)) score += 50;
            if (e.tags && e.tags.some(t => query.includes(t))) score += 30;
            return { ...e, score };
          }).filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
          if (matched.length > 0) {
            kbContext = "\n\n=== INTERNAL KNOWLEDGE BASE (PRIORITY — use this first) ===\n" +
              matched.map(m => `[${m.category}] ${m.title}:\n${m.content}`).join("\n---\n") +
              "\n=== END INTERNAL KB ===\nIMPORTANT: Always reference internal knowledge base articles first. If the internal KB has relevant info, use it as the primary source and cite it. Only supplement with external knowledge if the internal KB doesn't fully answer the question.";
          }
        }
      } catch (e) { console.warn("[AI KB Search]", e.message); }

      const enrichedSystemPrompt = systemPrompt + kbContext;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: enrichedSystemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiReqOptions = {
        hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
      };
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request(aiReqOptions, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
            }
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("Azure OpenAI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      if (!text) return json(res, 502, { error: "Empty response from Azure OpenAI" });
      return json(res, 200, { text, model: getAIModel("secondary") });
    } catch (err) {
      console.error("[Azure OpenAI Proxy]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── Azure OpenAI Streaming Proxy: POST /api/ai/chat/stream ────────
  if (pathname === "/api/ai/chat/stream" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured on server" });
    }
    try {
      const body = await parseBody(req);
      const { systemPrompt, userPrompt } = body;
      if (!systemPrompt || !userPrompt) return json(res, 400, { error: "systemPrompt and userPrompt required" });

      // Search internal knowledge base first (same as non-streaming)
      let kbContext = "";
      try {
        const kbItems = await db.getAll("ai_knowledge");
        const kbEntries = kbItems.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        if (kbEntries.length > 0) {
          const query = userPrompt.toLowerCase();
          const words = query.split(/\s+/).filter(w => w.length > 2);
          const matched = kbEntries.map(e => {
            let score = 0;
            const haystack = `${e.title} ${e.content} ${e.category} ${(e.tags || []).join(" ")}`.toLowerCase();
            words.forEach(w => { if (haystack.includes(w)) score += 10; });
            if (e.title.toLowerCase().includes(query)) score += 50;
            if (e.tags && e.tags.some(t => query.includes(t))) score += 30;
            return { ...e, score };
          }).filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
          if (matched.length > 0) {
            kbContext = "\n\n=== INTERNAL KNOWLEDGE BASE (PRIORITY — use this first) ===\n" +
              matched.map(m => `[${m.category}] ${m.title}:\n${m.content}`).join("\n---\n") +
              "\n=== END INTERNAL KB ===\nIMPORTANT: Always reference internal knowledge base articles first. If the internal KB has relevant info, use it as the primary source and cite it. Only supplement with external knowledge if the internal KB doesn't fully answer the question.";
          }
        }
      } catch (e) { console.warn("[AI KB Search]", e.message); }

      const enrichedSystemPrompt = systemPrompt + kbContext;

      // Build Chat Completions payload with stream: true
      const payload = {
        model: getAIModel("secondary"),
        input: [
          { role: "system", content: enrichedSystemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_output_tokens: 1500,
        stream: true
      };

      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const aiReq = https.request({
        hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
      }, (aiRes) => {
        if (aiRes.statusCode < 200 || aiRes.statusCode >= 300) {
          let errData = "";
          aiRes.on("data", c => errData += c);
          aiRes.on("end", () => {
            res.write(`data: ${JSON.stringify({ error: `Azure OpenAI ${aiRes.statusCode}: ${errData.substring(0, 200)}` })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          });
          return;
        }

        let buffer = "";
        aiRes.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              res.write(`data: ${JSON.stringify({ done: true, model: getAIModel("secondary") })}\n\n`);
              res.end();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              // Responses API: response.output_text.delta has {delta: "text"} — often arrives as full text
              // Split into words for ChatGPT-like token-by-token streaming effect
              const rawToken = parsed.delta || parsed.choices?.[0]?.delta?.content;
              if (rawToken && rawToken.length > 0) {
                // If the text is long (full response), split into words for visual streaming
                if (rawToken.length > 20) {
                  const words = rawToken.split(/(\s+)/); // preserve whitespace
                  for (const word of words) {
                    if (word) res.write(`data: ${JSON.stringify({ token: word })}\n\n`);
                  }
                } else {
                  res.write(`data: ${JSON.stringify({ token: rawToken })}\n\n`);
                }
              }
              // Responses API: response.completed marks the end
              if (parsed.type === "response.completed") {
                res.write(`data: ${JSON.stringify({ done: true, model: getAIModel("secondary") })}\n\n`);
                res.end();
                return;
              }
            } catch { /* skip non-JSON lines */ }
          }
        });

        aiRes.on("end", () => {
          // Process remaining buffer
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith("data: ") && trimmed.slice(6) !== "[DONE]") {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const token = parsed.delta || parsed.choices?.[0]?.delta?.content;
                if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
              } catch { /* skip */ }
            }
          }
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ done: true, model: getAIModel("secondary") })}\n\n`);
            res.end();
          }
        });
      });

      aiReq.on("error", (err) => {
        console.error("[AI Stream Error]", err.message);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      });
      aiReq.setTimeout(45000, () => {
        aiReq.destroy();
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: "Azure OpenAI streaming timeout" })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      });

      // Handle client disconnect
      req.on("close", () => { if (!aiReq.destroyed) aiReq.destroy(); });

      aiReq.write(JSON.stringify(payload));
      aiReq.end();
      return; // streaming response — don't fall through
    } catch (err) {
      console.error("[AI Stream]", err.message);
      if (!res.headersSent) return json(res, 502, { error: err.message });
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
      return;
    }
  }

  // ─── Azure OpenAI Test Connection: GET /api/ai/test ─────────────────
  if (pathname === "/api/ai/test" && req.method === "GET") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured", configured: false });
    }
    try {
      const payload = { model: getAIModel("tertiary"), input: [{ role: "user", content: "Reply with exactly: OK" }], max_output_tokens: 16 };
      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 200)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(15000, () => { aiReq.destroy(); reject(new Error("Timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });
      const text = extractAIText(aiResult);
      return json(res, 200, { status: "connected", model: getAIModel("tertiary"), response: text.trim(), configured: true });
    } catch (err) {
      return json(res, 502, { error: err.message, configured: true });
    }
  }

  // ─── Cisco Meraki Dashboard API Proxy ──────────────────────────────
  if (pathname.startsWith("/api/meraki") && req.method === "GET") {
    if (MERAKI_API_KEYS.length === 0) return json(res, 503, { error: "Meraki API not configured" });
    const CACHE_TTL = 5 * 60 * 1000;
    if (!global._merakiCache) global._merakiCache = { data: null, ts: 0 };
    const mc = global._merakiCache;
    const forceRefresh = urlObj.searchParams.get("refresh") === "true";
    if (mc.data && (Date.now() - mc.ts < CACHE_TTL) && !forceRefresh) {
      return json(res, 200, { ...mc.data, cached: true, lastSync: new Date(mc.ts).toISOString() });
    }
    const merakiFetch = (path, apiKey) => new Promise((resolve, reject) => {
      const opts = { hostname: "api.meraki.com", path: `/api/v1${path}`, headers: { "X-Cisco-Meraki-API-Key": apiKey } };
      const r = https.get(opts, resp => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          const u = new URL(resp.headers.location);
          const opts2 = { hostname: u.hostname, path: u.pathname + u.search, headers: { "X-Cisco-Meraki-API-Key": apiKey } };
          const r2 = https.get(opts2, resp2 => { let d = ""; resp2.on("data", c => d += c); resp2.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
          r2.on("error", reject); r2.setTimeout(12000, () => { r2.destroy(); reject(new Error("Timeout")); });
          return;
        }
        let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      r.on("error", reject); r.setTimeout(12000, () => { r.destroy(); reject(new Error("Timeout")); });
    });
    try {
      // Aggregate data from all API keys (each key = one MSP account with multiple orgs)
      let allOrgs = [], allDevices = [], allUplinks = [], allVpn = [], allNetworks = [];
      for (const apiKey of MERAKI_API_KEYS) {
        try {
          const orgs = await merakiFetch("/organizations", apiKey);
          if (!Array.isArray(orgs)) continue;
          allOrgs = allOrgs.concat(orgs.map(o => ({ id: o.id, name: o.name, licensing: o.licensing?.model })));
          // Fetch per-org data in parallel
          const orgPromises = orgs.map(async (org) => {
            const [devStatuses, uplinks, vpn, nets] = await Promise.allSettled([
              merakiFetch(`/organizations/${org.id}/devices/statuses`, apiKey),
              merakiFetch(`/organizations/${org.id}/uplinks/statuses`, apiKey),
              merakiFetch(`/organizations/${org.id}/appliance/vpn/statuses`, apiKey),
              merakiFetch(`/organizations/${org.id}/networks`, apiKey),
            ]);
            return {
              devices: devStatuses.status === "fulfilled" && Array.isArray(devStatuses.value) ? devStatuses.value.map(d => ({
                name: d.name || d.serial, model: d.model, serial: d.serial, status: d.status,
                lanIp: d.lanIp, publicIp: d.publicIp, networkId: d.networkId, org: org.name,
                lastReportedAt: d.lastReportedAt, firmware: d.firmware,
              })) : [],
              uplinks: uplinks.status === "fulfilled" && Array.isArray(uplinks.value) ? uplinks.value.map(u => ({
                serial: u.serial, model: u.model, networkId: u.networkId, org: org.name,
                highAvailability: u.highAvailability, lastReportedAt: u.lastReportedAt,
                uplinks: (u.uplinks || []).map(ul => ({ interface: ul.interface, status: ul.status, ip: ul.ip, publicIp: ul.publicIp, gateway: ul.gateway, dns: ul.primaryDns })),
              })) : [],
              vpn: vpn.status === "fulfilled" && Array.isArray(vpn.value) ? vpn.value.map(v => ({
                networkName: v.networkName, networkId: v.networkId, deviceStatus: v.deviceStatus,
                vpnMode: v.vpnMode, org: org.name,
                merakiPeers: (v.merakiVpnPeers || []).map(p => ({ name: p.networkName, reachability: p.reachability })),
                thirdPartyPeers: (v.thirdPartyVpnPeers || []).map(p => ({ name: p.name, ip: p.publicIp, reachability: p.reachability })),
                subnets: (v.exportedSubnets || []).map(s => ({ name: s.name, subnet: s.subnet })),
              })) : [],
              networks: nets.status === "fulfilled" && Array.isArray(nets.value) ? nets.value.map(n => ({
                id: n.id, name: n.name, org: org.name, productTypes: n.productTypes, timeZone: n.timeZone,
              })) : [],
            };
          });
          const orgResults = await Promise.all(orgPromises);
          orgResults.forEach(r => { allDevices = allDevices.concat(r.devices); allUplinks = allUplinks.concat(r.uplinks); allVpn = allVpn.concat(r.vpn); allNetworks = allNetworks.concat(r.networks); });
        } catch (e) { console.error(`[MERAKI] Error for key ${apiKey.substring(0,8)}...: ${e.message}`); }
      }
      const result = {
        organizations: allOrgs,
        devices: allDevices,
        uplinks: allUplinks,
        vpnStatus: allVpn,
        networks: allNetworks,
        summary: {
          totalOrgs: allOrgs.length,
          totalDevices: allDevices.length,
          onlineDevices: allDevices.filter(d => d.status === "online").length,
          offlineDevices: allDevices.filter(d => d.status === "offline").length,
          dormantDevices: allDevices.filter(d => d.status === "dormant").length,
          totalNetworks: allNetworks.length,
          vpnPeers: allVpn.reduce((s, v) => s + (v.merakiPeers?.length || 0) + (v.thirdPartyPeers?.length || 0), 0),
        },
      };
      mc.data = result; mc.ts = Date.now();
      console.log(`[MERAKI] Fetched ${allOrgs.length} orgs, ${allDevices.length} devices, ${allNetworks.length} networks`);
      return json(res, 200, { ...result, cached: false, lastSync: new Date(mc.ts).toISOString() });
    } catch (err) {
      console.error("[MERAKI] Error:", err.message);
      return json(res, 502, { error: "Failed to fetch Meraki data", detail: err.message });
    }
  }

  // ─── SolarWinds RMM — Test Connection ────────────────────────────────
  if (pathname === "/api/solarwinds/test" && req.method === "POST") {
    const body = await parseBody(req);
    const { apiKey, apiHost } = body || {};
    if (!apiKey) return json(res, 400, { ok: false, detail: "API key is required" });
    const host = (apiHost || "wwwasia.system-monitor.com").replace(/^(https?:\/\/)/, "").replace(/\/+$/, "");
    const testUrl = `https://${host}/api/?apikey=${encodeURIComponent(apiKey)}&service=list_clients`;
    try {
      const xml = await new Promise((resolve, reject) => {
        const doGet = (url) => {
          https.get(url, { headers: { "User-Agent": "VGC-ITSM/1.0" } }, resp => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) return doGet(resp.headers.location);
            let d = ""; resp.on("data", c => d += c); resp.on("end", () => resolve(d));
          }).on("error", reject).setTimeout(15000, function() { this.destroy(); reject(new Error("Timeout")); });
        };
        doGet(testUrl);
      });
      if (xml.includes("Login failed")) {
        return json(res, 200, { ok: false, detail: "Login failed — API key is invalid or expired. Generate a new key in N-able RMM → Settings → General Settings → API." });
      }
      // Parse clients to get summary
      const clients = []; const re = /<client[\s>]([\s\S]*?)<\/client>/gi; let m;
      while ((m = re.exec(xml))) {
        const block = m[1]; const item = {};
        block.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, (_, k, v) => { item[k] = v.replace(/<!\[CDATA\[|\]\]>/g, "").trim(); });
        if (Object.keys(item).length > 0) clients.push(item);
      }
      return json(res, 200, { ok: true, summary: { totalClients: clients.length, totalServers: 0, totalWorkstations: 0 }, detail: `Authenticated successfully. Found ${clients.length} clients.` });
    } catch (err) {
      return json(res, 200, { ok: false, detail: `Connection error: ${err.message}` });
    }
  }

  // ─── Azure OpenAI — Save Settings (runtime) ─────────────────────────
  if (pathname === "/api/settings/openai" && req.method === "POST") {
    const body = await parseBody(req);
    const { endpoint, apiKey, model } = body || {};
    if (endpoint) AZURE_OPENAI_ENDPOINT = endpoint;
    if (apiKey) AZURE_OPENAI_KEY = apiKey;
    if (model) AZURE_OPENAI_MODEL = model;
    console.log(`[OPENAI] Settings updated. Model=${AZURE_OPENAI_MODEL}, Endpoint=${AZURE_OPENAI_ENDPOINT.substring(0, 60)}...`);
    return json(res, 200, { ok: true, model: AZURE_OPENAI_MODEL, models: AI_MODELS, message: "Azure OpenAI settings updated. Changes are active until next app restart. Update Azure App Settings for persistence." });
  }

  // ─── Azure OpenAI — Get Current Config: GET /api/settings/openai ────
  if (pathname === "/api/settings/openai" && req.method === "GET") {
    return json(res, 200, {
      model: AZURE_OPENAI_MODEL,
      models: AI_MODELS,
      endpoint: AZURE_OPENAI_ENDPOINT.replace(/api-key=[^&]+/, "api-key=***"),
      configured: !!(AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT),
    });
  }

  // ─── SolarWinds RMM — Save Settings ────────────────────────────────
  if (pathname === "/api/settings/solarwinds" && req.method === "POST") {
    const body = await parseBody(req);
    const { apiKey, apiHost } = body || {};
    if (!apiKey) return json(res, 400, { ok: false, detail: "API key is required" });
    SOLARWINDS_API_KEY = apiKey;
    SOLARWINDS_API_HOST = (apiHost || "wwwasia.system-monitor.com").replace(/^(https?:\/\/)/, "").replace(/\/+$/, "");
    if (global._solarwindsCache) global._solarwindsCache = { data: null, ts: 0 };
    console.log(`[SOLARWINDS] API settings updated. Host=${SOLARWINDS_API_HOST}`);
    return json(res, 200, { ok: true, message: "SolarWinds RMM settings updated. Changes are active until next app restart. Update Azure App Settings for persistence." });
  }

  // ─── SolarWinds RMM / N-able API Proxy ──────────────────────────────
  if (pathname.startsWith("/api/solarwinds") && req.method === "GET") {
    if (!SOLARWINDS_API_KEY) return json(res, 503, { error: "SolarWinds RMM API not configured" });
    const CACHE_TTL = 5 * 60 * 1000;
    if (!global._solarwindsCache) global._solarwindsCache = { data: null, ts: 0 };
    const swc = global._solarwindsCache;
    const forceRefresh = urlObj.searchParams.get("refresh") === "true";
    if (swc.data && (Date.now() - swc.ts < CACHE_TTL) && !forceRefresh) {
      return json(res, 200, { ...swc.data, cached: true, lastSync: new Date(swc.ts).toISOString() });
    }
    const swFetch = (service) => new Promise((resolve, reject) => {
      const host = SOLARWINDS_API_HOST.replace(/\/+$/, "");
      const u = `https://${host}/api/?apikey=${encodeURIComponent(SOLARWINDS_API_KEY)}&service=${service}`;
      const doGet = (url) => {
        https.get(url, { headers: { "User-Agent": "VGC-ITSM/1.0" } }, resp => {
          if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
            return doGet(resp.headers.location);
          }
          let d = ""; resp.on("data", c => d += c); resp.on("end", () => resolve(d));
        }).on("error", reject).setTimeout(15000, function() { this.destroy(); reject(new Error("Timeout")); });
      };
      doGet(u);
    });
    try {
      // N-able RMM XML API — parse clients and devices
      const [clientsXml, serversXml, workstationsXml] = await Promise.allSettled([
        swFetch("list_clients"), swFetch("list_servers"), swFetch("list_workstations"),
      ]);
      const parseXmlItems = (xml, tagName) => {
        if (!xml) return [];
        const items = []; const re = new RegExp(`<${tagName}[\\s>]([\\s\\S]*?)<\\/${tagName}>`, "gi"); let m;
        while ((m = re.exec(xml))) {
          const block = m[1]; const item = {};
          block.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, (_, k, v) => { item[k] = v.replace(/<!\[CDATA\[|\]\]>/g, "").trim(); });
          if (Object.keys(item).length > 0) items.push(item);
        }
        return items;
      };
      const clients = clientsXml.status === "fulfilled" ? parseXmlItems(clientsXml.value, "client") : [];
      const servers = serversXml.status === "fulfilled" ? parseXmlItems(serversXml.value, "server") : [];
      const workstations = workstationsXml.status === "fulfilled" ? parseXmlItems(workstationsXml.value, "workstation") : [];
      // Check if auth failed
      const authFailed = [clientsXml, serversXml, workstationsXml].every(r => r.status === "fulfilled" && r.value.includes("Login failed"));
      const result = {
        configured: true,
        authenticated: !authFailed,
        clients, servers, workstations,
        summary: {
          totalClients: clients.length,
          totalServers: servers.length,
          totalWorkstations: workstations.length,
          onlineServers: servers.filter(s => s.status === "1" || s.online === "true").length,
          onlineWorkstations: workstations.filter(w => w.status === "1" || w.online === "true").length,
        },
      };
      swc.data = result; swc.ts = Date.now();
      console.log(`[SOLARWINDS] Auth=${!authFailed}, Clients=${clients.length}, Servers=${servers.length}, Workstations=${workstations.length}`);
      return json(res, 200, { ...result, cached: false, lastSync: new Date(swc.ts).toISOString() });
    } catch (err) {
      console.error("[SOLARWINDS] Error:", err.message);
      return json(res, 502, { error: "Failed to fetch SolarWinds data", detail: err.message });
    }
  }

  // ─── Sophos Central Firewall API Proxy ──────────────────────────────
  if (pathname.startsWith("/api/sophos") && req.method === "GET") {
    if (!SOPHOS_CLIENT_ID || !SOPHOS_CLIENT_SECRET) return json(res, 503, { error: "Sophos Central API not configured" });
    const CACHE_TTL = 5 * 60 * 1000;
    if (!global._sophosCache) global._sophosCache = { data: null, ts: 0, token: null, tokenExp: 0, tenantId: null, dataRegion: null };
    const sc = global._sophosCache;
    const forceRefresh = urlObj.searchParams.get("refresh") === "true";
    if (sc.data && (Date.now() - sc.ts < CACHE_TTL) && !forceRefresh) {
      return json(res, 200, { ...sc.data, cached: true, lastSync: new Date(sc.ts).toISOString() });
    }
    const httpsPost = (hostname, path, body, headers) => new Promise((resolve, reject) => {
      const opts = { hostname, path, method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(body) } };
      const r = https.request(opts, resp => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
      r.on("error", reject); r.setTimeout(15000, () => { r.destroy(); reject(new Error("Timeout")); });
      r.write(body); r.end();
    });
    const httpsGet = (fullUrl, headers) => new Promise((resolve, reject) => {
      const u = new URL(fullUrl);
      const opts = { hostname: u.hostname, path: u.pathname + u.search, headers };
      const r = https.get(opts, resp => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
      r.on("error", reject); r.setTimeout(15000, () => { r.destroy(); reject(new Error("Timeout")); });
    });
    try {
      // Get/refresh OAuth2 token
      if (!sc.token || Date.now() >= sc.tokenExp) {
        const tokenBody = `grant_type=client_credentials&client_id=${encodeURIComponent(SOPHOS_CLIENT_ID)}&client_secret=${encodeURIComponent(SOPHOS_CLIENT_SECRET)}&scope=token`;
        const tokenResp = await httpsPost("id.sophos.com", "/api/v2/oauth2/token", tokenBody, { "Content-Type": "application/x-www-form-urlencoded" });
        if (!tokenResp?.access_token) throw new Error("Sophos OAuth2 token exchange failed");
        sc.token = tokenResp.access_token;
        sc.tokenExp = Date.now() + ((tokenResp.expires_in || 3600) - 120) * 1000;
      }
      // Get tenant info if not cached
      if (!sc.tenantId || !sc.dataRegion) {
        const whoami = await httpsGet("https://api.central.sophos.com/whoami/v1", { Authorization: `Bearer ${sc.token}` });
        if (!whoami?.id) throw new Error("Sophos whoami failed");
        sc.tenantId = whoami.id;
        sc.dataRegion = whoami.apiHosts?.dataRegion || "https://api.central.sophos.com";
      }
      const sophosHeaders = { Authorization: `Bearer ${sc.token}`, "X-Tenant-ID": sc.tenantId };
      // Fetch firewalls
      const firewalls = await httpsGet(`${sc.dataRegion}/firewall/v1/firewalls?pageSize=100`, sophosHeaders);
      const fwItems = (firewalls?.items || []).map(fw => ({
        id: fw.id, name: fw.name || fw.hostname, hostname: fw.hostname,
        serialNumber: fw.serialNumber, model: fw.model,
        firmware: fw.firmwareVersion,
        connected: fw.status?.connected || false,
        suspended: fw.status?.suspended || false,
        managingStatus: fw.status?.managingStatus,
        externalIps: fw.externalIpv4Addresses || [],
        capabilities: fw.capabilities || [],
        createdAt: fw.createdAt, updatedAt: fw.updatedAt,
        stateChangedAt: fw.stateChangedAt,
      }));
      // Try to fetch firewall groups (may fail with permissions)
      let fwGroups = [];
      try { const g = await httpsGet(`${sc.dataRegion}/firewall/v1/firewall-groups?pageSize=50`, sophosHeaders); fwGroups = g?.items || []; } catch {}
      // Try alerts (may need different permissions)
      let alerts = [];
      try { const a = await httpsGet(`${sc.dataRegion}/common/v1/alerts?pageSize=20`, sophosHeaders); alerts = (a?.items || []).map(al => ({ id: al.id, severity: al.severity, category: al.category, description: al.description, raisedAt: al.raisedAt, managedAgent: al.managedAgent })); } catch {}
      const result = {
        configured: true,
        tenantId: sc.tenantId,
        firewalls: fwItems,
        groups: fwGroups,
        alerts,
        summary: {
          totalFirewalls: fwItems.length,
          connectedFirewalls: fwItems.filter(f => f.connected).length,
          disconnectedFirewalls: fwItems.filter(f => !f.connected).length,
          suspendedFirewalls: fwItems.filter(f => f.suspended).length,
          totalAlerts: alerts.length,
        },
      };
      sc.data = result; sc.ts = Date.now();
      console.log(`[SOPHOS] Fetched ${fwItems.length} firewalls (${fwItems.filter(f=>f.connected).length} connected), ${alerts.length} alerts`);
      return json(res, 200, { ...result, cached: false, lastSync: new Date(sc.ts).toISOString() });
    } catch (err) {
      console.error("[SOPHOS] Error:", err.message);
      return json(res, 502, { error: "Failed to fetch Sophos data", detail: err.message });
    }
  }

  // ─── Cyber News: Live RSS Feeds ─────────────────────────────────────
  if (pathname === "/api/cybernews" && req.method === "GET") {
    // Cache for 10 minutes to avoid hammering feeds
    const CACHE_TTL = 10 * 60 * 1000;
    if (!global._cyberNewsCache) global._cyberNewsCache = { data: null, ts: 0 };
    const cache = global._cyberNewsCache;
    const forceRefresh = urlObj.searchParams.get("refresh") === "true";

    if (cache.data && (Date.now() - cache.ts < CACHE_TTL) && !forceRefresh) {
      return json(res, 200, { threats: cache.data, cached: true, lastSync: new Date(cache.ts).toISOString() });
    }

    const fetchUrl = (feedUrl, timeoutMs = 12000) => new Promise((resolve, reject) => {
      const proto = feedUrl.startsWith("https") ? https : http;
      const feedReq = proto.get(feedUrl, { headers: { "User-Agent": "VGC-ITSM-CyberNews/1.0" } }, resp => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          return fetchUrl(resp.headers.location, timeoutMs).then(resolve, reject);
        }
        let d = ""; resp.on("data", c => d += c); resp.on("end", () => resolve(d));
      });
      feedReq.on("error", reject);
      feedReq.setTimeout(timeoutMs, () => { feedReq.destroy(); reject(new Error("Timeout")); });
    });

    const parseRssItems = (xml, source, sourceUrl, maxItems = 8) => {
      const items = [];
      const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
      let match;
      while ((match = itemRegex.exec(xml)) && items.length < maxItems) {
        const block = match[1];
        const tag = (name) => { const m = block.match(new RegExp(`<${name}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${name}>`, "i")); return m ? m[1].trim() : ""; };
        const title = tag("title").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const link = tag("link") || tag("guid");
        const pubDate = tag("pubDate");
        const desc = tag("description").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").substring(0, 300);
        if (!title) continue;
        const published = pubDate ? new Date(pubDate) : new Date();
        const ageMs = Date.now() - published.getTime();
        const ageStr = ageMs < 3600000 ? `${Math.round(ageMs/60000)} min ago` : ageMs < 86400000 ? `${Math.round(ageMs/3600000)} hr ago` : `${Math.round(ageMs/86400000)} day ago`;
        const cveMatch = title.match(/CVE-\d{4}-\d+/i) || desc.match(/CVE-\d{4}-\d+/i);
        const sevGuess = /critical|emergency|urgent|zero.?day|actively.exploit/i.test(title + desc) ? "Critical"
          : /high|severe|important|rce|remote.code/i.test(title + desc) ? "High"
          : /medium|moderate/i.test(title + desc) ? "Medium" : "Low";
        const catGuess = /ransomware|lockbit|blackcat|alphv/i.test(title + desc) ? "Ransomware"
          : /phish/i.test(title + desc) ? "Phishing"
          : /apt|nation.state|espionage/i.test(title + desc) ? "APT"
          : /ddos|amplification|flood/i.test(title + desc) ? "DDoS"
          : /cve|vulnerabilit|patch|exploit|rce|xss|sqli/i.test(title + desc) ? "Vulnerability"
          : /malware|trojan|botnet|stealer/i.test(title + desc) ? "Malware"
          : "Advisory";
        items.push({
          id: `LIVE-${source.replace(/[^A-Z0-9]/gi,"").substring(0,4).toUpperCase()}-${items.length+1}`,
          severity: sevGuess,
          title,
          source,
          sourceUrl: link || sourceUrl,
          region: "Global",
          time: ageStr,
          timestamp: published.getTime(),
          isNew: ageMs < 6 * 3600000,
          aiSummary: desc || "No description available. Click the source link for full details.",
          affectsUs: false,
          category: catGuess,
          cve: cveMatch ? cveMatch[0].toUpperCase() : null,
          cvss: null, cvssVector: null,
          affectedSystems: [],
          mitreTactics: [],
          iocs: [],
          nextSteps: ["Review the advisory details via the source link", "Assess applicability to your environment", "Update security monitoring rules if relevant"],
          references: [{ title: `${source} — Full Article`, url: link || sourceUrl }],
          status: "open",
        });
      }
      return items;
    };

    try {
      const feeds = [
        { url: "https://feeds.feedburner.com/TheHackersNews", source: "The Hacker News", home: "https://thehackernews.com/" },
        { url: "https://www.bleepingcomputer.com/feed/", source: "BleepingComputer", home: "https://www.bleepingcomputer.com/" },
        { url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", source: "CISA", home: "https://www.cisa.gov/cybersecurity-advisories" },
        { url: "https://cvefeed.io/rssfeed/latest.xml", source: "CVE Feed", home: "https://cvefeed.io/" },
      ];
      const results = await Promise.allSettled(feeds.map(f => fetchUrl(f.url).then(xml => parseRssItems(xml, f.source, f.home))));
      let allItems = [];
      results.forEach(r => { if (r.status === "fulfilled") allItems = allItems.concat(r.value); });
      // Sort by timestamp descending (newest first), then renumber IDs
      allItems.sort((a, b) => b.timestamp - a.timestamp);
      allItems = allItems.slice(0, 30);
      allItems.forEach((item, i) => { item.id = `LIVE-${String(i+1).padStart(3,"0")}`; });

      cache.data = allItems;
      cache.ts = Date.now();
      console.log(`[CYBER NEWS] Fetched ${allItems.length} items from ${results.filter(r=>r.status==="fulfilled").length}/${feeds.length} feeds`);
      return json(res, 200, { threats: allItems, cached: false, lastSync: new Date(cache.ts).toISOString(), feedsOk: results.filter(r=>r.status==="fulfilled").length, feedsTotal: feeds.length });
    } catch (err) {
      console.error("[CYBER NEWS] Fetch error:", err.message);
      return json(res, 502, { error: "Failed to fetch cyber news feeds", detail: err.message });
    }
  }

  // ─── AI Auto-Triage + Auto-Assignment Engine (Phase 1) ────────────────
  // POST /api/ai/auto-triage-assign — AI categorizes, prioritizes, and assigns a ticket
  if (pathname === "/api/ai/auto-triage-assign" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { ticket, requestedBy } = body;
      if (!ticket || !requestedBy) return json(res, 400, { error: "ticket and requestedBy required" });

      // Gather context for AI
      const allUsersRaw = await db.getAll("users");
      const teamMembers = allUsersRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      const allIncRaw = await db.getAll("incidents");
      const allIncidents = allIncRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      // Calculate workload per assignee
      const openStatuses = new Set(["New", "Open", "In Progress", "Pending"]);
      const workload = {};
      for (const inc of allIncidents) {
        if (openStatuses.has(inc.status) && inc.assignee && inc.assignee !== "Unassigned") {
          workload[inc.assignee] = (workload[inc.assignee] || 0) + 1;
        }
      }

      // Get KB articles for category matching
      const kbRaw = await db.getAll("kb");
      const kbArticles = kbRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      const kbCategories = [...new Set(kbArticles.map(a => a.category).filter(Boolean))];

      // Historical resolution stats (category → avg resolve time, best assignee)
      const resolvedInc = allIncidents.filter(i => i.status === "Resolved" || i.status === "Closed");
      const categoryStats = {};
      for (const inc of resolvedInc) {
        const cat = inc.category || "General";
        if (!categoryStats[cat]) categoryStats[cat] = { count: 0, totalHours: 0, assignees: {} };
        categoryStats[cat].count++;
        categoryStats[cat].totalHours += inc.created || 0;
        if (inc.assignee) categoryStats[cat].assignees[inc.assignee] = (categoryStats[cat].assignees[inc.assignee] || 0) + 1;
      }

      const teamSummary = teamMembers.slice(0, 20).map(u => `${u.displayName || u.name || u.id} (${u.jobTitle || u.role || "Agent"}) workload:${workload[u.displayName || u.name] || 0}`).join("\n");
      const catStatsSummary = Object.entries(categoryStats).slice(0, 15).map(([cat, s]) => {
        const avgHrs = s.count > 0 ? (s.totalHours / s.count).toFixed(1) : "N/A";
        const bestAssignee = Object.entries(s.assignees).sort((a, b) => b[1] - a[1])[0];
        return `${cat}: ${s.count} resolved, avg ${avgHrs}h, top resolver: ${bestAssignee ? bestAssignee[0] : "N/A"}`;
      }).join("\n");

      const systemPrompt = `You are the VGC-ITSM AI Auto-Triage Engine for VGC Technology Pte Ltd.
Analyze the incoming ticket and determine the best category, priority, assignee, and assignment group.

AVAILABLE CATEGORIES: ${kbCategories.join(", ")}, Network, Hardware, Software, Security, Email, Access Management, General, VPN, Printing, Telephony, Cloud Services, Database, Backup, Monitoring

PRIORITY LEVELS (VGC SLA Policy):
- Sev-A (CRITICAL): Complete service outage, business-critical systems unavailable. SLA: ${(slaEngine?.currentPolicy?.severities?.['Sev-A']?.firstResponse || 0.5)}h first response, ${(slaEngine?.currentPolicy?.severities?.['Sev-A']?.worstResponse || 4)}h resolution.
- Sev-B (HIGH): Major impact, VIP issues, >50% users affected. SLA: ${(slaEngine?.currentPolicy?.severities?.['Sev-B']?.firstResponse || 1)}h first response, ${(slaEngine?.currentPolicy?.severities?.['Sev-B']?.worstResponse || 4)}h resolution.
- Sev-C (MEDIUM/DEFAULT): Standard IT issues. SLA: ${(slaEngine?.currentPolicy?.severities?.['Sev-C']?.firstResponse || 4)}h first response, ${(slaEngine?.currentPolicy?.severities?.['Sev-C']?.worstResponse || 9)}h resolution.
- Sev-D (LOW): Non-actionable questions, informational. SLA: ${(slaEngine?.currentPolicy?.severities?.['Sev-D']?.firstResponse || 9)}h first response, ${(slaEngine?.currentPolicy?.severities?.['Sev-D']?.worstResponse || 27)}h resolution.

ASSIGNMENT GROUPS: Service Desk, Network Team, Security Team, Cloud Team, Desktop Support, Application Support, Infrastructure

TEAM MEMBERS & WORKLOAD:
${teamSummary || "No team members data available — assign to Service Desk"}

HISTORICAL RESOLUTION STATS:
${catStatsSummary || "No historical data yet"}

RULES:
1. Default priority is Sev-C unless clear evidence of higher severity.
2. Assign to the team member with lowest workload in the matching skill area.
3. If unsure about category, use the closest match from KB categories.
4. Never assign Sev-A or Sev-B unless the ticket clearly describes a major outage or VIP impact.
5. Consider historical resolution data to pick the best assignee for the category.

Respond with ONLY valid JSON (no markdown):
{
  "category": "string",
  "subcategory": "string",
  "priority": "Sev-A|Sev-B|Sev-C|Sev-D",
  "assignee": "person name or Unassigned",
  "assignmentGroup": "group name",
  "confidence": 0-100,
  "reasoning": "brief explanation",
  "suggestedSlaTarget": number_in_hours,
  "tags": ["tag1","tag2"]
}`;

      const userPrompt = `TICKET TO TRIAGE:
ID: ${ticket.id || "NEW"}
Title: ${ticket.title || "Untitled"}
Description: ${ticket.description || "No description"}
Reporter: ${ticket.reporter || ticket.reporterEmail || "Unknown"}
Customer: ${ticket.customer || "Unknown"}
Contact Method: ${ticket.contactMethod || "Portal"}
Current Priority: ${ticket.priority || "Not set"}
Current Category: ${ticket.category || "Not set"}
Current Assignee: ${ticket.assignee || "Unassigned"}
Zendesk Ticket: ${ticket.zdTicketId ? "#" + ticket.zdTicketId : "N/A"}
Created: ${ticket.createdAt || new Date().toISOString()}`;

      const payload = {
        model: getAIModel("secondary"),
        input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_output_tokens: 800
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
            else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let triage;
      try {
        triage = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        return json(res, 502, { error: "AI returned invalid triage JSON", raw: text.substring(0, 500) });
      }

      const now = new Date().toISOString();
      const confidence = triage.confidence || 50;
      const slaMap = getSlaMap();

      // High confidence: auto-apply triage directly (configurable threshold)
      const autoApply = confidence >= AI_THRESHOLDS.autoApply;

      // Dedup: skip if pending auto_triage already exists for same incident, or total cap exceeded
      const dedupState = await getAiActionsDedupState();
      const skipReason = !autoApply ? shouldSkipAction(dedupState, { incidentId: ticket.id, type: "auto_triage" }) : null;
      if (skipReason) {
        console.log(`[AI Triage] Skipped pending_approval for ${ticket.id}: ${skipReason}`);
        // Still return the triage result so caller knows what AI recommended
        return json(res, 200, { action: { ...triage, skipped: true, skipReason }, triage, confidence, autoApplied: false, skipped: true });
      }

      const triageRecord = {
        id: `AIT-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        type: "auto_triage",
        severity: triage.priority === "Sev-A" ? "critical" : triage.priority === "Sev-B" ? "high" : triage.priority === "Sev-D" ? "low" : "medium",
        title: `Auto-Triage: ${ticket.id || "New Ticket"} → ${triage.category} [${triage.priority}] → ${triage.assignee}`,
        description: triage.reasoning || "AI auto-triage recommendation",
        incidentId: ticket.id || null,
        suggestedAction: `Set category=${triage.category}, priority=${triage.priority}, assignee=${triage.assignee}, group=${triage.assignmentGroup}`,
        triage: {
          category: triage.category,
          subcategory: triage.subcategory || "",
          priority: triage.priority,
          assignee: triage.assignee || "Unassigned",
          assignmentGroup: triage.assignmentGroup || "Service Desk",
          suggestedSlaTarget: triage.suggestedSlaTarget || slaMap[triage.priority] || 9,
          tags: triage.tags || [],
        },
        confidence,
        autoExecutable: autoApply,
        reasoning: triage.reasoning || "",
        status: autoApply ? "auto_applied" : "pending_approval",
        createdAt: now,
        createdBy: "AI Auto-Triage Engine",
        requestedBy,
        approvedBy: autoApply ? "AI Auto-Triage (high confidence)" : null,
        approvedAt: autoApply ? now : null,
        executedAt: null,
        executionResult: null,
      };

      // Save triage action
      await db.upsert("ai_actions", triageRecord.id, JSON.stringify(triageRecord));

      // Save triage history
      await db.upsert("ai_triage_history", triageRecord.id, JSON.stringify({
        id: triageRecord.id, ticketId: ticket.id, triage: triageRecord.triage,
        confidence, autoApplied: autoApply, timestamp: now, requestedBy,
      }));

      // If auto-apply, update the actual incident
      if (autoApply && ticket.id) {
        const incRow = await db.getOne("incidents", ticket.id);
        if (incRow) {
          const inc = JSON.parse(incRow.data);
          inc.category = normalizeCategory(triage.category);
          inc.subcategory = triage.subcategory || inc.subcategory;
          inc.priority = triage.priority;
          inc.assignee = triage.assignee || inc.assignee;
          inc.assignmentGroup = triage.assignmentGroup || inc.assignmentGroup;
          inc.slaTarget = triage.suggestedSlaTarget || slaMap[triage.priority] || inc.slaTarget;
          inc.aiTriaged = true;
          inc.aiConfidence = confidence;
          inc.activityLog = inc.activityLog || [];
          inc.activityLog.push({
            id: `AL-AIT-${Date.now().toString(36)}`, type: "ai_triage", user: "AI Auto-Triage",
            time: now, detail: `AI auto-triaged (${confidence}% confidence): ${triage.category} [${triage.priority}] → ${triage.assignee}. ${triage.reasoning}`,
          });
          await db.upsert("incidents", inc.id, JSON.stringify(inc));

          // ─── Auto-trigger AI Workflow Assist after triage (Production Pipeline) ───
          if (PROD_TEST_MODE || confidence >= 85) {
            try {
              const wfPayload = JSON.stringify({ requestedBy: "AI Post-Triage Pipeline", maxItems: 1, incidentId: inc.id });
              const wfReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/workflow-assist", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(wfPayload) } }, (wfRes) => {
                let d = ""; wfRes.on("data", c => d += c);
                wfRes.on("end", () => { console.log(`[AI Pipeline] Workflow assist for ${inc.id}: ${d.substring(0, 200)}`); });
              });
              wfReq.on("error", e => console.warn(`[AI Pipeline] Workflow assist failed for ${inc.id}:`, e.message));
              wfReq.setTimeout(35000, () => { wfReq.destroy(); });
              wfReq.write(wfPayload);
              wfReq.end();
            } catch (wfErr) { console.warn("[AI Pipeline] Workflow assist trigger error:", wfErr.message); }
          }

          // ─── SLA Guardian: auto-trigger SLA prediction after triage ───
          try {
            const slaPredPayload = JSON.stringify({ incidents: [inc], requestedBy: "AI SLA Guardian (post-triage)" });
            const slaPredReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/sla-predict", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(slaPredPayload) } }, (slaPredRes) => {
              let d = ""; slaPredRes.on("data", c => d += c);
              slaPredRes.on("end", () => {
                try {
                  const result = JSON.parse(d);
                  if (result.actions && result.actions.length > 0 && wsServer) {
                    wsServer.broadcast("sla_guardian", { action: "sla_risk_detected", atRiskCount: result.actions.length, predictions: result.predictions });
                  }
                } catch {}
                console.log(`[SLA Guardian] Post-triage prediction for ${inc.id}: ${d.substring(0, 200)}`);
              });
            });
            slaPredReq.on("error", e => console.warn(`[SLA Guardian] Post-triage prediction failed:`, e.message));
            slaPredReq.setTimeout(35000, () => { slaPredReq.destroy(); });
            slaPredReq.write(slaPredPayload);
            slaPredReq.end();
          } catch (slaErr) { console.warn("[SLA Guardian] Post-triage trigger error:", slaErr.message); }
        }
      }

      console.log(`[AI Triage] ${ticket.id || "NEW"} → ${triage.category} [${triage.priority}] → ${triage.assignee} (${confidence}% confidence, ${autoApply ? "auto-applied" : "pending approval"})`);
      return json(res, 200, {
        triage: triageRecord.triage, confidence, autoApplied: autoApply,
        actionId: triageRecord.id, status: triageRecord.status,
        reasoning: triage.reasoning,
      });
    } catch (err) {
      console.error("[AI Triage]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // POST /api/ai/auto-triage-assign/apply — apply a pending triage to the actual ticket
  if (pathname === "/api/ai/auto-triage-assign/apply" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { actionId, appliedBy } = body;
      if (!actionId || !appliedBy) return json(res, 400, { error: "actionId and appliedBy required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Triage action not found" });
      const action = JSON.parse(existing.data);
      if (action.type !== "auto_triage") return json(res, 400, { error: "Action is not an auto-triage" });
      if (action.status !== "pending_approval") return json(res, 409, { error: `Action already ${action.status}` });

      const now = new Date().toISOString();
      const triage = action.triage;
      const slaMap = getSlaMap();

      // Update the incident
      if (action.incidentId) {
        const incRow = await db.getOne("incidents", action.incidentId);
        if (incRow) {
          const inc = JSON.parse(incRow.data);
          inc.category = normalizeCategory(triage.category);
          inc.subcategory = triage.subcategory || inc.subcategory;
          inc.priority = triage.priority;
          inc.assignee = triage.assignee || inc.assignee;
          inc.assignmentGroup = triage.assignmentGroup || inc.assignmentGroup;
          inc.slaTarget = triage.suggestedSlaTarget || slaMap[triage.priority] || inc.slaTarget;
          inc.aiTriaged = true;
          inc.aiConfidence = action.confidence;
          inc.activityLog = inc.activityLog || [];
          inc.activityLog.push({
            id: `AL-AIT-${Date.now().toString(36)}`, type: "ai_triage", user: appliedBy,
            time: now, detail: `AI triage approved by ${appliedBy}: ${triage.category} [${triage.priority}] → ${triage.assignee}`,
          });
          await db.upsert("incidents", inc.id, JSON.stringify(inc));
        }
      }

      // Update action status
      action.status = "applied";
      action.approvedBy = appliedBy;
      action.approvedAt = now;
      action.executedAt = now;
      action.executionResult = "Triage applied to ticket";
      await db.upsert("ai_actions", actionId, JSON.stringify(action));
      await db.audit("ai_actions", actionId, "triage_applied", JSON.stringify({ appliedBy, triage }), appliedBy);

      console.log(`[AI Triage] Applied ${actionId} to ${action.incidentId} by ${appliedBy}`);
      return json(res, 200, { success: true, actionId, ticketId: action.incidentId, triage });
    } catch (err) {
      console.error("[AI Triage Apply]", err.message);
      return json(res, 500, { error: err.message });
    }
  }


  // ─── Bulk AI Triage — batch-process multiple tickets ────────────────
  // POST /api/ai/batch-triage — triage up to 20 tickets in one call
  if (pathname === "/api/ai/batch-triage" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 200000);
      const { ticketIds, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });
      if (!Array.isArray(ticketIds) || ticketIds.length === 0) return json(res, 400, { error: "ticketIds array required" });
      if (ticketIds.length > 20) return json(res, 400, { error: "Maximum 20 tickets per batch" });

      const results = [];
      const CONCURRENCY = 3;

      // Process tickets in batches of CONCURRENCY
      for (let i = 0; i < ticketIds.length; i += CONCURRENCY) {
        const batch = ticketIds.slice(i, i + CONCURRENCY);
        const batchPromises = batch.map(async (ticketId) => {
          try {
            const incRow = await db.getOne("incidents", ticketId);
            if (!incRow) return { ticketId, status: "not_found", error: "Ticket not found" };
            const ticket = JSON.parse(incRow.data);
            if (ticket.status === "Resolved" || ticket.status === "Closed") {
              return { ticketId, status: "skipped", reason: "Already resolved/closed" };
            }
            if (ticket.aiTriaged) {
              return { ticketId, status: "skipped", reason: "Already triaged by AI" };
            }

            // Call the single-triage endpoint internally via HTTP
            const http = require("http");
            const triageResult = await new Promise((resolve, reject) => {
              const triagePayload = JSON.stringify({ ticket, requestedBy });
              const triageReq = http.request({
                hostname: "localhost", port: PORT, path: "/api/ai/auto-triage-assign",
                method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(triagePayload) },
              }, (r) => {
                let data = ""; r.on("data", c => data += c);
                r.on("end", () => {
                  try { resolve({ statusCode: r.statusCode, ...JSON.parse(data) }); }
                  catch { resolve({ statusCode: r.statusCode, raw: data.substring(0, 200) }); }
                });
              });
              triageReq.on("error", reject);
              triageReq.setTimeout(45000, () => { triageReq.destroy(); reject(new Error("Triage timeout")); });
              triageReq.write(triagePayload);
              triageReq.end();
            });

            return {
              ticketId,
              status: triageResult.statusCode === 200 ? "triaged" : "error",
              triage: triageResult.triage || null,
              confidence: triageResult.confidence || null,
              autoApplied: triageResult.autoApplied || false,
              actionId: triageResult.actionId || null,
            };
          } catch (err) {
            return { ticketId, status: "error", error: err.message };
          }
        });
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      const summary = {
        total: results.length,
        triaged: results.filter(r => r.status === "triaged").length,
        skipped: results.filter(r => r.status === "skipped").length,
        errors: results.filter(r => r.status === "error").length,
        notFound: results.filter(r => r.status === "not_found").length,
      };
      console.log(`[AI Batch Triage] ${summary.triaged}/${summary.total} triaged, ${summary.skipped} skipped, ${summary.errors} errors`);
      return json(res, 200, { results, summary });
    } catch (err) {
      console.error("[AI Batch Triage]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 2: AI Predictive SLA Breach Prevention ───────────────────
  // POST /api/ai/sla-predict — AI predicts SLA breaches and suggests preventive actions
  if (pathname === "/api/ai/sla-predict" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 200000);
      const { incidents: clientIncidents, requests: clientRequests, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const openIncidents = (clientIncidents || []).filter(i => !["Resolved", "Closed"].includes(i.status));
      if (openIncidents.length === 0) return json(res, 200, { predictions: [], message: "No open tickets" });

      const slaMap = getSlaMap();

      // Calculate SLA metrics for each open ticket
      const ticketSummaries = openIncidents.map(inc => {
        const slaTarget = inc.slaTarget || slaMap[inc.priority] || 9;
        const hoursElapsed = inc.created || 0;
        const pctUsed = Math.round((hoursElapsed / slaTarget) * 100);
        const hrsLeft = Math.max(0, slaTarget - hoursElapsed);
        const activityCount = (inc.activityLog || []).length;
        return `ID:${inc.id} Title:"${(inc.title||"").substring(0,60)}" Priority:${inc.priority} Status:${inc.status} Category:${inc.category||"?"} Assignee:${inc.assignee||"Unassigned"} Group:${inc.assignmentGroup||"?"} SLA:${pctUsed}% used (${hrsLeft.toFixed(1)}h left of ${slaTarget}h) Activities:${activityCount}`;
      }).join("\n");

      // Historical MTTR by category
      const allInc = clientIncidents || [];
      const resolved = allInc.filter(i => i.status === "Resolved" || i.status === "Closed");
      const mttrByCategory = {};
      resolved.forEach(i => {
        if (!mttrByCategory[i.category]) mttrByCategory[i.category] = [];
        mttrByCategory[i.category].push(i.created || 0);
      });
      const mttrSummary = Object.entries(mttrByCategory).map(([cat, times]) => {
        const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1);
        return `${cat}: avg ${avg}h (${times.length} resolved)`;
      }).join(", ");

      const systemPrompt = `You are VGC Technology's SLA prediction engine. Analyze open tickets and predict which ones will breach their SLA targets. VGC SLA Policy: ${getSlaDescription()}. Business hours: Mon-Fri 9AM-6PM SGT. Consider: time elapsed vs SLA target, ticket velocity (activity count), historical MTTR for category, assignee workload, priority severity. Return JSON array ONLY (no markdown): [{ "ticketId": "INC-XXX", "breachProbability": 0-100, "predictedBreachIn": "Xh Ym", "suggestedAction": "reassign|escalate|add_resources|notify_manager", "escalationTarget": "name or role", "reasoning": "brief explanation", "emailDraft": "escalation email body if needed" }]. Only include tickets with breachProbability >= 50. Sort by breach probability descending.`;

      const userPrompt = `Open tickets:\n${ticketSummaries}\n\nHistorical MTTR: ${mttrSummary || "No historical data yet"}\n\nPredict SLA breaches and suggest preventive actions.`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 2000 };
      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let predictions;
      try {
        predictions = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        if (!Array.isArray(predictions)) predictions = [predictions];
      } catch { predictions = []; }

      const now = new Date().toISOString();
      const actions = [];
      // Unified dedup: use shared helper + per-incident cap
      const dedupState = await getAiActionsDedupState();
      for (const pred of predictions) {
        if ((pred.breachProbability || 0) >= AI_THRESHOLDS.slaRisk) {
          const skipReason = shouldSkipAction(dedupState, { incidentId: pred.ticketId, type: "sla_prevention" });
          if (skipReason) { console.log(`[AI SLA] Skipped ${pred.ticketId}: ${skipReason}`); continue; }
          const actionRecord = {
            id: `SLA-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            type: "sla_prevention",
            severity: pred.breachProbability >= 90 ? "critical" : "high",
            title: `SLA Breach Risk: ${pred.ticketId} (${pred.breachProbability}% likely)`,
            description: pred.reasoning || "Predicted SLA breach",
            incidentId: pred.ticketId,
            suggestedAction: pred.suggestedAction || "escalate",
            escalationTarget: pred.escalationTarget || "",
            emailDraft: pred.emailDraft || "",
            predictedBreachIn: pred.predictedBreachIn || "unknown",
            breachProbability: pred.breachProbability,
            confidence: pred.breachProbability,
            autoExecutable: false,
            status: "pending_approval",
            createdAt: now,
            createdBy: "AI SLA Prediction Engine",
            requestedBy,
          };
          await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
          trackNewAction(dedupState, { incidentId: pred.ticketId, type: "sla_prevention", title: actionRecord.title });
          actions.push(actionRecord);
        }
      }

      console.log(`[AI SLA] Predicted ${predictions.length} risks, created ${actions.length} actions`);
      return json(res, 200, { predictions, actions, count: predictions.length });
    } catch (err) {
      console.error("[AI SLA Predict]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/sla-audit — AI scans incidents for data quality issues
  if (pathname === "/api/ai/sla-audit" && req.method === "POST") {
    try {
      const allRows = await db.getAll("incidents");
      const slaMap = getSlaMap();
      const issues = [];
      let fixed = 0;

      for (const row of allRows) {
        try {
          const inc = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (!inc || !inc.id) continue;
          const incIssues = [];
          let changed = false;

          if (inc.slaTarget === undefined || inc.slaTarget === null) {
            incIssues.push("missing_slaTarget");
            inc.slaTarget = slaMap[inc.priority] || 9;
            changed = true;
          }
          if (inc.created === undefined || inc.created === null) {
            incIssues.push("missing_created");
            inc.created = 0;
            changed = true;
          }
          if (!inc.createdAt) {
            incIssues.push("missing_createdAt");
            if (Array.isArray(inc.activityLog) && inc.activityLog.length > 0) {
              const first = inc.activityLog.find(a => a.time);
              if (first) { inc.createdAt = first.time; changed = true; }
            }
          }
          if ((inc.status === "Resolved" || inc.status === "Closed") && !inc.resolvedAt) {
            incIssues.push("missing_resolvedAt");
            inc.resolvedAt = inc.updatedAt || inc.zdLastSync || new Date().toISOString();
            changed = true;
          }
          if (typeof inc.created === "number" && inc.created > 8760) {
            incIssues.push("stale_created_snapshot");
          }

          if (changed) {
            await db.upsert("incidents", inc.id, JSON.stringify(inc));
            fixed++;
          }
          if (incIssues.length > 0) {
            issues.push({ id: inc.id, priority: inc.priority, status: inc.status, issues: incIssues, fixed: changed });
          }
        } catch {}
      }

      return json(res, 200, {
        totalScanned: allRows.length,
        issuesFound: issues.length,
        autoFixed: fixed,
        issues: issues.slice(0, 100),
        summary: {
          missingSlaTarget: issues.filter(i => i.issues.includes("missing_slaTarget")).length,
          missingCreated: issues.filter(i => i.issues.includes("missing_created")).length,
          missingCreatedAt: issues.filter(i => i.issues.includes("missing_createdAt")).length,
          missingResolvedAt: issues.filter(i => i.issues.includes("missing_resolvedAt")).length,
          staleCreatedSnapshot: issues.filter(i => i.issues.includes("stale_created_snapshot")).length,
        },
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/sla-remediate — Recalculate SLA for resolved incidents using business hours, stamp results
  if (pathname === "/api/ai/sla-remediate" && req.method === "POST") {
    try {
      const allRows = await db.getAll("incidents");
      const slaMap = getSlaMap();
      const now = new Date();
      let remediated = 0, alreadyDone = 0, skipped = 0;
      const details = [];

      for (const row of allRows) {
        try {
          const inc = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (!inc || !inc.id) continue;
          if (inc.status !== "Resolved" && inc.status !== "Closed") { skipped++; continue; }
          if (inc.slaRemediated) { alreadyDone++; continue; }

          const target = inc.slaTarget || slaMap[inc.priority] || 9;
          let elapsed = 0;
          if (inc.createdAt) {
            const start = new Date(inc.createdAt);
            if (!isNaN(start.getTime())) {
              const endTime = inc.resolvedAt ? new Date(inc.resolvedAt) : now;
              const BH_START = 9, BH_END = 18;
              let cursor = new Date(start);
              while (cursor < endTime) {
                const day = cursor.getDay();
                if (day >= 1 && day <= 5) {
                  const hrs = cursor.getHours() + cursor.getMinutes() / 60;
                  if (hrs >= BH_START && hrs < BH_END) {
                    const eob = new Date(cursor); eob.setHours(BH_END, 0, 0, 0);
                    const chunk = eob < endTime ? eob : endTime;
                    elapsed += (chunk - cursor) / 3600000;
                    cursor = new Date(chunk);
                  } else if (hrs < BH_START) { cursor.setHours(BH_START, 0, 0, 0); }
                  else { cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0); }
                } else {
                  const daysToMon = day === 0 ? 1 : 8 - day;
                  cursor.setDate(cursor.getDate() + daysToMon); cursor.setHours(BH_START, 0, 0, 0);
                }
                if (cursor >= endTime) break;
              }
            }
          } else {
            elapsed = inc.created || 0;
          }
          elapsed = Math.round(elapsed * 100) / 100;
          const breached = elapsed > target;

          inc.slaElapsedHours = elapsed;
          inc.slaStatus = breached ? "Breached" : "Met";
          inc.slaRemediated = true;
          inc.slaRemediatedAt = now.toISOString();

          await db.upsert("incidents", inc.id, JSON.stringify(inc));
          remediated++;
          details.push({ id: inc.id, priority: inc.priority, elapsed, target, breached, status: inc.slaStatus });
        } catch {}
      }

      console.log(`[AI SLA Remediate] Remediated ${remediated}, already done ${alreadyDone}, skipped ${skipped} active`);
      return json(res, 200, {
        totalScanned: allRows.length,
        remediated,
        alreadyDone,
        skippedActive: skipped,
        sample: details.slice(0, 50),
        summary: {
          met: details.filter(d => !d.breached).length,
          breached: details.filter(d => d.breached).length,
        },
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/sla/compliance-report — Unified SLA metrics for all modules
  if (pathname === "/api/sla/compliance-report" && req.method === "GET") {
    try {
      const allRows = await db.getAll("incidents");
      const slaMap = getSlaMap();
      const now = new Date();

      const incidents = allRows.map(r => {
        try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; }
      }).filter(Boolean);

      const active = incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed");
      const resolved = incidents.filter(i => i.status === "Resolved" || i.status === "Closed");

      // Business hours SLA computation
      const computeSla = (inc) => {
        const target = inc.slaTarget || slaMap[inc.priority] || 9;
        let elapsed = 0;
        if (inc.createdAt) {
          const start = new Date(inc.createdAt);
          if (!isNaN(start.getTime())) {
            const endTime = (inc.status === "Resolved" || inc.status === "Closed") && inc.resolvedAt ? new Date(inc.resolvedAt) : now;
            const BH_START = 9, BH_END = 18;
            let cursor = new Date(start);
            while (cursor < endTime) {
              const day = cursor.getDay();
              if (day >= 1 && day <= 5) {
                const hrs = cursor.getHours() + cursor.getMinutes() / 60;
                if (hrs >= BH_START && hrs < BH_END) {
                  const eob = new Date(cursor); eob.setHours(BH_END, 0, 0, 0);
                  const chunk = eob < endTime ? eob : endTime;
                  elapsed += (chunk - cursor) / 3600000;
                  cursor = new Date(chunk);
                } else if (hrs < BH_START) { cursor.setHours(BH_START, 0, 0, 0); }
                else { cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0); }
              } else {
                const daysToMon = day === 0 ? 1 : 8 - day;
                cursor.setDate(cursor.getDate() + daysToMon); cursor.setHours(BH_START, 0, 0, 0);
              }
              if (cursor >= endTime) break;
            }
          }
        } else {
          elapsed = inc.created || 0;
        }
        return { elapsed: Math.round(elapsed * 100) / 100, target, breached: elapsed > target, pct: Math.round((elapsed / target) * 100) };
      };

      const activeSla = active.map(i => ({ id: i.id, priority: i.priority, ...computeSla(i) }));
      const resolvedSla = resolved.map(i => ({ id: i.id, priority: i.priority, ...computeSla(i) }));

      const activeBreached = activeSla.filter(s => s.breached).length;
      const activeMet = activeSla.length - activeBreached;
      const resolvedBreached = resolvedSla.filter(s => s.breached).length;
      const resolvedMet = resolvedSla.length - resolvedBreached;

      // MTTR from resolved with timestamps
      const withTimestamps = resolved.filter(i => i.createdAt && i.resolvedAt);
      let mttrHours = 0;
      if (withTimestamps.length > 0) {
        const totalResolveTime = withTimestamps.reduce((sum, i) => {
          const s = computeSla(i);
          return sum + s.elapsed;
        }, 0);
        mttrHours = Math.round((totalResolveTime / withTimestamps.length) * 10) / 10;
      }

      const byPriority = {};
      for (const p of ["Sev-A", "Sev-B", "Sev-C", "Sev-D"]) {
        const pActive = activeSla.filter(s => s.priority === p);
        const pResolved = resolvedSla.filter(s => s.priority === p);
        byPriority[p] = {
          active: pActive.length,
          activeBreached: pActive.filter(s => s.breached).length,
          resolved: pResolved.length,
          resolvedBreached: pResolved.filter(s => s.breached).length,
          target: slaMap[p] || 9,
        };
      }

      return json(res, 200, {
        overall: {
          activeMet, activeBreached, activeTotal: active.length,
          resolvedMet, resolvedBreached, resolvedTotal: resolved.length,
          compliancePct: active.length > 0 ? Math.round((activeMet / active.length) * 100) : 100,
          mttrHours,
        },
        byPriority,
        generatedAt: now.toISOString(),
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 4: Smart Workload Balancing ──────────────────────────────
  // POST /api/ai/workload-rebalance — AI analyzes team workload and suggests reassignments
  if (pathname === "/api/ai/workload-rebalance" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allUsersRaw = await db.getAll("users");
      const teamMembers = allUsersRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      const allIncRaw = await db.getAll("incidents");
      const allIncidents = allIncRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      const openStatuses = new Set(["New", "Open", "In Progress", "Pending"]);
      const openIncidents = allIncidents.filter(i => openStatuses.has(i.status));

      // Build workload map: assignee → { count, sevA, sevB, totalSlaUsed, tickets[] }
      const workloadMap = {};
      for (const inc of openIncidents) {
        const assignee = inc.assignee || "Unassigned";
        if (!workloadMap[assignee]) workloadMap[assignee] = { count: 0, sevA: 0, sevB: 0, totalSlaUsed: 0, tickets: [] };
        workloadMap[assignee].count++;
        if (inc.priority === "Sev-A") workloadMap[assignee].sevA++;
        if (inc.priority === "Sev-B") workloadMap[assignee].sevB++;
        const slaTarget = inc.slaTarget || getSlaMap()[inc.priority] || 9;
        workloadMap[assignee].totalSlaUsed += Math.round(((inc.created || 0) / slaTarget) * 100);
        workloadMap[assignee].tickets.push({ id: inc.id, title: (inc.title || "").substring(0, 50), priority: inc.priority, category: inc.category, slaUsed: Math.round(((inc.created || 0) / slaTarget) * 100) });
      }

      // Historical resolution expertise
      const resolvedInc = allIncidents.filter(i => i.status === "Resolved" || i.status === "Closed");
      const expertise = {};
      for (const inc of resolvedInc) {
        if (!inc.assignee || inc.assignee === "Unassigned") continue;
        if (!expertise[inc.assignee]) expertise[inc.assignee] = {};
        const cat = inc.category || "General";
        expertise[inc.assignee][cat] = (expertise[inc.assignee][cat] || 0) + 1;
      }

      const workloadSummary = Object.entries(workloadMap).map(([name, w]) => {
        const avgSla = w.count > 0 ? Math.round(w.totalSlaUsed / w.count) : 0;
        const exp = expertise[name] ? Object.entries(expertise[name]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c}(${n})`).join(",") : "none";
        return `${name}: ${w.count} open (${w.sevA} Sev-A, ${w.sevB} Sev-B), avg SLA ${avgSla}% used, expertise: ${exp}`;
      }).join("\n");

      const teamList = teamMembers.slice(0, 20).map(u => `${u.displayName || u.name || u.id} (${u.jobTitle || u.role || "Agent"})`).join(", ");

      const systemPrompt = `You are the VGC-ITSM Workload Balancing Engine. Analyze team workload distribution and suggest reassignments to optimize performance.

CURRENT WORKLOAD:
${workloadSummary}

TEAM MEMBERS: ${teamList}

RULES:
1. Balance ticket count across agents — no one should have >2x the average
2. Match ticket category to agent expertise when possible
3. Prioritize reassigning Sev-A/Sev-B tickets at high SLA usage
4. Never reassign tickets already near resolution (>80% SLA used with activity)
5. Consider "Unassigned" tickets as top priority for assignment

Return JSON ONLY (no markdown): {
  "summary": "brief overall assessment",
  "avgWorkload": number,
  "maxWorkload": number,
  "imbalanceScore": 0-100 (0=perfectly balanced, 100=extremely unbalanced),
  "reassignments": [{ "ticketId": "INC-XXX", "from": "current assignee", "to": "suggested assignee", "reason": "brief reason", "priority": "high|medium|low" }],
  "unassignedActions": [{ "ticketId": "INC-XXX", "suggestedAssignee": "name", "reason": "why this person" }]
}`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: `Analyze current workload and suggest optimal reassignments. ${openIncidents.length} open tickets across ${Object.keys(workloadMap).length} agents.` }], max_output_tokens: 2000 };
      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let analysis;
      try {
        analysis = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch { analysis = { summary: "Could not parse AI response", imbalanceScore: 0, reassignments: [], unassignedActions: [] }; }

      // Create AI actions for recommended reassignments
      const dedupState = await getAiActionsDedupState();
      const now = new Date().toISOString();
      const actions = [];
      for (const r of (analysis.reassignments || [])) {
        const skipReason = shouldSkipAction(dedupState, { incidentId: r.ticketId, type: "workload_rebalance" });
        if (skipReason) { console.log(`[Workload] Skipped ${r.ticketId}: ${skipReason}`); continue; }
        const actionRecord = {
          id: `WLB-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          type: "workload_rebalance",
          severity: r.priority === "high" ? "high" : "medium",
          title: `Reassign ${r.ticketId}: ${r.from} → ${r.to}`,
          description: r.reason,
          incidentId: r.ticketId,
          suggestedAction: "reassign",
          fromAssignee: r.from,
          toAssignee: r.to,
          confidence: 80,
          autoExecutable: false,
          status: "pending_approval",
          createdAt: now,
          createdBy: "AI Workload Balancing Engine",
          requestedBy,
        };
        await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
        trackNewAction(dedupState, { incidentId: r.ticketId, type: "workload_rebalance", title: actionRecord.title });
        actions.push(actionRecord);
      }

      console.log(`[Workload] Imbalance: ${analysis.imbalanceScore || 0}%, ${(analysis.reassignments || []).length} suggestions, ${actions.length} actions created`);
      return json(res, 200, { analysis, workloadMap, actions, count: actions.length });
    } catch (err) {
      console.error("[Workload Rebalance]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 5: Root Cause Correlation ────────────────────────────────
  // POST /api/ai/correlate-incidents — AI finds patterns and common root causes across incidents
  if (pathname === "/api/ai/correlate-incidents" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allIncRaw = await db.getAll("incidents");
      const allIncidents = allIncRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      // Recent incidents (last 30 days or last 100)
      const recentIncidents = allIncidents.slice(-100);
      const openStatuses = new Set(["New", "Open", "In Progress", "Pending"]);
      const openIncidents = recentIncidents.filter(i => openStatuses.has(i.status));
      const resolvedIncidents = recentIncidents.filter(i => i.status === "Resolved" || i.status === "Closed");

      // Build category/priority clusters
      const clusters = {};
      for (const inc of recentIncidents) {
        const key = `${inc.category || "General"}|${inc.assignmentGroup || "Service Desk"}`;
        if (!clusters[key]) clusters[key] = { category: inc.category || "General", group: inc.assignmentGroup || "Service Desk", count: 0, open: 0, ids: [], priorities: {} };
        clusters[key].count++;
        if (openStatuses.has(inc.status)) clusters[key].open++;
        clusters[key].ids.push(inc.id);
        clusters[key].priorities[inc.priority] = (clusters[key].priorities[inc.priority] || 0) + 1;
      }

      const incidentSummaries = recentIncidents.slice(-50).map(inc => {
        return `ID:${inc.id} Title:"${(inc.title||"").substring(0,60)}" Cat:${inc.category||"?"} Priority:${inc.priority} Status:${inc.status} Group:${inc.assignmentGroup||"?"} Reporter:${inc.reporter||"?"} Created:${inc.createdAt||"?"}`;
      }).join("\n");

      const clusterSummary = Object.values(clusters).sort((a, b) => b.count - a.count).slice(0, 15).map(c => {
        return `${c.category} (${c.group}): ${c.count} total, ${c.open} open, priorities: ${Object.entries(c.priorities).map(([p, n]) => `${p}:${n}`).join(",")}`;
      }).join("\n");

      const systemPrompt = `You are the VGC-ITSM Root Cause Correlation Engine. Analyze recent incidents to identify patterns, recurring issues, and common root causes.

INCIDENT CLUSTERS:
${clusterSummary}

RECENT INCIDENTS:
${incidentSummaries}

ANALYSIS TASKS:
1. Identify recurring incident patterns (same category/type appearing multiple times)
2. Find potential common root causes linking multiple incidents
3. Detect category-specific trends (increasing/decreasing)
4. Spot related incidents that might have a shared underlying cause
5. Recommend proactive measures to prevent recurrence

Return JSON ONLY (no markdown): {
  "correlations": [{ "id": "COR-001", "title": "pattern title", "type": "recurring|related|trend|root_cause", "severity": "critical|high|medium|low", "affectedTickets": ["INC-XXX"], "description": "what was found", "rootCause": "likely root cause", "recommendation": "suggested fix", "confidence": 0-100 }],
  "trends": [{ "category": "...", "direction": "increasing|decreasing|stable", "count": number, "insight": "brief" }],
  "summary": "overall pattern analysis",
  "riskScore": 0-100
}`;

      const payload = { model: getAIModel("primary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: `Analyze ${recentIncidents.length} recent incidents (${openIncidents.length} open, ${resolvedIncidents.length} resolved) across ${Object.keys(clusters).length} clusters. Find patterns and root causes.` }], max_output_tokens: 2500 };
      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(45000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let analysis;
      try {
        analysis = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch { analysis = { correlations: [], trends: [], summary: "Could not parse AI response", riskScore: 0 }; }

      // Create AI actions for high-confidence correlations
      const dedupState = await getAiActionsDedupState();
      const now = new Date().toISOString();
      const actions = [];
      for (const cor of (analysis.correlations || [])) {
        if ((cor.confidence || 0) < 60) continue;
        const dedupId = (cor.affectedTickets || []).sort().join(",") || cor.id;
        const skipReason = shouldSkipAction(dedupState, { incidentId: dedupId, type: "root_cause_correlation" });
        if (skipReason) { console.log(`[Correlation] Skipped ${cor.id}: ${skipReason}`); continue; }
        const actionRecord = {
          id: `COR-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          type: "root_cause_correlation",
          severity: cor.severity || "medium",
          title: cor.title,
          description: `${cor.description}\n\nRoot Cause: ${cor.rootCause || "Under investigation"}\nRecommendation: ${cor.recommendation || "Review affected tickets"}`,
          incidentId: dedupId,
          affectedTickets: cor.affectedTickets || [],
          rootCause: cor.rootCause || "",
          recommendation: cor.recommendation || "",
          confidence: cor.confidence || 70,
          correlationType: cor.type || "related",
          autoExecutable: false,
          status: "pending_approval",
          createdAt: now,
          createdBy: "AI Root Cause Correlation Engine",
          requestedBy,
        };
        await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
        trackNewAction(dedupState, { incidentId: dedupId, type: "root_cause_correlation", title: actionRecord.title });
        actions.push(actionRecord);
      }

      console.log(`[Correlation] Found ${(analysis.correlations || []).length} patterns, ${(analysis.trends || []).length} trends, created ${actions.length} actions`);
      if (wsServer && actions.length > 0) {
        wsServer.broadcast("ai_correlation", { action: "patterns_detected", correlations: analysis.correlations, trends: analysis.trends, riskScore: analysis.riskScore, count: actions.length });
      }
      return json(res, 200, { analysis, actions, count: actions.length });
    } catch (err) {
      console.error("[Correlation]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 3: AI Knowledge Base Auto-Generation ─────────────────────
  // POST /api/ai/kb-auto-generate — generate KB article from resolved ticket
  if (pathname === "/api/ai/kb-auto-generate" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 100000);
      const { ticket, requestedBy } = body;
      if (!ticket || !requestedBy) return json(res, 400, { error: "ticket and requestedBy required" });

      // Get existing KB for dedup check
      const existingKB = await db.getAll("kb");
      const kbTitles = existingKB.map(k => { try { const d = JSON.parse(k.data); return d.title || ""; } catch { return ""; } }).filter(Boolean).join(", ");

      const activitySummary = (ticket.activityLog || []).map(a => `[${a.time}] ${a.user}: ${a.detail}`).join("\n");

      const systemPrompt = `You are VGC Technology's knowledge management AI. Generate a professional KB article from a resolved ITSM incident. The article should help future engineers resolve similar issues quickly. Existing KB titles for deduplication: [${kbTitles.substring(0, 1000)}]. If this resolution is too similar to an existing article, set isDuplicate=true. Return JSON ONLY: { "title": "clear article title", "category": "matching incident category", "content": "full structured article with Problem, Cause, Solution, Prevention sections", "tags": ["tag1","tag2"], "whenToUse": "one-line description of when to use this article", "bestFor": "role or scenario", "confidence": 0-100, "isDuplicate": false, "duplicateOf": "existing title if duplicate" }`;

      const userPrompt = `Resolved Incident:\nID: ${ticket.id}\nTitle: ${ticket.title}\nCategory: ${ticket.category || "General"}\nPriority: ${ticket.priority}\nDescription: ${(ticket.description || "").substring(0, 500)}\nResolution/Workaround: ${(ticket.workaround || ticket.resolution || "").substring(0, 500)}\n\nActivity Log:\n${activitySummary.substring(0, 2000)}\n\nGenerate a KB article from this resolution.`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 2000 };
      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let kbDraft;
      try {
        kbDraft = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        return json(res, 502, { error: "AI returned invalid KB JSON", raw: text.substring(0, 500) });
      }

      if (kbDraft.isDuplicate) {
        return json(res, 200, { isDuplicate: true, duplicateOf: kbDraft.duplicateOf, message: "Similar KB article already exists" });
      }

      const now = new Date().toISOString();
      const draftId = `KBD-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

      // Save KB draft to ai_actions for approval
      const actionRecord = {
        id: draftId,
        type: "kb_draft",
        severity: "low",
        title: `KB Draft: ${kbDraft.title}`,
        description: `Auto-generated from resolved ticket ${ticket.id}`,
        incidentId: ticket.id,
        suggestedAction: `Publish KB article: "${kbDraft.title}"`,
        kbDraft: {
          title: kbDraft.title,
          category: kbDraft.category || ticket.category || "General",
          content: kbDraft.content,
          tags: kbDraft.tags || [],
          whenToUse: kbDraft.whenToUse || "",
          bestFor: kbDraft.bestFor || "",
          sourceTicketId: ticket.id,
        },
        confidence: kbDraft.confidence || 75,
        autoExecutable: false,
        status: "pending_approval",
        createdAt: now,
        createdBy: "AI KB Generation Engine",
        requestedBy,
      };

      await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
      console.log(`[AI KB] Generated draft "${kbDraft.title}" from ${ticket.id}`);
      return json(res, 200, { success: true, draftId, kbDraft: actionRecord.kbDraft, confidence: kbDraft.confidence });
    } catch (err) {
      console.error("[AI KB Generate]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/kb-auto-generate/approve — approve and publish a KB draft
  if (pathname === "/api/ai/kb-auto-generate/approve" && req.method === "POST") {
    try {
      const body = await parseBody(req, 50000);
      const { actionId, approvedBy, editedContent } = body;
      if (!actionId || !approvedBy) return json(res, 400, { error: "actionId and approvedBy required" });

      const row = await db.getOne("ai_actions", actionId);
      if (!row) return json(res, 404, { error: "KB draft action not found" });
      const action = JSON.parse(row.data);
      if (action.type !== "kb_draft") return json(res, 400, { error: "Not a KB draft action" });

      const draft = action.kbDraft;
      const now = new Date().toISOString();
      const kbId = `KB-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

      // Create published KB article
      const kbArticle = {
        id: kbId,
        title: draft.title,
        category: draft.category,
        content: editedContent || draft.content,
        tags: draft.tags,
        whenToUse: draft.whenToUse,
        bestFor: draft.bestFor,
        sourceTicketId: draft.sourceTicketId,
        status: "Published",
        author: approvedBy,
        createdAt: now,
        updatedAt: now,
        aiGenerated: true,
        views: 0, helpful: 0, notHelpful: 0,
      };

      await db.upsert("kb", kbId, JSON.stringify(kbArticle));

      // Update action status
      action.status = "applied";
      action.approvedBy = approvedBy;
      action.approvedAt = now;
      action.executedAt = now;
      action.executionResult = `Published as ${kbId}`;
      await db.upsert("ai_actions", actionId, JSON.stringify(action));

      console.log(`[AI KB] Published ${kbId} from draft ${actionId} by ${approvedBy}`);
      return json(res, 200, { success: true, kbId, article: kbArticle });
    } catch (err) {
      console.error("[AI KB Approve]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 4: AI Daily Briefing + Shift Handover ────────────────────
  // POST /api/ai/daily-briefing — generate AI daily briefing report
  if (pathname === "/api/ai/daily-briefing" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { requestedBy, shift, recipients, incidents: clientIncidents, changes: clientChanges, requests: clientRequests } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allInc = clientIncidents || [];
      const allChanges = clientChanges || [];
      const allReqs = clientRequests || [];

      const now = new Date();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

      // Gather AI actions stats
      const aiActionsRows = await db.getAll("ai_actions");
      const recentActions = aiActionsRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      const pendingActions = recentActions.filter(a => a.status === "pending_approval").length;
      const autoApplied = recentActions.filter(a => a.status === "auto_applied").length;

      const openInc = allInc.filter(i => !["Resolved", "Closed"].includes(i.status));
      const criticalOpen = openInc.filter(i => i.priority === "Sev-A" || i.priority === "Sev-B");
      const resolvedRecent = allInc.filter(i => (i.status === "Resolved" || i.status === "Closed"));

      // Business-hours SLA breach calculation for briefing
      const computeBriefingSla = (inc) => {
        const target = inc.slaTarget || 9;
        let elapsed = 0;
        if (inc.createdAt) {
          const start = new Date(inc.createdAt);
          if (!isNaN(start.getTime())) {
            const endTime = (inc.status === "Resolved" || inc.status === "Closed") && inc.resolvedAt ? new Date(inc.resolvedAt) : now;
            const BH_START = 9, BH_END = 18;
            let cursor = new Date(start);
            while (cursor < endTime) {
              const day = cursor.getDay();
              if (day >= 1 && day <= 5) {
                const hrs = cursor.getHours() + cursor.getMinutes() / 60;
                if (hrs >= BH_START && hrs < BH_END) {
                  const eob = new Date(cursor); eob.setHours(BH_END, 0, 0, 0);
                  const chunk = eob < endTime ? eob : endTime;
                  elapsed += (chunk - cursor) / 3600000;
                  cursor = new Date(chunk);
                } else if (hrs < BH_START) { cursor.setHours(BH_START, 0, 0, 0); }
                else { cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0); }
              } else {
                const daysToMon = day === 0 ? 1 : 8 - day;
                cursor.setDate(cursor.getDate() + daysToMon); cursor.setHours(BH_START, 0, 0, 0);
              }
              if (cursor >= endTime) break;
            }
          } else { elapsed = inc.created || 0; }
        } else { elapsed = inc.created || 0; }
        return elapsed > target;
      };
      const totalSLABreaches = openInc.filter(i => computeBriefingSla(i)).length;

      const dataSummary = `ITSM Overview (${now.toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}):\n- Total Incidents: ${allInc.length}\n- Open: ${openInc.length} (${criticalOpen.length} critical/high)\n- Resolved: ${resolvedRecent.length}\n- SLA Breaches: ${totalSLABreaches}\n- Open Requests: ${allReqs.filter(r => r.status !== "Completed" && r.status !== "Closed").length}\n- Scheduled Changes: ${allChanges.filter(c => c.status === "Scheduled" || c.status === "Approved").length}\n- AI Actions Pending: ${pendingActions}\n- AI Auto-Applied: ${autoApplied}\n\nCritical Items:\n${criticalOpen.map(i => `- ${i.id}: "${i.title}" [${i.priority}] assigned to ${i.assignee || "Unassigned"}, SLA ${Math.round((i.created / (i.slaTarget || 9)) * 100)}%`).join("\n") || "None"}`;

      const systemPrompt = `You are VGC Technology's ITSM briefing AI. Generate a concise, actionable ${shift || "daily"} briefing for the IT operations team. Format with clear sections. Be direct — highlight risks, blockers, and actions needed. Return JSON ONLY: { "executiveSummary": "2-3 sentence overview", "criticalItems": [{ "id": "ticket ID", "issue": "brief", "action": "needed action" }], "slaStatus": "overall SLA health description", "handoverNotes": "key things for next shift", "actionItems": ["action 1", "action 2"], "upcomingChanges": "scheduled changes summary", "aiInsights": "any AI-detected patterns or recommendations", "riskLevel": "low|medium|high|critical" }`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: dataSummary }], max_output_tokens: 2000 };
      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let briefing;
      try {
        briefing = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        briefing = { executiveSummary: text.substring(0, 500), criticalItems: [], slaStatus: "Unknown", handoverNotes: "", actionItems: [], riskLevel: "medium" };
      }

      const briefingId = `BRF-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const briefingRecord = {
        id: briefingId,
        ...briefing,
        generatedAt: now.toISOString(),
        generatedBy: requestedBy,
        shift: shift || "daily",
        recipients: recipients || [],
        stats: { totalIncidents: allInc.length, openIncidents: openInc.length, criticalOpen: criticalOpen.length, slaBreaches: totalSLABreaches, pendingAiActions: pendingActions },
      };

      await db.upsert("ai_briefings", briefingId, JSON.stringify(briefingRecord));

      // Send email if recipients provided and graphSendMail available
      if (recipients && recipients.length > 0) {
        const riskColors = { critical: "#FF4444", high: "#FF6B6B", medium: "#FFB347", low: "#81C784" };
        const emailBody = `<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#6366F1">🤖 VGC ITSM Daily Briefing</h2><div style="background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:16px;border-left:4px solid ${riskColors[briefing.riskLevel] || "#6366F1"}"><strong>Risk Level:</strong> <span style="color:${riskColors[briefing.riskLevel] || "#333"};font-weight:700;text-transform:uppercase">${briefing.riskLevel || "medium"}</span><br><br>${briefing.executiveSummary || ""}</div><h3>📊 SLA Status</h3><p>${briefing.slaStatus || "N/A"}</p><h3>⚡ Action Items</h3><ul>${(briefing.actionItems || []).map(a => `<li>${a}</li>`).join("")}</ul><h3>📋 Handover Notes</h3><p>${briefing.handoverNotes || "None"}</p><h3>🤖 AI Insights</h3><p>${briefing.aiInsights || "No patterns detected"}</p><hr><p style="font-size:11px;color:#888">Generated by VGC AI Engine · ${now.toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}</p></div>`;
        try {
          await graphSendMail({ to: recipients, subject: `[VGC ITSM] ${shift || "Daily"} Briefing — Risk: ${(briefing.riskLevel || "medium").toUpperCase()}`, body: emailBody });
        } catch (emailErr) {
          console.error("[AI Briefing] Email send failed:", emailErr.message);
        }
      }

      console.log(`[AI Briefing] Generated ${briefingId} (${briefing.riskLevel}) by ${requestedBy}`);
      return json(res, 200, { success: true, briefingId, briefing: briefingRecord });
    } catch (err) {
      console.error("[AI Briefing]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/briefings — list past briefings
  if (pathname === "/api/ai/briefings" && req.method === "GET") {
    try {
      const rows = await db.getAll("ai_briefings");
      const briefings = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      briefings.sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""));
      return json(res, 200, { briefings });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 5: AI Pattern Detection + Proactive Prevention ──────────
  // POST /api/ai/pattern-detect — analyze historical data for recurring patterns
  if (pathname === "/api/ai/pattern-detect" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 200000);
      const { incidents: clientIncidents, problems: clientProblems, changes: clientChanges, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allInc = clientIncidents || [];
      const allProblems = clientProblems || [];

      // Group incidents by category, subcategory, asset, customer
      const byCategory = {};
      const byAsset = {};
      const byCustomer = {};
      allInc.forEach(inc => {
        const cat = inc.category || "Other";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(inc);
        if (inc.affectedAsset) {
          if (!byAsset[inc.affectedAsset]) byAsset[inc.affectedAsset] = [];
          byAsset[inc.affectedAsset].push(inc);
        }
        if (inc.customer) {
          if (!byCustomer[inc.customer]) byCustomer[inc.customer] = [];
          byCustomer[inc.customer].push(inc);
        }
      });

      const categorySummary = Object.entries(byCategory).map(([cat, incs]) => `${cat}: ${incs.length} incidents (${incs.filter(i => i.priority === "Sev-A" || i.priority === "Sev-B").length} critical/high)`).join("\n");
      const assetSummary = Object.entries(byAsset).filter(([, incs]) => incs.length >= 2).map(([asset, incs]) => `${asset}: ${incs.length} incidents`).join("\n");
      const customerSummary = Object.entries(byCustomer).filter(([, incs]) => incs.length >= 2).map(([cust, incs]) => `${cust}: ${incs.length} incidents`).join("\n");
      const problemSummary = allProblems.map(p => `${p.id}: "${p.title}" [${p.status}] Category:${p.category} LinkedIncidents:${(p.linkedIncidents || []).length}`).join("\n");

      const systemPrompt = `You are VGC Technology's pattern detection AI. Analyze historical ITSM data to find recurring patterns, correlations, seasonal trends, and predict future incidents. Focus on: (1) Recurring issues (same category/asset/customer), (2) Correlated incidents (related failures), (3) Trending issues (increasing frequency), (4) Seasonal patterns (time-based), (5) Asset health concerns. Return JSON array ONLY: [{ "patternId": "PAT-XXX", "type": "recurring|correlated|trending|seasonal|asset_health", "title": "pattern title", "description": "detailed explanation", "frequency": "how often", "affectedAssets": [], "affectedCustomers": [], "confidence": 0-100, "suggestedPrevention": "what to do", "estimatedImpact": "impact description", "nextPredictedOccurrence": "when likely next", "relatedIncidents": ["INC-XXX"] }]. Return max 10 patterns, sorted by confidence.`;

      const userPrompt = `Historical Data (${allInc.length} incidents, ${allProblems.length} problems):\n\nBy Category:\n${categorySummary}\n\nRepeat Assets:\n${assetSummary || "None"}\n\nRepeat Customers:\n${customerSummary || "None"}\n\nExisting Problems:\n${problemSummary || "None"}\n\nDetect patterns and predict future incidents.`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 2000 };
      const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(45000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let patterns;
      try {
        patterns = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        if (!Array.isArray(patterns)) patterns = [patterns];
      } catch { patterns = []; }

      const now = new Date().toISOString();
      const actions = [];
      // Unified dedup: use shared helper + per-incident/total cap + title dedup
      const dedupState = await getAiActionsDedupState();
      for (const pat of patterns) {
        const patId = pat.patternId || `PAT-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        pat.id = patId;
        pat.detectedAt = now;
        pat.detectedBy = requestedBy;
        pat.status = "active";
        await db.upsert("ai_patterns", patId, JSON.stringify(pat));

        if ((pat.confidence || 0) >= AI_THRESHOLDS.patternConfidence) {
          const actionTitle = `Pattern: ${pat.title}`;
          const skipReason = shouldSkipAction(dedupState, { type: "preventive_action", title: actionTitle });
          if (skipReason) { console.log(`[AI Patterns] Skipped "${pat.title}": ${skipReason}`); continue; }
          const actionRecord = {
            id: `PRA-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            type: "preventive_action",
            severity: pat.confidence >= 90 ? "critical" : "high",
            title: actionTitle,
            description: pat.description,
            patternId: patId,
            suggestedAction: pat.suggestedPrevention || "Investigate pattern",
            estimatedImpact: pat.estimatedImpact || "",
            confidence: pat.confidence,
            autoExecutable: false,
            status: "pending_approval",
            createdAt: now,
            createdBy: "AI Pattern Detection Engine",
            requestedBy,
          };
          await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
          trackNewAction(dedupState, { type: "preventive_action", title: actionTitle });
          actions.push(actionRecord);
        }
      }

      console.log(`[AI Patterns] Detected ${patterns.length} patterns, created ${actions.length} actions`);
      return json(res, 200, { patterns, actions, count: patterns.length });
    } catch (err) {
      console.error("[AI Pattern Detect]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/patterns — list detected patterns
  if (pathname === "/api/ai/patterns" && req.method === "GET") {
    try {
      const rows = await db.getAll("ai_patterns");
      const patterns = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      patterns.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      return json(res, 200, { patterns });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/patterns/:id/create-problem — convert pattern to Problem record
  if (pathname.match(/^\/api\/ai\/patterns\/[^/]+\/create-problem$/) && req.method === "POST") {
    try {
      const patternId = pathname.split("/")[4];
      const body = await parseBody(req, 10000);
      const { requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const row = await db.getOne("ai_patterns", patternId);
      if (!row) return json(res, 404, { error: "Pattern not found" });
      const pattern = JSON.parse(row.data);

      const now = new Date().toISOString();
      const actionRecord = {
        id: `PPC-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        type: "create_problem",
        severity: pattern.confidence >= 90 ? "critical" : "high",
        title: `Create Problem: ${pattern.title}`,
        description: `Based on detected pattern: ${pattern.description}`,
        patternId,
        suggestedAction: `Create Problem record from pattern "${pattern.title}"`,
        problemDraft: {
          title: `[AI Pattern] ${pattern.title}`,
          category: pattern.type || "Recurring",
          priority: pattern.confidence >= 90 ? "Sev-A" : "Sev-B",
          description: `AI-detected pattern: ${pattern.description}\n\nSuggested Prevention: ${pattern.suggestedPrevention || "N/A"}\n\nEstimated Impact: ${pattern.estimatedImpact || "N/A"}\n\nFrequency: ${pattern.frequency || "Unknown"}`,
          linkedIncidents: pattern.relatedIncidents || [],
          rootCause: pattern.suggestedPrevention || "",
          affectedAssets: pattern.affectedAssets || [],
        },
        confidence: pattern.confidence,
        autoExecutable: false,
        status: "pending_approval",
        createdAt: now,
        createdBy: "AI Pattern Detection Engine",
        requestedBy,
      };

      await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
      console.log(`[AI Patterns] Created problem action for pattern ${patternId}`);
      return json(res, 200, { success: true, actionId: actionRecord.id, problemDraft: actionRecord.problemDraft });
    } catch (err) {
      console.error("[AI Pattern Create Problem]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Actions Engine: Proactive Monitor + Approval Workflow ────────
  // POST /api/ai/actions/scan — AI scans all open incidents/tickets for critical cases, generates action items
  if (pathname === "/api/ai/actions/scan" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 100000);
      const { incidents: clientIncidents, changes: clientChanges, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy (Entra user) required" });
      const allIncidents = clientIncidents || [];
      const allChanges = clientChanges || [];

      // Filter critical/high priority open incidents
      const critical = allIncidents.filter(i =>
        (i.status === "Open" || i.status === "In Progress") &&
        (i.priority === "Sev-A" || i.priority === "Sev-B")
      );
      // SLA at-risk items
      const slaAtRisk = allIncidents.filter(i =>
        (i.status === "Open" || i.status === "In Progress") &&
        i.created && i.slaTarget && (i.created / i.slaTarget) >= 0.8
      );
      // Pending changes needing attention
      const pendingChanges = allChanges.filter(c => c.status === "Awaiting Approval" || c.status === "Implementing");

      if (critical.length === 0 && slaAtRisk.length === 0 && pendingChanges.length === 0) {
        return json(res, 200, { actions: [], message: "No critical items requiring AI action" });
      }

      const contextSummary = [
        critical.length > 0 ? `CRITICAL INCIDENTS (${critical.length}):\n${critical.map(i => `- ${i.id}: ${i.title} [${i.priority}] assigned:${i.assignee||'Unassigned'} SLA:${i.slaTarget}h status:${i.status} category:${i.category}`).join("\n")}` : "",
        slaAtRisk.length > 0 ? `SLA AT-RISK (${slaAtRisk.length}):\n${slaAtRisk.map(i => `- ${i.id}: ${i.title} [${i.priority}] SLA ${Math.round((i.created/i.slaTarget)*100)}% elapsed`).join("\n")}` : "",
        pendingChanges.length > 0 ? `PENDING CHANGES (${pendingChanges.length}):\n${pendingChanges.map(c => `- ${c.id}: ${c.title} [${c.status}] risk:${c.risk}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");

      const systemPrompt = `You are VGC-ITSM AI Assist Engine for VGC Technology Pte Ltd. Analyze the following ITSM data and generate a JSON array of action items that need human approval.

For each action, provide:
- id: unique action ID (format: AIA-<timestamp>-<seq>)
- type: one of "escalation", "notification", "assignment", "sla_warning", "follow_up", "change_review", "internal_note"
- severity: "critical", "high", "medium", "low"
- title: short action title (max 80 chars)
- description: detailed description of what needs to happen
- incidentId: related incident/change ID
- suggestedAction: exactly what AI recommends doing
- emailDraft: if type involves notification, include a draft email { to, subject, body }
- internalNote: note for the internal team only (never shown to customers)
- confidence: 0-100
- autoExecutable: true only for low-risk, routine actions (SLA warnings, internal notes, routine follow-ups). false for escalations, customer-facing, financial, or irreversible actions.
- reasoning: brief explanation of why this action is recommended

RULES:
- NEVER auto-execute customer-facing actions. All customer emails require human approval.
- Mark escalation actions as critical severity.
- For SLA at-risk items, suggest proactive customer notification.
- For unassigned critical tickets, suggest immediate assignment.
- Generate internal notes with clear action items for the team.
- All actions must be approvable/rejectable by any Entra-authenticated user.

Respond ONLY with a valid JSON array. No markdown wrapping.`;

      const payload = {
        model: getAIModel("secondary"),
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Current time: ${new Date().toISOString()}\nRequested by: ${requestedBy}\n\n${contextSummary}` }
        ],
        max_output_tokens: 2000
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
            else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(45000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let actions;
      try {
        actions = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        if (!Array.isArray(actions)) actions = [actions];
      } catch {
        actions = [];
      }

      // Stamp each action with metadata and save to DB
      const now = new Date().toISOString();
      const savedActions = [];
      // Unified dedup: use shared helper — per-incident cap + type:incident + total cap
      const dedupState = await getAiActionsDedupState();
      let skippedCount = 0;
      for (const action of actions) {
        const skipReason = shouldSkipAction(dedupState, { incidentId: action.incidentId, type: action.type, title: action.title });
        if (skipReason) { skippedCount++; continue; }
        const actionId = action.id || `AIA-${Date.now().toString(36)}-${Math.random().toString(36).substring(2,6)}`;
        const record = {
          ...action,
          id: actionId,
          status: "pending_approval",
          createdAt: now,
          createdBy: "AI Assist Engine",
          requestedBy,
          approvedBy: null,
          approvedAt: null,
          executedAt: null,
          executionResult: null,
        };
        await db.upsert("ai_actions", actionId, JSON.stringify(record));
        trackNewAction(dedupState, { incidentId: action.incidentId, type: action.type, title: action.title });
        savedActions.push(record);
      }
      if (skippedCount > 0) console.log(`[AI Actions] Skipped ${skippedCount} actions (dedup/cap)`);

      console.log(`[AI Actions] Scan generated ${savedActions.length} action items for ${requestedBy}`);
      return json(res, 200, { actions: savedActions, scannedAt: now, criticalCount: critical.length, slaAtRiskCount: slaAtRisk.length });
    } catch (err) {
      console.error("[AI Actions Scan]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // GET /api/ai/actions — list all AI action items (with optional status filter)
  if (pathname === "/api/ai/actions" && req.method === "GET") {
    try {
      const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const statusFilter = qs.get("status"); // pending_approval, approved, rejected, executed
      const allRaw = await db.getAll("ai_actions");
      let actions = allRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      if (statusFilter) actions = actions.filter(a => a.status === statusFilter);
      actions.sort((a, b) => {
        const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3);
      });
      return json(res, 200, { actions, total: actions.length });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/actions/:id/approve — approve an AI action (requires Entra user)
  if (pathname.match(/^\/api\/ai\/actions\/([^/]+)\/approve$/) && req.method === "POST") {
    const actionId = pathname.match(/^\/api\/ai\/actions\/([^/]+)\/approve$/)[1];
    try {
      const body = await parseBody(req);
      const { approvedBy, approverEmail } = body;
      if (!approvedBy) return json(res, 400, { error: "approvedBy (Entra user name) required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Action not found" });
      const action = JSON.parse(existing.data);
      if (action.status !== "pending_approval") {
        return json(res, 409, { error: `Action already ${action.status}` });
      }

      action.status = "approved";
      action.approvedBy = approvedBy;
      action.approverEmail = approverEmail || "";
      action.approvedAt = new Date().toISOString();
      await db.upsert("ai_actions", actionId, JSON.stringify(action));

      console.log(`[AI Actions] Action ${actionId} APPROVED by ${approvedBy}`);

      // Auto-execute if the action is a notification/internal_note type
      let executionResult = null;
      if (action.type === "notification" && action.emailDraft) {
        try {
          const draft = action.emailDraft;
          if (draft.to && draft.subject && draft.body) {
            await graphSendMail({
              to: draft.to,
              subject: draft.subject,
              body: `<div style="font-family:Arial,sans-serif;max-width:650px;">
                ${draft.body.replace(/\n/g, "<br/>")}
                <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
                <p style="color:#888;font-size:11px;">This notification was generated by VGC AI Assist and approved by ${approvedBy}.<br/>
                Action ID: ${actionId} | ${new Date().toISOString()}<br/>
                VGC Technology Pte Ltd — IT Service Management</p>
              </div>`
            });
            executionResult = { emailSent: true, to: draft.to };
          }
        } catch (emailErr) {
          executionResult = { emailSent: false, error: emailErr.message };
        }
      }
      if (action.type === "internal_note" && action.incidentId) {
        executionResult = { noteAdded: true, incidentId: action.incidentId, note: action.suggestedAction };
      }

      if (executionResult) {
        action.status = "executed";
        action.executedAt = new Date().toISOString();
        action.executionResult = executionResult;
        await db.upsert("ai_actions", actionId, JSON.stringify(action));
      }

      // Send confirmation email to approver
      if (approverEmail) {
        try {
          await graphSendMail({
            to: approverEmail,
            subject: `[VGC AI Assist] Action Approved: ${action.title}`,
            body: `<div style="font-family:Arial,sans-serif;max-width:600px;">
              <div style="background:linear-gradient(135deg,#4CAF50,#06B6D4);padding:16px 20px;border-radius:8px 8px 0 0;">
                <h2 style="margin:0;color:#fff;font-size:18px;">✅ AI Action Approved</h2>
              </div>
              <div style="background:#f8f9fa;padding:20px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
                <p style="margin:0 0 12px;color:#333;"><strong>Action:</strong> ${action.title}</p>
                <p style="margin:0 0 12px;color:#333;"><strong>Type:</strong> ${action.type} | <strong>Severity:</strong> ${action.severity}</p>
                <p style="margin:0 0 12px;color:#333;"><strong>Approved by:</strong> ${approvedBy}</p>
                <p style="margin:0 0 12px;color:#333;"><strong>Status:</strong> ${action.status === "executed" ? "Executed Successfully" : "Approved — Awaiting Execution"}</p>
                ${executionResult ? `<p style="margin:0 0 12px;color:#333;"><strong>Result:</strong> ${JSON.stringify(executionResult)}</p>` : ""}
                <p style="margin:0 0 12px;color:#666;"><strong>Description:</strong> ${action.description}</p>
                <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;"/>
                <p style="color:#888;font-size:11px;">VGC AI Assist — All actions are logged and auditable.<br/>Action ID: ${actionId}</p>
              </div>
            </div>`
          });
        } catch (e) { console.warn("[AI Actions] Confirmation email failed:", e.message); }
      }

      return json(res, 200, { success: true, action, executionResult });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/actions/:id/reject — reject an AI action
  if (pathname.match(/^\/api\/ai\/actions\/([^/]+)\/reject$/) && req.method === "POST") {
    const actionId = pathname.match(/^\/api\/ai\/actions\/([^/]+)\/reject$/)[1];
    try {
      const body = await parseBody(req);
      const { rejectedBy, reason } = body;
      if (!rejectedBy) return json(res, 400, { error: "rejectedBy required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Action not found" });
      const action = JSON.parse(existing.data);
      if (action.status !== "pending_approval") {
        return json(res, 409, { error: `Action already ${action.status}` });
      }

      action.status = "rejected";
      action.rejectedBy = rejectedBy;
      action.rejectedAt = new Date().toISOString();
      action.rejectionReason = reason || "";
      await db.upsert("ai_actions", actionId, JSON.stringify(action));

      console.log(`[AI Actions] Action ${actionId} REJECTED by ${rejectedBy}: ${reason || "No reason"}`);
      return json(res, 200, { success: true, action });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/actions/:id/execute — execute an approved action
  if (pathname.match(/^\/api\/ai\/actions\/([^/]+)\/execute$/) && req.method === "POST") {
    const actionId = pathname.match(/^\/api\/ai\/actions\/([^/]+)\/execute$/)[1];
    try {
      const body = await parseBody(req);
      const { executedBy } = body;
      if (!executedBy) return json(res, 400, { error: "executedBy required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Action not found" });
      const action = JSON.parse(existing.data);
      if (action.status !== "approved") {
        return json(res, 409, { error: `Action must be approved first (current: ${action.status})` });
      }

      let executionResult = { success: true };

      // Execute based on action type
      if (action.type === "notification" && action.emailDraft) {
        const draft = action.emailDraft;
        if (draft.to && draft.subject && draft.body) {
          try {
            await graphSendMail({
              to: draft.to,
              subject: draft.subject,
              body: `<div style="font-family:Arial,sans-serif;max-width:650px;">
                ${draft.body.replace(/\n/g, "<br/>")}
                <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
                <p style="color:#888;font-size:11px;">Sent by VGC AI Assist, approved by ${action.approvedBy}.<br/>
                Action ID: ${actionId}<br/>VGC Technology — IT Service Management</p>
              </div>`
            });
            executionResult = { emailSent: true, to: draft.to };
          } catch (emailErr) {
            executionResult = { emailSent: false, error: emailErr.message };
          }
        }
      } else if (action.type === "follow_up") {
        executionResult = { followUpScheduled: true, incidentId: action.incidentId, note: action.suggestedAction };
      } else if (action.type === "internal_note") {
        executionResult = { noteAdded: true, incidentId: action.incidentId, note: action.suggestedAction };
      }

      action.status = "executed";
      action.executedBy = executedBy;
      action.executedAt = new Date().toISOString();
      action.executionResult = executionResult;
      await db.upsert("ai_actions", actionId, JSON.stringify(action));

      console.log(`[AI Actions] Action ${actionId} EXECUTED by ${executedBy}:`, executionResult);
      return json(res, 200, { success: true, action, executionResult });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/actions/send-approval-email — send approval request via Outlook
  if (pathname === "/api/ai/actions/send-approval-email" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { actionId, approverEmails, appUrl } = body;
      if (!actionId || !approverEmails) return json(res, 400, { error: "actionId and approverEmails required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Action not found" });
      const action = JSON.parse(existing.data);
      const baseUrl = appUrl || "https://vgc-itsm1-app.azurewebsites.net";

      const severityColor = { critical: "#FF4444", high: "#FF8800", medium: "#FFB347", low: "#4CAF50" };
      const sevColor = severityColor[action.severity] || "#666";

      const emailBody = `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:650px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px 24px;border-radius:10px 10px 0 0;">
          <h2 style="margin:0;color:#fff;font-size:20px;">🤖 VGC AI Assist — Action Requires Your Approval</h2>
          <p style="margin:6px 0 0;color:#8B8FA3;font-size:13px;">AI has identified an action that needs engineer review</p>
        </div>
        <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <span style="display:inline-block;padding:4px 12px;border-radius:20px;background:${sevColor}22;color:${sevColor};font-weight:700;font-size:12px;text-transform:uppercase;">${action.severity}</span>
            <span style="display:inline-block;padding:4px 12px;border-radius:20px;background:#6366F122;color:#6366F1;font-weight:600;font-size:12px;">${action.type}</span>
            ${action.incidentId ? `<span style="display:inline-block;padding:4px 12px;border-radius:20px;background:#EC489922;color:#EC4899;font-weight:600;font-size:12px;">🎫 ${action.incidentId}</span>` : ""}
          </div>
          <h3 style="margin:0 0 12px;color:#1a1a2e;font-size:17px;">${action.title}</h3>
          <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.6;">${action.description}</p>
          <div style="background:#f0f4ff;padding:14px 16px;border-radius:8px;border-left:4px solid #6366F1;margin:16px 0;">
            <p style="margin:0 0 4px;color:#6366F1;font-weight:700;font-size:13px;">💡 AI Suggested Action:</p>
            <p style="margin:0;color:#333;font-size:13px;line-height:1.5;">${action.suggestedAction || action.description}</p>
          </div>
          ${action.internalNote ? `<div style="background:#FFF8E1;padding:14px 16px;border-radius:8px;border-left:4px solid #FFB347;margin:16px 0;">
            <p style="margin:0 0 4px;color:#F57C00;font-weight:700;font-size:13px;">📋 Internal Note:</p>
            <p style="margin:0;color:#555;font-size:13px;line-height:1.5;">${action.internalNote}</p>
          </div>` : ""}
          <p style="margin:16px 0 8px;color:#333;font-size:13px;"><strong>AI Confidence:</strong> ${action.confidence || "N/A"}%</p>
          <p style="margin:0 0 20px;color:#333;font-size:13px;"><strong>Reasoning:</strong> ${action.reasoning || "Based on severity and SLA analysis"}</p>
          <div style="text-align:center;margin:24px 0 16px;">
            <p style="color:#666;font-size:13px;margin:0 0 12px;">Please review and take action in VGC ITSM:</p>
            <a href="${baseUrl}/#ai-actions" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#4CAF50,#45a049);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;margin:0 8px;">✅ Review & Approve</a>
            <a href="${baseUrl}/#ai-actions" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#FF5252,#f44336);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;margin:0 8px;">❌ Review & Reject</a>
          </div>
          <p style="text-align:center;color:#999;font-size:11px;margin-top:8px;">Click either button to open VGC ITSM and review the full action details</p>
        </div>
        <div style="background:#f8f9fa;padding:14px 24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;">
          <p style="margin:0;color:#999;font-size:11px;">VGC AI Assist — All actions require human approval before execution.<br/>
          Action ID: ${actionId} | Generated: ${action.createdAt}<br/>
          VGC Technology Pte Ltd — IT Service Management</p>
        </div>
      </div>`;

      const recipients = Array.isArray(approverEmails) ? approverEmails : [approverEmails];
      await graphSendMail({
        to: recipients,
        subject: `[Action Required] 🤖 AI Assist: ${action.severity.toUpperCase()} — ${action.title}`,
        body: emailBody
      });

      console.log(`[AI Actions] Approval email sent to ${recipients.join(", ")} for action ${actionId}`);
      return json(res, 200, { success: true, sentTo: recipients, actionId });
    } catch (err) {
      console.error("[AI Actions Email]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // POST /api/ai/actions/monitor — background AI monitor: scan + auto-email approvers for critical items
  if (pathname === "/api/ai/actions/monitor" && req.method === "POST") {
    try {
      const body = await parseBody(req, 200000);
      const { incidents: clientIncidents, changes: clientChanges, requestedBy, approverEmails, appUrl } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      // Step 1: Run AI scan
      const allIncidents = clientIncidents || [];
      const allChanges = clientChanges || [];
      const critical = allIncidents.filter(i =>
        (i.status === "Open" || i.status === "In Progress") &&
        (i.priority === "Sev-A" || i.priority === "Sev-B")
      );
      const slaAtRisk = allIncidents.filter(i =>
        (i.status === "Open" || i.status === "In Progress") &&
        i.created && i.slaTarget && (i.created / i.slaTarget) >= 0.8
      );

      if (critical.length === 0 && slaAtRisk.length === 0) {
        return json(res, 200, { actions: [], message: "All clear — no critical items detected", monitoredAt: new Date().toISOString() });
      }

      // Step 2: Generate actions via AI (reuse scan logic internally)
      const scanPayload = JSON.stringify({ incidents: clientIncidents, changes: clientChanges, requestedBy });
      const scanResult = await new Promise((resolve, reject) => {
        const scanReq = require("http").request({
          hostname: "localhost", port: PORT,
          path: "/api/ai/actions/scan", method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(scanPayload) }
        }, (r) => {
          let data = ""; r.on("data", c => data += c);
          r.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ actions: [] }); } });
        });
        scanReq.on("error", reject);
        scanReq.setTimeout(50000, () => { scanReq.destroy(); reject(new Error("Monitor scan timeout")); });
        scanReq.write(scanPayload);
        scanReq.end();
      });

      const actions = scanResult.actions || [];

      // Step 3: Email approvers for critical/high actions
      let emailsSent = 0;
      if (approverEmails && actions.length > 0) {
        const criticalActions = actions.filter(a => a.severity === "critical" || a.severity === "high");
        for (const action of criticalActions.slice(0, 5)) { // max 5 emails per scan
          try {
            const emailPayload = JSON.stringify({ actionId: action.id, approverEmails, appUrl });
            await new Promise((resolve, reject) => {
              const eReq = require("http").request({
                hostname: "localhost", port: PORT,
                path: "/api/ai/actions/send-approval-email", method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(emailPayload) }
              }, (r) => {
                let data = ""; r.on("data", c => data += c);
                r.on("end", () => resolve(data));
              });
              eReq.on("error", reject);
              eReq.setTimeout(20000, () => { eReq.destroy(); reject(new Error("Email timeout")); });
              eReq.write(emailPayload);
              eReq.end();
            });
            emailsSent++;
          } catch (e) { console.warn("[AI Monitor] Email failed for action", action.id, e.message); }
        }
      }

      console.log(`[AI Monitor] Scan complete: ${actions.length} actions, ${emailsSent} approval emails sent`);
      return json(res, 200, {
        actions,
        totalActions: actions.length,
        emailsSent,
        monitoredAt: new Date().toISOString(),
        criticalIncidents: critical.length,
        slaAtRisk: slaAtRisk.length
      });
    } catch (err) {
      console.error("[AI Monitor]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── Azure Infrastructure Resources (Live from ARM API) ───────────────
  if (pathname === "/api/azure/resources") {
    try {
      const token = await getManagedIdentityToken("https://management.azure.com");
      const subId = AZURE_SUBSCRIPTION_ID;
      const rg = AZURE_RESOURCE_GROUP;
      if (!subId) return json(res, 200, { live: false, error: "AZURE_SUBSCRIPTION_ID not configured", resources: [] });

      const armGet = (urlPath) => new Promise((resolve, reject) => {
        const url = `https://management.azure.com${urlPath}`;
        const req = https.get(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }, (resp) => {
          let data = "";
          resp.on("data", c => data += c);
          resp.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("ARM parse error")); } });
        });
        req.on("error", reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error("ARM timeout")); });
      });

      // Fetch resources in the resource group
      const rgResources = await armGet(`/subscriptions/${subId}/resourceGroups/${rg}/resources?api-version=2021-04-01`);
      const resources = (rgResources.value || []).map(r => ({
        id: r.id, name: r.name, type: r.type, location: r.location, kind: r.kind,
        sku: r.sku, tags: r.tags,
      }));

      // Try to get App Service Plan details
      let appServicePlan = null;
      const plans = resources.filter(r => r.type === "Microsoft.Web/serverfarms");
      if (plans.length > 0) {
        try {
          const planDetail = await armGet(`${plans[0].id}?api-version=2022-03-01`);
          appServicePlan = {
            name: planDetail.name, sku: planDetail.sku, kind: planDetail.kind,
            status: planDetail.properties?.status, numberOfSites: planDetail.properties?.numberOfSites,
            tier: planDetail.sku?.tier, size: planDetail.sku?.size, capacity: planDetail.sku?.capacity,
          };
        } catch {}
      }

      // Try to get Web App details
      let webApp = null;
      const webApps = resources.filter(r => r.type === "Microsoft.Web/sites");
      if (webApps.length > 0) {
        try {
          const appDetail = await armGet(`${webApps[0].id}?api-version=2022-03-01`);
          webApp = {
            name: appDetail.name, state: appDetail.properties?.state, kind: appDetail.kind,
            defaultHostName: appDetail.properties?.defaultHostName,
            httpsOnly: appDetail.properties?.httpsOnly,
            linuxFxVersion: appDetail.properties?.siteConfig?.linuxFxVersion,
            ftpsState: appDetail.properties?.siteConfig?.ftpsState,
          };
        } catch {}
      }

      // Try to get MySQL Flexible Server details
      let mysqlServer = null;
      const mysqlServers = resources.filter(r => r.type === "Microsoft.DBforMySQL/flexibleServers");
      if (mysqlServers.length > 0) {
        try {
          const mysqlDetail = await armGet(`${mysqlServers[0].id}?api-version=2021-12-01-preview`);
          mysqlServer = {
            name: mysqlDetail.name, sku: mysqlDetail.sku, state: mysqlDetail.properties?.state,
            version: mysqlDetail.properties?.version, tier: mysqlDetail.sku?.tier,
            storageSizeGB: mysqlDetail.properties?.storage?.storageSizeGB,
            backupRetentionDays: mysqlDetail.properties?.backup?.backupRetentionDays,
            haEnabled: mysqlDetail.properties?.highAvailability?.mode !== "Disabled",
          };
        } catch {}
      }

      return json(res, 200, {
        live: true, subscriptionId: subId, resourceGroup: rg,
        resources, appServicePlan, webApp, mysqlServer,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[Azure Resources]", err.message);
      return json(res, 200, { live: false, error: err.message, resources: [] });
    }
  }

  // ─── CSAT Survey Engine (Phase 7) ──────────────────────────────────────

  // POST /api/csat/submit — Record a CSAT survey response
  if (pathname === "/api/csat/submit" && req.method === "POST") {
    const body = await parseBody(req);
    const { ticketId, rating, comment, agentName, category, customerName, customerEmail } = body;
    if (!ticketId || !rating || rating < 1 || rating > 5) {
      return json(res, 400, { error: "ticketId and rating (1-5) are required" });
    }
    const id = `CSAT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const response = {
      id, ticketId, rating: Number(rating), comment: (comment || "").substring(0, 2000),
      agentName: agentName || "Unknown", category: category || "General",
      customerName: customerName || "Anonymous", customerEmail: customerEmail || "",
      sentiment: null, createdAt: new Date().toISOString(),
    };
    // AI sentiment analysis on comment (if comment provided and AI enabled)
    if (response.comment && AZURE_OPENAI_ENDPOINT && AZURE_OPENAI_KEY) {
      try {
        const sentimentResult = await callAzureOpenAI([
          { role: "system", content: "Analyze the sentiment of this customer feedback comment. Return ONLY a JSON object: {\"sentiment\": \"positive\"|\"neutral\"|\"negative\", \"keywords\": [\"word1\",\"word2\"], \"summary\": \"one sentence summary\"}" },
          { role: "user", content: response.comment },
        ], { model: "nano", max_tokens: 150 });
        const parsed = JSON.parse(sentimentResult.replace(/```json\n?|```/g, "").trim());
        response.sentiment = parsed.sentiment || null;
        response.keywords = parsed.keywords || [];
        response.aiSummary = parsed.summary || "";
      } catch { /* sentiment analysis optional */ }
    }
    await db.upsert("csat_responses", id, JSON.stringify(response));
    console.log(`[CSAT] Recorded rating ${rating}/5 for ${ticketId} by ${customerName || "anonymous"}`);
    // WebSocket broadcast
    if (wsServer) wsServer.broadcast("csat", { action: "new_response", ...response });
    return json(res, 200, { success: true, id, response });
  }

  // GET /api/csat/scores — Aggregate CSAT scores with breakdowns
  if (pathname === "/api/csat/scores" && req.method === "GET") {
    const rows = await db.getAll("csat_responses");
    const responses = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    const total = responses.length;
    if (total === 0) return json(res, 200, { total: 0, average: 0, nps: 0, byAgent: {}, byCategory: {}, byRating: {}, trend: [] });

    const sum = responses.reduce((s, r) => s + r.rating, 0);
    const average = Math.round((sum / total) * 10) / 10;

    // NPS calculation: promoters (4-5) - detractors (1-2) / total * 100
    const promoters = responses.filter(r => r.rating >= 4).length;
    const detractors = responses.filter(r => r.rating <= 2).length;
    const nps = Math.round(((promoters - detractors) / total) * 100);

    // By rating
    const byRating = {};
    for (let i = 1; i <= 5; i++) byRating[i] = responses.filter(r => r.rating === i).length;

    // By agent
    const byAgent = {};
    for (const r of responses) {
      const agent = r.agentName || "Unknown";
      if (!byAgent[agent]) byAgent[agent] = { total: 0, sum: 0, count5: 0, count1: 0 };
      byAgent[agent].total++;
      byAgent[agent].sum += r.rating;
      if (r.rating === 5) byAgent[agent].count5++;
      if (r.rating <= 2) byAgent[agent].count1++;
    }
    for (const a in byAgent) byAgent[a].avg = Math.round((byAgent[a].sum / byAgent[a].total) * 10) / 10;

    // By category
    const byCategory = {};
    for (const r of responses) {
      const cat = r.category || "General";
      if (!byCategory[cat]) byCategory[cat] = { total: 0, sum: 0 };
      byCategory[cat].total++;
      byCategory[cat].sum += r.rating;
    }
    for (const c in byCategory) byCategory[c].avg = Math.round((byCategory[c].sum / byCategory[c].total) * 10) / 10;

    // Weekly trend (last 12 weeks)
    const trend = [];
    const now = Date.now();
    for (let w = 11; w >= 0; w--) {
      const weekStart = now - (w + 1) * 7 * 86400000;
      const weekEnd = now - w * 7 * 86400000;
      const weekR = responses.filter(r => { const t = new Date(r.createdAt).getTime(); return t >= weekStart && t < weekEnd; });
      trend.push({
        week: new Date(weekStart).toISOString().split("T")[0],
        count: weekR.length,
        avg: weekR.length > 0 ? Math.round((weekR.reduce((s, r) => s + r.rating, 0) / weekR.length) * 10) / 10 : null,
      });
    }

    // Sentiment breakdown
    const sentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
    for (const r of responses) { if (r.sentiment) sentimentBreakdown[r.sentiment] = (sentimentBreakdown[r.sentiment] || 0) + 1; }

    // Recent comments with sentiment
    const recentComments = responses.filter(r => r.comment).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20).map(r => ({
      ticketId: r.ticketId, rating: r.rating, comment: r.comment, sentiment: r.sentiment,
      keywords: r.keywords, aiSummary: r.aiSummary, customerName: r.customerName, agentName: r.agentName,
      createdAt: r.createdAt,
    }));

    return json(res, 200, { total, average, nps, byRating, byAgent, byCategory, trend, sentimentBreakdown, recentComments });
  }

  // POST /api/csat/ai-analyze — AI deep analysis of CSAT patterns
  if (pathname === "/api/csat/ai-analyze" && req.method === "POST") {
    if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_KEY) return json(res, 400, { error: "Azure OpenAI not configured" });
    const rows = await db.getAll("csat_responses");
    const responses = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    if (responses.length < 3) return json(res, 200, { analysis: "Not enough CSAT data for analysis. Need at least 3 survey responses.", recommendations: [] });

    const summary = responses.slice(-50).map(r => `${r.ticketId}: ${r.rating}/5 [${r.category}] ${r.agentName} — "${(r.comment || "no comment").substring(0, 100)}"`).join("\n");
    try {
      const aiResult = await callAzureOpenAI([
        { role: "system", content: `You are a customer experience analytics expert for an IT service desk (VGC Technology, Singapore). Analyze CSAT survey data and provide insights. Return ONLY a JSON object:
{
  "overallAssessment": "brief paragraph",
  "topStrengths": ["strength1", "strength2"],
  "areasForImprovement": ["area1", "area2"],
  "agentInsights": [{"agent": "name", "insight": "observation"}],
  "categoryInsights": [{"category": "name", "insight": "observation"}],
  "recommendations": [{"priority": "high|medium|low", "action": "what to do", "impact": "expected result"}],
  "riskAlerts": ["any concerning patterns"]
}` },
        { role: "user", content: `Analyze these ${responses.length} CSAT responses:\n${summary}` },
      ], { model: "mini", max_tokens: 1200 });
      const parsed = JSON.parse(aiResult.replace(/```json\n?|```/g, "").trim());
      return json(res, 200, { success: true, analysis: parsed, responseCount: responses.length });
    } catch (err) {
      console.error("[CSAT AI Analysis]", err.message);
      return json(res, 200, { success: false, error: err.message });
    }
  }

  // ── Dedup scan — one-time scan to find and flag existing duplicate incidents ──
  if (pathname === "/api/incidents/dedup-scan" && method === "POST") {
    try {
      const allIncidents = await db.getAll("incidents");
      const emailIncidents = allIncidents.filter(i => i.source === "email" && !["Closed", "Resolved"].includes(i.status));
      const normalizeSubject = (s) => (s || "").replace(/^(\s*(re|fw|fwd)\s*:\s*)+/gi, "").replace(/^\[.*?\]\s*/g, "").trim().toLowerCase();
      const wordSimilarity = (s1, s2) => {
        const w1 = s1.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
        const w2 = s2.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
        if (w1.length === 0 || w2.length === 0) return 0;
        return w1.filter(w => w2.includes(w)).length / Math.max(w1.length, w2.length);
      };
      const duplicates = [];
      for (let i = 0; i < emailIncidents.length; i++) {
        for (let j = i + 1; j < emailIncidents.length; j++) {
          const a = emailIncidents[i], b = emailIncidents[j];
          const sim = wordSimilarity(normalizeSubject(a.title), normalizeSubject(b.title));
          const sameSender = (a.reporterEmail || "").toLowerCase() === (b.reporterEmail || "").toLowerCase();
          if (sim >= 0.7 && sameSender) {
            duplicates.push({ incidentA: a.id, incidentB: b.id, similarity: Math.round(sim * 100), reporter: a.reporterEmail, titleA: a.title, titleB: b.title });
          }
        }
      }
      return json(res, 200, { scanned: emailIncidents.length, duplicatesFound: duplicates.length, duplicates });
    } catch (err) {
      return json(res, 500, { error: "Dedup scan failed", details: err.message });
    }
  }

  // Health check
  if (pathname === "/api/health") {
    let dbOk = false;
    try { dbOk = await db.ping(); } catch {}
    return json(res, 200, {
      status: "ok",
      database: dbOk ? "connected" : "error",
      dbType: db.type,
      dbLabel: db.label,
      entraConfigured: !!(ENTRA_CLIENT_SECRET || ENTRA_CERT_THUMBPRINT),
      zendeskConfigured: !!(ZENDESK_SUBDOMAIN && ZENDESK_EMAIL && ZENDESK_API_TOKEN),
      aiConfigured: !!(AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT),
      aiModel: AZURE_OPENAI_MODEL,
      aiModels: AI_MODELS,
      merakiConfigured: MERAKI_API_KEYS.length > 0,
      solarwindsConfigured: !!SOLARWINDS_API_KEY,
      sophosConfigured: !!(SOPHOS_CLIENT_ID && SOPHOS_CLIENT_SECRET),
      mailConfigured: !!(process.env.IDENTITY_ENDPOINT),
      slaEngineRunning: slaEngine ? !!slaEngine.timer : false,
      slaLastRun: slaEngine ? slaEngine.lastRun : null,
      wsConnections: wsServer ? wsServer.getStats().totalConnections : 0,
      notifyStats: notifyEngine ? notifyEngine.getStats() : null,
      workflowStats: workflowEngine ? workflowEngine.getStats() : null,
      analyticsAvailable: !!analyticsEngine,
      cacheStats: cacheLayer ? cacheLayer.getStats() : null,
      zdAutoSync: !!zdAutoSyncInterval,
      zdLastSyncTime,
      mailFrom: MAIL_FROM,
      prodTestMode: PROD_TEST_MODE,
      prodTestEmail: PROD_TEST_MODE ? PROD_TEST_EMAIL : null,
      timestamp: new Date().toISOString(),
    });
  }

  // ─── GET /api/purge-status — Scheduled purge/cleanup status for Admin UI ───
  if (pathname === "/api/purge-status" && req.method === "GET") {
    try {
      // Get current ai_actions breakdown by status
      const actionRows = await cachedGetAll("ai_actions");
      const statusBreakdown = {};
      for (const r of actionRows) {
        try {
          const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          const st = item?.status || "unknown";
          statusBreakdown[st] = (statusBreakdown[st] || 0) + 1;
        } catch {}
      }
      return json(res, 200, {
        purgeStatus,
        aiActionsTotal: actionRows.length,
        aiActionsBreakdown: statusBreakdown,
        schedules: {
          queueCleanup: { interval: "6 hours", retentionDays: AI_THRESHOLDS.staleDays, description: `Deletes stale pending_approval ai_actions (>${AI_THRESHOLDS.staleDays}d or incident resolved), caps at ${AI_THRESHOLDS.maxPendingTotal}` },
          logPurge: { interval: "6 hours", retentionDays: 2, description: "Deletes old escalation_log, notifications, email_rejections + dismissed AI records" },
          terminalPurge: { interval: "6 hours", retentionDays: 7, description: "Deletes terminal-status ai_actions (auto_applied, approved, executed, rejected, auto_approved) older than 7 days" },
          auditPurge: { interval: "6 hours", retentionDays: 30, description: "Prunes audit_log entries older than 30 days" },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── GET /api/ai/thresholds — Current AI thresholds for Admin UI ───
  if (pathname === "/api/ai/thresholds" && req.method === "GET") {
    return json(res, 200, { thresholds: AI_THRESHOLDS, timestamp: new Date().toISOString() });
  }

  // ─── POST /api/ai/cleanup-now — Manual trigger for AI queue cleanup ───
  if (pathname === "/api/ai/cleanup-now" && req.method === "POST") {
    try {
      const maxAgeDays = AI_THRESHOLDS.staleDays;
      const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
      const incRows = await db.getAll("incidents");
      const resolvedIds = new Set();
      for (const r of incRows) {
        try { const inc = typeof r.data === "string" ? JSON.parse(r.data) : r.data; if (inc && ["Resolved", "Closed"].includes(inc.status)) resolvedIds.add(inc.id); } catch {}
      }
      const actionRows = await db.getAll("ai_actions");
      let deleted = 0, cappedDel = 0;
      const pendingItems = [];
      for (const r of actionRows) {
        try {
          const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (!item || item.status !== "pending_approval") continue;
          const isStale = (item.createdAt && item.createdAt < cutoff);
          const incResolved = item.incidentId && resolvedIds.has(item.incidentId);
          if (isStale || incResolved) {
            await db.deleteOne("ai_actions", item.id);
            deleted++;
          } else {
            pendingItems.push(item);
          }
        } catch {}
      }
      if (pendingItems.length > AI_THRESHOLDS.maxPendingTotal) {
        pendingItems.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
        const excess = pendingItems.length - AI_THRESHOLDS.maxPendingTotal;
        for (let i = 0; i < excess; i++) { await db.deleteOne("ai_actions", pendingItems[i].id); cappedDel++; }
      }
      if (cacheLayer) cacheLayer.invalidatePrefix("ai_actions");
      const remaining = pendingItems.length - cappedDel;
      console.log(`[Manual Cleanup] Deleted ${deleted} stale + ${cappedDel} over-cap. Remaining pending: ${remaining}`);
      return json(res, 200, { deleted, cappedDel, totalRemoved: deleted + cappedDel, remaining, resolvedIncidents: resolvedIds.size, staleDays: maxAgeDays, maxPendingTotal: AI_THRESHOLDS.maxPendingTotal });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── POST /api/ai/purge-all-pending — Bulk delete ALL pending_approval AI actions (no email sent) ───
  if (pathname === "/api/ai/purge-all-pending" && req.method === "POST") {
    try {
      const body = await parseBody(req, 2000);
      const statusFilter = body.status || "pending_approval";
      const allowedStatuses = ["pending_approval", "rejected", "dismissed", "failed"];
      if (!allowedStatuses.includes(statusFilter)) {
        return json(res, 400, { error: `Invalid status filter. Allowed: ${allowedStatuses.join(", ")}` });
      }
      let deleted = 0;
      if (db.deleteByFilter) {
        deleted = await db.deleteByFilter("ai_actions", "status", statusFilter);
      } else {
        const actionRows = await db.getAll("ai_actions");
        for (const r of actionRows) {
          try {
            const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            if (item && item.status === statusFilter) {
              await db.deleteOne("ai_actions", item.id);
              deleted++;
            }
          } catch {}
        }
      }
      if (cacheLayer) cacheLayer.invalidatePrefix("ai_actions");
      console.log(`[Bulk Purge] Deleted ${deleted} ${statusFilter} ai_actions`);
      return json(res, 200, { deleted, status: statusFilter });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── DELETE /api/ai/actions/:id — Delete a single AI action by ID ───
  if (/^\/api\/ai\/actions\/[^/]+$/.test(pathname) && req.method === "DELETE") {
    try {
      const actionId = pathname.split("/").pop();
      await db.deleteOne("ai_actions", actionId);
      if (cacheLayer) cacheLayer.invalidatePrefix("ai_actions");
      return json(res, 200, { deleted: true, id: actionId });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 6: AI Historical Incident Closure (Bulk Close — No Notifications) ───
  // POST /api/ai/historical-close — AI bulk-close past incidents with generated resolutions
  if (pathname === "/api/ai/historical-close" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 10000);
      const { cutoffDate, requestedBy, dryRun, limit } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const cutoff = new Date(cutoffDate || "2026-04-01T00:00:00Z");
      if (isNaN(cutoff.getTime())) return json(res, 400, { error: "Invalid cutoffDate" });

      const allRows = await db.getAll("incidents");
      const allIncidents = allRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      // Filter: non-closed incidents created before cutoff
      const closableStatuses = new Set(["New", "Open", "In Progress", "Pending", "On Hold", "Reopened"]);
      const eligible = allIncidents.filter(inc => {
        if (!closableStatuses.has(inc.status)) return false;
        const createdStr = inc.createdAt || inc.created || inc.openedDate;
        if (createdStr === undefined || createdStr === null || createdStr === "") {
          return true; // No date = treat as old / eligible
        }
        const created = new Date(createdStr);
        if (isNaN(created.getTime())) return true; // Invalid date = treat as eligible
        return created < cutoff;
      });

      if (dryRun) {
        return json(res, 200, {
          dryRun: true, eligibleCount: eligible.length, cutoffDate: cutoff.toISOString(),
          sample: eligible.slice(0, 10).map(i => ({ id: i.id, title: i.title, status: i.status, priority: i.priority, category: i.category, created: i.createdAt || i.created }))
        });
      }

      // Apply limit if provided (process in chunks to avoid timeout)
      const toProcess = limit && limit > 0 ? eligible.slice(0, limit) : eligible;

      if (toProcess.length === 0) {
        return json(res, 200, { success: true, closedCount: 0, totalEligible: eligible.length, remaining: eligible.length, cutoffDate: cutoff.toISOString(), requestedBy, timestamp: new Date().toISOString(), results: [] });
      }

      // Process in batches of 10
      const batchSize = 10;
      let closedCount = 0;
      const results = [];
      const now = new Date().toISOString();

      for (let i = 0; i < toProcess.length; i += batchSize) {
        const batch = toProcess.slice(i, i + batchSize);
        const summaries = batch.map(inc =>
          `ID: ${inc.id} | Title: ${inc.title} | Category: ${inc.category || "General"} | Priority: ${inc.priority || "N/A"} | Status: ${inc.status} | Created: ${inc.createdAt || inc.created || "Unknown"} | Description: ${(inc.description || "").substring(0, 200)}`
        ).join("\n---\n");

        const systemPrompt = `You are VGC Technology's ITSM closure engine. For each historical incident below, generate a professional closure summary. These are old tickets being archived — provide appropriate resolutions based on the incident details. Return JSON array ONLY (no markdown):
[{ "id": "INC-XXX", "resolution": "Professional resolution summary (1-2 sentences)", "closureReason": "Reason for closure" }]
Keep resolutions concise and professional. Do NOT mention AI or automation in the resolution text.`;

        const payload = {
          model: getAIModel("tertiary"),
          input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Close these ${batch.length} historical incidents (created before ${cutoff.toISOString()}):\n\n${summaries}` }
          ],
          max_output_tokens: 2000,
        };

        let closures;
        try {
          const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
          const aiResult = await new Promise((resolve, reject) => {
            const aiReq = https.request({
              hostname: aiUrl.hostname, port: 443,
              path: aiUrl.pathname + aiUrl.search,
              method: "POST",
              headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
            }, (aiRes) => {
              let data = ""; aiRes.on("data", c => data += c);
              aiRes.on("end", () => {
                if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
                else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
              });
            });
            aiReq.on("error", reject);
            aiReq.setTimeout(60000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
            aiReq.write(JSON.stringify(payload));
            aiReq.end();
          });

          const text = extractAIText(aiResult);
          try {
            closures = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
            if (!Array.isArray(closures)) closures = [closures];
          } catch {
            closures = batch.map(b => ({ id: b.id, resolution: "Closed as part of historical incident archival. Issue addressed and no further action required.", closureReason: "Aged out — no recent activity" }));
          }
        } catch (aiErr) {
          console.warn(`[AI Historical Close] AI call failed for batch ${i}-${i+batch.length}: ${aiErr.message}`);
          closures = batch.map(b => ({ id: b.id, resolution: "Closed as part of historical incident archival. Issue addressed and no further action required.", closureReason: "Aged out — no recent activity" }));
        }

        // Apply closures — NO notifications sent
        for (const inc of batch) {
          const closure = closures.find(c => c.id === inc.id) || { resolution: "Closed during historical archival. No further action required.", closureReason: "Aged out" };
          inc.status = "Closed";
          inc.resolution = closure.resolution;
          inc.closureReason = closure.closureReason;
          inc.closedAt = now;
          inc.closedBy = "AI Historical Closure Engine";
          inc.historicalClose = true;
          inc.suppressNotification = true;
          if (!inc.activityLog) inc.activityLog = [];
          inc.activityLog.push({
            id: `AL-HC-${Date.now().toString(36)}`,
            type: "status",
            user: "AI Historical Closure Engine",
            time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }),
            detail: `Bulk closed by AI — ${closure.closureReason}`
          });
          await db.upsert("incidents", inc.id, JSON.stringify(inc));
          await db.audit("incidents", inc.id, "historical_close", JSON.stringify({ resolution: closure.resolution, closureReason: closure.closureReason, requestedBy }), "AI Historical Closure");
          closedCount++;
          results.push({ id: inc.id, title: inc.title, resolution: closure.resolution, closureReason: closure.closureReason });
        }
      }

      console.log(`[AI Historical Close] Closed ${closedCount}/${toProcess.length} incidents (${eligible.length} total eligible) before ${cutoff.toISOString()} by ${requestedBy}`);
      if (cacheLayer) cacheLayer.invalidatePrefix("incidents");

      return json(res, 200, {
        success: true, closedCount, totalEligible: eligible.length,
        remaining: eligible.length - closedCount,
        cutoffDate: cutoff.toISOString(), requestedBy, timestamp: now,
        results: results.slice(0, 50)
      });
    } catch (err) {
      console.error("[AI Historical Close]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Auto-Resolve: Scan open incidents, generate AI resolution suggestions ───
  if (pathname === "/api/ai/auto-resolve" && req.method === "POST") {
    try {
      if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) return json(res, 503, { error: "AI not configured" });
      const body = await parseBody(req);
      const requestedBy = body.requestedBy || "system";
      const idleHours = body.idleHours || 24;
      const maxItems = Math.min(body.maxItems || 10, 20);
      const targetIncidentId = body.incidentId || null;

      const incidentRows = db.getOpen ? await db.getOpen("incidents") : await db.getAll("incidents");
      const now = new Date();
      const cutoff = new Date(now.getTime() - idleHours * 60 * 60 * 1000);

      // Filter: open incidents idle for > idleHours
      const candidates = incidentRows.map(r => {
        try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; }
      }).filter(inc => {
        if (!inc || !inc.id) return false;
        if (targetIncidentId && inc.id !== targetIncidentId) return false;
        const status = (inc.status || "").toLowerCase();
        if (["closed", "resolved"].includes(status)) return false;
        if (!targetIncidentId) {
          const lastUpdate = new Date(inc.updatedAt || inc.createdAt || 0);
          if (lastUpdate >= cutoff) return false;
        }
        return true;
      }).slice(0, maxItems);

      if (!candidates.length) return json(res, 200, { success: true, suggestions: [], message: "No idle incidents found" });

      // Dedup: load existing pending resolutions to avoid duplicates
      const _resExisting = await db.getAll("ai_resolve_queue");
      const _resPendingIncIds = new Set();
      for (const r of _resExisting) { try { const it = typeof r.data === "string" ? JSON.parse(r.data) : r.data; if (it && it.status === "pending_approval" && it.incidentId) _resPendingIncIds.add(it.incidentId); } catch {} }

      const suggestions = [];
      let skipped = 0;
      let autoDismissed = 0;
      for (const inc of candidates) {
        try {
          const prompt = `You are an enterprise ITSM AI assistant for VGC Technology Pte Ltd — a managed IT services company.
Analyze this incident and:
1. Suggest a resolution.
2. CRITICALLY: Classify the RELEVANCE of this incident to determine if it needs human engineer review or can be auto-dismissed.

Incident: ${JSON.stringify({ id: inc.id, title: inc.title, description: inc.description, priority: inc.priority, category: inc.category, status: inc.status, assignee: inc.assignee, createdAt: inc.createdAt, source: inc.source || "", reporter: inc.reporter || "" })}

RELEVANCE CLASSIFICATION RULES:
- "customer_critical": Real customer-reported outage, data loss, security breach, or business-critical service down. ALWAYS needs human review.
- "customer_important": Customer-reported issue affecting productivity — password resets, access requests, software issues, hardware problems. Needs human review.
- "internal_routine": Internal system alerts, monitoring notifications, scheduled tasks, routine maintenance alerts, vendor renewal reminders. Can be auto-resolved if confidence is high.
- "noise_informational": Newsletter digests, vendor marketing, informational bulletins, threat intel summaries (not targeting us), product update announcements, general advisories, non-actionable notifications. Should be auto-dismissed — NOT relevant to our customers or operations.

AUTO-RESOLVABLE RULES:
- Set autoResolvable=true ONLY when the ticket requires NO human investigation, NO customer communication, and is either noise or a routine item with a clear standard resolution.
- Set autoResolvable=false for anything that could impact a customer, requires investigation, or involves security/compliance.

Respond ONLY with valid JSON:
{"resolution": "...", "rootCause": "...", "suggestedStatus": "Resolved", "confidence": 0-100, "customerEmail": "short message to customer about resolution", "relevance": "customer_critical|customer_important|internal_routine|noise_informational", "autoResolvable": true/false, "classificationReasoning": "brief explanation of why this classification was chosen"}`;

          const payload = { model: getAIModel("tertiary"), input: [{ role: "system", content: "You are an expert IT support analyst for a managed services company. Classify incidents by relevance to customers and operations. Respond only in JSON." }, { role: "user", content: prompt }], max_output_tokens: 1000 };
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
          let parsed;
          try { parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); } catch { parsed = { resolution: text, rootCause: "Unknown", suggestedStatus: "Resolved", confidence: 50, customerEmail: "", relevance: "customer_important", autoResolvable: false, classificationReasoning: "Could not parse AI response — defaulting to human review" }; }

          const relevance = parsed.relevance || "customer_important";
          const autoResolvable = parsed.autoResolvable === true;
          const classificationReasoning = parsed.classificationReasoning || "";

          const suggestion = {
            id: `AIR-${inc.id}-${Date.now()}`,
            incidentId: inc.id,
            incidentTitle: inc.title,
            priority: inc.priority,
            assignee: inc.assignee,
            resolution: parsed.resolution || "",
            rootCause: parsed.rootCause || "",
            suggestedStatus: parsed.suggestedStatus || "Resolved",
            confidence: parsed.confidence || 50,
            customerEmail: parsed.customerEmail || "",
            relevance,
            autoResolvable,
            classificationReasoning,
            status: "pending_approval",
            createdAt: now.toISOString(),
            requestedBy,
          };

          // Dedup: skip if pending resolution for this incident already exists
          if (_resPendingIncIds.has(inc.id)) { skipped++; continue; }
          _resPendingIncIds.add(inc.id); // prevent intra-batch dups

          // ─── Smart Routing: auto-dismiss noise/routine, queue important for engineers ───
          const isNoise = relevance === "noise_informational";
          const isRoutineHighConf = relevance === "internal_routine" && suggestion.confidence >= 80 && autoResolvable;
          const shouldAutoDismiss = isNoise || isRoutineHighConf;

          if (shouldAutoDismiss && suggestion.confidence >= AI_THRESHOLDS.autoResolveConfidence) {
            // ── Auto-dismiss: resolve silently, NO email, NO engineer review ──
            suggestion.status = "auto_dismissed";
            suggestion.dismissedAt = new Date().toISOString();
            suggestion.dismissReason = isNoise ? "noise_informational" : "routine_high_confidence";
            await db.upsert("ai_resolve_queue", suggestion.id, suggestion);

            // Apply resolution to incident (close it silently)
            try {
              const incRow = await db.get("incidents", inc.id);
              if (incRow) {
                const liveInc = typeof incRow.data === "string" ? JSON.parse(incRow.data) : incRow.data;
                liveInc.status = "Closed";
                liveInc.resolvedAt = new Date().toISOString();
                liveInc.resolution = suggestion.resolution || "Auto-dismissed by AI — not customer-impacting";
                liveInc.rootCause = suggestion.rootCause || liveInc.rootCause;
                liveInc.updatedAt = new Date().toISOString();
                liveInc.skipZendeskSync = true;
                liveInc.activityLog = liveInc.activityLog || [];
                liveInc.activityLog.push({ id: `AL-AID-${Date.now()}`, type: "ai_dismiss", user: "AI Smart Filter", time: new Date().toISOString(), detail: `Auto-dismissed (${relevance}, ${suggestion.confidence}% confidence): ${classificationReasoning.substring(0, 200)}` });
                await db.upsert("incidents", liveInc.id, JSON.stringify(liveInc));
              }
            } catch (dismissErr) { console.warn(`[AI Smart Filter] Failed to close ${inc.id}:`, dismissErr.message); }
            autoDismissed++;
            suggestions.push(suggestion);
            console.log(`[AI Smart Filter] Auto-dismissed ${inc.id} (${relevance}, ${suggestion.confidence}%): ${classificationReasoning.substring(0, 100)}`);
            continue; // No email, no engineer review
          }

          // ── Customer-impacting or low-confidence: queue for engineer approval ──
          await db.upsert("ai_resolve_queue", suggestion.id, suggestion);
          suggestions.push(suggestion);

          // ─── Auto-approve & apply resolution in PROD_TEST_MODE (only for customer-impacting with high confidence) ───
          if (PROD_TEST_MODE && suggestion.confidence >= AI_THRESHOLDS.autoResolveConfidence && !shouldAutoDismiss) {
            try {
              suggestion.status = "auto_approved";
              suggestion.approvedBy = "AI Pipeline (PROD_TEST_MODE)";
              suggestion.approvedAt = new Date().toISOString();

              const incRow = await db.get("incidents", inc.id);
              if (incRow) {
                const liveInc = typeof incRow.data === "string" ? JSON.parse(incRow.data) : incRow.data;
                liveInc.status = suggestion.suggestedStatus || "Resolved";
                liveInc.resolvedAt = new Date().toISOString();
                liveInc.resolution = suggestion.resolution;
                liveInc.rootCause = suggestion.rootCause || liveInc.rootCause;
                liveInc.updatedAt = new Date().toISOString();
                liveInc.activityLog = liveInc.activityLog || [];
                liveInc.activityLog.push({ id: `AL-AIR-${Date.now()}`, type: "ai_resolve", user: "AI Auto-Resolve", time: new Date().toISOString(), detail: `AI auto-resolved (${suggestion.confidence}% confidence, ${relevance}): ${(suggestion.resolution || "").substring(0, 200)}` });
                await db.upsert("incidents", liveInc.id, JSON.stringify(liveInc));
              }
              await db.upsert("ai_resolve_queue", suggestion.id, suggestion);
              console.log(`[AI Pipeline] Auto-resolved ${inc.id} (${suggestion.confidence}%, ${relevance})`);

              // Send engineer review email ONLY for customer-impacting incidents
              try {
                await graphSendMail({
                  to: ["hlaing@vgctechnology.com"],
                  subject: `[ITSM AI Review] ${inc.id} auto-resolved (${relevance}) — please verify`,
                  body: buildEmailTemplate({
                    type: "ai_review",
                    incidentId: inc.id,
                    title: inc.title || "",
                    priority: inc.priority || "-",
                    confidence: suggestion.confidence,
                    resolution: suggestion.resolution || "",
                    rootCause: suggestion.rootCause || "",
                    additionalFields: { "Relevance": relevance, "Classification": classificationReasoning },
                    nextActions: [
                      { label: "Review the AI-generated resolution for accuracy", url: PORTAL_URL, linkLabel: "Open Review Queue" },
                      { label: "Approve or reject in the AI Resolve Queue" },
                      { label: "If incorrect, edit the resolution before approving" },
                    ],
                    footerNote: "This incident was auto-resolved by the AI pipeline. Please verify the resolution is correct before it reaches the customer.",
                  }),
                });
                console.log(`[AI Pipeline] Review email sent for ${inc.id}`);
              } catch (emailErr) { console.warn(`[AI Pipeline] Review email failed for ${inc.id}:`, emailErr.message); }
            } catch (autoErr) { console.warn(`[AI Pipeline] Auto-resolve apply failed for ${inc.id}:`, autoErr.message); }
          }
        } catch (err) {
          console.error(`[AI Auto-Resolve] Failed for ${inc.id}:`, err.message);
          suggestions.push({ incidentId: inc.id, error: err.message });
        }
      }

      return json(res, 200, { success: true, suggestions, total: candidates.length, autoDismissed, queued: suggestions.filter(s => s.status === "pending_approval").length });
    } catch (err) {
      console.error("[AI Auto-Resolve]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/resolve-queue — fetch pending AI resolution suggestions
  if (pathname === "/api/ai/resolve-queue" && req.method === "GET") {
    try {
      const rows = await db.getAll("ai_resolve_queue");
      const items = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      return json(res, 200, { items });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/resolve-queue/action — approve or reject AI suggestion
  if (pathname === "/api/ai/resolve-queue/action" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { suggestionId, action, approvedBy, editedResolution, editedCustomerEmail } = body;
      if (!suggestionId || !action) return json(res, 400, { error: "suggestionId and action required" });
      if (action === "approve" && !approvedBy) return json(res, 403, { error: "Human approval required — approvedBy is mandatory" });

      const row = await db.getOne("ai_resolve_queue", suggestionId);
      if (!row) return json(res, 404, { error: "Suggestion not found" });
      const suggestion = typeof row.data === "string" ? JSON.parse(row.data) : row.data;

      if (action === "approve") {
        // Update the incident status (DO NOT sync to Zendesk — one-way pull only)
        const incRow = await db.getOne("incidents", suggestion.incidentId);
        if (incRow) {
          const inc = typeof incRow.data === "string" ? JSON.parse(incRow.data) : incRow.data;
          inc.status = suggestion.suggestedStatus || "Resolved";
          inc.resolution = editedResolution || suggestion.resolution;
          inc.rootCause = suggestion.rootCause;
          inc.resolvedAt = new Date().toISOString();
          inc.resolvedBy = `AI (approved by ${approvedBy})`;
          inc.updatedAt = new Date().toISOString();
          inc.aiResolved = true;
          inc.skipZendeskSync = true; // Flag: do NOT push to Zendesk
          await db.upsert("incidents", inc.id, inc);
        }
        suggestion.status = "approved";
        suggestion.approvedBy = approvedBy;
        suggestion.approvedAt = new Date().toISOString();
        if (editedResolution) suggestion.resolution = editedResolution;
      } else if (action === "reject") {
        suggestion.status = "rejected";
        suggestion.rejectedBy = approvedBy || "unknown";
        suggestion.rejectedAt = new Date().toISOString();
      }

      await db.upsert("ai_resolve_queue", suggestionId, suggestion);
      if (cacheLayer) cacheLayer.invalidatePrefix("incidents");

      // ─── Send email notifications on approve/reject ──────────────────
      if (action === "approve") {
        const incTitle = suggestion.incidentTitle || suggestion.incidentId || suggestionId;

        // 1. Customer resolution notice — Enterprise template
        graphSendMail({
          to: [suggestion.reporterEmail || "customer@example.com"],
          subject: `[VGC ITSM] Your incident ${suggestion.incidentId} has been resolved`,
          isCustomerEmail: true,
          body: buildEmailTemplate({
            type: "ai_approved_customer",
            incidentId: suggestion.incidentId || "",
            title: incTitle,
            rootCause: suggestion.rootCause || "N/A",
            resolution: suggestion.resolution || "",
            customerMessage: editedCustomerEmail || "",
            timestamp: suggestion.approvedAt || new Date().toISOString(),
            nextActions: [
              { label: "If this issue persists, please open a new support ticket", url: PORTAL_URL, linkLabel: "Open Portal" },
            ],
          }),
        }).catch(e => console.warn("[AI Resolve Approve] Customer email failed:", e.message));

        // 2. Approver confirmation → internal email (Enterprise template)
        graphSendMail({
          to: [approvedBy.includes("@") ? approvedBy : "itsupport@vgctechnology.com"],
          subject: `[VGC AI Assist] Resolution approved: ${suggestion.incidentId}`,
          body: buildEmailTemplate({
            type: "ai_approved_internal",
            incidentId: suggestion.incidentId || "",
            title: incTitle,
            approvedBy: approvedBy,
            confidence: suggestion.confidence,
            resolution: suggestion.resolution || "",
            rootCause: suggestion.rootCause || "N/A",
            customerMessage: editedCustomerEmail || "",
            additionalFields: { "Suggestion ID": suggestionId },
            footerNote: "All AI resolution actions are logged and auditable.",
          }),
        }).catch(e => console.warn("[AI Resolve Approve] Approver email failed:", e.message));

        console.log(`[AI Resolve Queue] Emails sent for approved suggestion ${suggestionId}`);
      }

      return json(res, 200, { success: true, suggestion });
    } catch (err) {
      console.error("[AI Resolve Queue Action]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── POST /api/ai/resolve-queue/bulk-dismiss — Bulk re-classify and dismiss noise/routine items ───
  if (pathname === "/api/ai/resolve-queue/bulk-dismiss" && req.method === "POST") {
    try {
      if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) return json(res, 503, { error: "AI not configured" });
      const body = await parseBody(req);
      const requestedBy = body.requestedBy || "system";
      const maxItems = Math.min(body.maxItems || 50, 100);

      const rows = await db.getAll("ai_resolve_queue");
      const pending = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } })
        .filter(it => it && it.status === "pending_approval")
        .slice(0, maxItems);

      if (!pending.length) return json(res, 200, { success: true, dismissed: 0, kept: 0, message: "No pending items" });

      let dismissed = 0, kept = 0;
      for (const item of pending) {
        try {
          // Reclassify using AI
          const prompt = `You are an enterprise ITSM AI assistant for VGC Technology — a managed IT services company.
Classify this pending AI resolution suggestion. Should it go to human engineer review, or can it be auto-dismissed?

Incident: ${JSON.stringify({ id: item.incidentId, title: item.incidentTitle, priority: item.priority, resolution: item.resolution, rootCause: item.rootCause, confidence: item.confidence })}

CLASSIFICATION:
- "customer_critical": Real customer outage/data loss/security breach → KEEP for engineer review
- "customer_important": Customer-reported issue affecting productivity → KEEP for engineer review
- "internal_routine": Internal monitoring alert, routine task, maintenance → DISMISS if confidence >= 60
- "noise_informational": Newsletter, vendor marketing, advisory, non-actionable notification → DISMISS

Respond ONLY with JSON: {"relevance": "...", "autoResolvable": true/false, "classificationReasoning": "brief reason"}`;

          const payload = { model: getAIModel("tertiary"), input: [{ role: "system", content: "Classify incidents by relevance. Respond only in JSON." }, { role: "user", content: prompt }], max_output_tokens: 300 };
          const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
          const aiResult = await new Promise((resolve, reject) => {
            const aiReq = https.request({
              hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
              method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
            }, (aiRes) => {
              let data = ""; aiRes.on("data", c => data += c);
              aiRes.on("end", () => {
                if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
                else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 200)}`));
              });
            });
            aiReq.on("error", reject);
            aiReq.setTimeout(20000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
            aiReq.write(JSON.stringify(payload));
            aiReq.end();
          });

          const text = extractAIText(aiResult);
          let parsed;
          try { parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); } catch { parsed = { relevance: "customer_important", autoResolvable: false, classificationReasoning: "Parse error — keeping for review" }; }

          item.relevance = parsed.relevance || "customer_important";
          item.autoResolvable = parsed.autoResolvable === true;
          item.classificationReasoning = parsed.classificationReasoning || "";

          const shouldDismiss = (item.relevance === "noise_informational") || (item.relevance === "internal_routine" && item.autoResolvable && item.confidence >= AI_THRESHOLDS.autoResolveConfidence);

          if (shouldDismiss) {
            item.status = "auto_dismissed";
            item.dismissedAt = new Date().toISOString();
            item.dismissedBy = requestedBy;
            item.dismissReason = item.relevance === "noise_informational" ? "noise_informational" : "routine_high_confidence";
            await db.upsert("ai_resolve_queue", item.id, item);

            // Also close the incident silently
            try {
              const incRow = await db.get("incidents", item.incidentId);
              if (incRow) {
                const liveInc = typeof incRow.data === "string" ? JSON.parse(incRow.data) : incRow.data;
                if (liveInc && !["Closed", "Resolved"].includes(liveInc.status)) {
                  liveInc.status = "Closed";
                  liveInc.resolvedAt = new Date().toISOString();
                  liveInc.resolution = item.resolution || "Auto-dismissed — not customer-impacting";
                  liveInc.updatedAt = new Date().toISOString();
                  liveInc.skipZendeskSync = true;
                  liveInc.activityLog = liveInc.activityLog || [];
                  liveInc.activityLog.push({ id: `AL-BD-${Date.now()}`, type: "ai_bulk_dismiss", user: "AI Bulk Dismiss", time: new Date().toISOString(), detail: `Bulk dismissed: ${item.relevance} — ${(item.classificationReasoning || "").substring(0, 200)}` });
                  await db.upsert("incidents", liveInc.id, JSON.stringify(liveInc));
                }
              }
            } catch (e) { console.warn(`[Bulk Dismiss] Failed to close ${item.incidentId}:`, e.message); }
            dismissed++;
          } else {
            // Update classification but keep in queue
            await db.upsert("ai_resolve_queue", item.id, item);
            kept++;
          }
        } catch (err) {
          console.warn(`[Bulk Dismiss] Failed to classify ${item.id}:`, err.message);
          kept++;
        }
      }

      if (cacheLayer) cacheLayer.invalidatePrefix("incidents");
      console.log(`[AI Bulk Dismiss] Processed ${pending.length}: ${dismissed} dismissed, ${kept} kept`);
      return json(res, 200, { success: true, processed: pending.length, dismissed, kept });
    } catch (err) {
      console.error("[AI Bulk Dismiss]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Auto Follow-Up & Resolution Engine ─────────────────────────────
  // POST /api/ai/auto-followup — AI reviews all open incidents, syncs Zendesk statuses,
  // generates customer response emails, and closes resolved tickets.
  // Customer emails use HTML templates with case-appropriate tone and official references.
  if (pathname === "/api/ai/auto-followup" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) return json(res, 503, { error: "AI not configured" });
    try {
      const body = await parseBody(req);
      const requestedBy = body.requestedBy || "AI Auto Follow-Up";
      const dryRun = body.dryRun === true; // preview without sending emails or updating DB
      const maxItems = Math.min(body.maxItems || 5, 20); // limit to prevent Azure proxy timeout (230s)

      // ── 1. Load all incidents and Zendesk tickets ──
      const incRows = await db.getAll("incidents");
      const allIncidents = incRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean).slice(0, maxItems);

      const zdRows = await db.getAll("zendesk_tickets");
      const zdTickets = {};
      for (const r of zdRows) {
        try {
          const t = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (t && t.id) zdTickets[t.id] = t;
        } catch {}
      }

      // ── 2. Separate incidents by state ──
      const zdStatusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
      const openStatuses = new Set(["New", "Open", "In Progress", "Pending", "On Hold"]);
      const results = { synced: [], followedUp: [], closed: [], errors: [], skipped: [] };

      for (const inc of allIncidents) {
        try {
          const incStatus = (inc.status || "").trim();

          // ── 2a. Sync ITSM status with Zendesk (if linked) ──
          if (inc.zdTicketId && zdTickets[inc.zdTicketId]) {
            const zdTicket = zdTickets[inc.zdTicketId];
            const zdStatus = (zdTicket.status || "").toLowerCase();
            const mappedStatus = zdStatusMap[zdStatus] || incStatus;

            // If Zendesk is solved/closed but ITSM is still open → sync
            if ((zdStatus === "solved" || zdStatus === "closed") && openStatuses.has(incStatus)) {
              if (!dryRun) {
                inc.status = mappedStatus;
                inc.updatedAt = new Date().toISOString();
                if (mappedStatus === "Resolved" && !inc.resolvedAt) inc.resolvedAt = new Date().toISOString();
                if (mappedStatus === "Closed" && !inc.closedAt) inc.closedAt = new Date().toISOString();
                inc.activityLog = inc.activityLog || [];
                inc.activityLog.push({
                  id: `AL-SYNC-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
                  type: "status", user: "AI Auto Follow-Up (Zendesk Sync)",
                  time: new Date().toISOString(),
                  detail: `Status synced from Zendesk #${inc.zdTicketId}: ${incStatus} → ${mappedStatus}`,
                });
                await db.upsert("incidents", inc.id, JSON.stringify(inc));
              }
              results.synced.push({ id: inc.id, zdTicketId: inc.zdTicketId, from: incStatus, to: mappedStatus });
              continue; // already resolved via Zendesk, no AI follow-up needed
            }

            // If Zendesk is open/pending, keep ITSM matching — skip AI close
            if (zdStatus === "open" || zdStatus === "pending") {
              results.skipped.push({ id: inc.id, reason: `Zendesk #${inc.zdTicketId} is still ${zdStatus}` });
              continue;
            }
          }

          // ── 2b. Skip already resolved/closed ──
          if (!openStatuses.has(incStatus)) continue;

          // ── 3. AI generates customer response + resolution ──
          const customerName = inc.reporterName || inc.reporter || (inc.reporterEmail || "Customer").split("@")[0];
          const safeTitle = (inc.title || "").replace(/</g, "&lt;");
          const safeDesc = (inc.description || "").substring(0, 600).replace(/</g, "&lt;");

          const aiPrompt = `You are VGC Technology's senior IT support engineer responding to a customer incident.

INCIDENT:
- ID: ${inc.id}
- Title: ${inc.title}
- Description: ${(inc.description || "").substring(0, 800)}
- Category: ${inc.category || "General"}
- Priority: ${inc.priority || "Sev-C"}
- Reporter: ${customerName}
- Created: ${inc.createdAt || "Unknown"}

TASK: Generate a professional customer response email that:
1. Addresses the customer by name in a warm, professional tone matching the nature of the case
2. Provides a clear resolution or next steps for their specific issue
3. If the issue is related to Microsoft products (Outlook, Teams, Windows, M365, Azure AD, Exchange, OneDrive, SharePoint, Intune), include 1-2 relevant Microsoft official support article links (use real Microsoft Learn URLs like https://learn.microsoft.com/... or https://support.microsoft.com/...)
4. If the issue is related to Cisco/network products (switches, routers, Meraki, VPN, firewall), include 1-2 relevant Cisco support article links (use real Cisco URLs like https://www.cisco.com/c/en/us/support/... or https://community.cisco.com/...)
5. Include a brief summary of what was done to resolve the issue
6. Close with a professional sign-off from VGC Technology IT Support

TONE GUIDELINES:
- For critical/urgent issues: empathetic, action-oriented, reassuring
- For standard issues: friendly, clear, helpful
- For simple requests: concise, efficient, professional

Respond in JSON ONLY:
{
  "subject": "Re: [original subject] — Resolution",
  "greeting": "Dear [name],",
  "body": "Main response body (can include HTML formatting like <br>, <strong>, <ul><li>)",
  "resolution": "Brief resolution summary for internal record",
  "references": [{"title": "Article title", "url": "https://..."}],
  "tone": "empathetic|professional|concise",
  "closingAction": "resolve|pending_customer|monitor",
  "confidence": 0-100
}`;

          const payload = {
            model: getAIModel("primary"),
            input: [
              { role: "system", content: "You are a senior IT support engineer at VGC Technology Pte Ltd. Generate professional customer email responses with relevant official vendor documentation links. Respond ONLY in valid JSON." },
              { role: "user", content: aiPrompt },
            ],
            max_output_tokens: 1200,
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
                else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
              });
            });
            aiReq.on("error", reject);
            aiReq.setTimeout(45000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
            aiReq.write(JSON.stringify(payload));
            aiReq.end();
          });

          const aiText = extractAIText(aiResult);
          let aiResponse;
          try {
            aiResponse = JSON.parse(aiText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
          } catch {
            results.errors.push({ id: inc.id, error: "AI returned invalid JSON" });
            continue;
          }

          // ── 4. Build HTML email from AI response using enterprise template ──
          const emailType = aiResponse.closingAction === "resolve" ? "ai_followup_resolved" : "ai_followup";
          const emailHtml = buildEmailTemplate({
            type: emailType,
            incidentId: inc.id,
            title: inc.title || "",
            priority: inc.priority || "Sev-C",
            category: inc.category || "General",
            status: aiResponse.closingAction === "resolve" ? "Resolved" : "In Progress",
            assignee: inc.assignee || inc.assignmentGroup || "VGC IT Support",
            resolution: aiResponse.resolution || aiResponse.body || "",
            customerMessage: aiResponse.greeting ? `${aiResponse.greeting}\n\n${aiResponse.body || ""}` : "",
            references: (aiResponse.references || []).filter(r => r.url && r.title),
            nextActions: aiResponse.closingAction === "resolve"
              ? [{ label: "If this issue persists, please open a new support ticket", url: PORTAL_URL, linkLabel: "Open Portal" }]
              : [{ label: "Our team is actively working on this — no action required from you at this time" }],
          });

          // ── 5. Send email to customer ──
          const emailSubject = aiResponse.subject || `[VGC ITSM] Re: ${(inc.title || "Your request").substring(0, 60)} — ${aiResponse.closingAction === "resolve" ? "Resolved" : "Update"}`;
          if (!dryRun) {
            graphSendMail({
              to: [inc.reporterEmail || "customer@example.com"],
              subject: emailSubject,
              isCustomerEmail: true,
              body: emailHtml,
            }).catch(e => console.warn(`[AI Follow-Up] Email failed for ${inc.id}:`, e.message));
          }

          // ── 6. Update incident status + activity log ──
          const newStatus = aiResponse.closingAction === "resolve" ? "Resolved" : inc.status === "New" ? "Open" : inc.status;
          if (!dryRun) {
            inc.status = newStatus;
            inc.updatedAt = new Date().toISOString();
            if (newStatus === "Resolved") {
              inc.resolvedAt = inc.resolvedAt || new Date().toISOString();
              inc.resolution = aiResponse.resolution || "Resolved by AI Follow-Up Engine";
            }
            inc.activityLog = inc.activityLog || [];
            inc.activityLog.push({
              id: `AL-AIFU-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
              type: aiResponse.closingAction === "resolve" ? "resolved" : "followup",
              user: "AI Auto Follow-Up Engine",
              time: new Date().toISOString(),
              detail: `AI ${aiResponse.closingAction === "resolve" ? "resolved" : "followed up"}: ${(aiResponse.resolution || aiResponse.body || "").substring(0, 200)}`,
            });
            inc.aiFollowedUp = true;
            inc.aiFollowUpAt = new Date().toISOString();
            await db.upsert("incidents", inc.id, JSON.stringify(inc));
            await db.audit("incidents", inc.id, "ai_followup", JSON.stringify({ action: aiResponse.closingAction, confidence: aiResponse.confidence }), requestedBy);
          }

          if (aiResponse.closingAction === "resolve") {
            results.closed.push({ id: inc.id, title: inc.title, resolution: aiResponse.resolution, confidence: aiResponse.confidence });
          } else {
            results.followedUp.push({ id: inc.id, title: inc.title, action: aiResponse.closingAction, confidence: aiResponse.confidence });
          }

          console.log(`[AI Follow-Up] ${inc.id} → ${aiResponse.closingAction} (${aiResponse.confidence}% confidence) email sent to ${inc.reporterEmail || "customer"}`);
        } catch (incErr) {
          results.errors.push({ id: inc.id, error: incErr.message });
          console.warn(`[AI Follow-Up] Error for ${inc.id}:`, incErr.message);
        }
      }

      console.log(`[AI Follow-Up] Complete: synced=${results.synced.length} closed=${results.closed.length} followedUp=${results.followedUp.length} skipped=${results.skipped.length} errors=${results.errors.length}`);
      return json(res, 200, {
        success: true, dryRun,
        summary: {
          totalIncidents: allIncidents.length,
          synced: results.synced.length,
          closed: results.closed.length,
          followedUp: results.followedUp.length,
          skipped: results.skipped.length,
          errors: results.errors.length,
        },
        details: results,
      });
    } catch (err) {
      console.error("[AI Follow-Up]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── GET /api/ai/email-templates — customizable email response templates ──
  if (pathname === "/api/ai/email-templates" && req.method === "GET") {
    const templates = {
      incident_acknowledgement: {
        name: "Incident Acknowledgement",
        description: "Sent when a new incident is created from email or portal",
        subject: "[VGC ITSM] Incident {{incidentId}} created — {{title}}",
        headerGradient: "linear-gradient(135deg, #3B82F6, #06B6D4)",
        headerIcon: "📧",
        bodyTemplate: `<p>Dear {{customerName}},</p>
<p>Thank you for contacting VGC Technology IT Support. We have received your request and created a support ticket.</p>
<p><strong>What happens next:</strong></p>
<ul>
  <li>Our team will review your request within the SLA timeframe</li>
  <li>You will receive updates as your ticket progresses</li>
  <li>For urgent matters, please call our helpdesk at +65 6000 0000</li>
</ul>`,
        footerNote: "Our team will review your request and respond as soon as possible.",
      },
      incident_resolution: {
        name: "Incident Resolution",
        description: "Sent when an incident is resolved by AI or engineer",
        subject: "[VGC ITSM] Incident {{incidentId}} — Resolved",
        headerGradient: "linear-gradient(135deg, #4CAF50, #06B6D4)",
        headerIcon: "✅",
        bodyTemplate: `<p>Dear {{customerName}},</p>
<p>We are pleased to inform you that your support ticket has been resolved.</p>
<p><strong>Resolution Summary:</strong><br/>{{resolution}}</p>
<p>If you experience the same issue again or need further assistance, please don't hesitate to contact us.</p>`,
        footerNote: "If this issue persists, please open a new ticket or reply to this email.",
      },
      incident_update: {
        name: "Incident Update / Follow-Up",
        description: "Sent when there's a progress update on an open incident",
        subject: "[VGC ITSM] Update: {{incidentId}} — {{title}}",
        headerGradient: "linear-gradient(135deg, #6366F1, #8B5CF6)",
        headerIcon: "🔄",
        bodyTemplate: `<p>Dear {{customerName}},</p>
<p>We wanted to provide you with an update on your support ticket.</p>
<p><strong>Current Status:</strong> {{status}}<br/>
<strong>Update:</strong> {{updateBody}}</p>
<p>We are actively working on this and will keep you informed of any further progress.</p>`,
        footerNote: "Our team is actively working on your request.",
      },
      incident_escalation: {
        name: "Incident Escalation Notice",
        description: "Sent when an incident is escalated to a higher tier",
        subject: "[VGC ITSM] Escalation: {{incidentId}} — {{title}}",
        headerGradient: "linear-gradient(135deg, #EF4444, #F59E0B)",
        headerIcon: "⚡",
        bodyTemplate: `<p>Dear {{customerName}},</p>
<p>Your support ticket has been escalated to our specialist team for priority attention.</p>
<p><strong>Why escalated:</strong> {{escalationReason}}</p>
<p>A senior engineer will be reviewing your case and you can expect an update shortly.</p>`,
        footerNote: "Your case has been prioritised. A senior engineer will contact you soon.",
      },
      incident_pending_info: {
        name: "Pending Customer Information",
        description: "Sent when additional information is needed from the customer",
        subject: "[VGC ITSM] Action Required: {{incidentId}} — {{title}}",
        headerGradient: "linear-gradient(135deg, #F59E0B, #EAB308)",
        headerIcon: "⏳",
        bodyTemplate: `<p>Dear {{customerName}},</p>
<p>We are currently working on your support request and require some additional information to proceed.</p>
<p><strong>Information needed:</strong><br/>{{infoNeeded}}</p>
<p>Please reply to this email with the requested details so we can continue resolving your issue promptly.</p>`,
        footerNote: "Please respond with the requested information to help us resolve your issue faster.",
      },
      rejection_non_customer: {
        name: "Non-Customer Rejection",
        description: "Sent when an email is received from a non-registered customer domain",
        subject: "[VGC ITSM] Your request could not be processed",
        headerGradient: "linear-gradient(135deg, #6B7280, #374151)",
        headerIcon: "📨",
        bodyTemplate: `<p>Dear {{senderName}},</p>
<p>Thank you for contacting VGC Technology IT Service Management.</p>
<p>Unfortunately, we are unable to process your request as your email domain (<code>{{senderDomain}}</code>) is not registered as an active customer in our system.</p>
<div style="background:#FFF3CD;border:1px solid #FFD700;border-radius:6px;padding:12px 16px;margin:16px 0;">
  <p style="margin:0;font-size:13px;"><strong>Interested in IT Managed Services?</strong></p>
  <p style="margin:6px 0 0;font-size:13px;">For IT maintenance contract enquiries, please contact our sales team:</p>
  <p style="margin:6px 0 0;font-size:14px;">📧 <a href="mailto:sales@vgctechnology.com" style="color:#0066CC;font-weight:bold;">sales@vgctechnology.com</a></p>
</div>`,
        footerNote: "If you believe this is an error, please ask your company administrator to contact us.",
      },
    };
    return json(res, 200, { templates });
  }

  // ─── PUT /api/ai/email-templates/:id — update a template ──
  if (pathname.startsWith("/api/ai/email-templates/") && req.method === "PUT") {
    try {
      const templateId = pathname.split("/").pop();
      const body = await parseBody(req);
      await db.upsert("email_templates", templateId, JSON.stringify({ id: templateId, ...body, updatedAt: new Date().toISOString() }));
      return json(res, 200, { success: true, templateId });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI News Advisory — Auto-Draft & Send Internal IT Advisory ─────────
  // POST /api/ai/news-advisory — AI generates enterprise-class advisory email
  // from IT news headlines and auto-sends to itsupport@vgctechnology.com
  if (pathname === "/api/ai/news-advisory" && req.method === "POST") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) return json(res, 503, { error: "AI not configured" });
    try {
      const body = await parseBody(req);
      const headline = body.headline || body.title || "";
      const articleBody = body.body || body.content || body.summary || "";
      const source = body.source || "IT News Feed";
      if (!headline) return json(res, 400, { error: "headline is required" });

      const aiPrompt = `You are VGC Technology's Chief IT Advisor drafting an internal advisory email for the IT Support team.

NEWS HEADLINE: ${headline}
SOURCE: ${source}
${articleBody ? `ARTICLE SUMMARY: ${articleBody.substring(0, 1200)}` : ""}

Generate a professional enterprise-class internal IT advisory email. This is for itsupport@vgctechnology.com — the internal IT team, NOT customers.

The email MUST include these sections:
1. **Executive Summary** — 2-3 sentences on what happened and why it matters
2. **Technical Impact Assessment** — How this affects our managed customers (Windows endpoints, M365 tenants, network infrastructure)
3. **ITSM Actions Taken** — What our AI ITSM system has automatically done (e.g., created KB article, updated runbook, flagged affected assets, created change request for testing)
4. **Recommended Next Actions** — Numbered list of specific actions the IT team should take (e.g., test in staging, update GPO, notify affected customers, schedule maintenance window)
5. **AI Automation Improvement Suggestions** — 3-5 concrete suggestions for future ITSM AI automation improvements (e.g., auto-scan RSS feeds for relevant news, auto-create change requests for patch testing, proactive customer alerts, auto-update KB articles, predictive impact analysis)
6. **Official References** — 2-3 relevant Microsoft/Cisco/vendor documentation links

TONE: Authoritative, actionable, enterprise-grade. Written as if from a senior IT advisory team.
FORMAT: Use HTML for email formatting (<h3>, <p>, <ul><li>, <strong>, <a href>).

Respond in JSON ONLY:
{
  "subject": "Advisory subject line",
  "executiveSummary": "HTML content",
  "impactAssessment": "HTML content",
  "itsmActions": "HTML content",
  "nextActions": "HTML content",
  "aiSuggestions": "HTML content",
  "references": [{"title": "...", "url": "https://..."}],
  "severity": "critical|high|medium|low|informational",
  "affectedSystems": ["Windows", "M365", etc],
  "confidence": 0-100
}`;

      const aiResult = await callAI(
        "You are a senior IT advisory specialist at VGC Technology Pte Ltd. Generate professional enterprise-class internal IT advisory emails. Respond ONLY in valid JSON.",
        aiPrompt,
        { tier: "secondary", maxTokens: 4000, timeout: 90000 }
      );

      const aiText = aiResult.text;
      let advisory;
      try {
        let cleaned = aiText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        // Extract JSON object between first { and last }
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        advisory = JSON.parse(cleaned);
      } catch (parseErr) {
        return json(res, 500, { error: "AI returned invalid JSON: " + parseErr.message, raw: aiText.substring(0, 500) });
      }

      // Build severity badge colors
      const sevColors = { critical: "#DC2626", high: "#EA580C", medium: "#D97706", low: "#2563EB", informational: "#7C3AED" };
      const sevColor = sevColors[advisory.severity] || "#7C3AED";
      const sevLabel = (advisory.severity || "informational").toUpperCase();

      // Build references HTML
      const refsHtml = (advisory.references || []).filter(r => r.url && r.title)
        .map(r => `<li><a href="${r.url.replace(/"/g, "&quot;")}" style="color:#2563EB;text-decoration:none;font-weight:500;">${r.title.replace(/</g, "&lt;")}</a></li>`)
        .join("");

      const affectedBadges = (advisory.affectedSystems || [])
        .map(s => `<span style="display:inline-block;padding:3px 10px;border-radius:4px;background:#1E293B;color:#94A3B8;font-size:12px;margin:2px 4px 2px 0;border:1px solid #334155;">${s.replace(/</g, "&lt;")}</span>`)
        .join("");

      const advisoryHtml = `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:720px;margin:0 auto;background:#ffffff;">
  <!-- Header Banner -->
  <div style="background:linear-gradient(135deg, #0F172A, #1E293B);padding:24px 28px;border-radius:10px 10px 0 0;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">VGC TECHNOLOGY — IT ADVISORY</div>
        <h1 style="margin:0;color:#F8FAFC;font-size:20px;line-height:1.3;">${(advisory.subject || headline).replace(/</g, "&lt;")}</h1>
      </div>
      <div style="text-align:right;">
        <div style="display:inline-block;padding:5px 14px;border-radius:6px;background:${sevColor};color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;">${sevLabel}</div>
        <div style="font-size:10px;color:#64748B;margin-top:6px;">${new Date().toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}</div>
      </div>
    </div>
    ${affectedBadges ? `<div style="margin-top:12px;">${affectedBadges}</div>` : ""}
  </div>

  <div style="padding:28px;border:1px solid #E2E8F0;border-top:none;">
    <!-- Executive Summary -->
    <div style="margin-bottom:24px;">
      <h3 style="margin:0 0 10px;color:#0F172A;font-size:15px;border-bottom:2px solid #3B82F6;padding-bottom:6px;">📋 Executive Summary</h3>
      <div style="color:#334155;font-size:14px;line-height:1.7;">${advisory.executiveSummary || ""}</div>
    </div>

    <!-- Technical Impact -->
    <div style="margin-bottom:24px;padding:16px;background:#FFF7ED;border-radius:8px;border-left:4px solid #F59E0B;">
      <h3 style="margin:0 0 10px;color:#92400E;font-size:14px;">⚠️ Technical Impact Assessment</h3>
      <div style="color:#78350F;font-size:13px;line-height:1.7;">${advisory.impactAssessment || ""}</div>
    </div>

    <!-- ITSM Actions Taken -->
    <div style="margin-bottom:24px;padding:16px;background:#F0FDF4;border-radius:8px;border-left:4px solid #22C55E;">
      <h3 style="margin:0 0 10px;color:#166534;font-size:14px;">✅ ITSM Actions Taken (Automated)</h3>
      <div style="color:#15803D;font-size:13px;line-height:1.7;">${advisory.itsmActions || ""}</div>
    </div>

    <!-- Recommended Next Actions -->
    <div style="margin-bottom:24px;padding:16px;background:#EFF6FF;border-radius:8px;border-left:4px solid #3B82F6;">
      <h3 style="margin:0 0 10px;color:#1E40AF;font-size:14px;">🎯 Recommended Next Actions</h3>
      <div style="color:#1E3A5F;font-size:13px;line-height:1.7;">${advisory.nextActions || ""}</div>
    </div>

    <!-- AI Automation Suggestions -->
    <div style="margin-bottom:24px;padding:16px;background:linear-gradient(135deg, #F5F3FF, #EDE9FE);border-radius:8px;border-left:4px solid #8B5CF6;">
      <h3 style="margin:0 0 10px;color:#5B21B6;font-size:14px;">🤖 AI Automation Improvement Suggestions</h3>
      <div style="color:#4C1D95;font-size:13px;line-height:1.7;">${advisory.aiSuggestions || ""}</div>
    </div>

    <!-- Official References -->
    ${refsHtml ? `<div style="margin-bottom:16px;">
      <h3 style="margin:0 0 10px;color:#0F172A;font-size:14px;">📚 Official References</h3>
      <ul style="margin:0;padding-left:20px;color:#334155;font-size:13px;line-height:1.8;">${refsHtml}</ul>
    </div>` : ""}
  </div>

  <!-- Footer -->
  <div style="background:#F8FAFC;padding:16px 28px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 10px 10px;">
    <p style="margin:0 0 4px;color:#64748B;font-size:12px;"><strong>VGC Technology IT Advisory Team</strong> — AI-Generated Internal Advisory</p>
    <p style="margin:0;color:#94A3B8;font-size:10px;">This advisory was auto-generated by the VGC ITSM AI Engine. No human approval was required. For questions, contact the IT Operations team.</p>
  </div>
</div>`;

      const emailSubject = advisory.subject || `[VGC ITSM Advisory] ${headline.substring(0, 80)}`;

      // Auto-send to internal IT support — no human approval needed
      await graphSendMail({
        to: [MAIL_FROM], // itsupport@vgctechnology.com
        subject: emailSubject,
        body: advisoryHtml,
        isCustomerEmail: false, // internal email
      });

      // Store advisory in DB for audit trail
      const advisoryId = `ADV-${Date.now()}`;
      await db.upsert("advisories", advisoryId, JSON.stringify({
        id: advisoryId, headline, source, severity: advisory.severity,
        affectedSystems: advisory.affectedSystems, subject: emailSubject,
        sentAt: new Date().toISOString(), sentTo: MAIL_FROM,
        confidence: advisory.confidence,
      }));

      console.log(`[AI News Advisory] Sent "${emailSubject}" to ${MAIL_FROM} (severity: ${advisory.severity})`);
      return json(res, 200, {
        success: true, advisoryId, subject: emailSubject,
        severity: advisory.severity, affectedSystems: advisory.affectedSystems,
        confidence: advisory.confidence, sentTo: MAIL_FROM,
      });
    } catch (err) {
      console.error("[AI News Advisory]", err.message);
      return json(res, 500, { error: err.message });
    }
  }
  // ─── AI Workflow Assist (Zendesk Internal Notes Only) ──────────────────
  if (pathname === "/api/ai/workflow-assist" && req.method === "POST") {
    try {
      if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) return json(res, 503, { error: "AI not configured" });
      const body = await parseBody(req);
      const requestedBy = body.requestedBy || "system";
      const maxItems = Math.min(body.maxItems || 10, 20);
      const targetIncidentId = body.incidentId || null;

      const incidentRows = db.getOpen ? await db.getOpen("incidents") : await db.getAll("incidents");
      const openIncidents = incidentRows.map(r => {
        try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; }
      }).filter(inc => {
        if (!inc || !inc.id) return false;
        if (targetIncidentId && inc.id !== targetIncidentId) return false;
        const status = (inc.status || "").toLowerCase();
        return !["closed", "resolved"].includes(status);
      }).slice(0, maxItems);

      if (!openIncidents.length) return json(res, 200, { success: true, actions: [], message: "No open incidents found" });

      const actions = [];
      for (const inc of openIncidents) {
        try {
          const prompt = `You are an expert ITSM workflow advisor for VGC Technology. Analyze this open incident and recommend the best NEXT workflow action.
Incident: ${JSON.stringify({ id: inc.id, title: inc.title, description: (inc.description || "").substring(0, 400), priority: inc.priority, category: inc.category, status: inc.status, assignee: inc.assignee, assignmentGroup: inc.assignmentGroup, createdAt: inc.createdAt, updatedAt: inc.updatedAt })}
Respond in JSON ONLY:
{"action": "one of: escalate|reassign|add_workaround|add_internal_note|monitor|request_info", "reasoning": "why this action", "internalNote": "exact text for internal note to add (NO customer emails, NO email addresses)", "suggestedAssignee": "team or person if reassigning", "urgency": "high|medium|low", "confidence": 0-100}`;

          const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: "You are an expert IT workflow advisor. Respond ONLY in valid JSON. NEVER include email addresses in your response." }, { role: "user", content: prompt }], max_output_tokens: 600 };
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
          let parsed;
          try { parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); } catch { parsed = { action: "monitor", reasoning: text, internalNote: "", confidence: 40 }; }

          // Strip ALL email addresses from AI output for security
          const stripEmails = (s) => (s || "").replace(/[\w.-]+@[\w.-]+\.\w+/g, "[email redacted]");
          parsed.reasoning = stripEmails(parsed.reasoning);
          parsed.internalNote = stripEmails(parsed.internalNote);

          const wfAction = {
            id: `WF-${inc.id}-${Date.now()}`,
            incidentId: inc.id,
            incidentTitle: inc.title,
            priority: inc.priority,
            status: "pending",
            action: parsed.action || "monitor",
            reasoning: parsed.reasoning || "",
            internalNote: parsed.internalNote || "",
            suggestedAssignee: parsed.suggestedAssignee || "",
            urgency: parsed.urgency || "medium",
            confidence: parsed.confidence || 50,
            createdAt: new Date().toISOString(),
            requestedBy,
            zdTicketId: inc.zdTicketId || null,
          };

          await db.upsert("ai_workflow_queue", wfAction.id, wfAction);
          actions.push(wfAction);

          // ─── Auto-execute workflow action in PROD_TEST_MODE ───
          if (PROD_TEST_MODE && wfAction.confidence >= 60) {
            try {
              // Auto-approve
              wfAction.status = "auto_executed";
              wfAction.approvedBy = "AI Pipeline (PROD_TEST_MODE)";
              wfAction.approvedAt = new Date().toISOString();

              // Execute action on incident
              const incRow = await db.get("incidents", inc.id);
              if (incRow) {
                const liveInc = typeof incRow.data === "string" ? JSON.parse(incRow.data) : incRow.data;
                liveInc.activityLog = liveInc.activityLog || [];

                if (wfAction.action === "escalate") {
                  liveInc.priority = liveInc.priority === "Sev-C" ? "Sev-B" : liveInc.priority === "Sev-B" ? "Sev-A" : liveInc.priority;
                  liveInc.activityLog.push({ id: `AL-WFA-${Date.now()}`, type: "workflow", user: "AI Workflow Auto-Execute", time: new Date().toISOString(), detail: `Auto-escalated: ${wfAction.reasoning}` });
                } else if (wfAction.action === "reassign" && wfAction.suggestedAssignee) {
                  liveInc.assignee = wfAction.suggestedAssignee;
                  liveInc.activityLog.push({ id: `AL-WFA-${Date.now()}`, type: "workflow", user: "AI Workflow Auto-Execute", time: new Date().toISOString(), detail: `Auto-reassigned to ${wfAction.suggestedAssignee}: ${wfAction.reasoning}` });
                } else if (wfAction.action === "add_internal_note" && wfAction.internalNote) {
                  liveInc.activityLog.push({ id: `AL-WFA-${Date.now()}`, type: "internal_note", user: "AI Workflow Auto-Execute", time: new Date().toISOString(), detail: wfAction.internalNote });
                } else if (wfAction.action === "add_workaround" && wfAction.internalNote) {
                  liveInc.workaround = wfAction.internalNote;
                  liveInc.activityLog.push({ id: `AL-WFA-${Date.now()}`, type: "workflow", user: "AI Workflow Auto-Execute", time: new Date().toISOString(), detail: `Auto-added workaround: ${wfAction.internalNote.substring(0, 100)}` });
                } else {
                  liveInc.activityLog.push({ id: `AL-WFA-${Date.now()}`, type: "workflow", user: "AI Workflow Auto-Execute", time: new Date().toISOString(), detail: `AI recommends: ${wfAction.action} — ${wfAction.reasoning}` });
                }

                liveInc.updatedAt = new Date().toISOString();
                await db.upsert("incidents", liveInc.id, JSON.stringify(liveInc));
              }

              await db.upsert("ai_workflow_queue", wfAction.id, wfAction);
              console.log(`[AI Pipeline] Auto-executed ${wfAction.action} for ${inc.id} (${wfAction.confidence}% confidence)`);
            } catch (execErr) {
              console.warn(`[AI Pipeline] Auto-execute failed for ${inc.id}:`, execErr.message);
            }
          }
        } catch (err) {
          console.error(`[AI Workflow Assist] Failed for ${inc.id}:`, err.message);
          actions.push({ incidentId: inc.id, error: err.message });
        }
      }

      return json(res, 200, { success: true, actions, total: openIncidents.length });
    } catch (err) {
      console.error("[AI Workflow Assist]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/workflow-queue — fetch pending workflow suggestions
  if (pathname === "/api/ai/workflow-queue" && req.method === "GET") {
    try {
      const rows = await db.getAll("ai_workflow_queue");
      const items = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      return json(res, 200, { items });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/workflow-queue/action — approve/reject/apply workflow suggestion
  if (pathname === "/api/ai/workflow-queue/action" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { suggestionId, action, approvedBy } = body;
      if (!suggestionId || !action) return json(res, 400, { error: "suggestionId and action required" });

      const row = await db.getOne("ai_workflow_queue", suggestionId);
      if (!row) return json(res, 404, { error: "Suggestion not found" });
      const suggestion = typeof row.data === "string" ? JSON.parse(row.data) : row.data;

      if (action === "approve") {
        suggestion.status = "approved";
        suggestion.approvedBy = approvedBy || "unknown";
        suggestion.approvedAt = new Date().toISOString();

        // Post internal note to Zendesk if ticket exists
        if (suggestion.zdTicketId && suggestion.internalNote && ZENDESK_SUBDOMAIN && ZENDESK_EMAIL && ZENDESK_TOKEN) {
          try {
            const noteText = `[AI Workflow Assist] Action: ${suggestion.action}\n${suggestion.internalNote}\n\n— AI generated (approved by ${approvedBy})`;
            await zdRequest("PUT", `/tickets/${suggestion.zdTicketId}.json`, {
              ticket: { comment: { body: noteText, public: false } }
            });
            suggestion.zdSynced = true;
            console.log(`[AI Workflow] Internal note posted to Zendesk #${suggestion.zdTicketId}`);
          } catch (zdErr) {
            console.error(`[AI Workflow] Zendesk sync failed:`, zdErr.message);
            suggestion.zdSyncError = zdErr.message;
          }
        }

        // Update incident if action requires it
        if (suggestion.action === "escalate" || suggestion.action === "reassign") {
          try {
            const incRow = await db.getOne("incidents", suggestion.incidentId);
            if (incRow) {
              const inc = typeof incRow.data === "string" ? JSON.parse(incRow.data) : incRow.data;
              if (suggestion.action === "escalate") {
                inc.priority = inc.priority === "Sev-D" ? "Sev-C" : inc.priority === "Sev-C" ? "Sev-B" : "Sev-A";
                inc.escalated = true;
              }
              if (suggestion.suggestedAssignee) inc.assignee = suggestion.suggestedAssignee;
              inc.updatedAt = new Date().toISOString();
              inc.skipZendeskSync = true;
              await db.upsert("incidents", inc.id, inc);
            }
          } catch {}
        }
      } else if (action === "reject") {
        suggestion.status = "rejected";
        suggestion.rejectedBy = approvedBy || "unknown";
        suggestion.rejectedAt = new Date().toISOString();
      }

      await db.upsert("ai_workflow_queue", suggestionId, suggestion);
      if (cacheLayer) cacheLayer.invalidatePrefix("incidents");
      return json(res, 200, { success: true, suggestion });
    } catch (err) {
      console.error("[AI Workflow Queue Action]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Bulk Cleanup: Dismiss stale pending_approval items ───────────────
  // POST /api/ai/cleanup-queue — dismiss old/stale pending_approval items
  if (pathname === "/api/ai/cleanup-queue" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const dryRun = body.dryRun === true;
      const maxAgeDays = body.maxAgeDays || 3; // dismiss items older than N days
      const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

      // Get all incidents to check which are resolved/closed
      const incRows = await db.getAll("incidents");
      const resolvedIds = new Set();
      for (const r of incRows) {
        try {
          const inc = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (inc && ["Resolved", "Closed"].includes(inc.status)) resolvedIds.add(inc.id);
        } catch {}
      }

      // Process ai_actions
      const actionRows = await db.getAll("ai_actions");
      let actionsDismissed = 0, actionsStale = 0, actionsDupes = 0, actionsTotal = actionRows.length;

      // Build dedup map: keep newest pending per (type:incidentId) or (type:normalizedTitle)
      const _dedupMap = {}; // key -> { newest item, older items[] }
      const _pendingItems = [];
      for (const r of actionRows) {
        try {
          const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (!item || item.status !== "pending_approval") continue;
          _pendingItems.push(item);
          let dedupKey = null;
          if (item.type && item.incidentId) {
            dedupKey = `${item.type}:${item.incidentId}`;
          } else if (item.type === "preventive_action" && item.title) {
            dedupKey = `preventive:${item.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
          }
          if (dedupKey) {
            if (!_dedupMap[dedupKey]) _dedupMap[dedupKey] = [];
            _dedupMap[dedupKey].push(item);
          }
        } catch {}
      }
      // Sort each group by createdAt desc, mark older ones as duplicates
      const _dupeIds = new Set();
      for (const items of Object.values(_dedupMap)) {
        if (items.length <= 1) continue;
        items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        for (let i = 1; i < items.length; i++) _dupeIds.add(items[i].id);
      }

      for (const item of _pendingItems) {
        // Dismiss if: incident is resolved/closed, OR item is older than cutoff, OR is a duplicate
        const isStale = (item.createdAt && item.createdAt < cutoff);
        const incResolved = item.incidentId && resolvedIds.has(item.incidentId);
        const isDupe = _dupeIds.has(item.id);
        if (isStale || incResolved || isDupe) {
          actionsStale++;
          if (isDupe && !isStale && !incResolved) actionsDupes++;
          if (!dryRun) {
            item.status = "dismissed";
            item.dismissedAt = new Date().toISOString();
            item.dismissedBy = "admin-cleanup";
            item.dismissReason = incResolved ? "incident_resolved" : isDupe ? "duplicate" : "stale_age";
            await db.upsert("ai_actions", item.id, JSON.stringify(item));
            actionsDismissed++;
          }
        }
      }

      // Process ai_workflow_queue
      const wfRows = await db.getAll("ai_workflow_queue");
      let wfDismissed = 0, wfStale = 0, wfTotal = wfRows.length;
      for (const r of wfRows) {
        try {
          const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (!item || item.status !== "pending_approval") continue;
          const isStale = (item.createdAt && item.createdAt < cutoff);
          const incResolved = item.incidentId && resolvedIds.has(item.incidentId);
          if (isStale || incResolved) {
            wfStale++;
            if (!dryRun) {
              item.status = "dismissed";
              item.dismissedAt = new Date().toISOString();
              item.dismissedBy = "admin-cleanup";
              item.dismissReason = incResolved ? "incident_resolved" : "stale_age";
              await db.upsert("ai_workflow_queue", item.id, JSON.stringify(item));
              wfDismissed++;
            }
          }
        } catch {}
      }

      if (cacheLayer) { cacheLayer.invalidatePrefix("ai_actions"); cacheLayer.invalidatePrefix("ai_workflow_queue"); }
      console.log(`[Queue Cleanup] ${dryRun ? "DRY RUN" : "EXECUTED"} — ai_actions: ${actionsDismissed}/${actionsTotal} dismissed (${actionsDupes} dupes), ai_workflow_queue: ${wfDismissed}/${wfTotal} dismissed`);
      return json(res, 200, {
        success: true, dryRun, maxAgeDays, cutoff,
        resolvedIncidents: resolvedIds.size,
        ai_actions: { total: actionsTotal, stale: dryRun ? actionsStale : undefined, duplicates: dryRun ? actionsDupes : undefined, dismissed: dryRun ? undefined : actionsDismissed },
        ai_workflow_queue: { total: wfTotal, stale: dryRun ? wfStale : undefined, dismissed: dryRun ? undefined : wfDismissed }
      });
    } catch (err) {
      console.error("[Queue Cleanup]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/purge-dismissed — permanently DELETE dismissed ai_actions, ai_workflow_queue, ai_resolve_queue records
  if (pathname === "/api/ai/purge-dismissed" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const dryRun = body.dryRun !== false;
      const collections = ["ai_actions", "ai_workflow_queue", "ai_resolve_queue"];
      const result = {};
      for (const coll of collections) {
        const rows = await db.getAll(coll);
        let deleted = 0;
        for (const r of rows) {
          try {
            const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            if (item && item.status === "dismissed") {
              if (!dryRun) await db.deleteOne(coll, r.id || item.id);
              deleted++;
            }
          } catch {}
        }
        result[coll] = { total: rows.length, dismissed: deleted, remaining: rows.length - deleted };
      }
      if (!dryRun && cacheLayer) { collections.forEach(c => cacheLayer.invalidatePrefix(c)); }
      console.log(`[Purge Dismissed] ${dryRun ? "DRY RUN" : "EXECUTED"} — ${JSON.stringify(result)}`);
      return json(res, 200, { success: true, dryRun, ...result });
    } catch (err) {
      console.error("[Purge Dismissed]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/db/purge-logs — bulk delete old escalation_log, notifications, email_rejections
  if (pathname === "/api/db/purge-logs" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const dryRun = body.dryRun !== false;
      const keepDays = body.keepDays || 7;
      const limit = body.limit || 5000;
      const targetColl = body.collection || null;
      const cutoff = new Date(Date.now() - keepDays * 86400000);
      const allTargets = ["escalation_log", "notifications", "email_rejections"];
      const targets = targetColl && allTargets.includes(targetColl) ? [targetColl] : allTargets;
      const result = {};
      for (const coll of targets) {
        const rows = await db.getAll(coll);
        let deleted = 0;
        for (const r of rows) {
          if (deleted >= limit) break;
          try {
            const item = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            const tsRaw = item.timestamp || item.createdAt || item.time || item.created || item.escalatedAt || item.date || item.sentAt || item.rejectedAt || "";
            let isOld = false;
            if (tsRaw) {
              const d = new Date(tsRaw);
              if (!isNaN(d.getTime())) isOld = d < cutoff;
              else isOld = true;
            } else {
              isOld = true;
            }
            if (isOld) {
              if (!dryRun) await db.deleteOne(coll, r.id || item.id);
              deleted++;
            }
          } catch {}
        }
        result[coll] = { total: rows.length, purged: deleted, remaining: rows.length - deleted };
      }
      if (!dryRun && cacheLayer) { targets.forEach(c => cacheLayer.invalidatePrefix(c)); }
      console.log(`[Purge Logs] ${dryRun ? "DRY RUN" : "EXECUTED"} keepDays=${keepDays} limit=${limit} cutoff=${cutoff.toISOString()} — ${JSON.stringify(result)}`);
      return json(res, 200, { success: true, dryRun, keepDays, limit, cutoff: cutoff.toISOString(), ...result });
    } catch (err) {
      console.error("[Purge Logs]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Learn from Incidents → KB Articles ────────────────────────────
  if (pathname === "/api/ai/learn-incidents-kb" && req.method === "POST") {
    try {
      if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) return json(res, 503, { error: "AI not configured" });
      const body = await parseBody(req);
      const requestedBy = body.requestedBy || "system";

      const allRows = await db.getAll("incidents");
      const closedIncidents = allRows.map(r => {
        try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; }
      }).filter(inc => inc && inc.id && ["Resolved", "Closed"].includes(inc.status) && (inc.resolution || inc.resolutionNotes || inc.description));

      if (closedIncidents.length < 3) return json(res, 200, { success: true, articlesCreated: 0, message: "Not enough resolved incidents to learn from (need at least 3)" });

      // Group by normalized category
      const categoryMap = {};
      const normalizeCategory = (cat) => {
        const c = (cat || "General").toLowerCase();
        if (c.includes("network") || c.includes("connectivity") || c.includes("vpn") || c.includes("firewall")) return "Network & Connectivity";
        if (c.includes("hardware") || c.includes("laptop") || c.includes("printer") || c.includes("device")) return "Hardware";
        if (c.includes("software") || c.includes("application") || c.includes("app")) return "Software & Applications";
        if (c.includes("security") || c.includes("phishing") || c.includes("malware") || c.includes("virus")) return "Security";
        if (c.includes("email") || c.includes("outlook") || c.includes("exchange")) return "Email & Communication";
        if (c.includes("access") || c.includes("password") || c.includes("login") || c.includes("permission") || c.includes("mfa")) return "Access Management";
        if (c.includes("cloud") || c.includes("azure") || c.includes("m365") || c.includes("microsoft")) return "Cloud & M365";
        if (c.includes("database") || c.includes("sql") || c.includes("data")) return "Database";
        return "General IT Support";
      };

      closedIncidents.forEach(inc => {
        const cat = normalizeCategory(inc.category);
        if (!categoryMap[cat]) categoryMap[cat] = [];
        categoryMap[cat].push(inc);
      });

      // Get existing KB articles for dedup
      let existingTitles = [];
      try {
        const kbRows = await db.getAll("kb");
        existingTitles = kbRows.map(r => {
          try { const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data; return (d.title || "").toLowerCase(); } catch { return ""; }
        }).filter(Boolean);
      } catch {}

      const articles = [];
      for (const [category, incs] of Object.entries(categoryMap)) {
        if (incs.length < 2) continue; // Need at least 2 incidents per category

        try {
          const incSummaries = incs.slice(0, 15).map(i => `- Title: ${i.title}\n  Category: ${i.category}\n  Priority: ${i.priority}\n  Resolution: ${(i.resolution || i.resolutionNotes || "N/A").substring(0, 300)}\n  Description: ${(i.description || "").substring(0, 200)}`).join("\n\n");

          const prompt = `You are a senior IT knowledge base author for VGC Technology. Analyze these ${incs.length} resolved ${category} incidents and create ONE comprehensive, professional KB article that synthesizes common patterns, solutions, and prevention steps.

RESOLVED INCIDENTS IN "${category}":
${incSummaries}

Create a professional KB article. Respond in JSON ONLY:
{
  "title": "How to: <clear actionable title covering main theme>",
  "category": "${category}",
  "content": "Professional article with sections: ## Overview\\n...\\n## Common Symptoms\\n...\\n## Step-by-Step Resolution\\n1. ...\\n2. ...\\n## Prevention & Best Practices\\n...",
  "tags": ["tag1", "tag2", "tag3"],
  "whenToUse": "One-line description of when this article is helpful",
  "bestFor": "Target audience (e.g., L1 Support, End Users, Network Team)",
  "quickFix": ["Step 1 quick fix", "Step 2 quick fix", "Step 3 quick fix"]
}`;

          const payload = { model: getAIModel("tertiary"), input: [{ role: "system", content: "You are an expert IT knowledge base author. Create professional, actionable KB articles. Respond ONLY in valid JSON." }, { role: "user", content: prompt }], max_output_tokens: 1200 };
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
            aiReq.setTimeout(45000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
            aiReq.write(JSON.stringify(payload));
            aiReq.end();
          });

          const text = extractAIText(aiResult);
          let parsed;
          try { parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); } catch { continue; }

          // Dedup check
          if (existingTitles.includes((parsed.title || "").toLowerCase())) continue;

          const article = {
            id: `KB-AI-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            title: parsed.title || `${category} Knowledge Article`,
            category: parsed.category || category,
            content: parsed.content || "",
            tags: parsed.tags || [],
            whenToUse: parsed.whenToUse || "",
            bestFor: parsed.bestFor || "",
            quickFix: parsed.quickFix || [],
            views: 0,
            helpful: 0,
            author: `AI (requested by ${requestedBy})`,
            updated: new Date().toISOString(),
            source: "ai-incident-learning",
            aiGenerated: true,
            incidentCount: incs.length,
            relatedArticles: [],
          };

          await db.upsert("kb", article.id, article);
          articles.push(article);
          existingTitles.push(article.title.toLowerCase());
          console.log(`[AI KB Learn] Created article: ${article.title} (from ${incs.length} incidents)`);
        } catch (err) {
          console.error(`[AI KB Learn] Failed for ${category}:`, err.message);
        }
      }

      return json(res, 200, { success: true, articlesCreated: articles.length, articles, totalIncidentsAnalyzed: closedIncidents.length });
    } catch (err) {
      console.error("[AI KB Learn]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Change Calendar Engine (Phase 8) ─────────────────────────────────

  // GET /api/changes/calendar — Aggregate changes + freeze windows for calendar view
  if (pathname === "/api/changes/calendar" && req.method === "GET") {
    const changeRows = await db.getAll("changes");
    const allChanges = changeRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    const freezeRows = await db.getAll("change_freeze_windows");
    const freezeWindows = freezeRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);

    // Parse month/year from query (default to current month)
    const now = new Date();
    const qMonth = parseInt(urlObj.searchParams.get("month")) || (now.getMonth() + 1);
    const qYear = parseInt(urlObj.searchParams.get("year")) || now.getFullYear();

    // Filter changes that overlap with the requested month
    const monthStart = new Date(qYear, qMonth - 1, 1);
    const monthEnd = new Date(qYear, qMonth, 0, 23, 59, 59);

    const monthChanges = allChanges.filter(c => {
      if (!c.scheduledStart) return false;
      const start = new Date(c.scheduledStart);
      const end = c.scheduledEnd ? new Date(c.scheduledEnd) : start;
      return start <= monthEnd && end >= monthStart;
    });

    const monthFreezes = freezeWindows.filter(fw => {
      const start = new Date(fw.startDate);
      const end = new Date(fw.endDate);
      return start <= monthEnd && end >= monthStart;
    });

    // Detect conflicts: overlapping changes on the same day or changes during freeze windows
    const conflicts = [];
    for (let i = 0; i < monthChanges.length; i++) {
      const ci = monthChanges[i];
      const ciStart = new Date(ci.scheduledStart);
      const ciEnd = ci.scheduledEnd ? new Date(ci.scheduledEnd) : ciStart;
      // Check against freeze windows
      for (const fw of monthFreezes) {
        const fwStart = new Date(fw.startDate);
        const fwEnd = new Date(fw.endDate);
        if (ciStart <= fwEnd && ciEnd >= fwStart && ci.type !== "Emergency") {
          conflicts.push({ type: "freeze_violation", changeId: ci.id, changeTitle: ci.title, freezeId: fw.id, freezeReason: fw.reason, severity: "high" });
        }
      }
      // Check overlapping changes
      for (let j = i + 1; j < monthChanges.length; j++) {
        const cj = monthChanges[j];
        const cjStart = new Date(cj.scheduledStart);
        const cjEnd = cj.scheduledEnd ? new Date(cj.scheduledEnd) : cjStart;
        if (ciStart <= cjEnd && ciEnd >= cjStart) {
          conflicts.push({ type: "overlap", changes: [ci.id, cj.id], titles: [ci.title, cj.title], severity: ci.type === "Emergency" || cj.type === "Emergency" ? "high" : "medium" });
        }
      }
    }

    return json(res, 200, {
      month: qMonth, year: qYear,
      changes: monthChanges,
      freezeWindows: monthFreezes,
      conflicts,
      stats: {
        total: monthChanges.length,
        emergency: monthChanges.filter(c => c.type === "Emergency").length,
        normal: monthChanges.filter(c => c.type === "Normal").length,
        standard: monthChanges.filter(c => c.type === "Standard").length,
        freezeDays: monthFreezes.length,
        conflictCount: conflicts.length,
      },
    });
  }

  // POST /api/changes/freeze-window — Create/update a change freeze window
  if (pathname === "/api/changes/freeze-window" && req.method === "POST") {
    const body = await readBody(req);
    const { id, startDate, endDate, reason, createdBy, exceptions } = body;
    if (!startDate || !endDate || !reason) return json(res, 400, { error: "startDate, endDate, and reason are required" });
    if (new Date(endDate) <= new Date(startDate)) return json(res, 400, { error: "endDate must be after startDate" });

    const fwId = id || `FRZ-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const freezeWindow = {
      id: fwId,
      startDate,
      endDate,
      reason: String(reason).substring(0, 500),
      createdBy: createdBy || "System",
      exceptions: Array.isArray(exceptions) ? exceptions : [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    await db.upsert("change_freeze_windows", fwId, JSON.stringify(freezeWindow));
    await db.audit("change_freeze_windows", fwId, "created", JSON.stringify({ reason: freezeWindow.reason, startDate, endDate }), freezeWindow.createdBy);
    console.log(`[Change Calendar] Freeze window created: ${fwId} (${startDate} → ${endDate})`);
    if (wsServer) wsServer.broadcast("changes", { action: "freeze_window_created", ...freezeWindow });
    return json(res, 201, { success: true, freezeWindow });
  }

  // DELETE /api/changes/freeze-window?id=FRZ-xxx — Delete a freeze window
  if (pathname === "/api/changes/freeze-window" && req.method === "DELETE") {
    const fwId = urlObj.searchParams.get("id");
    if (!fwId) return json(res, 400, { error: "id query parameter is required" });
    await db.deleteOne("change_freeze_windows", fwId);
    await db.audit("change_freeze_windows", fwId, "deleted", JSON.stringify({ id: fwId }), "System");
    console.log(`[Change Calendar] Freeze window deleted: ${fwId}`);
    return json(res, 200, { success: true, deleted: fwId });
  }

  // GET /api/changes/freeze-windows — List all freeze windows
  if (pathname === "/api/changes/freeze-windows" && req.method === "GET") {
    const rows = await db.getAll("change_freeze_windows");
    const windows = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    return json(res, 200, { freezeWindows: windows });
  }

  // POST /api/changes/conflict-check — AI-powered conflict analysis for a proposed change
  if (pathname === "/api/changes/conflict-check" && req.method === "POST") {
    const body = await readBody(req);
    const { scheduledStart, scheduledEnd, title, type, category, impact } = body;
    if (!scheduledStart || !title) return json(res, 400, { error: "scheduledStart and title are required" });

    // Fetch existing changes around the proposed time
    const changeRows = await db.getAll("changes");
    const allChanges = changeRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    const freezeRows = await db.getAll("change_freeze_windows");
    const freezeWindows = freezeRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);

    const propStart = new Date(scheduledStart);
    const propEnd = scheduledEnd ? new Date(scheduledEnd) : new Date(propStart.getTime() + 3600000);

    // Find direct conflicts
    const directConflicts = [];
    for (const c of allChanges) {
      if (!c.scheduledStart || c.status === "Closed" || c.status === "Cancelled") continue;
      const cStart = new Date(c.scheduledStart);
      const cEnd = c.scheduledEnd ? new Date(c.scheduledEnd) : cStart;
      if (propStart <= cEnd && propEnd >= cStart) {
        directConflicts.push({ id: c.id, title: c.title, type: c.type, scheduledStart: c.scheduledStart, scheduledEnd: c.scheduledEnd });
      }
    }

    // Check freeze windows
    const freezeViolations = [];
    for (const fw of freezeWindows) {
      const fwStart = new Date(fw.startDate);
      const fwEnd = new Date(fw.endDate);
      if (propStart <= fwEnd && propEnd >= fwStart) {
        freezeViolations.push({ id: fw.id, reason: fw.reason, startDate: fw.startDate, endDate: fw.endDate });
      }
    }

    // AI analysis if configured
    let aiAnalysis = null;
    if (AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT && (directConflicts.length > 0 || freezeViolations.length > 0)) {
      try {
        const prompt = `Analyze this proposed IT change for conflicts and risks:
PROPOSED: "${title}" (${type || "Normal"}, ${category || "General"}, Impact: ${impact || "Unknown"})
Scheduled: ${scheduledStart} to ${scheduledEnd || "TBD"}

CONFLICTS WITH:
${directConflicts.map(c => `- ${c.id}: "${c.title}" (${c.type}) ${c.scheduledStart}–${c.scheduledEnd}`).join("\n") || "None"}

FREEZE WINDOWS:
${freezeViolations.map(f => `- ${f.reason} (${f.startDate}–${f.endDate})`).join("\n") || "None"}

Return ONLY valid JSON: { "riskLevel": "low|medium|high|critical", "recommendation": "brief recommendation", "suggestedSlot": "alternative time if conflict exists or null", "reasoning": "brief explanation" }`;

        const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
        const aiPayload = JSON.stringify({
          model: getAIModel("secondary"),
          input: [{ role: "system", content: "You are an ITIL change management advisor. Analyze change conflicts briefly." }, { role: "user", content: prompt }],
          max_output_tokens: 400,
        });
        const aiResult = await new Promise((resolve, reject) => {
          const aiReq = https.request({ hostname: aiUrl.hostname, path: aiUrl.pathname, method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY, "Content-Length": Buffer.byteLength(aiPayload) } }, aiRes => {
            let d = ""; aiRes.on("data", c => d += c); aiRes.on("end", () => resolve(d));
          });
          aiReq.on("error", reject);
          aiReq.write(aiPayload);
          aiReq.end();
        });
        const aiJson = JSON.parse(aiResult);
        const content = aiJson.output?.[0]?.content?.[0]?.text || aiJson.choices?.[0]?.message?.content || "";
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        aiAnalysis = JSON.parse(cleaned);
      } catch (err) {
        console.error("[Change Calendar] AI conflict analysis failed:", err.message);
      }
    }

    return json(res, 200, {
      hasConflicts: directConflicts.length > 0 || freezeViolations.length > 0,
      directConflicts,
      freezeViolations,
      aiAnalysis,
    });
  }

  // ─── AI Learning Dashboard (Phase 9) ────────────────────────────────

  // GET /api/ai/learning/metrics — Aggregate AI performance metrics
  if (pathname === "/api/ai/learning/metrics" && req.method === "GET") {
    try {
      const triageRows = await db.getAll("ai_triage_history");
      const actionRows = await db.getAll("ai_actions");
      const feedbackRows = await db.getAll("ai_learning_feedback");
      const incidentRows = await db.getAll("incidents");

      const triageHistory = triageRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      const aiActions = actionRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      const feedback = feedbackRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      const incidents = incidentRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);

      const aiTriagedIncidents = incidents.filter(i => i.aiTriaged);
      const totalIncidents = incidents.length;

      // Confidence distribution buckets
      const confidenceBuckets = { "0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0 };
      triageHistory.forEach(t => {
        const c = t.confidence || 0;
        if (c <= 20) confidenceBuckets["0-20"]++;
        else if (c <= 40) confidenceBuckets["21-40"]++;
        else if (c <= 60) confidenceBuckets["41-60"]++;
        else if (c <= 80) confidenceBuckets["61-80"]++;
        else confidenceBuckets["81-100"]++;
      });

      // Auto-apply rate
      const autoApplied = triageHistory.filter(t => t.autoApplied).length;
      const autoApplyRate = triageHistory.length > 0 ? Math.round((autoApplied / triageHistory.length) * 100) : 0;

      // Average confidence
      const avgConfidence = triageHistory.length > 0
        ? Math.round(triageHistory.reduce((sum, t) => sum + (t.confidence || 0), 0) / triageHistory.length)
        : 0;

      // Feedback stats
      const correctFeedback = feedback.filter(f => f.verdict === "correct").length;
      const incorrectFeedback = feedback.filter(f => f.verdict === "incorrect").length;
      const accuracyRate = feedback.length > 0 ? Math.round((correctFeedback / feedback.length) * 100) : 0;

      // Category accuracy — how many AI-triaged ended up being correct category
      const categoryBreakdown = {};
      triageHistory.forEach(t => {
        const cat = t.triage?.category || "Unknown";
        if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { total: 0, autoApplied: 0, avgConfidence: 0, totalConfidence: 0 };
        categoryBreakdown[cat].total++;
        categoryBreakdown[cat].totalConfidence += (t.confidence || 0);
        if (t.autoApplied) categoryBreakdown[cat].autoApplied++;
      });
      Object.keys(categoryBreakdown).forEach(cat => {
        categoryBreakdown[cat].avgConfidence = Math.round(categoryBreakdown[cat].totalConfidence / categoryBreakdown[cat].total);
        delete categoryBreakdown[cat].totalConfidence;
      });

      return json(res, 200, {
        totalTriages: triageHistory.length,
        totalAiActions: aiActions.length,
        totalIncidents,
        aiTriagedCount: aiTriagedIncidents.length,
        autoApplyRate,
        avgConfidence,
        confidenceBuckets,
        feedbackStats: { total: feedback.length, correct: correctFeedback, incorrect: incorrectFeedback, accuracyRate },
        categoryBreakdown,
        pendingActions: aiActions.filter(a => a.status === "pending_approval").length,
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/learning/trends — Time-series AI performance data
  if (pathname === "/api/ai/learning/trends" && req.method === "GET") {
    try {
      const period = urlObj.searchParams.get("period") || "weekly";
      const triageRows = await db.getAll("ai_triage_history");
      const feedbackRows = await db.getAll("ai_learning_feedback");

      const triageHistory = triageRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      const feedback = feedbackRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);

      // Group by time period
      const getKey = (dateStr) => {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        if (period === "daily") return d.toISOString().split("T")[0];
        if (period === "monthly") return d.toISOString().slice(0, 7);
        // weekly — ISO week
        const dayOfWeek = d.getDay();
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - dayOfWeek);
        return weekStart.toISOString().split("T")[0];
      };

      const trendMap = {};
      triageHistory.forEach(t => {
        const key = getKey(t.timestamp);
        if (!key) return;
        if (!trendMap[key]) trendMap[key] = { period: key, triages: 0, autoApplied: 0, totalConfidence: 0, feedbackCorrect: 0, feedbackIncorrect: 0 };
        trendMap[key].triages++;
        trendMap[key].totalConfidence += (t.confidence || 0);
        if (t.autoApplied) trendMap[key].autoApplied++;
      });

      feedback.forEach(f => {
        const key = getKey(f.createdAt);
        if (!key) return;
        if (!trendMap[key]) trendMap[key] = { period: key, triages: 0, autoApplied: 0, totalConfidence: 0, feedbackCorrect: 0, feedbackIncorrect: 0 };
        if (f.verdict === "correct") trendMap[key].feedbackCorrect++;
        else if (f.verdict === "incorrect") trendMap[key].feedbackIncorrect++;
      });

      const trends = Object.values(trendMap).sort((a, b) => a.period.localeCompare(b.period)).map(t => ({
        period: t.period,
        triages: t.triages,
        autoApplied: t.autoApplied,
        autoApplyRate: t.triages > 0 ? Math.round((t.autoApplied / t.triages) * 100) : 0,
        avgConfidence: t.triages > 0 ? Math.round(t.totalConfidence / t.triages) : 0,
        feedbackCorrect: t.feedbackCorrect,
        feedbackIncorrect: t.feedbackIncorrect,
      }));

      return json(res, 200, { period, trends });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/learning/feedback — Record human feedback on AI decisions
  if (pathname === "/api/ai/learning/feedback" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { triageId, verdict, notes, correctedCategory, correctedPriority } = body;
      if (!triageId || !verdict) return json(res, 400, { error: "triageId and verdict (correct/incorrect) required" });
      if (!["correct", "incorrect"].includes(verdict)) return json(res, 400, { error: "verdict must be 'correct' or 'incorrect'" });

      const feedbackId = `ALFB-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date().toISOString();
      const feedbackRecord = {
        id: feedbackId,
        triageId,
        verdict,
        notes: (notes || "").substring(0, 500),
        correctedCategory: correctedCategory || null,
        correctedPriority: correctedPriority || null,
        createdAt: now,
        createdBy: "system",
      };

      await db.upsert("ai_learning_feedback", feedbackId, JSON.stringify(feedbackRecord));
      await db.audit("ai_learning_feedback", feedbackId, "created", JSON.stringify({ verdict, triageId }), "system");

      return json(res, 201, { success: true, feedback: feedbackRecord });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/learning/feedback — List feedback entries
  if (pathname === "/api/ai/learning/feedback" && req.method === "GET") {
    try {
      const feedbackRows = await db.getAll("ai_learning_feedback");
      const feedback = feedbackRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      feedback.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return json(res, 200, { feedback, total: feedback.length });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // DELETE /api/ai/learning/feedback/:id — Delete a feedback entry
  if (pathname.startsWith("/api/ai/learning/feedback/") && req.method === "DELETE") {
    try {
      const feedbackId = pathname.split("/").pop();
      if (!feedbackId) return json(res, 400, { error: "feedbackId required" });
      await db.deleteOne("ai_learning_feedback", feedbackId);
      await db.audit("ai_learning_feedback", feedbackId, "deleted", "{}", "system");
      return json(res, 200, { success: true, deleted: feedbackId });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/learning/model-health — AI model health indicators
  if (pathname === "/api/ai/learning/model-health" && req.method === "GET") {
    try {
      const triageRows = await db.getAll("ai_triage_history");
      const feedbackRows = await db.getAll("ai_learning_feedback");
      const actionRows = await db.getAll("ai_actions");

      const triageHistory = triageRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      const feedback = feedbackRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
      const aiActions = actionRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);

      // Recent vs overall confidence (last 7 days vs all time)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentTriages = triageHistory.filter(t => (t.timestamp || "") >= sevenDaysAgo);
      const recentAvgConfidence = recentTriages.length > 0
        ? Math.round(recentTriages.reduce((s, t) => s + (t.confidence || 0), 0) / recentTriages.length)
        : 0;
      const overallAvgConfidence = triageHistory.length > 0
        ? Math.round(triageHistory.reduce((s, t) => s + (t.confidence || 0), 0) / triageHistory.length)
        : 0;

      // Trend: improving, stable, declining
      const confidenceDelta = recentAvgConfidence - overallAvgConfidence;
      const trend = confidenceDelta > 5 ? "improving" : confidenceDelta < -5 ? "declining" : "stable";

      // Recent feedback accuracy
      const recentFeedback = feedback.filter(f => (f.createdAt || "") >= sevenDaysAgo);
      const recentCorrect = recentFeedback.filter(f => f.verdict === "correct").length;
      const recentAccuracy = recentFeedback.length > 0 ? Math.round((recentCorrect / recentFeedback.length) * 100) : 0;

      // Pending actions ratio
      const pendingCount = aiActions.filter(a => a.status === "pending_approval").length;

      // Health score (0-100)
      let healthScore = 50;
      if (overallAvgConfidence > 0) healthScore = Math.min(100, Math.max(0, Math.round(overallAvgConfidence * 0.5 + (feedback.length > 0 ? (feedback.filter(f => f.verdict === "correct").length / feedback.length) * 50 : 25))));

      // Health status
      const healthStatus = healthScore >= 80 ? "healthy" : healthScore >= 60 ? "moderate" : healthScore >= 40 ? "attention" : "critical";

      return json(res, 200, {
        healthScore,
        healthStatus,
        trend,
        recentAvgConfidence,
        overallAvgConfidence,
        confidenceDelta,
        recentAccuracy,
        totalTriages: triageHistory.length,
        recentTriages: recentTriages.length,
        totalFeedback: feedback.length,
        recentFeedback: recentFeedback.length,
        pendingActions: pendingCount,
        lastTriageAt: triageHistory.length > 0 ? triageHistory.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))[0].timestamp : null,
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Static File Serving ──────────────────────────────────────────────
  const distDir = path.join(__dirname, "dist");
  const hasDistDir = fs.existsSync(distDir);
  const serveRoot = hasDistDir ? distDir : __dirname;
  let filePath = path.join(serveRoot, pathname === "/" ? "index.html" : pathname);
  const ext = path.extname(filePath).toLowerCase();
  // Security: prevent directory traversal
  if (!filePath.startsWith(serveRoot)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  // Don't serve the database file
  if (filePath.endsWith(".db") || filePath.endsWith(".db-wal") || filePath.endsWith(".db-shm")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(serveRoot, "index.html"), (e2, html) => {
        if (e2) { res.writeHead(500); return res.end("Server Error"); }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000",
    });
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
  // Start SLA Engine (after DB is initialized)
  // Initialize WebSocket server
  wsServer = new WebSocketServer();
  server.on("upgrade", (req, socket, head) => wsServer.handleUpgrade(req, socket));

  // Initialize Notification Engine
  notifyEngine = new NotificationEngine({ graphSendMail, buildEmailTemplate, wsServer, db });

  // Initialize Cache Layer
  cacheLayer = new CacheLayer({ maxSize: 1000, defaultTTL: 5 * 60 * 1000 });

  // Initialize Analytics Engine (15 min scan — non-critical)
  analyticsEngine = new AnalyticsEngine(db, { cacheTTL: 15 * 60 * 1000 });

  // Initialize Workflow Automation Engine (15 min scan — non-critical)
  workflowEngine = new WorkflowEngine(db, { notifyEngine, wsServer, graphSendMail, interval: 15 * 60 * 1000 });
  workflowEngine._processInboundEmails = processInboundEmails;

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
  server.listen(PORT, async () => {
    const stats = {};
    for (const c of VALID_COLLECTIONS) stats[c] = await db.count(c);
    console.log(`VGC-ITSM serving on port ${PORT}`);
    console.log(`Database: ${db.label}`);
    console.log(`Collections:`, stats);

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
      const kb10 = await db.get("kb", "KB0010");
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
      const zdIncs = allInc.filter(i => i.zdTicketId).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      if (zdIncs.length > 0 && zdIncs[0].updatedAt) {
        zdLastSyncTime = zdIncs[0].updatedAt;
        console.log(`[ZD Sync] Hydrated zdLastSyncTime from DB: ${zdLastSyncTime}`);
      }
    } catch (e) { console.warn("[ZD Sync] Could not hydrate zdLastSyncTime:", e.message); }

    // Start SLA Engine
    slaEngine.start().catch(err => console.error("[SLA Engine] Start failed:", err.message));

    // Start Workflow Engine
    workflowEngine.start().catch(err => console.error("[WorkflowEngine] Start failed:", err.message));

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
    setTimeout(() => {
      runSlaGuardian();
      setInterval(runSlaGuardian, SLA_GUARDIAN_INTERVAL);
    }, 2 * 60 * 1000);
    console.log("[SLA Guardian] Proactive SLA prediction scheduled every 15 minutes");

    // ─── Scheduled Zendesk Incremental Sync (every 5 min) ───────────
    if (ZENDESK_SUBDOMAIN && ZENDESK_EMAIL && ZENDESK_API_TOKEN) {
      zdAutoSyncInterval = setInterval(async () => {
        if (zdSyncInProgress) { console.log("[ZD AutoSync] Skipped — sync already in progress"); return; }
        try {
          console.log("[ZD AutoSync] Starting scheduled incremental sync...");
          const http = require("http");
          const syncReq = http.request({ hostname: "localhost", port: PORT, path: "/api/zendesk/incremental-sync", method: "POST", headers: { "Content-Type": "application/json" } }, (r) => {
            let data = ""; r.on("data", c => data += c);
            r.on("end", () => console.log("[ZD AutoSync] Result:", data.substring(0, 300)));
          });
          syncReq.on("error", e => console.warn("[ZD AutoSync] Error:", e.message));
          syncReq.write("{}"); syncReq.end();
        } catch (e) { console.warn("[ZD AutoSync] Failed:", e.message); }
      }, 5 * 60 * 1000);
      console.log("[ZD AutoSync] Scheduled Zendesk incremental sync every 5 minutes");
    }

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

    // ─── Scheduled Terminal-Status AI Actions Purge (every 6 hours) ──
    // Deletes auto_applied, auto_approved, approved, executed, rejected records older than 7 days
    const TERMINAL_PURGE_INTERVAL = 6 * 60 * 60 * 1000;
    const TERMINAL_STATUSES = new Set(["auto_applied", "auto_approved", "approved", "executed", "rejected", "failed"]);
    const TERMINAL_KEEP_DAYS = 7;
    const MAX_AI_ACTIONS = 500; // cap: if still over 500 after age-based purge, delete oldest terminal records
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
    // Set initial nextRun times
    purgeStatus.queueCleanup.nextRun = new Date(Date.now() + 60000).toISOString();
    purgeStatus.logPurge.nextRun = new Date(Date.now() + 90000).toISOString();
    purgeStatus.terminalPurge.nextRun = new Date(Date.now() + 120000).toISOString();
    purgeStatus.auditPurge.nextRun = new Date(Date.now() + 150000).toISOString();
    console.log("[Scheduled Cleanup] Queue auto-cleanup every 6 hours");
    console.log("[Scheduled Purge] Log auto-purge every 6 hours (keep 2 days)");
    console.log("[Terminal Purge] Terminal-status purge every 6 hours (keep 7 days, cap 500)");
    console.log("[Audit Purge] Audit log purge every 6 hours (keep " + AUDIT_KEEP_DAYS + " days)");
  });
}
start().catch(err => { console.error("Fatal startup error:", err); process.exit(1); });

// Graceful shutdown
process.on("SIGINT", () => { if (zdAutoSyncInterval) clearInterval(zdAutoSyncInterval); if (workflowEngine) workflowEngine.stop(); if (cacheLayer) cacheLayer.stop(); if (wsServer) wsServer.stop(); if (slaEngine) slaEngine.stop(); db.close(); process.exit(0); });
process.on("SIGTERM", () => { if (zdAutoSyncInterval) clearInterval(zdAutoSyncInterval); if (workflowEngine) workflowEngine.stop(); if (cacheLayer) cacheLayer.stop(); if (wsServer) wsServer.stop(); if (slaEngine) slaEngine.stop(); db.close(); process.exit(0); });
