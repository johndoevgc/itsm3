#!/usr/bin/env node
// ─── VGC ITSM — Staging seed (pure Node, runs INSIDE prod App Service) ───
//
// Reads from:   prod MySQL via process.env.MYSQL_* (already set on prod slot)
// Writes to:    staging MySQL via process.env.STG_*  (passed by the runner)
//
// Behavior:
//   • TRUNCATEs staging.itsm_data and staging.audit_log
//   • Streams prod.itsm_data row-by-row, scrubs JSON `data` per collection,
//     batch-inserts into staging.itsm_data
//   • Does NOT copy audit_log (replaying real history into staging is risky)
//   • Inserts ONE marker row into staging.audit_log so the table is non-empty
//
// Safety:
//   • Read-only on prod (only SELECT statements)
//   • Refuses to run if STG_HOST equals MYSQL_HOST (prevents wiping prod)

import mysql from "mysql2/promise";
import crypto from "node:crypto";

const PROD = {
  host:     process.env.MYSQL_HOST,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl:      { rejectUnauthorized: false },
};
const STG = {
  host:     process.env.STG_HOST,
  user:     process.env.STG_USER,
  password: process.env.STG_PWD,
  database: process.env.STG_DB,
  ssl:      { rejectUnauthorized: false },
  multipleStatements: true,
};

for (const [k, v] of Object.entries({ ...PROD, ...STG })) {
  if (!v && k !== "ssl") { console.error(`Missing env: ${k}`); process.exit(2); }
}
if (PROD.host === STG.host && PROD.database === STG.database) {
  console.error("ABORT: prod and staging point at the same DB"); process.exit(3);
}

// ─── PII scrubbers per collection ─────────────────────────────────────
const idx = new Map();           // stable per-collection counter for fakes
const next = (c) => { const n = (idx.get(c) || 0) + 1; idx.set(c, n); return n; };
const fakeEmail = (c) => `${c}${next(c)}@staging.local`;
const fakeName  = (c) => `User ${next(c)}`;
const fakePhone = (c) => `+65 9${String(10000000 + Math.floor(Math.random()*89999999)).padStart(8,"0")}`;
const hashStr   = (v) => crypto.createHash("sha256").update(String(v)).digest("hex").slice(0,16);
const scrubText = (v) => v ? `[scrubbed ${String(v).length}c]` : v;

// Field-name regex used as defense-in-depth on every collection
const SUS_KEYS = /(email|upn|phone|mobile|address|password|secret|token|api[_-]?key|ssn|nric|passport|dob|salary|bank|iban|swift)/i;

// Per-collection rules: function(obj) -> mutates obj
const COLLECTION_RULES = {
  users: (o) => {
    if (o.email)        o.email        = fakeEmail("user");
    if (o.upn)          o.upn          = o.email;
    if (o.username)     o.username     = `user${next("user")}`;
    if (o.displayName)  o.displayName  = fakeName("user");
    if (o.fullName)     o.fullName     = fakeName("user");
    if (o.phone)        o.phone        = fakePhone();
    if (o.passwordHash) o.passwordHash = "$2b$10$STAGINGSTAGINGSTAGINGUe9KoSZ4mZl6NbVrZ7QGdN0r4G9C9sKi";
    if (o.photo)        o.photo        = null;
  },
  customers: (o) => {
    if (o.name)         o.name         = `Customer-${next("cust")}`;
    if (o.contactEmail) o.contactEmail = fakeEmail("cust");
    if (o.contactPhone) o.contactPhone = fakePhone();
    if (o.address)      o.address      = null;
    if (o.notes)        o.notes        = null;
  },
  incidents: (o) => {
    for (const k of ["reporterEmail","assigneeEmail","contactEmail","requesterEmail"]) {
      if (o[k]) o[k] = fakeEmail("incident");
    }
    for (const k of ["reporterPhone","contactPhone"]) {
      if (o[k]) o[k] = fakePhone();
    }
    if (o.description) o.description = scrubText(o.description);
    if (o.resolution)  o.resolution  = scrubText(o.resolution);
    if (Array.isArray(o.comments)) {
      o.comments = o.comments.map(c => ({
        ...c,
        body: scrubText(c.body),
        authorEmail: c.authorEmail ? fakeEmail("incident") : c.authorEmail,
      }));
    }
    if (Array.isArray(o.attachments)) o.attachments = [];
  },
  zendesk_tickets: (o) => {
    if (o.subject)     o.subject     = `[scrub] ${hashStr(o.subject)}`;
    if (o.description) o.description = scrubText(o.description);
    if (o.requester_email)   o.requester_email   = fakeEmail("zd");
    if (o.requester_phone)   o.requester_phone   = fakePhone();
    if (o.assignee_email)    o.assignee_email    = fakeEmail("zd");
    if (o.submitter_email)   o.submitter_email   = fakeEmail("zd");
  },
  zendesk_comments: (o) => {
    if (o.body)         o.body         = scrubText(o.body);
    if (o.html_body)    o.html_body    = scrubText(o.html_body);
    if (o.author_email) o.author_email = fakeEmail("zdc");
  },
  notifications: (o) => {
    if (o.recipient)    o.recipient    = fakeEmail("notif");
    if (o.body)         o.body         = scrubText(o.body);
    if (o.subject)      o.subject      = "[scrubbed]";
  },
  email_whitelist: (o) => {
    if (o.email) o.email = fakeEmail("wl");
  },
  email_rejections: (o) => {
    if (o.from)    o.from    = fakeEmail("rej");
    if (o.subject) o.subject = "[scrubbed]";
    if (o.body)    o.body    = scrubText(o.body);
  },
  ai_resolve_queue: (o) => {
    if (o.prompt)  o.prompt  = scrubText(o.prompt);
    if (o.context) o.context = scrubText(o.context);
  },
  ai_workflow_queue: (o) => {
    if (o.prompt)  o.prompt  = scrubText(o.prompt);
    if (o.context) o.context = scrubText(o.context);
  },
  ai_triage_history: (o) => {
    if (o.prompt)  o.prompt  = scrubText(o.prompt);
    if (o.input)   o.input   = scrubText(o.input);
    if (o.output)  o.output  = scrubText(o.output);
  },
  ai_actions: (o) => {
    if (o.input)  o.input  = scrubText(o.input);
    if (o.output) o.output = scrubText(o.output);
  },
  ai_kb_drafts: (o) => {
    if (o.draft) o.draft = scrubText(o.draft);
  },
  contracts: (o) => {
    if (o.value)         o.value = 0;
    if (o.signatoryEmail) o.signatoryEmail = fakeEmail("ct");
  },
  vendors: (o) => {
    if (o.contactEmail) o.contactEmail = fakeEmail("vendor");
    if (o.contactPhone) o.contactPhone = fakePhone();
    if (o.notes)        o.notes        = null;
  },
};

