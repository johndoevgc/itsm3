#!/usr/bin/env node
/**
 * purge-for-v4-launch.cjs — Clean-slate purge for v4.0.0 production launch
 *
 * Removes all historical incident/operational data while preserving
 * configuration, KB articles, customers, and structural data.
 *
 * Usage:
 *   node scripts/purge-for-v4-launch.cjs              # Dry-run (shows what would be deleted)
 *   node scripts/purge-for-v4-launch.cjs --confirm     # Execute purge
 *
 * Environment:
 *   Reads .env or env vars for DB connection (MYSQL_HOST, etc.)
 *   Falls back to SQLite if no MySQL/MSSQL configured.
 */

const path = require("path");
const fs = require("fs");

// ─── Load env ────────────────────────────────────────────────────────
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* no dotenv */ }

const CONFIRM = process.argv.includes("--confirm");

// ─── Collections to PURGE (operational data, incidents, AI, SLA, etc.) ──
const PURGE_COLLECTIONS = [
  // Core operational
  "incidents",
  "problems",
  "changes",
  "requests",
  "worklogs",
  // Zendesk cached
  "zendesk_tickets",
  "zendesk_users",
  "zendesk_orgs",
  "zendesk_sync_state",
  "zendesk_comments",
  "zd_ai_queue",
  // AI operational
  "ai_actions",
  "ai_triage_history",
  "ai_briefings",
  "ai_patterns",
  "ai_resolve_queue",
  "ai_workflow_queue",
  "ai_knowledge",
  "ai_chat_sessions",
  "ai_kb_drafts",
  "ai_learning_feedback",
  "ai_usage",
  "ai_audit_log",
  "ai_email_outbox",
  // M365 agent
  "m365_agent_runs",
  "m365_agent_actions",
  // SLA
  "sla_tracking",
  "sla_breach_notifications",
  "sla_predictions",
  // Workflow / escalation
  "workflow_executions",
  "escalation_log",
  "runbook_executions",
  // Notifications
  "notifications",
  // Approvals
  "approval_instances",
  // ITIL4 operational
  "pir_records",
  "csi_register",
  "csat_responses",
  "mim_records",
  // Comms
  "channel_stats",
  "chat_assist_sessions",
  "email_rejections",
  "email_confirm_log",
  // Reports / analytics snapshots
  "service_reports",
  "anomaly_alerts",
  "benchmarks",
  // Misc operational
  "gamification_scores",
  "shadow_diffs",
  "auto_reassign_history",
  "billing_entries",
  "portal_sessions",
  "dsar_requests",
  "status_subscribers",
  "cost_allocations",
  "cost_rates",
  "compliance_evidence",
  "saved_reports",
];

