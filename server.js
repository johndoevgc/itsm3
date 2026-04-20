const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
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

// Azure OpenAI config (server-side only — avoids CORS and protects API key)
// Primary: gpt-5.4-pro (East US 2) — Responses API (supports streaming)
let AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || "https://hlain-mo2f4i57-eastus2.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview";
let AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY || "BCGYlxp4toZd7q4vflLPIR0Hqa6FZJo1DP4vk0JolcjSmY3TgCvNJQQJ99CDACHYHv6XJ3w3AAAAACOGjzsj";
let AZURE_OPENAI_MODEL = process.env.AZURE_OPENAI_MODEL || "gpt-5.4-nano";

// Zendesk API config (server-side only — protects API token)
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || "";
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL || "";
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN || "";

// Cisco Meraki Dashboard API (server-side only)
const MERAKI_API_KEYS = (process.env.MERAKI_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);

// SolarWinds RMM / N-able API (server-side only)
let SOLARWINDS_API_KEY = process.env.SOLARWINDS_API_KEY || "";
let SOLARWINDS_API_HOST = process.env.SOLARWINDS_API_HOST || "www.systemmonitor.us";

// Sophos Central Firewall API (server-side only)
const SOPHOS_CLIENT_ID = process.env.SOPHOS_CLIENT_ID || "";
const SOPHOS_CLIENT_SECRET = process.env.SOPHOS_CLIENT_SECRET || "";

// M365 Mail sending via Managed Identity
const MAIL_FROM = process.env.MAIL_FROM || "itsupport@vgctechnology.com";

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

// Valid collection names (whitelist to prevent injection)
const VALID_COLLECTIONS = new Set([
  "incidents", "problems", "changes", "requests",
  "assets", "kb", "services", "users", "vendors",
  "workflow_rules", "survey_templates", "smart_tasks",
  "integrations", "escalation_log", "escalation_config",
  "customers", "service_reports",
  "zendesk_tickets", "zendesk_users", "zendesk_orgs",
  "zendesk_sync_state", "zendesk_comments",
]);

// ─── Zendesk Sync State ──────────────────────────────────────────────
let zdSyncInProgress = false;
let zdLastSyncTime = null;
let zdSyncStats = { tickets: 0, users: 0, orgs: 0, comments: 0, errors: 0 };

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

