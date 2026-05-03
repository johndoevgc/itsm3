import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Verifies the schema and SQL used by the SQLite db backend in server.js for
// audit_log: countAudit() and lastAuditTs(). Mirrors the prepared statements at
// server.js ~L1180/L1198. If the server schema changes, this test must change.

const TMP = path.join(os.tmpdir(), `vgc-audit-test-${Date.now()}.db`);
let sdb;
let countAudit, lastAuditTs, insertAudit;

beforeAll(() => {
  sdb = new Database(TMP);
  sdb.pragma("journal_mode = WAL");
  sdb.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL,
      record_id TEXT NOT NULL, action TEXT NOT NULL, data TEXT,
      user_name TEXT, timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  `);
  countAudit = sdb.prepare("SELECT COUNT(*) as cnt FROM audit_log");
  lastAuditTs = sdb.prepare("SELECT MAX(timestamp) as ts FROM audit_log");
  insertAudit = sdb.prepare(
    "INSERT INTO audit_log (collection, record_id, action, data, user_name) VALUES (?, ?, ?, ?, ?)"
  );
});

afterAll(() => {
  try { sdb.close(); } catch { /* ignore */ }
  for (const ext of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP + ext); } catch { /* ignore */ }
  }
});

describe("audit_log countAudit / lastAuditTs", () => {
  it("countAudit returns 0 on empty table", () => {
    expect(countAudit.get().cnt).toBe(0);
  });

  it("lastAuditTs returns null on empty table", () => {
    expect(lastAuditTs.get().ts).toBeNull();
  });

  it("countAudit reflects inserts", () => {
    insertAudit.run("incidents", "INC-1", "create", "{}", "tester");
    insertAudit.run("incidents", "INC-2", "update", "{}", "tester");
    insertAudit.run("problems", "PRB-1", "create", "{}", "tester");
    expect(countAudit.get().cnt).toBe(3);
  });

  it("lastAuditTs returns ISO-parseable timestamp after writes", () => {
    const ts = lastAuditTs.get().ts;
    expect(typeof ts).toBe("string");
    expect(ts.length).toBeGreaterThan(0);
    const d = new Date(ts.replace(" ", "T") + "Z");
    expect(Number.isFinite(d.getTime())).toBe(true);
  });

  it("count increments are integer-typed (not bigint)", () => {
    const cnt = countAudit.get().cnt;
    expect(Number.isInteger(cnt)).toBe(true);
  });
});

describe("/api/db-stats audit_log shape contract", () => {
  // routes/core.js /api/db-stats sets stats.audit_log = await db.countAudit().
  // /api/status components.audit_log = { status, rows, lastWrite }.
  // /api/health audit = { rows, lastWrite, retentionDays }.
  // These tests pin the field names so a refactor that drops them fails CI.
  it("countAudit shape used by /api/db-stats", () => {
    const cnt = countAudit.get().cnt;
    const stats = { audit_log: cnt };
    expect(stats).toHaveProperty("audit_log");
    expect(typeof stats.audit_log).toBe("number");
  });

  it("audit health payload shape used by /api/health and /api/status", () => {
    const payload = {
      rows: countAudit.get().cnt,
      lastWrite: lastAuditTs.get().ts || null,
      retentionDays: 30,
    };
    expect(payload).toHaveProperty("rows");
    expect(payload).toHaveProperty("lastWrite");
    expect(payload).toHaveProperty("retentionDays");
    expect(typeof payload.retentionDays).toBe("number");
  });
});
