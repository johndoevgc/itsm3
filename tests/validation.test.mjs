import { describe, it, expect } from "vitest";
import { validate, incidentSchema, changeSchema, assetSchema } from "../src/server/validation.js";

describe("validate()", () => {
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
    expect(r.data.customField).toBe("abc");
  });

  it("applies defaults for missing optional fields", () => {
    const r = validate("incidents", { title: "Test" });
    expect(r.success).toBe(true);
    expect(r.data.status).toBe("New");
    expect(r.data.priority).toBe("Medium");
  });

  it("passes valid change request", () => {
    const r = validate("changes", { title: "Upgrade server", changeType: "Normal" });
    expect(r.success).toBe(true);
  });

  it("rejects change with invalid risk", () => {
    const r = validate("changes", { title: "Test", risk: "Extreme" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("risk");
  });

  it("passes valid asset", () => {
    const r = validate("assets", { name: "Laptop-001", status: "Active" });
    expect(r.success).toBe(true);
  });

  it("rejects asset without name", () => {
    const r = validate("assets", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("name");
  });

  it("skips validation for unknown collections", () => {
    const r = validate("custom_data", { anything: true });
    expect(r.success).toBe(true);
  });

  it("validates cmdb same as assets", () => {
    const r = validate("cmdb", { name: "Switch-01", status: "Deployed" });
    expect(r.success).toBe(true);
  });

  it("passes valid service request", () => {
    const r = validate("requests", { title: "New laptop request" });
    expect(r.success).toBe(true);
    expect(r.data.status).toBe("New");
  });

  it("passes valid problem", () => {
    const r = validate("problems", { title: "Recurring DNS failure" });
    expect(r.success).toBe(true);
  });

  it("rejects problem with invalid status", () => {
    const r = validate("problems", { title: "Test", status: "Invalid" });
    expect(r.success).toBe(false);
  });
});
