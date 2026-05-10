// On-Call / Shift Rotation tests
import { describe, it, expect } from "vitest";

describe("On-Call / Shift Rotation", () => {
  const ROTATION_TYPES = ["Weekly", "Daily", "Custom"];

  it("validates rotation types", () => {
    expect(ROTATION_TYPES).toContain("Weekly");
    expect(ROTATION_TYPES).toContain("Daily");
    expect(ROTATION_TYPES).toContain("Custom");
  });

  it("calculates weekly rotation index", () => {
    const startDate = new Date("2025-01-06"); // Monday
    const members = ["Alice", "Bob", "Charlie"];
    const now = new Date("2025-01-20"); // 2 weeks later
    const weekNum = Math.floor((now - startDate) / (7 * 86400000));
    const idx = weekNum % members.length;
    expect(weekNum).toBe(2);
    expect(idx).toBe(2);
    expect(members[idx]).toBe("Charlie");
  });

  it("calculates daily rotation index", () => {
    const startDate = new Date("2025-01-06");
    const members = ["Alice", "Bob", "Charlie"];
    const now = new Date("2025-01-09"); // 3 days later
    const dayNum = Math.floor((now - startDate) / 86400000);
    const idx = dayNum % members.length;
    expect(dayNum).toBe(3);
    expect(idx).toBe(0);
    expect(members[idx]).toBe("Alice");
  });

  it("applies holiday override", () => {
    const schedule = {
      members: ["Alice", "Bob"],
      holidayOverrides: [
        { date: "2025-01-01", assignee: "Charlie", reason: "New Year" },
      ],
    };
    const todayStr = "2025-01-01";
    const override = schedule.holidayOverrides.find((h) => h.date === todayStr);
    expect(override).toBeTruthy();
    expect(override.assignee).toBe("Charlie");
  });

  it("returns rotation member when no holiday", () => {
    const schedule = {
      members: ["Alice", "Bob"],
      holidayOverrides: [
        { date: "2025-12-25", assignee: "Charlie" },
      ],
    };
    const todayStr = "2025-01-15";
    const override = schedule.holidayOverrides.find((h) => h.date === todayStr);
    expect(override).toBeUndefined();
  });

  it("generates schedule ID format", () => {
    const id = `ONCALL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    expect(id).toMatch(/^ONCALL-\d+-[a-z0-9]+$/);
  });

  it("wraps rotation for large member lists", () => {
    const members = ["A", "B", "C", "D", "E"];
    const dayNum = 13;
    const idx = dayNum % members.length;
    expect(idx).toBe(3);
    expect(members[idx]).toBe("D");
  });
});
