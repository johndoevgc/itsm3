import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowEngine } from "../workflowEngine.js";

// ─── Helper: create a mock DB ───────────────────────────────────────────
function createMockDb(overrides = {}) {
  return {
    getAll: vi.fn().mockResolvedValue([]),
    getOpen: vi.fn().mockResolvedValue([]),
    getOne: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(),
    audit: vi.fn().mockResolvedValue(),
    getMaxUpdatedAt: vi.fn().mockResolvedValue(null),
    getByField: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ─── Helper: wrap an incident as a DB row ───────────────────────────────
function row(incident) {
  return { data: JSON.stringify(incident) };
}

describe("WorkflowEngine", () => {
  let db;

  beforeEach(() => {
    db = createMockDb();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Construction ─────────────────────────────────────────────────────
  it("constructs with default 5-minute interval", () => {
    const engine = new WorkflowEngine(db);
    expect(engine.interval).toBe(5 * 60 * 1000);
    expect(engine.stats.rulesEvaluated).toBe(0);
  });

  // ─── Change-detection skip ────────────────────────────────────────────
  it("skips cycle when data hash is unchanged", async () => {
    db.getMaxUpdatedAt.mockResolvedValue("same-hash");
    const engine = new WorkflowEngine(db);
    engine._lastDataHash = "same-hash";

    await engine.runCycle();

    expect(engine.stats.cyclesSkipped).toBe(1);
    expect(db.getOpen).not.toHaveBeenCalled();
  });

  it("runs cycle when data hash changes", async () => {
    db.getMaxUpdatedAt.mockResolvedValue("new-hash");
    const engine = new WorkflowEngine(db);
    engine._lastDataHash = "old-hash";

    await engine.runCycle();

    expect(engine.stats.cyclesSkipped).toBe(0);
  });

  // ─── _autoCloseResolved ───────────────────────────────────────────────
  describe("_autoCloseResolved", () => {
    const rule = { id: "WF004", name: "Auto-close resolved", status: "Active" };

    it("auto-closes incidents resolved more than 72h ago", async () => {
      const resolvedAt = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
      const incident = { id: "INC-AC-1", status: "Resolved", resolvedAt, title: "Test" };
      db.getByField.mockResolvedValue([row(incident)]);

      const engine = new WorkflowEngine(db);
      await engine._autoCloseResolved(rule);

      expect(db.upsert).toHaveBeenCalledWith(
        "incidents",
        "INC-AC-1",
        expect.stringContaining('"status":"Closed"'),
      );
      expect(engine.stats.autoClosedTickets).toBe(1);
    });

    it("does NOT auto-close incidents resolved less than 72h ago", async () => {
      const resolvedAt = new Date(Date.now() - 71 * 60 * 60 * 1000).toISOString();
      const incident = { id: "INC-AC-2", status: "Resolved", resolvedAt, title: "Test" };
      db.getByField.mockResolvedValue([row(incident)]);

      const engine = new WorkflowEngine(db);
      await engine._autoCloseResolved(rule);

      expect(db.upsert).not.toHaveBeenCalled();
      expect(engine.stats.autoClosedTickets).toBe(0);
    });

    it("skips deleted incidents", async () => {
      const resolvedAt = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
      const incident = { id: "INC-AC-3", status: "Resolved", resolvedAt, _deleted: true };
      db.getByField.mockResolvedValue([row(incident)]);

      const engine = new WorkflowEngine(db);
      await engine._autoCloseResolved(rule);

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("skips non-Resolved incidents", async () => {
      const incident = { id: "INC-AC-4", status: "Open", resolvedAt: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString() };
      db.getByField.mockResolvedValue([row(incident)]);

      const engine = new WorkflowEngine(db);
      await engine._autoCloseResolved(rule);

      expect(db.upsert).not.toHaveBeenCalled();
    });
  });

  // ─── _autoEscalateCritical ────────────────────────────────────────────
  describe("_autoEscalateCritical", () => {
    const rule = { id: "WF001", name: "Auto-escalate critical", status: "Active" };

    it("escalates Sev-A incident with no response after 15 min", async () => {
      const created = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
      const engine = new WorkflowEngine(db);
      engine._cycleIncidents = [
        { id: "INC-ESC-1", priority: "Sev-A", status: "Open", createdAt: created },
      ];

      await engine._autoEscalateCritical(rule);

      expect(db.upsert).toHaveBeenCalledWith(
        "incidents",
        "INC-ESC-1",
        expect.stringContaining('"_escalatedByWF":true'),
      );
      expect(engine.stats.autoEscalated).toBe(1);
    });

    it("does NOT escalate Sev-A with response within 15 min", async () => {
      const created = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const engine = new WorkflowEngine(db);
      engine._cycleIncidents = [
        { id: "INC-ESC-2", priority: "Sev-A", status: "Open", createdAt: created, firstResponseAt: new Date().toISOString() },
      ];

      await engine._autoEscalateCritical(rule);

      expect(db.upsert).not.toHaveBeenCalledWith("incidents", "INC-ESC-2", expect.anything());
    });

    it("does NOT escalate Sev-A within 15 min", async () => {
      const created = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
      const engine = new WorkflowEngine(db);
      engine._cycleIncidents = [
        { id: "INC-ESC-3", priority: "Sev-A", status: "Open", createdAt: created },
      ];

      await engine._autoEscalateCritical(rule);

      expect(engine.stats.autoEscalated).toBe(0);
    });

    it("does NOT escalate non-Sev-A incidents", async () => {
      const created = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const engine = new WorkflowEngine(db);
      engine._cycleIncidents = [
        { id: "INC-ESC-4", priority: "Sev-B", status: "Open", createdAt: created },
      ];

      await engine._autoEscalateCritical(rule);

      expect(engine.stats.autoEscalated).toBe(0);
    });

    it("skips already-escalated incidents", async () => {
      const created = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const engine = new WorkflowEngine(db);
      engine._cycleIncidents = [
        { id: "INC-ESC-5", priority: "Sev-A", status: "Open", createdAt: created, _escalatedByWF: true },
      ];

      await engine._autoEscalateCritical(rule);

      expect(engine.stats.autoEscalated).toBe(0);
    });

    it("skips closed/resolved incidents", async () => {
      const created = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const engine = new WorkflowEngine(db);
      engine._cycleIncidents = [
        { id: "INC-ESC-6", priority: "Sev-A", status: "Closed", createdAt: created },
      ];

      await engine._autoEscalateCritical(rule);

      expect(engine.stats.autoEscalated).toBe(0);
    });
  });

  // ─── _slaBreachAlert ──────────────────────────────────────────────────
  describe("_slaBreachAlert", () => {
    const rule = { id: "WF003", name: "SLA breach alert", status: "Active" };

    it("sends alert when SLA usage is between 75% and 100%", async () => {
      const slaRecord = { id: "INC-SLA-1", incidentId: "INC-SLA-1", resolutionPct: 80, status: "at_risk" };
      db.getAll.mockResolvedValue([row(slaRecord)]);

      const engine = new WorkflowEngine(db);
      await engine._slaBreachAlert(rule);

      expect(db.upsert).toHaveBeenCalledWith(
        "sla_tracking",
        "INC-SLA-1",
        expect.stringContaining("_wfAlertSent"),
      );
    });

    it("does NOT alert when SLA usage is below 75%", async () => {
      const slaRecord = { id: "INC-SLA-2", incidentId: "INC-SLA-2", resolutionPct: 50, status: "on_track" };
      db.getAll.mockResolvedValue([row(slaRecord)]);

      const engine = new WorkflowEngine(db);
      await engine._slaBreachAlert(rule);

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("does NOT alert when already breached (≥100%)", async () => {
      const slaRecord = { id: "INC-SLA-3", incidentId: "INC-SLA-3", resolutionPct: 120, status: "breached" };
      db.getAll.mockResolvedValue([row(slaRecord)]);

      const engine = new WorkflowEngine(db);
      await engine._slaBreachAlert(rule);

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("throttles alerts to 30min intervals", async () => {
      const recentAlert = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
      const slaRecord = { id: "INC-SLA-4", incidentId: "INC-SLA-4", resolutionPct: 85, status: "at_risk", _wfAlertSent: recentAlert };
      db.getAll.mockResolvedValue([row(slaRecord)]);

      const engine = new WorkflowEngine(db);
      await engine._slaBreachAlert(rule);

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("skips deleted SLA records", async () => {
      const slaRecord = { id: "INC-SLA-5", resolutionPct: 80, status: "at_risk", _deleted: true };
      db.getAll.mockResolvedValue([row(slaRecord)]);

      const engine = new WorkflowEngine(db);
      await engine._slaBreachAlert(rule);

      expect(db.upsert).not.toHaveBeenCalled();
    });
  });

  // ─── onEvent ──────────────────────────────────────────────────────────
  describe("onEvent", () => {
    it("fires action when rule matches event", async () => {
      const rule = {
        id: "WF002", name: "Auto-approve standard", status: "Active",
      };
      db.getAll.mockResolvedValue([row(rule)]); // workflow_rules

      const changeData = { id: "CHG-1", type: "Standard", riskLevel: "Low" };

      const engine = new WorkflowEngine(db);
      await engine.onEvent("upsert", "changes", changeData);

      expect(db.upsert).toHaveBeenCalledWith(
        "changes",
        "CHG-1",
        expect.stringContaining('"approvalStatus":"Approved"'),
      );
      expect(engine.stats.actionsExecuted).toBe(1);
    });

    it("does not fire for inactive rules", async () => {
      const rule = {
        id: "WF002", name: "Auto-approve standard", status: "Inactive",
      };
      db.getAll.mockResolvedValue([row(rule)]);

      const changeData = { id: "CHG-2", type: "Standard", riskLevel: "Low" };

      const engine = new WorkflowEngine(db);
      await engine.onEvent("upsert", "changes", changeData);

      expect(engine.stats.actionsExecuted).toBe(0);
    });

    it("does not fire when event does not match rule conditions", async () => {
      const rule = {
        id: "WF002", name: "Auto-approve standard", status: "Active",
      };
      db.getAll.mockResolvedValue([row(rule)]);

      // Normal change with high risk → should NOT auto-approve
      const changeData = { id: "CHG-3", type: "Normal", riskLevel: "High" };

      const engine = new WorkflowEngine(db);
      await engine.onEvent("upsert", "changes", changeData);

      expect(engine.stats.actionsExecuted).toBe(0);
    });

    it("skips deleted rules", async () => {
      const rule = {
        id: "WF002", name: "Auto-approve standard", status: "Active", _deleted: true,
      };
      db.getAll.mockResolvedValue([row(rule)]);

      const engine = new WorkflowEngine(db);
      await engine.onEvent("upsert", "changes", { id: "CHG-4", type: "Standard", riskLevel: "Low" });

      expect(engine.stats.actionsExecuted).toBe(0);
    });
  });

  // ─── _matchesEvent ────────────────────────────────────────────────────
  describe("_matchesEvent", () => {
    it("matches auto-approve for standard low-risk changes", () => {
      const engine = new WorkflowEngine(db);
      const rule = { id: "WF002" };
      expect(engine._matchesEvent(rule, "upsert", "changes", { type: "Standard", riskLevel: "Low" })).toBe(true);
    });

    it("does not match auto-approve for emergency changes", () => {
      const engine = new WorkflowEngine(db);
      const rule = { id: "WF002" };
      expect(engine._matchesEvent(rule, "upsert", "changes", { type: "Emergency", riskLevel: "High" })).toBe(false);
    });

    it("matches VIP fast-track for executive users", () => {
      const engine = new WorkflowEngine(db);
      const rule = { id: "WF005" };
      expect(engine._matchesEvent(rule, "upsert", "incidents", { reporterRole: "VIP User" })).toBe(true);
    });

    it("matches duplicate detection on new incidents", () => {
      const engine = new WorkflowEngine(db);
      const rule = { id: "WF007" };
      expect(engine._matchesEvent(rule, "upsert", "incidents", {})).toBe(true);
    });

    it("returns false for unrecognized rules", () => {
      const engine = new WorkflowEngine(db);
      const rule = { id: "WF999" };
      expect(engine._matchesEvent(rule, "upsert", "incidents", {})).toBe(false);
    });
  });

  // ─── getStats / getLog ────────────────────────────────────────────────
  describe("getStats", () => {
    it("returns stats with running=false when not started", () => {
      const engine = new WorkflowEngine(db);
      const stats = engine.getStats();
      expect(stats.running).toBe(false);
      expect(stats.rulesEvaluated).toBe(0);
      expect(stats.actionsExecuted).toBe(0);
    });
  });

  describe("getLog", () => {
    it("returns last N log entries", () => {
      const engine = new WorkflowEngine(db);
      engine._log("action", "TEST", "msg1");
      engine._log("action", "TEST", "msg2");
      engine._log("action", "TEST", "msg3");
      const log = engine.getLog(2);
      expect(log).toHaveLength(2);
      expect(log[0].message).toBe("msg2");
      expect(log[1].message).toBe("msg3");
    });
  });
});
