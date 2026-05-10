// PIR / Post-Incident Review tests
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("PIR / Post-Incident Review", () => {
  const PIR_STATUSES = ["Draft", "In Progress", "Completed", "Overdue"];
  const PIR_RCA_TYPES = ["Human Error", "Process Failure", "Technology Failure", "External Factor", "Unknown"];

  it("validates PIR statuses", () => {
    expect(PIR_STATUSES).toContain("Draft");
    expect(PIR_STATUSES).toContain("Completed");
    expect(PIR_STATUSES.length).toBe(4);
  });

  it("validates RCA type enums", () => {
    expect(PIR_RCA_TYPES).toContain("Human Error");
    expect(PIR_RCA_TYPES).toContain("Technology Failure");
    expect(PIR_RCA_TYPES).toContain("External Factor");
  });

  it("generates PIR ID format", () => {
    const id = `PIR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    expect(id).toMatch(/^PIR-\d+-[a-z0-9]+$/);
  });

  it("validates PIR action item structure", () => {
    const actionItem = {
      description: "Implement automated monitoring",
      owner: "ops-team",
      dueDate: "2025-02-01",
      status: "Open",
    };
    expect(actionItem.description).toBeTruthy();
    expect(actionItem.owner).toBeTruthy();
    expect(actionItem.status).toBe("Open");
  });

  it("rejects invalid PIR status", () => {
    const invalidStatus = "Cancelled";
    expect(PIR_STATUSES).not.toContain(invalidStatus);
  });

  it("computes overdue action items", () => {
    const now = Date.now();
    const actions = [
      { description: "Fix A", dueDate: new Date(now - 86400000).toISOString(), status: "Open" },
      { description: "Fix B", dueDate: new Date(now + 86400000).toISOString(), status: "Open" },
      { description: "Fix C", dueDate: new Date(now - 172800000).toISOString(), status: "Completed" },
    ];
    const overdue = actions.filter(
      (a) => a.status !== "Completed" && a.status !== "Overdue" && a.dueDate && new Date(a.dueDate).getTime() < now
    );
    expect(overdue).toHaveLength(1);
    expect(overdue[0].description).toBe("Fix A");
  });
});