// Generic recursive sweep for any field name matching SUS_KEYS that the
// per-collection rule didn't explicitly handle.
function sweep(o) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { o.forEach(sweep); return; }
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === "object") { sweep(v); continue; }
    if (typeof v !== "string") continue;
    if (!SUS_KEYS.test(k)) continue;
    if (/email|upn/i.test(k)) o[k] = fakeEmail("sweep");
    else if (/phone|mobile/i.test(k)) o[k] = fakePhone();
    else if (/password|secret|token|api[_-]?key/i.test(k)) o[k] = null;
    else o[k] = "[scrubbed]";
  }
}

// ─── Main ─────────────────────────────────────────────────────────────
const COLLECTIONS_TO_SKIP = new Set([
  "ai_audit_log",  // sensitive AI prompts
]);

(async () => {
  console.log(`Connecting to PROD ${PROD.host}/${PROD.database} ...`);
  const src = await mysql.createConnection(PROD);
  console.log(`Connecting to STAGING ${STG.host}/${STG.database} ...`);
  const dst = await mysql.createConnection(STG);

  // Ensure schema exists in staging
  await dst.query(`
    CREATE TABLE IF NOT EXISTS itsm_data (
      collection VARCHAR(64) NOT NULL,
      id VARCHAR(128) NOT NULL,
      data LONGTEXT,
      updated_at DATETIME,
      PRIMARY KEY (collection, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS audit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      collection VARCHAR(64),
      record_id VARCHAR(128),
      action VARCHAR(32),
      data LONGTEXT,
      user_name VARCHAR(128),
      timestamp DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log("Schema ensured.");

  console.log("Truncating staging tables...");
  await dst.query("TRUNCATE TABLE itsm_data");
  await dst.query("TRUNCATE TABLE audit_log");

  const [colsRes] = await src.query(
    "SELECT collection, COUNT(*) c FROM itsm_data GROUP BY collection ORDER BY c DESC"
  );
  let totalRead = 0, totalWritten = 0, totalScrubbed = 0;

  for (const { collection, c: count } of colsRes) {
    if (COLLECTIONS_TO_SKIP.has(collection)) {
      console.log(`SKIP   ${collection.padEnd(28)} ${count} rows (sensitive)`);
      continue;
    }
    const rule = COLLECTION_RULES[collection];
    process.stdout.write(`COPY   ${collection.padEnd(28)} ${count} rows ... `);

    const [rows] = await src.query(
      "SELECT id, data, updated_at FROM itsm_data WHERE collection = ?",
      [collection]
    );
    totalRead += rows.length;

    const batch = [];
    let scrubbedHere = 0;
    for (const r of rows) {
      let obj = null;
      try { obj = r.data ? JSON.parse(r.data) : null; }
      catch { obj = null; }
      let outData = r.data;
      if (obj && typeof obj === "object") {
        if (rule) { rule(obj); scrubbedHere++; }
        sweep(obj);
        outData = JSON.stringify(obj);
      }
      batch.push([collection, r.id, outData, r.updated_at]);
    }

    // bulk insert in chunks of 500
    const CHUNK = 500;
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK);
      await dst.query(
        "INSERT INTO itsm_data (collection, id, data, updated_at) VALUES ?",
        [slice]
      );
    }
    totalWritten  += batch.length;
    totalScrubbed += scrubbedHere;
    console.log(`done (${batch.length} written, ${scrubbedHere} explicitly scrubbed)`);
  }

  await dst.query(
    "INSERT INTO audit_log (collection, record_id, action, data, user_name, timestamp) VALUES (?,?,?,?,?,NOW())",
    ["_seed", "init", "seed", JSON.stringify({ source: PROD.host, totalRead, totalWritten }), "seed-staging.mjs"]
  );

  await src.end();
  await dst.end();
  console.log(`\nDONE. Read ${totalRead} | Wrote ${totalWritten} | Scrubbed-by-rule ${totalScrubbed}`);
})().catch(e => { console.error("FATAL:", e.message, e.stack); process.exit(1); });
