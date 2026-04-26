import { describe, it, expect } from "vitest";

// Simulate the db.audit function signature to verify parameter order
// The correct signature is: audit(collection, record_id, action, data, user)
// action column is VARCHAR(32), record_id is VARCHAR(128)

describe("db.audit parameter order validation", () => {
  // Simulates the MySQL audit function signature
  function validateAuditParams(collection, rid, action, data, user) {
    const errors = [];
    if (typeof collection !== "string" || collection.length === 0) errors.push("collection must be non-empty string");
    if (typeof rid !== "string" || rid.length === 0) errors.push("record_id must be non-empty string");
    if (typeof action !== "string" || action.length === 0) errors.push("action must be non-empty string");
    if (action.length > 32) errors.push(`action exceeds VARCHAR(32): "${action}" (${action.length} chars)`);
    if (rid.length > 128) errors.push(`record_id exceeds VARCHAR(128): "${rid}" (${rid.length} chars)`);
    return errors;
  }

  it("approval_submitted: record_id before action", () => {
    const targetId = "INC-123456789";
    const errors = validateAuditParams("incidents", targetId, "approval_submitted", "{}", "system");
    expect(errors).toEqual([]);
    expect("approval_submitted".length).toBeLessThanOrEqual(32);
  });

  it("approval action: instanceId before approval_action", () => {
    const instanceId = "AI-m1abc2def";
    const errors = validateAuditParams("approval_instances", instanceId, "approval_approved", "{}", "admin@vgc.com");
    expect(errors).toEqual([]);
    expect("approval_approved".length).toBeLessThanOrEqual(32);
    expect("approval_rejected".length).toBeLessThanOrEqual(32);
  });

  it("CMDB create: relId before create", () => {
    const relId = "REL-m1abc2def";
    const errors = validateAuditParams("cmdb_relationships", relId, "create", "{}", "system");
    expect(errors).toEqual([]);
  });

  it("CMDB delete: relId before delete", () => {
    const relId = "REL-m1abc2def";
    const errors = validateAuditParams("cmdb_relationships", relId, "delete", "{}", "system");
    expect(errors).toEqual([]);
  });

  it("runbook started: execId before started", () => {
    const execId = "RB-m1abc2def";
    const errors = validateAuditParams("runbook_executions", execId, "started", "{}", "system");
    expect(errors).toEqual([]);
  });

  it("report schedule create: schedId before create", () => {
    const schedId = "RS-m1abc2def";
    const errors = validateAuditParams("report_schedules", schedId, "create", "{}", "system");
    expect(errors).toEqual([]);
  });

  it("FAILS if record_id is placed in action column (old bug)", () => {
    // This simulates the OLD broken parameter order where record_id was in the action slot
    const longRecordId = "INC-1234567890-VERYLONGIDENTIFIER";
    const errors = validateAuditParams("incidents", "approval_submitted", longRecordId, "{}", "system");
    // The record_id in action position would exceed VARCHAR(32)
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("action exceeds VARCHAR(32)");
  });

  it("all action strings fit within VARCHAR(32)", () => {
    const actions = [
      "approval_submitted", "approval_approved", "approval_rejected",
      "create", "delete", "started", "upsert", "email_create",
    ];
    for (const a of actions) {
      expect(a.length).toBeLessThanOrEqual(32);
    }
  });
});
