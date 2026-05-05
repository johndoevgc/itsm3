import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { WorkflowEngine } = require("../workflowEngine.js");

function makeDb(seed = {}) {
  const store = new Map();
  for (const [coll, items] of Object.entries(seed)) {
    const inner = new Map();
    for (const it of items) inner.set(it.id, JSON.stringify(it));
    store.set(coll, inner);
  }
  return {
    async getAll(coll) {
      const inner = store.get(coll); if (!inner) return [];
      return Array.from(inner.entries()).map(([id, data]) => ({ id, data }));
    },
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
  };
}

describe("v3.35.0 Phase A — email ingest routing helpers", () => {
  let engine;
  beforeEach(() => {
    engine = new WorkflowEngine(makeDb());
  });

  describe("pickSkillAssignee", () => {
    it("returns lowest-workload candidate for a known category", () => {
      engine.setSkillMap({ Network: ["alice", "bob", "carol"] });
      const workload = { alice: 5, bob: 1, carol: 3 };
      const pick = engine.pickSkillAssignee("Network", workload);
      expect(pick).toEqual({ name: "bob", load: 1 });
    });

    it("treats missing workload entries as zero", () => {
      engine.setSkillMap({ Network: ["alice", "bob"] });
      const pick = engine.pickSkillAssignee("Network", {});
      expect(pick.load).toBe(0);
      expect(["alice", "bob"]).toContain(pick.name);
    });

    it("returns null for unknown category", () => {
      engine.setSkillMap({ Network: ["alice"] });
      expect(engine.pickSkillAssignee("UnknownCat", {})).toBeNull();
    });

    it("returns null when skill map empty", () => {
      expect(engine.pickSkillAssignee("Network", {})).toBeNull();
    });

    it("honors excludeName option", () => {
      engine.setSkillMap({ Network: ["alice", "bob"] });
      const pick = engine.pickSkillAssignee("Network", { alice: 0, bob: 5 }, { excludeName: "alice" });
      expect(pick.name).toBe("bob");
    });

    it("returns null when only candidate is excluded", () => {
      engine.setSkillMap({ Network: ["alice"] });
      const pick = engine.pickSkillAssignee("Network", {}, { excludeName: "alice" });
      expect(pick).toBeNull();
    });
  });

  describe("pickRoundRobinAgent", () => {
    it("picks lowest-workload from roster", () => {
      const pick = engine.pickRoundRobinAgent(["alice", "bob", "carol"], { alice: 3, bob: 1, carol: 2 });
      expect(pick).toEqual({ name: "bob", load: 1 });
    });

    it("returns null on empty roster", () => {
      expect(engine.pickRoundRobinAgent([], {})).toBeNull();
    });

    it("excludes specified name", () => {
      const pick = engine.pickRoundRobinAgent(["alice", "bob"], { alice: 0, bob: 5 }, { excludeName: "alice" });
      expect(pick.name).toBe("bob");
    });
  });

  describe("getServiceDeskRoster", () => {
    it("returns members from active record", async () => {
      const db = makeDb({ service_desk_roster: [{ id: "active", members: ["alice", "bob", "carol"] }] });
      const eng = new WorkflowEngine(db);
      const roster = await eng.getServiceDeskRoster();
      expect(roster).toEqual(["alice", "bob", "carol"]);
    });

    it("returns empty array when no roster configured", async () => {
      const db = makeDb();
      const eng = new WorkflowEngine(db);
      const roster = await eng.getServiceDeskRoster();
      expect(roster).toEqual([]);
    });

    it("caches roster between calls (5-min TTL)", async () => {
      const db = makeDb({ service_desk_roster: [{ id: "active", members: ["alice"] }] });
      const eng = new WorkflowEngine(db);
      await eng.getServiceDeskRoster();
      // Mutate underlying store after first read
      db._store = undefined; // sanity: simulate db write that happened later
      // Override getOne to detect re-fetch
      let calls = 0;
      const orig = eng.db.getOne;
      eng.db.getOne = async (...args) => { calls++; return orig.call(eng.db, ...args); };
      await eng.getServiceDeskRoster();
      expect(calls).toBe(0); // served from cache
    });
  });
});
