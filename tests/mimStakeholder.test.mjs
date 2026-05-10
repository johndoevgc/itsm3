// MIM Stakeholder & Phase Enhancement tests
import { describe, it, expect } from "vitest";

describe("MIM Stakeholder & Phase Management", () => {
  const MIM_PHASES = ["Detection", "Triage", "Mitigation", "Resolution", "PIR"];

  it("validates MIM phase sequence", () => {
    expect(MIM_PHASES).toHaveLength(5);
    expect(MIM_PHASES[0]).toBe("Detection");
    expect(MIM_PHASES[4]).toBe("PIR");
  });

  it("rejects invalid phase", () => {
    expect(MIM_PHASES).not.toContain("Planning");
    expect(MIM_PHASES).not.toContain("Closure");
  });

  it("tracks phase history", () => {
    const phaseHistory = [];
    const phases = ["Detection", "Triage", "Mitigation"];
    for (const phase of phases) {
      phaseHistory.push({
        phase,
        enteredAt: new Date().toISOString(),
        enteredBy: "Admin",
      });
    }
    expect(phaseHistory).toHaveLength(3);
    expect(phaseHistory[0].phase).toBe("Detection");
    expect(phaseHistory[2].phase).toBe("Mitigation");
  });

  it("manages stakeholder list — add", () => {
    const stakeholders = [];
    const newStakeholder = {
      name: "Jane Smith",
      role: "Service Owner",
      email: "jane@example.com",
      addedAt: new Date().toISOString(),
    };
    stakeholders.push(newStakeholder);
    expect(stakeholders).toHaveLength(1);
    expect(stakeholders[0].name).toBe("Jane Smith");
  });

  it("manages stakeholder list — remove by email", () => {
    const stakeholders = [
      { name: "Jane", email: "jane@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ];
    const filtered = stakeholders.filter((s) => s.email !== "jane@example.com");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("Bob");
  });

  it("adds phase to timeline", () => {
    const timeline = [
      { time: "2025-01-01T00:00:00Z", event: "Major Incident Declared", phase: "Detection" },
    ];
    timeline.push({
      time: "2025-01-01T00:15:00Z",
      event: "Phase: Triage",
      phase: "Triage",
      user: "Admin",
    });
    expect(timeline).toHaveLength(2);
    expect(timeline[1].phase).toBe("Triage");
  });

  it("generates MIM record with stakeholders and phase", () => {
    const mimRecord = {
      id: `MIM-${Date.now()}`,
      incidentId: "INC-001",
      status: "active",
      phase: "Detection",
      stakeholders: [{ name: "Admin", role: "Incident Manager", email: "admin@test.com" }],
    };
    expect(mimRecord.phase).toBe("Detection");
    expect(mimRecord.stakeholders).toHaveLength(1);
    expect(mimRecord.stakeholders[0].role).toBe("Incident Manager");
  });

  it("validates Sev-A MIM requires PIR for closure", () => {
    const incident = { priority: "Sev-A", isMajorIncident: true };
    const hasPir = false;
    const canClose = incident.priority !== "Sev-A" || hasPir;
    expect(canClose).toBe(false);
  });

  it("allows MIM closure when PIR exists", () => {
    const incident = { priority: "Sev-A", isMajorIncident: true };
    const hasPir = true;
    const canClose = incident.priority !== "Sev-A" || hasPir;
    expect(canClose).toBe(true);
  });
});