// ─── Collections to KEEP (config, structure, KB, customers) ──────────
const KEEP_COLLECTIONS = [
  "kb",
  "customers",
  "services",
  "assets",
  "users",
  "vendors",
  "contracts",
  "workflow_rules",
  "workflow_rules_v2",
  "automation_rules",
  "survey_templates",
  "smart_tasks",
  "integrations",
  "escalation_config",
  "sla_config",
  "sla_calendars",
  "incident_templates",
  "ticket_templates",
  "approval_chains",
  "cmdb_relationships",
  "cmdb_discovery",
  "email_templates",
  "email_whitelist",
  "email_preferences",
  "notification_templates",
  "notification_preferences",
  "custom_fields",
  "field_visibility_rules",
  "advisories",
  "change_freeze_windows",
  "known_errors",
  "i18n_packs",
  "dashboard_layouts",
  "releases",
  "report_schedules",
  "saved_filters",
  "tenant_settings",
  "feature_flags",
  "pdpa_config",
  "sg_holidays",
  "teams_webhooks",
  "service_desk_roster",
  "oncall_schedules",
  "customer_sla_policies",
  "itsm_counters",
];

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   VGC-ITSM v4.0.0 — Clean Slate Purge Script           ║");
  console.log(`║   Mode: ${CONFIRM ? "🔴 LIVE PURGE" : "🟢 DRY-RUN (no changes)"}                       ║`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // ─── Connect to DB ────────────────────────────────────────────────
  let db;
  const USE_MSSQL = process.env.AZURE_SQL_CONNECTION_STRING || process.env.MSSQL_SERVER;
  const USE_MYSQL = process.env.MYSQL_HOST || process.env.MYSQL_PASSWORD;

  if (USE_MSSQL) {
    const sql = require("mssql");
    const pool = await sql.connect(process.env.AZURE_SQL_CONNECTION_STRING || {
      server: process.env.MSSQL_SERVER,
      database: process.env.MSSQL_DATABASE || "itsmdb",
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      options: { encrypt: true, trustServerCertificate: true },
    });
    db = {
      type: "mssql",
      count: async (coll) => {
        const r = await pool.request().input("coll", sql.NVarChar(64), coll)
          .query("SELECT COUNT(*) AS cnt FROM itsm_data WHERE collection = @coll");
        return r.recordset[0].cnt;
      },
      deleteCollection: async (coll) => {
        const r = await pool.request().input("coll", sql.NVarChar(64), coll)
          .query("DELETE FROM itsm_data WHERE collection = @coll");
        return r.rowsAffected?.[0] || 0;
      },
      upsert: async (coll, id, data) => {
        await pool.request()
          .input("coll", sql.NVarChar(64), coll).input("id", sql.NVarChar(128), id)
          .input("data", sql.NVarChar(sql.MAX), data)
          .query(`MERGE itsm_data AS t USING (SELECT @coll AS collection, @id AS id, @data AS data) AS s
            ON t.collection = s.collection AND t.id = s.id
            WHEN MATCHED THEN UPDATE SET data = s.data, updated_at = GETUTCDATE()
            WHEN NOT MATCHED THEN INSERT (collection, id, data) VALUES (s.collection, s.id, s.data);`);
      },
      pruneAudit: async () => {
        const r = await pool.request().query("DELETE FROM audit_log");
        return r.rowsAffected?.[0] || 0;
      },
      countAudit: async () => {
        const r = await pool.request().query("SELECT COUNT(*) AS cnt FROM audit_log");
        return r.recordset[0].cnt;
      },
      close: () => pool.close(),
    };
  } else if (USE_MYSQL) {
    const mysql = require("mysql2/promise");
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || "flexibleserverdb",
      port: parseInt(process.env.MYSQL_PORT || "3306", 10),
      ssl: process.env.MYSQL_SSL === "false" ? undefined : { rejectUnauthorized: true },
      waitForConnections: true, connectionLimit: 5,
    });
    db = {
      type: "mysql",
      count: async (coll) => {
        const [rows] = await pool.execute("SELECT COUNT(*) AS cnt FROM itsm_data WHERE collection = ?", [coll]);
        return rows[0].cnt;
      },
      deleteCollection: async (coll) => {
        const [r] = await pool.execute("DELETE FROM itsm_data WHERE collection = ?", [coll]);
        return r.affectedRows || 0;
      },
      upsert: async (coll, id, data) => {
        await pool.execute(
          "INSERT INTO itsm_data (collection, id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP",
          [coll, id, data]
        );
      },
      pruneAudit: async () => {
        const [r] = await pool.execute("DELETE FROM audit_log");
        return r.affectedRows || 0;
      },
      countAudit: async () => {
        const [rows] = await pool.execute("SELECT COUNT(*) AS cnt FROM audit_log");
        return rows[0].cnt;
      },
      close: () => pool.end(),
    };
  } else {
    const Database = require("better-sqlite3");
    const DB_PATH = path.join(__dirname, "..", process.env.SQLITE_PATH || "itsm.db");
    if (!fs.existsSync(DB_PATH)) { console.error(`SQLite DB not found at ${DB_PATH}`); process.exit(1); }
    const sdb = new Database(DB_PATH);
    db = {
      type: "sqlite",
      count: (coll) => sdb.prepare("SELECT COUNT(*) AS cnt FROM itsm_data WHERE collection = ?").get(coll).cnt,
      deleteCollection: (coll) => sdb.prepare("DELETE FROM itsm_data WHERE collection = ?").run(coll).changes,
      upsert: (coll, id, data) => sdb.prepare("INSERT INTO itsm_data (collection, id, data, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')").run(coll, id, data),
      pruneAudit: () => sdb.prepare("DELETE FROM audit_log").run().changes,
      countAudit: () => sdb.prepare("SELECT COUNT(*) AS cnt FROM audit_log").get().cnt,
      close: () => sdb.close(),
    };
  }

  console.log(`Database: ${db.type}\n`);

  // ─── Count & Purge collections ────────────────────────────────────
  let totalPurged = 0;
  console.log("── Collections to PURGE ──────────────────────────────────");
  for (const coll of PURGE_COLLECTIONS) {
    try {
      const count = await db.count(coll);
      if (count === 0) continue;
      if (CONFIRM) {
        const deleted = await db.deleteCollection(coll);
        console.log(`  ✗ ${coll}: ${deleted} records deleted`);
        totalPurged += deleted;
      } else {
        console.log(`  ○ ${coll}: ${count} records (would delete)`);
        totalPurged += count;
      }
    } catch (e) {
      console.warn(`  ⚠ ${coll}: ${e.message}`);
    }
  }

  // ─── Purge audit_log ──────────────────────────────────────────────
  try {
    const auditCount = await db.countAudit();
    if (auditCount > 0) {
      if (CONFIRM) {
        const deleted = await db.pruneAudit();
        console.log(`  ✗ audit_log: ${deleted} records deleted`);
        totalPurged += deleted;
      } else {
        console.log(`  ○ audit_log: ${auditCount} records (would delete)`);
        totalPurged += auditCount;
      }
    }
  } catch (e) {
    console.warn(`  ⚠ audit_log: ${e.message}`);
  }

  // ─── Show kept collections ────────────────────────────────────────
  console.log("\n── Collections KEPT (not touched) ────────────────────────");
  for (const coll of KEEP_COLLECTIONS) {
    try {
      const count = await db.count(coll);
      if (count > 0) console.log(`  ✓ ${coll}: ${count} records`);
    } catch { /* skip */ }
  }

  // ─── Reset incident counter ───────────────────────────────────────
  console.log("\n── Incident Counter ─────────────────────────────────────");
  if (CONFIRM) {
    await db.upsert("itsm_counters", "incident_counter", "0");
    console.log("  ✓ incident_counter reset to 0 (next incident: INC-0001)");
  } else {
    console.log("  ○ incident_counter would be reset to 0");
  }

  // ─── Summary ──────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  if (CONFIRM) {
    console.log(`🔴 PURGE COMPLETE — ${totalPurged} records removed`);
    console.log("   Next incident ID will be INC-0001");
  } else {
    console.log(`🟢 DRY-RUN — ${totalPurged} records would be removed`);
    console.log("   Run with --confirm to execute");
  }
  console.log("══════════════════════════════════════════════════════════\n");

  await db.close();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
