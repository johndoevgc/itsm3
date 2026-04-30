import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 10.1 — Scheduled Task Runner
  // ═══════════════════════════════════════════════════════════════════════
  describe("registerScheduledTask / runScheduledTasks", () => {
    it("registers and executes a scheduled task when due", async () => {
      const engine = new WorkflowEngine(db);
      const handler = vi.fn().mockResolvedValue();
      engine.registerScheduledTask("T1", { name: "Cleanup", intervalMs: 60000, handler });

      // Advance time past the interval
      vi.advanceTimersByTime(61000);
      await engine.runScheduledTasks();

      expect(handler).toHaveBeenCalledWith(engine);
      const stats = engine.getScheduledTaskStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].runCount).toBe(1);
      expect(stats[0].errors).toBe(0);
      expect(stats[0].lastRun).toBeTruthy();
    });

    it("does NOT execute a task before its interval elapses", async () => {
      const engine = new WorkflowEngine(db);
      const handler = vi.fn().mockResolvedValue();
      engine.registerScheduledTask("T2", { name: "Report", intervalMs: 300000, handler });

      // Don't advance time — task is not yet due
      await engine.runScheduledTasks();

      expect(handler).not.toHaveBeenCalled();
      expect(engine.getScheduledTaskStats()[0].runCount).toBe(0);
    });

    it("does NOT execute disabled tasks", async () => {
      const engine = new WorkflowEngine(db);
      const handler = vi.fn().mockResolvedValue();
      engine.registerScheduledTask("T3", { name: "Disabled", intervalMs: 1000, handler, enabled: false });

      vi.advanceTimersByTime(2000);
      await engine.runScheduledTasks();

      expect(handler).not.toHaveBeenCalled();
    });

    it("tracks errors and advances nextRun on failure", async () => {
      const engine = new WorkflowEngine(db);
      const handler = vi.fn().mockRejectedValue(new Error("boom"));
      engine.registerScheduledTask("T4", { name: "Failing", intervalMs: 60000, handler });

      vi.advanceTimersByTime(61000);
      await engine.runScheduledTasks();

      const stats = engine.getScheduledTaskStats();
      expect(stats[0].errors).toBe(1);
      expect(stats[0].runCount).toBe(0);
    });

    it("returns empty stats when no tasks registered", () => {
      const engine = new WorkflowEngine(db);
      expect(engine.getScheduledTaskStats()).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 10.2 — Multi-tier Escalation Chain
  // ═══════════════════════════════════════════════════════════════════════
  describe("setEscalationChain / _runEscalationChain", () => {
    const chain = [
      { level: 1, thresholdMin: 15, notifyRoles: ["engineer"], channels: ["inapp"] },
      { level: 2, thresholdMin: 30, notifyRoles: ["team_lead"], channels: ["inapp", "email"] },
      { level: 3, thresholdMin: 60, notifyRoles: ["manager"], channels: ["inapp", "email"] },
    ];

    it("escalates Sev-A incident to L1 after threshold", async () => {
      const engine = new WorkflowEngine(db);
      engine.setEscalationChain(chain);
      engine._cycleIncidents = [
        { id: "INC-EC-1", priority: "Sev-A", status: "Open", createdAt: new Date(Date.now() - 20 * 60000).toISOString() },
      ];

      await engine._runEscalationChain();

      expect(db.upsert).toHaveBeenCalledWith("incidents", "INC-EC-1", expect.stringContaining('"escalationLevel":1'));
      expect(db.upsert).toHaveBeenCalledWith("escalation_log", expect.stringContaining("ESC-CHAIN-"), expect.any(String));
      expect(engine.stats.autoEscalated).toBe(1);
    });

    it("escalates Sev-A to L2 after 30 min", async () => {
      const engine = new WorkflowEngine(db);
      engine.setEscalationChain(chain);
      engine._cycleIncidents = [
        { id: "INC-EC-2", priority: "Sev-A", status: "Open", createdAt: new Date(Date.now() - 35 * 60000).toISOString(), _escalationLevel: 1 },
      ];

      await engine._runEscalationChain();

      expect(db.upsert).toHaveBeenCalledWith("incidents", "INC-EC-2", expect.stringContaining('"escalationLevel":2'));
    });

    it("doubles threshold for Sev-B incidents", async () => {
      const engine = new WorkflowEngine(db);
      engine.setEscalationChain(chain);
      // 20 min elapsed — L1 threshold is 15*2=30 min for Sev-B, so should NOT escalate
      engine._cycleIncidents = [
        { id: "INC-EC-3", priority: "Sev-B", status: "Open", createdAt: new Date(Date.now() - 20 * 60000).toISOString() },
      ];

      await engine._runEscalationChain();

      expect(db.upsert).not.toHaveBeenCalledWith("incidents", "INC-EC-3", expect.anything());
    });

    it("does NOT escalate Sev-B before doubled threshold", async () => {
      const engine = new WorkflowEngine(db);
      engine.setEscalationChain(chain);
      // 35 min elapsed — L1 threshold for Sev-B is 30 min → should trigger L1
      engine._cycleIncidents = [
        { id: "INC-EC-4", priority: "Sev-B", status: "Open", createdAt: new Date(Date.now() - 35 * 60000).toISOString() },
      ];

      await engine._runEscalationChain();

      expect(db.upsert).toHaveBeenCalledWith("incidents", "INC-EC-4", expect.stringContaining('"escalationLevel":1'));
    });

    it("skips closed/resolved incidents", async () => {
      const engine = new WorkflowEngine(db);
      engine.setEscalationChain(chain);
      engine._cycleIncidents = [
        { id: "INC-EC-5", priority: "Sev-A", status: "Closed", createdAt: new Date(Date.now() - 120 * 60000).toISOString() },
      ];

      await engine._runEscalationChain();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("skips non-Sev-A/B priorities", async () => {
      const engine = new WorkflowEngine(db);
      engine.setEscalationChain(chain);
      engine._cycleIncidents = [
        { id: "INC-EC-6", priority: "Sev-C", status: "Open", createdAt: new Date(Date.now() - 120 * 60000).toISOString() },
      ];

      await engine._runEscalationChain();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("does nothing when no chain is configured", async () => {
      const engine = new WorkflowEngine(db);
      engine._cycleIncidents = [
        { id: "INC-EC-7", priority: "Sev-A", status: "Open", createdAt: new Date(Date.now() - 120 * 60000).toISOString() },
      ];

      await engine._runEscalationChain();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("sends email when channel includes email and graphSendMail provided", async () => {
      const sendMail = vi.fn().mockResolvedValue();
      const engine = new WorkflowEngine(db, { graphSendMail: sendMail });
      engine.setEscalationChain([
        { level: 1, thresholdMin: 10, notifyRoles: ["engineer"], channels: ["inapp", "email"] },
      ]);
      engine._cycleIncidents = [
        { id: "INC-EC-8", priority: "Sev-A", status: "Open", createdAt: new Date(Date.now() - 15 * 60000).toISOString() },
      ];

      await engine._runEscalationChain();

      expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
        subject: expect.stringContaining("ESCALATION L1"),
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 10.3 — Skill-based Auto-Assignment
  // ═══════════════════════════════════════════════════════════════════════
  describe("setSkillMap / _autoAssignBySkill", () => {
    it("assigns unassigned incident to lowest-workload engineer", async () => {
      const engine = new WorkflowEngine(db);
      engine.setSkillMap({ "Network": ["Alice", "Bob"] });
      engine._cycleIncidents = [
        { id: "INC-SK-1", category: "Network", assignee: "Unassigned" },
        { id: "INC-SK-2", category: "Network", assignee: "Alice" }, // Alice has 1 ticket
      ];

      await engine._autoAssignBySkill();

      // Bob has 0 tickets, Alice has 1 → should pick Bob
      expect(db.upsert).toHaveBeenCalledWith("incidents", "INC-SK-1", expect.stringContaining('"assignee":"Bob"'));
    });

    it("skips already-assigned incidents", async () => {
      const engine = new WorkflowEngine(db);
      engine.setSkillMap({ "Network": ["Alice"] });
      engine._cycleIncidents = [
        { id: "INC-SK-3", category: "Network", assignee: "Charlie" },
      ];

      await engine._autoAssignBySkill();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("skips incidents with no matching skill map category", async () => {
      const engine = new WorkflowEngine(db);
      engine.setSkillMap({ "Network": ["Alice"] });
      engine._cycleIncidents = [
        { id: "INC-SK-4", category: "Printing", assignee: "Unassigned" },
      ];

      await engine._autoAssignBySkill();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("does nothing when skill map is empty", async () => {
      const engine = new WorkflowEngine(db);
      engine._cycleIncidents = [
        { id: "INC-SK-5", category: "Network", assignee: "Unassigned" },
      ];

      await engine._autoAssignBySkill();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("adds activityLog entry on assignment", async () => {
      const engine = new WorkflowEngine(db);
      engine.setSkillMap({ "Security": ["Diana"] });
      engine._cycleIncidents = [
        { id: "INC-SK-6", category: "Security", assignee: "Unassigned" },
      ];

      await engine._autoAssignBySkill();

      expect(db.upsert).toHaveBeenCalledWith("incidents", "INC-SK-6", expect.stringContaining('"auto_assign"'));
    });

    it("broadcasts via wsServer when available", async () => {
      const ws = { broadcast: vi.fn() };
      const engine = new WorkflowEngine(db, { wsServer: ws });
      engine.setSkillMap({ "Email": ["Eve"] });
      engine._cycleIncidents = [
        { id: "INC-SK-7", category: "Email", assignee: "Unassigned" },
      ];

      await engine._autoAssignBySkill();

      expect(ws.broadcast).toHaveBeenCalledWith("incidents", expect.objectContaining({
        action: "skill_assign", id: "INC-SK-7", assignee: "Eve",
      }));
    });

    it("skips incidents already attempted for skill assignment", async () => {
      const engine = new WorkflowEngine(db);
      engine.setSkillMap({ "Network": ["Alice"] });
      engine._cycleIncidents = [
        { id: "INC-SK-8", category: "Network", assignee: "Unassigned", _skillAssignAttempted: true },
      ];

      await engine._autoAssignBySkill();

      expect(db.upsert).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 10.4 — Change Approval Pipeline
  // ═══════════════════════════════════════════════════════════════════════
  describe("_processChangeApprovals", () => {
    it("auto-approves standard low-risk changes", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-1", type: "standard", riskLevel: "low" })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-1", expect.stringContaining('"approvalStatus":"Approved"'));
      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-1", expect.stringContaining('"approvalStage":"auto"'));
    });

    it("auto-approves standard changes with no risk specified", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-2", type: "standard" })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-2", expect.stringContaining('"approvalStatus":"Approved"'));
    });

    it("requests manager approval for normal changes", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-3", type: "normal", riskLevel: "medium" })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-3", expect.stringContaining('"approvalStatus":"Pending Approval"'));
      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-3", expect.stringContaining('"approvalStage":"manager"'));
    });

    it("flags emergency changes for CAB review", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-4", type: "emergency", riskLevel: "high" })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-4", expect.stringContaining('"approvalStatus":"CAB Review"'));
      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-4", expect.stringContaining('"approvalStage":"cab"'));
    });

    it("skips already-approved changes", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-5", type: "standard", riskLevel: "low", approvalStatus: "Approved" })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("skips rejected changes", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-6", type: "standard", riskLevel: "low", approvalStatus: "Rejected" })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("skips closed changes", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-7", type: "standard", riskLevel: "low", status: "Closed" })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("skips deleted changes", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-8", type: "standard", riskLevel: "low", _deleted: true })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).not.toHaveBeenCalled();
    });

    it("records approvalHistory for auto-approved changes", async () => {
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-9", type: "standard", riskLevel: "low" })]);

      const engine = new WorkflowEngine(db);
      await engine._processChangeApprovals();

      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-9", expect.stringContaining('"approvalHistory"'));
      expect(db.upsert).toHaveBeenCalledWith("changes", "CHG-AP-9", expect.stringContaining('"stage":"auto"'));
    });

    it("broadcasts via wsServer on auto-approve", async () => {
      const ws = { broadcast: vi.fn() };
      db.getAll.mockResolvedValue([row({ id: "CHG-AP-10", type: "standard", riskLevel: "low" })]);

      const engine = new WorkflowEngine(db, { wsServer: ws });
      await engine._processChangeApprovals();

      expect(ws.broadcast).toHaveBeenCalledWith("changes", expect.objectContaining({
        action: "auto_approve", id: "CHG-AP-10",
      }));
    });

    it("handles DB errors gracefully", async () => {
      db.getAll.mockRejectedValue(new Error("DB down"));

      const engine = new WorkflowEngine(db);
      // Should not throw
      await expect(engine._processChangeApprovals()).resolves.not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 10 — getStats includes Phase 10 data
  // ═══════════════════════════════════════════════════════════════════════
  describe("getStats (Phase 10 extensions)", () => {
    it("includes escalation chain tier count", () => {
      const engine = new WorkflowEngine(db);
      engine.setEscalationChain([
        { level: 1, thresholdMin: 15, notifyRoles: ["engineer"], channels: ["inapp"] },
        { level: 2, thresholdMin: 30, notifyRoles: ["lead"], channels: ["email"] },
      ]);
      const stats = engine.getStats();
      expect(stats.escalationChainTiers).toBe(2);
    });

    it("includes skill map category count", () => {
      const engine = new WorkflowEngine(db);
      engine.setSkillMap({ Network: ["A"], Security: ["B"], Email: ["C"] });
      const stats = engine.getStats();
      expect(stats.skillMapCategories).toBe(3);
    });

    it("includes scheduled task stats", () => {
      const engine = new WorkflowEngine(db);
      engine.registerScheduledTask("T1", { name: "Test", intervalMs: 60000, handler: vi.fn() });
      const stats = engine.getStats();
      expect(stats.scheduledTasks).toHaveLength(1);
      expect(stats.scheduledTasks[0].name).toBe("Test");
    });
  });
});
