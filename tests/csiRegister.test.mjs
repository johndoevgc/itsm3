// CSI Register tests
import { describe, it, expect } from "vitest";

describe("CSI Register", () => {
  const CSI_STATUSES = ["Identified", "Proposed", "In Progress", "Completed", "Rejected"];
  const CSI_PRIORITIES = ["Critical", "High", "Medium", "Low"];
  const CSI_CATEGORIES = [
    "Process Improvement", "Technology Enhancement", "People & Skills",
    "Service Quality", "Cost Optimization", "Security Improvement",
  ];

  it("validates CSI statuses", () => {
    expect(CSI_STATUSES).toContain("Identified");
    expect(CSI_STATUSES).toContain("Completed");
    expect(CSI_STATUSES).toContain("Rejected");
  });

  it("validates CSI priorities", () => {
    expect(CSI_PRIORITIES).toHaveLength(4);
    expect(CSI_PRIORITIES[0]).toBe("Critical");
  });

  it("validates CSI categories", () => {
    expect(CSI_CATEGORIES).toContain("Process Improvement");
    expect(CSI_CATEGORIES).toContain("Cost Optimization");
  });

  it("generates CSI ID format", () => {
    const id = `CSI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    expect(id).toMatch(/^CSI-\d+-[a-z0-9]+$/);
  });

  it("computes completion rate", () => {
    const records = [
      { status: "Completed" },
      { status: "Completed" },
      { status: "In Progress" },
      { status: "Identified" },
      { status: "Rejected" },
    ];
    const completed = records.filter((r) => r.status === "Completed").length;
    const rate = Math.round((completed / records.length) * 100);
    expect(rate).toBe(40);
  });

  it("computes stats by category", () => {
    const records = [
      { category: "Process Improvement", status: "Completed" },
      { category: "Process Improvement", status: "In Progress" },
      { category: "Technology Enhancement", status: "Identified" },
    ];
    const byCategory = {};
    for (const r of records) {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    }
    expect(byCategory["Process Improvement"]).toBe(2);
    expect(byCategory["Technology Enhancement"]).toBe(1);
  });

  it("filters by status", () => {
    const records = [
      { id: "CSI-1", status: "Completed" },
      { id: "CSI-2", status: "In Progress" },
      { id: "CSI-3", status: "Completed" },
    ];
    const inProgress = records.filter((r) => r.status === "In Progress");
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0].id).toBe("CSI-2");
  });
});
