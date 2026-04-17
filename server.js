const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const USE_MSSQL = !!(process.env.AZURE_SQL_SERVER || process.env.MSSQL_HOST);
const USE_MYSQL = !USE_MSSQL && !!(process.env.MYSQL_HOST);

// Microsoft Entra ID config (client secret via env var only — NEVER in frontend)
const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID || "";
const ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID || "";
const ENTRA_CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET || "";

// Azure OpenAI config (server-side only — avoids CORS and protects API key)
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || "";
const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY || "";
const AZURE_OPENAI_MODEL = process.env.AZURE_OPENAI_MODEL || "gpt-5.4-mini";

// Zendesk API config (server-side only — protects API token)
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || "";
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL || "";
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN || "";

// Cisco Meraki Dashboard API (server-side only)
const MERAKI_API_KEYS = (process.env.MERAKI_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);

// SolarWinds RMM / N-able API (server-side only)
const SOLARWINDS_API_KEY = process.env.SOLARWINDS_API_KEY || "";
const SOLARWINDS_API_HOST = process.env.SOLARWINDS_API_HOST || "www.systemmonitor.us";

// Sophos Central Firewall API (server-side only)
const SOPHOS_CLIENT_ID = process.env.SOPHOS_CLIENT_ID || "";
const SOPHOS_CLIENT_SECRET = process.env.SOPHOS_CLIENT_SECRET || "";

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
        await pool.execute(
          "INSERT INTO itsm_data (collection, id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP",
          [coll, id, data]
        );
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
]);

// Server-side Graph API call using client credentials (app-only)
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
      const { to, subject, reportId, customerName } = body;
      if (!to || !subject) return json(res, 400, { error: "Missing to or subject" });
      // In production, use nodemailer with smtpConfig. For demo, log and return success.
      console.log(`[VGC-ITSM] Email queued: to=${to}, subject=${subject}, reportId=${reportId}, customer=${customerName}`);
      return json(res, 200, { success: true, message: `Email sent to ${to}` });
    } catch (err) {
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

    const zdRequest = (method, zdPath, body) => new Promise((resolve, reject) => {
      const url = new URL(zdBase + zdPath);
      const opts = {
        hostname: url.hostname, port: 443, path: url.pathname + url.search,
        method, headers: { "Authorization": zdAuth, "Content-Type": "application/json" },
      };
      const r = https.request(opts, (resp) => {
        let data = ""; resp.on("data", c => data += c);
        resp.on("end", () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            resolve(data ? JSON.parse(data) : {});
          } else {
            reject(new Error(`Zendesk ${resp.statusCode}: ${data.substring(0, 500)}`));
          }
        });
      });
      r.on("error", reject);
      r.setTimeout(20000, () => { r.destroy(); reject(new Error("Zendesk API timeout")); });
      if (body) r.write(JSON.stringify(body));
      r.end();
    });

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

        // Fetch ticket + comments from Zendesk
        const ticket = await zdRequest("GET", `/tickets/${ticketId}.json`);
        const comments = await zdRequest("GET", `/tickets/${ticketId}/comments.json`).catch(() => ({ comments: [] }));
        const lastComment = (comments.comments || []).slice(-1)[0]?.body || "";

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

        const isResponsesAPI = AZURE_OPENAI_ENDPOINT.includes("/responses");
        const payload = isResponsesAPI
          ? { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] }
          : { model: AZURE_OPENAI_MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_completion_tokens: 1500, temperature: 0.4 };

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

        const text = aiResult?.output?.[0]?.content?.[0]?.text || aiResult?.choices?.[0]?.message?.content || aiResult?.output_text || "";
        let parsed;
        try {
          parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        } catch {
          parsed = { category: "General", priority: "normal", tags: [], draft_response: text, internal_note: "Unstructured AI response", confidence: 50, suggested_assignee: "L1 Support", auto_sendable: false, itsm_category: "General", sla_priority: "Sev-D" };
        }

        return json(res, 200, { triage: parsed, ticket: ticket.ticket });
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

        console.log(`[AUDIT] Ticket #${ticketId} response sent — approved by: ${approvedBy}`);
        return json(res, 200, { success: true, approvedBy, result });
      }

      // GET /api/zendesk/new-tickets — fetch only new/open tickets for automation polling
      if (pathname === "/api/zendesk/new-tickets" && req.method === "GET") {
        const result = await zdRequest("GET", "/search.json?query=type:ticket status:new status:open&sort_by=created_at&sort_order=desc&per_page=50");
        return json(res, 200, result);
      }

      // GET /api/zendesk/agents — fetch Zendesk agents with groups
      if (pathname === "/api/zendesk/agents" && req.method === "GET") {
        const [agents, groups] = await Promise.all([
          zdRequest("GET", "/users.json?role=agent"),
          zdRequest("GET", "/groups.json"),
        ]);
        return json(res, 200, { agents: agents.users || [], groups: groups.groups || [] });
      }

      return json(res, 404, { error: "Zendesk endpoint not found" });
    } catch (err) {
      console.error("[Zendesk Proxy]", err.message);
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

      const isResponsesAPI = AZURE_OPENAI_ENDPOINT.includes("/responses");
      const payload = isResponsesAPI
        ? { model: AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] }
        : { model: AZURE_OPENAI_MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_completion_tokens: 1200, temperature: 0.7 };

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

      const text = aiResult?.output?.[0]?.content?.[0]?.text || aiResult?.choices?.[0]?.message?.content || aiResult?.output_text || "";
      if (!text) return json(res, 502, { error: "Empty response from Azure OpenAI" });
      return json(res, 200, { text, model: AZURE_OPENAI_MODEL });
    } catch (err) {
      console.error("[Azure OpenAI Proxy]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── Azure OpenAI Test Connection: GET /api/ai/test ─────────────────
  if (pathname === "/api/ai/test" && req.method === "GET") {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured", configured: false });
    }
    try {
      const isResponsesAPI = AZURE_OPENAI_ENDPOINT.includes("/responses");
      const payload = isResponsesAPI
        ? { model: AZURE_OPENAI_MODEL, input: [{ role: "user", content: "Reply with exactly: OK" }] }
        : { model: AZURE_OPENAI_MODEL, messages: [{ role: "user", content: "Reply with exactly: OK" }], max_completion_tokens: 10, temperature: 0 };
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
      const text = aiResult?.output?.[0]?.content?.[0]?.text || aiResult?.choices?.[0]?.message?.content || aiResult?.output_text || "";
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
  });
}
start().catch(err => { console.error("Fatal startup error:", err); process.exit(1); });

// Graceful shutdown
process.on("SIGINT", () => { db.close(); process.exit(0); });
process.on("SIGTERM", () => { db.close(); process.exit(0); });