// Server-side Graph API call using client credentials (app-only) — fallback
function graphAppCall(endpoint) {
  return new Promise((resolve, reject) => {
    if (!ENTRA_CLIENT_SECRET) return reject(new Error("No client secret configured"));
    const tokenBody = `client_id=${encodeURIComponent(ENTRA_CLIENT_ID)}&scope=${encodeURIComponent("https://graph.microsoft.com/.default")}&client_secret=${encodeURIComponent(ENTRA_CLIENT_SECRET)}&grant_type=client_credentials`;
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

// Send email via Microsoft Graph API using Managed Identity
function graphSendMail({ to, subject, body, from }) {
  return new Promise(async (resolve, reject) => {
    try {
      const token = await getManagedIdentityToken();
      const sender = from || MAIL_FROM;
      const mailPayload = JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: body },
          toRecipients: (Array.isArray(to) ? to : [to]).map(addr => ({ emailAddress: { address: addr } })),
          from: { emailAddress: { address: sender } },
        },
        saveToSentItems: true,
      });
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
    } catch (err) { reject(err); }
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

  // ─── REST API: /api/db/:collection ─────────────────────────────────
  const dbMatch = pathname.match(/^\/api\/db\/([a-z_]+)(?:\/([^/]+))?$/);
  if (dbMatch) {
    const collection = dbMatch[1];
    const recordId = dbMatch[2] ? decodeURIComponent(dbMatch[2]) : null;

    if (!VALID_COLLECTIONS.has(collection)) {
      return json(res, 400, { error: "Invalid collection name" });
    }

    try {
      // GET /api/db/:collection — list all
      if (req.method === "GET" && !recordId) {
        const rows = await db.getAll(collection);
        const items = rows.map(r => JSON.parse(r.data));
        return json(res, 200, { collection, count: items.length, data: items });
      }

      // GET /api/db/:collection/:id — get one
      if (req.method === "GET" && recordId) {
        const row = await db.getOne(collection, recordId);
        if (!row) return json(res, 404, { error: "Not found" });
        return json(res, 200, JSON.parse(row.data));
      }

      // POST /api/db/:collection — create or bulk upsert
      if (req.method === "POST") {
        const body = await readBody(req);
        if (Array.isArray(body)) {
          await db.bulkUpsert(collection, body);
          await db.audit(collection, "*", "bulk_upsert", JSON.stringify({ count: body.length }), "system");
          return json(res, 200, { ok: true, collection, upserted: body.length });
        } else {
          const id = body.id || recordId || String(Date.now());
          body.id = id;
          await db.upsert(collection, id, JSON.stringify(body));
          await db.audit(collection, id, "upsert", JSON.stringify(body), body._user || "system");
          return json(res, 200, { ok: true, id });
        }
      }

      // PUT /api/db/:collection/:id — update one
      if (req.method === "PUT" && recordId) {
        const body = await readBody(req);
        body.id = recordId;
        await db.upsert(collection, recordId, JSON.stringify(body));
        await db.audit(collection, recordId, "update", JSON.stringify(body), body._user || "system");
        return json(res, 200, { ok: true, id: recordId });
      }

      // DELETE /api/db/:collection/:id — delete one
      if (req.method === "DELETE" && recordId) {
        await db.deleteOne(collection, recordId);
        await db.audit(collection, recordId, "delete", null, "system");
        return json(res, 200, { ok: true, deleted: recordId });
      }

      return json(res, 405, { error: "Method not allowed" });
    } catch (err) {
      console.error(`DB API error [${collection}]:`, err.message);
      return json(res, 500, { error: err.message });
    }
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
        // Fetch requester info for ITSM incident mapping
        let requester = null;
        if (ticket.ticket?.requester_id) {
          try {
            const reqData = await zdRequest("GET", `/users/${ticket.ticket.requester_id}.json`);
            requester = reqData?.user || null;
          } catch {}
        }

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
10. sla_priority — Sev-A (Critical, 4hr), Sev-B (High, 4hr), Sev-C (Medium, 9hr), Sev-D (Low, 27hr)

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

        const payload = { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

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

        return json(res, 200, { triage: parsed, ticket: ticket.ticket, requester: requester ? { name: requester.name, email: requester.email, phone: requester.phone, organization_id: requester.organization_id } : null });
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
              await graphSendMail({ to: requesterEmail, subject: `Re: ${ticketSubject} [#${ticketId}]`, body: htmlBody });
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
        const body = await parseBody(req);
        const { zdTicketId, action, status, priority, comment, assignee, isInternal } = body;
        if (!zdTicketId) return json(res, 400, { error: "zdTicketId required" });

        const priorityMap = { "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" };
        const statusMap = { "New": "new", "Open": "open", "In Progress": "open", "Pending": "pending", "On Hold": "hold", "Resolved": "solved", "Closed": "closed", "Reopened": "open" };
        const ticketUpdate = { ticket: {} };

        if (status) ticketUpdate.ticket.status = statusMap[status] || status;
        if (priority) ticketUpdate.ticket.priority = priorityMap[priority] || priority;
        if (comment) {
          ticketUpdate.ticket.comment = { body: `[ITSM Sync] ${comment}`, public: isInternal === false };
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
                  channel: t.via?.channel || "unknown", source: t.via?.source || {},
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

                // Auto-create ITSM incidents from tickets
                if (createIncidents) {
                  const existing = await db.getOne("incidents", `ZD-${t.id}`);
                  if (!existing) {
                    const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                    const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
                    const slaMap = { "Sev-A": 4, "Sev-B": 4, "Sev-C": 9, "Sev-D": 27 };
                    const itsmPriority = priorityMap[t.priority] || "Sev-C";
                    const incident = {
                      id: `INC-ZD${t.id}`, title: t.subject || "Untitled",
                      description: t.description || "", category: (t.tags || [])[0] || "General",
                      subcategory: "", priority: itsmPriority,
                      status: statusMap[t.status] || "New",
                      urgency: t.priority === "urgent" ? "Critical" : "Standard",
                      impact: t.priority === "urgent" ? "Enterprise" : "Individual",
                      assignee: "Unassigned", assignmentGroup: "Service Desk",
                      reporter: "Zendesk Import", reporterEmail: "",
                      customer: "", contactMethod: "Zendesk",
                      created: Math.max(0, Math.round((Date.now() - new Date(t.created_at).getTime()) / 3600000)),
                      slaTarget: slaMap[itsmPriority] || 9,
                      aiTriaged: false, aiConfidence: 0, zdTicketId: t.id,
                      zdLastSync: new Date().toISOString(),
                      workaround: "", linkedProblem: "", affectedAssets: [],
                      activityLog: [{ id: `AL-ZD${t.id}`, type: "sync", user: "Zendesk Import", time: new Date().toISOString(), detail: `Historical import from Zendesk #${t.id} (${t.status})` }],
                    };
                    await db.upsert("incidents", incident.id, JSON.stringify(incident));
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

                // Sync status/priority back to ITSM incidents if linked
                const itsmRows = await db.getAll("incidents");
                for (const row of itsmRows) {
                  try {
                    const inc = JSON.parse(row.data);
                    if (inc.zdTicketId === t.id) {
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
                  } catch {}
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

              // Sync to ITSM incidents if linked
              const incRows = await db.getAll("incidents");
              for (const row of incRows) {
                try {
                  const inc = JSON.parse(row.data);
                  if (inc.zdTicketId === t.id) {
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
                    break;
                  }
                } catch {}
              }

              // If new ticket and no ITSM incident exists, auto-create one
              if (eventType === "ticket_created" || eventType === "zen:event-type:ticket.created") {
                let hasIncident = false;
                const allInc = await db.getAll("incidents");
                for (const row of allInc) {
                  try { if (JSON.parse(row.data).zdTicketId === t.id) { hasIncident = true; break; } } catch {}
                }
                if (!hasIncident) {
                  const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                  const slaMap = { "Sev-A": 4, "Sev-B": 4, "Sev-C": 9, "Sev-D": 27 };
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
      // PUSH ITSM → ZENDESK — Sync ITSM incident changes to Zendesk
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/push-to-zendesk" && req.method === "POST") {
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
          let synced = 0; let created = 0;
          for (const row of orgRows) {
            const org = JSON.parse(row.data);
            const existingCustomers = await db.getAll("customers");
            let found = false;
            for (const cRow of existingCustomers) {
              const c = JSON.parse(cRow.data);
              if (c.zdOrgId === org.id || c.name?.toLowerCase() === org.name?.toLowerCase()) {
                c.zdOrgId = org.id;
                c.zdDomains = org.domains || [];
                c.zdTags = org.tags || [];
                c.zdLastSync = new Date().toISOString();
                await db.upsert("customers", c.id, JSON.stringify(c));
                found = true; synced++; break;
              }
            }
            if (!found) {
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
          const rows = await db.getAll("zendesk_tickets");
          let tickets = rows.map(r => JSON.parse(r.data));
          if (status) tickets = tickets.filter(t => t.status === status);
          return json(res, 200, { tickets: tickets.slice(0, limit), total: tickets.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      if (pathname === "/api/zendesk/stored/users" && req.method === "GET") {
        try {
          const rows = await db.getAll("zendesk_users");
          const users = rows.map(r => JSON.parse(r.data));
          return json(res, 200, { users, total: users.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      if (pathname === "/api/zendesk/stored/orgs" && req.method === "GET") {
        try {
          const rows = await db.getAll("zendesk_orgs");
          const orgs = rows.map(r => JSON.parse(r.data));
          return json(res, 200, { orgs, total: orgs.length });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      if (pathname.match(/^\/api\/zendesk\/stored\/tickets\/\d+\/comments$/) && req.method === "GET") {
        const ticketId = pathname.split("/")[5];
        try {
          const rows = await db.getAll("zendesk_comments");
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

          for (const t of resolved.slice(0, 200)) {
            // Get comments for this ticket
            const commentRows = await db.getAll("zendesk_comments");
            const ticketComments = commentRows.map(r => JSON.parse(r.data)).filter(c => c.ticketId === t.id);
            const publicComments = ticketComments.filter(c => c.public);
            if (publicComments.length === 0) continue;

            const resolution = publicComments[publicComments.length - 1]?.body || "";
            if (resolution.length < 20) continue;

            const kbId = `kb_zd_${t.id}`;
            const existing = await db.getOne("ai_knowledge", kbId);
            if (existing) continue;

            const entry = {
              id: kbId, title: t.subject || `Zendesk #${t.id}`,
              category: (t.tags || [])[0] || "General",
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
        const haystack = `${e.title} ${e.content} ${e.category} ${(e.tags || []).join(" ")}`.toLowerCase();
        words.forEach(w => { if (haystack.includes(w)) score += 10; });
        if (e.title.toLowerCase().includes(query)) score += 50;
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

      const payload = { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 4000 };

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

      const payload = { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

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
      return json(res, 200, { resolution: text, model: AZURE_OPENAI_MODEL });
    } catch (err) {
      console.error("[AI Error Resolver]", err.message);
      return json(res, 502, { error: err.message });
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

      const payload = { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 4000 };

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

      const payload = { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

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
      return json(res, 200, { resolution: text, model: AZURE_OPENAI_MODEL });
    } catch (err) {
      console.error("[AI Error Resolver]", err.message);
      return json(res, 502, { error: err.message });
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

      const payload = { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: enrichedSystemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 800 };

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
      return json(res, 200, { text, model: AZURE_OPENAI_MODEL });
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
        model: AZURE_OPENAI_MODEL,
        input: [
          { role: "system", content: enrichedSystemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_output_tokens: 800,
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
              res.write(`data: ${JSON.stringify({ done: true, model: AZURE_OPENAI_MODEL })}\n\n`);
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
                res.write(`data: ${JSON.stringify({ done: true, model: AZURE_OPENAI_MODEL })}\n\n`);
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
            res.write(`data: ${JSON.stringify({ done: true, model: AZURE_OPENAI_MODEL })}\n\n`);
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
      const payload = { model: AZURE_OPENAI_MODEL, input: [{ role: "user", content: "Reply with exactly: OK" }], max_output_tokens: 16 };
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
      return json(res, 200, { status: "connected", model: AZURE_OPENAI_MODEL, response: text.trim(), configured: true });
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
    const host = (apiHost || "www.systemmonitor.us").replace(/^(https?:\/\/)/, "");
    const hostFull = host.startsWith("www.") ? host : `www.${host}`;
    const testUrl = `https://${hostFull}/api/?apikey=${encodeURIComponent(apiKey)}&service=list_clients`;
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
    return json(res, 200, { ok: true, model: AZURE_OPENAI_MODEL, message: "Azure OpenAI settings updated. Changes are active until next app restart. Update Azure App Settings for persistence." });
  }

  // ─── Azure OpenAI — Get Current Config: GET /api/settings/openai ────
  if (pathname === "/api/settings/openai" && req.method === "GET") {
    return json(res, 200, {
      model: AZURE_OPENAI_MODEL,
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
    SOLARWINDS_API_HOST = (apiHost || "www.systemmonitor.us").replace(/^(https?:\/\/)/, "");
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
      const host = SOLARWINDS_API_HOST.startsWith("www.") ? SOLARWINDS_API_HOST : `www.${SOLARWINDS_API_HOST}`;
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

  // Health check
  if (pathname === "/api/health") {
    let dbOk = false;
    try { dbOk = await db.ping(); } catch {}
    return json(res, 200, {
      status: "ok",
      database: dbOk ? "connected" : "error",
      dbType: db.type,
      dbLabel: db.label,
      entraConfigured: !!ENTRA_CLIENT_SECRET,
      zendeskConfigured: !!(ZENDESK_SUBDOMAIN && ZENDESK_EMAIL && ZENDESK_API_TOKEN),
      aiConfigured: !!(AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT),
      aiModel: AZURE_OPENAI_MODEL,
      merakiConfigured: MERAKI_API_KEYS.length > 0,
      solarwindsConfigured: !!SOLARWINDS_API_KEY,
      sophosConfigured: !!(SOPHOS_CLIENT_ID && SOPHOS_CLIENT_SECRET),
      mailConfigured: !!(process.env.IDENTITY_ENDPOINT),
      mailFrom: MAIL_FROM,
      timestamp: new Date().toISOString(),
    });
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
async function start() {
  await initDatabase();
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
    // Run initial sync 30s after startup, then every 24 hours
    setTimeout(runDailySync, 30000);
    setInterval(runDailySync, 24 * 60 * 60 * 1000);
  });
}
start().catch(err => { console.error("Fatal startup error:", err); process.exit(1); });

// Graceful shutdown
process.on("SIGINT", () => { db.close(); process.exit(0); });
process.on("SIGTERM", () => { db.close(); process.exit(0); });
