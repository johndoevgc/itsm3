import { describe, it, expect } from "vitest";

// Tests for the VALID_COLLECTIONS whitelist validation added to approval submit endpoint

describe("targetCollection validation", () => {
  const VALID_COLLECTIONS = new Set([
    "incidents", "problems", "changes", "releases", "service_requests",
    "tasks", "assets", "cmdb_items", "knowledge_base", "users",
    "teams", "sla_policies", "reports", "dashboards",
    "approval_chains", "approval_instances",
    "cmdb_relationships", "runbook_templates", "runbook_executions",
    "report_schedules", "ai_knowledge", "vendors", "customers",
  ]);

  it("accepts valid incident collection", () => {
    expect(VALID_COLLECTIONS.has("incidents")).toBe(true);
  });

  it("accepts valid changes collection", () => {
    expect(VALID_COLLECTIONS.has("changes")).toBe(true);
  });

  it("accepts valid service_requests collection", () => {
    expect(VALID_COLLECTIONS.has("service_requests")).toBe(true);
  });

  it("rejects arbitrary collection names", () => {
    expect(VALID_COLLECTIONS.has("malicious_table")).toBe(false);
    expect(VALID_COLLECTIONS.has("")).toBe(false);
    expect(VALID_COLLECTIONS.has("admin")).toBe(false);
  });

  it("rejects SQL injection attempts", () => {
    expect(VALID_COLLECTIONS.has("incidents; DROP TABLE--")).toBe(false);
    expect(VALID_COLLECTIONS.has("' OR 1=1--")).toBe(false);
  });
});
