import { describe, it, expect } from "vitest";
import { validate } from "../src/server/validation.js";

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
