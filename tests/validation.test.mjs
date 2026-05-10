import { describe, it, expect } from "vitest";
import { validate, validateEndpoint } from "../src/server/validation.js";

describe("validate()", () => {
  // ─── Incidents ──────────────────────────────────────────────────────
  it("passes valid incident", () => {
    const r = validate("incidents", { title: "VPN down", priority: "High", status: "New" });
    expect(r.success).toBe(true);
    expect(r.data.title).toBe("VPN down");
  });

  it("rejects incident without title", () => {
    const r = validate("incidents", { priority: "High" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("title");
  });

  it("rejects invalid priority", () => {
    const r = validate("incidents", { title: "Test", priority: "Urgent" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("priority");
  });

  it("allows extra fields (passthrough)", () => {
    const r = validate("incidents", { title: "Test", customField: "abc" });
    expect(r.success).toBe(true);
  });

  it("passes incident with only title", () => {
    const r = validate("incidents", { title: "Test" });
    expect(r.success).toBe(true);
  });

  it("rejects invalid reporter email", () => {
    const r = validate("incidents", { title: "Test", reporterEmail: "not-an-email" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("reporterEmail");
  });

  it("rejects invalid impact value", () => {
    const r = validate("incidents", { title: "Test", impact: "Extreme" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("impact");
  });

  // ─── Changes ────────────────────────────────────────────────────────
  it("passes valid change request", () => {
    const r = validate("changes", { title: "Upgrade server", changeType: "Normal" });
    expect(r.success).toBe(true);
  });

  it("rejects change with invalid risk", () => {
    const r = validate("changes", { title: "Test", risk: "Extreme" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("risk");
  });

  it("rejects change with invalid changeType", () => {
    const r = validate("changes", { title: "Test", changeType: "Fast" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("changeType");
  });

  it("accepts change with scheduled dates", () => {
    const r = validate("changes", { title: "Test", scheduledStart: "2026-05-01", scheduledEnd: "2026-05-02" });
    expect(r.success).toBe(true);
  });

  // ─── Assets / CMDB ─────────────────────────────────────────────────
  it("passes valid asset", () => {
    const r = validate("assets", { name: "Laptop-001", status: "Active" });
    expect(r.success).toBe(true);
  });

  it("rejects asset without name", () => {
    const r = validate("assets", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("name");
  });

  it("validates cmdb same as assets", () => {
    const r = validate("cmdb", { name: "Switch-01", status: "Deployed" });
    expect(r.success).toBe(true);
  });

  it("rejects asset with invalid status", () => {
    const r = validate("assets", { name: "Test", status: "Lost" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("status");
  });

  // ─── Problems ───────────────────────────────────────────────────────
  it("passes valid problem", () => {
    const r = validate("problems", { title: "Recurring DNS failure" });
    expect(r.success).toBe(true);
  });

  it("rejects problem with invalid status", () => {
    const r = validate("problems", { title: "Test", status: "Invalid" });
    expect(r.success).toBe(false);
  });

  it("accepts problem with relatedIncidents array", () => {
    const r = validate("problems", { title: "Test", relatedIncidents: ["INC-001", "INC-002"] });
    expect(r.success).toBe(true);
  });

  it("rejects problem with non-string relatedIncidents", () => {
    const r = validate("problems", { title: "Test", relatedIncidents: [123] });
    expect(r.success).toBe(false);
    expect(r.error).toContain("relatedIncidents");
  });

  // ─── Service Requests ──────────────────────────────────────────────
  it("passes valid service request", () => {
    const r = validate("requests", { title: "New laptop request" });
    expect(r.success).toBe(true);
  });

  it("rejects request with invalid status", () => {
    const r = validate("requests", { title: "Test", status: "Done" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("status");
  });

  // ─── Customers ─────────────────────────────────────────────────────
  it("passes valid customer", () => {
    const r = validate("customers", { name: "Acme Corp", email: "info@acme.com" });
    expect(r.success).toBe(true);
  });

  it("rejects customer without name", () => {
    const r = validate("customers", { email: "test@test.com" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("name");
  });

  it("rejects customer with invalid email", () => {
    const r = validate("customers", { name: "Test", email: "bad-email" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("email");
  });

  // ─── KB Articles ───────────────────────────────────────────────────
  it("passes valid KB article", () => {
    const r = validate("kb", { title: "How to reset password", status: "Published" });
    expect(r.success).toBe(true);
  });

  it("rejects KB article without title", () => {
    const r = validate("kb", { content: "Some content" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("title");
  });

  it("rejects KB article with invalid status", () => {
    const r = validate("kb", { title: "Test", status: "Live" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("status");
  });

  it("accepts KB article with tags array", () => {
    const r = validate("kb", { title: "Test", tags: ["network", "vpn"] });
    expect(r.success).toBe(true);
  });

  // ─── Services ──────────────────────────────────────────────────────
  it("passes valid service", () => {
    const r = validate("services", { name: "Email Service", status: "Active" });
    expect(r.success).toBe(true);
  });

  it("rejects service without name", () => {
    const r = validate("services", { status: "Active" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("name");
  });

  it("rejects service with invalid status", () => {
    const r = validate("services", { name: "Test", status: "Running" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("status");
  });

  // ─── Edge cases ────────────────────────────────────────────────────
  it("skips validation for unknown collections", () => {
    const r = validate("custom_data", { anything: true });
    expect(r.success).toBe(true);
  });

  it("rejects null body for known collections", () => {
    const r = validate("incidents", null);
    expect(r.success).toBe(false);
    expect(r.error).toContain("non-null object");
  });

  it("rejects array body for known collections", () => {
    const r = validate("incidents", [{ title: "Test" }]);
    expect(r.success).toBe(false);
    expect(r.error).toContain("non-null object");
  });

  it("collects multiple errors at once", () => {
    const r = validate("incidents", { priority: "Urgent", impact: "Extreme" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("title");
    expect(r.error).toContain("priority");
    expect(r.error).toContain("impact");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// validateEndpoint() — endpoint-specific validators
// ═══════════════════════════════════════════════════════════════════════
describe("validateEndpoint()", () => {
  // ─── Edge cases ────────────────────────────────────────────────────
  it("skips validation for unknown endpoints", () => {
    const r = validateEndpoint("unknown_endpoint", { anything: true });
    expect(r.success).toBe(true);
  });

  it("rejects null body", () => {
    const r = validateEndpoint("sla_config", null);
    expect(r.success).toBe(false);
    expect(r.error).toContain("non-null object");
  });

  // ─── SLA Config ────────────────────────────────────────────────────
  it("passes valid sla_config", () => {
    const r = validateEndpoint("sla_config", { severities: { critical: { response: 15 } } });
    expect(r.success).toBe(true);
  });

  it("rejects sla_config without severities object", () => {
    const r = validateEndpoint("sla_config", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("severities");
  });

  // ─── SLA Category Modifier ────────────────────────────────────────
  it("passes valid sla_category_modifier", () => {
    const r = validateEndpoint("sla_category_modifier", { category: "Network", multiplier: 1.5 });
    expect(r.success).toBe(true);
  });

  it("rejects sla_category_modifier with missing category", () => {
    const r = validateEndpoint("sla_category_modifier", { multiplier: 1 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("category");
  });

  it("rejects sla_category_modifier with bad multiplier", () => {
    const r = validateEndpoint("sla_category_modifier", { category: "Net", multiplier: 99 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("multiplier");
  });

  // ─── SLA Pause / Resume ───────────────────────────────────────────
  it("passes valid sla_pause", () => {
    const r = validateEndpoint("sla_pause", { incidentId: "INC-001", reason: "Waiting on vendor" });
    expect(r.success).toBe(true);
  });

  it("rejects sla_pause without incidentId", () => {
    const r = validateEndpoint("sla_pause", { reason: "test" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("incidentId");
  });

  it("passes valid sla_resume", () => {
    const r = validateEndpoint("sla_resume", { incidentId: "INC-001" });
    expect(r.success).toBe(true);
  });

  // ─── SLA Calendar ─────────────────────────────────────────────────
  it("passes valid sla_calendar", () => {
    const r = validateEndpoint("sla_calendar", { name: "APAC Hours", timezone: "Asia/Singapore" });
    expect(r.success).toBe(true);
  });

  it("rejects sla_calendar with invalid timezone", () => {
    const r = validateEndpoint("sla_calendar", { name: "Test", timezone: "Mars/Olympus" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("timezone");
  });

  // ─── Notification Send ────────────────────────────────────────────
  it("passes valid notification_send", () => {
    const r = validateEndpoint("notification_send", { type: "alert", to: "user@example.com" });
    expect(r.success).toBe(true);
  });

  it("rejects notification_send with invalid email", () => {
    const r = validateEndpoint("notification_send", { to: "not-email" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("to");
  });

  // ─── Notification Template ────────────────────────────────────────
  it("passes valid notification_template", () => {
    const r = validateEndpoint("notification_template", { name: "Breach Alert", eventType: "sla_breach" });
    expect(r.success).toBe(true);
  });

  it("rejects notification_template without name", () => {
    const r = validateEndpoint("notification_template", { eventType: "sla_breach" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("name");
  });

  // ─── Approval Submit ──────────────────────────────────────────────
  it("passes valid approval_submit", () => {
    const r = validateEndpoint("approval_submit", { chainId: "chain-1", targetCollection: "changes", targetId: "CHG-001" });
    expect(r.success).toBe(true);
  });

  it("rejects approval_submit without required fields", () => {
    const r = validateEndpoint("approval_submit", { chainId: "chain-1" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("targetCollection");
    expect(r.error).toContain("targetId");
  });

  // ─── Approval Action ──────────────────────────────────────────────
  it("passes valid approval_action", () => {
    const r = validateEndpoint("approval_action", { action: "approved" });
    expect(r.success).toBe(true);
  });

  it("rejects approval_action with invalid action", () => {
    const r = validateEndpoint("approval_action", { action: "maybe" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("action");
  });

  // ─── Approval Generate Token ──────────────────────────────────────
  it("passes valid approval_generate_token", () => {
    const r = validateEndpoint("approval_generate_token", { instanceId: "inst-1", approverEmail: "admin@test.com" });
    expect(r.success).toBe(true);
  });

  it("rejects approval_generate_token with invalid email", () => {
    const r = validateEndpoint("approval_generate_token", { instanceId: "inst-1", approverEmail: "bad" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("approverEmail");
  });

  // ─── CMDB Relationship ────────────────────────────────────────────
  it("passes valid cmdb_relationship", () => {
    const r = validateEndpoint("cmdb_relationship", { sourceId: "CI-001", targetId: "CI-002", type: "depends_on" });
    expect(r.success).toBe(true);
  });

  it("rejects cmdb_relationship with invalid type", () => {
    const r = validateEndpoint("cmdb_relationship", { sourceId: "CI-001", targetId: "CI-002", type: "links_to" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("type");
  });

  // ─── Runbook Execute ──────────────────────────────────────────────
  it("passes valid runbook_execute", () => {
    const r = validateEndpoint("runbook_execute", { runbookId: "RB-001" });
    expect(r.success).toBe(true);
  });

  it("rejects runbook_execute without runbookId", () => {
    const r = validateEndpoint("runbook_execute", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("runbookId");
  });

  // ─── Runbook Step Update ──────────────────────────────────────────
  it("passes valid runbook_step_update", () => {
    const r = validateEndpoint("runbook_step_update", { status: "completed" });
    expect(r.success).toBe(true);
  });

  it("rejects runbook_step_update with invalid status", () => {
    const r = validateEndpoint("runbook_step_update", { status: "done" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("status");
  });

  // ─── Runbook Action Execute ───────────────────────────────────────
  it("passes valid runbook_action_execute", () => {
    const r = validateEndpoint("runbook_action_execute", { actionId: "ACT-01" });
    expect(r.success).toBe(true);
  });

  it("rejects runbook_action_execute with params as array", () => {
    const r = validateEndpoint("runbook_action_execute", { actionId: "ACT-01", params: [1, 2] });
    expect(r.success).toBe(false);
    expect(r.error).toContain("params");
  });

  // ─── Report Schedule ──────────────────────────────────────────────
  it("passes valid report_schedule", () => {
    const r = validateEndpoint("report_schedule", { name: "Weekly SLA", type: "sla", frequency: "weekly", format: "pdf" });
    expect(r.success).toBe(true);
  });

  it("rejects report_schedule with invalid frequency", () => {
    const r = validateEndpoint("report_schedule", { name: "Test", type: "sla", frequency: "biweekly" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("frequency");
  });

  // ─── Feature Flag ─────────────────────────────────────────────────
  it("passes valid feature_flag", () => {
    const r = validateEndpoint("feature_flag", { name: "dark_mode", enabled: true });
    expect(r.success).toBe(true);
  });

  it("rejects feature_flag without name", () => {
    const r = validateEndpoint("feature_flag", { enabled: true });
    expect(r.success).toBe(false);
    expect(r.error).toContain("name");
  });

  // ─── Change Freeze Window ─────────────────────────────────────────
  it("passes valid change_freeze_window", () => {
    const r = validateEndpoint("change_freeze_window", { startDate: "2026-12-20", endDate: "2026-12-31", reason: "Year-end freeze" });
    expect(r.success).toBe(true);
  });

  it("rejects change_freeze_window without reason", () => {
    const r = validateEndpoint("change_freeze_window", { startDate: "2026-12-20", endDate: "2026-12-31" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("reason");
  });

  // ─── Change Conflict Check ────────────────────────────────────────
  it("passes valid change_conflict_check", () => {
    const r = validateEndpoint("change_conflict_check", { scheduledStart: "2026-06-01T10:00:00Z", title: "Deploy v2" });
    expect(r.success).toBe(true);
  });

  it("rejects change_conflict_check without title", () => {
    const r = validateEndpoint("change_conflict_check", { scheduledStart: "2026-06-01T10:00:00Z" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("title");
  });

  // ─── M365 Diagnose ────────────────────────────────────────────────
  it("passes valid m365_diagnose", () => {
    const r = validateEndpoint("m365_diagnose", { incidentId: "INC-001", targetUpn: "user@company.com" });
    expect(r.success).toBe(true);
  });

  // ─── M365 Action Propose ──────────────────────────────────────────
  it("passes valid m365_action_propose", () => {
    const r = validateEndpoint("m365_action_propose", { actionId: "reset-mfa" });
    expect(r.success).toBe(true);
  });

  it("rejects m365_action_propose without actionId", () => {
    const r = validateEndpoint("m365_action_propose", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("actionId");
  });

  // ─── M365 Approve Execute ─────────────────────────────────────────
  it("passes valid m365_approve_execute", () => {
    const r = validateEndpoint("m365_approve_execute", { proposalId: "PROP-001" });
    expect(r.success).toBe(true);
  });

  it("rejects m365_approve_execute without proposalId", () => {
    const r = validateEndpoint("m365_approve_execute", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("proposalId");
  });

  // ─── Incident Link Child ──────────────────────────────────────────
  it("passes valid incident_link_child", () => {
    const r = validateEndpoint("incident_link_child", { childId: "INC-099" });
    expect(r.success).toBe(true);
  });

  it("rejects incident_link_child without childId", () => {
    const r = validateEndpoint("incident_link_child", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("childId");
  });

  // ─── Incident Cascade Resolve ─────────────────────────────────────
  it("passes valid incident_cascade_resolve", () => {
    const r = validateEndpoint("incident_cascade_resolve", { resolution: "Fixed root cause" });
    expect(r.success).toBe(true);
  });

  it("passes incident_cascade_resolve with empty body", () => {
    const r = validateEndpoint("incident_cascade_resolve", {});
    expect(r.success).toBe(true);
  });

  // ─── AI Learning Feedback ─────────────────────────────────────────
  it("passes valid ai_learning_feedback", () => {
    const r = validateEndpoint("ai_learning_feedback", { triageId: "TRI-001", verdict: "correct" });
    expect(r.success).toBe(true);
  });

  it("rejects ai_learning_feedback with invalid verdict", () => {
    const r = validateEndpoint("ai_learning_feedback", { triageId: "TRI-001", verdict: "maybe" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("verdict");
  });

  it("rejects ai_learning_feedback without triageId", () => {
    const r = validateEndpoint("ai_learning_feedback", { verdict: "correct" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("triageId");
  });

  // ─── i18n Pack ─────────────────────────────────────────────────────
  it("passes valid i18n_pack", () => {
    const r = validateEndpoint("i18n_pack", { lang: "zh", strings: { hello: "你好" } });
    expect(r.success).toBe(true);
  });

  it("rejects i18n_pack without lang", () => {
    const r = validateEndpoint("i18n_pack", { strings: { hello: "Hi" } });
    expect(r.success).toBe(false);
    expect(r.error).toContain("lang");
  });

  it("rejects i18n_pack without strings object", () => {
    const r = validateEndpoint("i18n_pack", { lang: "fr" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("strings");
  });
});
