import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WorkflowEngine = require("../workflowEngine.js").WorkflowEngine;
const featureFlags = require("../featureFlags.js");

// In-memory db helper
function makeDb() {
  const store = new Map();
  return {
    async getAll(coll) {
      const inner = store.get(coll); if (!inner) return [];
      return Array.from(inner.entries()).map(([id, data]) => ({ id, data }));
    },
    async getOpen(coll) { return this.getAll(coll); },
    async getOne(coll, id) {
      const inner = store.get(coll); if (!inner) return null;
      const data = inner.get(id);
      return data ? { id, data } : null;
    },
    async upsert(coll, id, data) {
      if (!store.has(coll)) store.set(coll, new Map());
      store.get(coll).set(id, data);
    },
    async audit() {},
    _store: store,
  };
}

function setFlag(enabled, payload = {}) {
  return featureFlags.set("auto_reassign_sev_ab", { enabled, scope: "all", payload });
}

describe("v3.35.0 Phase C — _autoApplyReassignSuggestions", () => {
  beforeEach(async () => {
    // Init with a fresh mock db (also disables timer via reloadSec=0)
    await featureFlags.init(makeDb(), { reloadSec: 0 });
    await setFlag(false, { shadowOnly: true, dailyCap: 50, minAgeMinutes: 15 });
  });

  it("does nothing when flag disabled", async () => {
    await setFlag(false);
    const db = makeDb();
    const engine = new WorkflowEngine(db);
    engine.setSkillMap({ Network: ["alice", "bob"] });
    engine._cycleIncidents = [
      { id: "INC-1", priority: "Sev-A", status: "Open", assignee: "Unassigned",
        createdAt: new Date(Date.now() - 60 * 60000).toISOString(), category: "Network" },
    ];
    const upsertSpy = vi.spyOn(db, "upsert");
    await engine._autoApplyReassignSuggestions();
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("shadow mode logs to history without mutating incident.assignee", async () => {
    await setFlag(true, { shadowOnly: true, dailyCap: 50, minAgeMinutes: 15 });
    const db = makeDb();
    const engine = new WorkflowEngine(db);
    engine.setSkillMap({ Network: ["alice"] });
    const inc = { id: "INC-S1", priority: "Sev-A", status: "Open", assignee: "Unassigned",
      createdAt: new Date(Date.now() - 60 * 60000).toISOString(), category: "Network" };
    engine._cycleIncidents = [inc];
    await engine._autoApplyReassignSuggestions();
    expect(inc.assignee).toBe("Unassigned");
    const hist = await db.getAll("auto_reassign_history");
    expect(hist.length).toBe(1);
    const h = JSON.parse(hist[0].data);
    expect(h.mode).toBe("shadow");
    expect(h.suggestedAssignee).toBe("alice");
    expect(h.incidentId).toBe("INC-S1");
  });

  it("real mode mutates incident assignee and writes history", async () => {
    await setFlag(true, { shadowOnly: false, dailyCap: 50, minAgeMinutes: 15 });
    const db = makeDb();
    const engine = new WorkflowEngine(db);
    engine.setSkillMap({ Network: ["alice"] });
    const inc = { id: "INC-R1", priority: "Sev-A", status: "Open", assignee: "Unassigned",
      createdAt: new Date(Date.now() - 60 * 60000).toISOString(), category: "Network" };
    engine._cycleIncidents = [inc];
    await engine._autoApplyReassignSuggestions();
    expect(inc.assignee).toBe("alice");
    expect(inc.assignedBy).toBe("AutoReassign-SevAB");
    const hist = await db.getAll("auto_reassign_history");
    expect(hist.length).toBe(1);
    expect(JSON.parse(hist[0].data).mode).toBe("real");
  });

  it("respects minAgeMinutes grace period", async () => {
    await setFlag(true, { shadowOnly: false, dailyCap: 50, minAgeMinutes: 15 });
    const db = makeDb();
    const engine = new WorkflowEngine(db);
    engine.setSkillMap({ Network: ["alice"] });
    const inc = { id: "INC-AGE", priority: "Sev-A", status: "Open", assignee: "Unassigned",
      createdAt: new Date(Date.now() - 5 * 60000).toISOString(), category: "Network" };
    engine._cycleIncidents = [inc];
    await engine._autoApplyReassignSuggestions();
    expect(inc.assignee).toBe("Unassigned");
  });

  it("enforces daily cap from history", async () => {
    await setFlag(true, { shadowOnly: false, dailyCap: 1, minAgeMinutes: 15 });
    const db = makeDb();
    // Re-init so featureFlags.set persists; but daily-cap query uses the engine's db, not flags db
    // Pre-seed today's history at cap
    const today = new Date().toISOString().slice(0, 10);
    await db.upsert("auto_reassign_history", "AR-PRE", JSON.stringify({ id: "AR-PRE", day: today, mode: "real" }));
    const engine = new WorkflowEngine(db);
    engine.setSkillMap({ Network: ["alice"] });
    const inc = { id: "INC-CAP", priority: "Sev-A", status: "Open", assignee: "Unassigned",
      createdAt: new Date(Date.now() - 60 * 60000).toISOString(), category: "Network" };
    engine._cycleIncidents = [inc];
    await engine._autoApplyReassignSuggestions();
    expect(inc.assignee).toBe("Unassigned");
  });

  it("skips already-assigned incidents", async () => {
    await setFlag(true, { shadowOnly: false, dailyCap: 50, minAgeMinutes: 15 });
    const db = makeDb();
    const engine = new WorkflowEngine(db);
    engine.setSkillMap({ Network: ["alice", "bob"] });
    const inc = { id: "INC-ASSIGNED", priority: "Sev-A", status: "Open", assignee: "carol",
      createdAt: new Date(Date.now() - 60 * 60000).toISOString(), category: "Network" };
    engine._cycleIncidents = [inc];
    await engine._autoApplyReassignSuggestions();
    expect(inc.assignee).toBe("carol");
  });

  it("skips Sev-C/Sev-D priorities", async () => {
    await setFlag(true, { shadowOnly: false, dailyCap: 50, minAgeMinutes: 15 });
    const db = makeDb();
    const engine = new WorkflowEngine(db);
    engine.setSkillMap({ Network: ["alice"] });
    const inc = { id: "INC-SEVC", priority: "Sev-C", status: "Open", assignee: "Unassigned",
      createdAt: new Date(Date.now() - 60 * 60000).toISOString(), category: "Network" };
    engine._cycleIncidents = [inc];
    await engine._autoApplyReassignSuggestions();
    expect(inc.assignee).toBe("Unassigned");
  });
});
