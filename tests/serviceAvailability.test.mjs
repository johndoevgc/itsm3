// Service Availability tests
import { describe, it, expect } from "vitest";

describe("Service Availability", () => {
  it("computes availability percentage", () => {
    const totalHours = 720; // 30 days
    const downtimeHours = 3.6; // ~0.5%
    const availability = ((totalHours - downtimeHours) / totalHours) * 100;
    expect(availability).toBeCloseTo(99.5, 1);
  });

  it("calculates MTBF (mean time between failures)", () => {
    const totalHours = 720;
    const incidentCount = 3;
    const mtbf = totalHours / incidentCount;
    expect(mtbf).toBe(240);
  });

  it("calculates MTTR (mean time to resolve)", () => {
    const resolveTimes = [2, 4, 1.5, 3]; // hours
    const mttr = resolveTimes.reduce((a, b) => a + b, 0) / resolveTimes.length;
    expect(mttr).toBe(2.625);
  });

  it("only counts Sev-A and Sev-B as downtime", () => {
    const incidents = [
      { priority: "Sev-A", resolveTimeHours: 2 },
      { priority: "Sev-B", resolveTimeHours: 4 },
      { priority: "Sev-C", resolveTimeHours: 8 },
      { priority: "Sev-D", resolveTimeHours: 12 },
    ];
    const downtime = incidents
      .filter((i) => i.priority === "Sev-A" || i.priority === "Sev-B")
      .reduce((sum, i) => sum + i.resolveTimeHours, 0);
    expect(downtime).toBe(6);
  });

  it("groups incidents by affected service", () => {
    const incidents = [
      { affectedService: "Email", priority: "Sev-A" },
      { affectedService: "Email", priority: "Sev-B" },
      { affectedService: "VPN", priority: "Sev-A" },
    ];
    const byService = {};
    for (const i of incidents) {
      const svc = i.affectedService || "Unknown";
      if (!byService[svc]) byService[svc] = [];
      byService[svc].push(i);
    }
    expect(byService.Email).toHaveLength(2);
    expect(byService.VPN).toHaveLength(1);
  });

  it("handles zero incidents gracefully", () => {
    const totalHours = 720;
    const downtimeHours = 0;
    const availability = totalHours > 0 ? ((totalHours - downtimeHours) / totalHours) * 100 : 100;
    expect(availability).toBe(100);
  });
});
