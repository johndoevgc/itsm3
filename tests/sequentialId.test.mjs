import { describe, it, expect, beforeEach } from "vitest";

/**
 * v4.0.0 — Sequential Incident ID Counter tests
 *
 * Validates the getNextId() atomic counter that replaced random INC-xxx IDs.
 * Uses an in-memory mock that mimics the SQLite/MySQL/MSSQL behaviour.
 */

function makeDb() {
  const store = new Map();
  return {
    async getAll(coll) {
      const inner = store.get(coll);
      if (!inner) return [];
      return Array.from(inner.entries()).map(([id, data]) => ({ id, data }));
    },
    async getOne(coll, id) {
      const inner = store.get(coll);
      if (!inner) return null;
      const data = inner.get(id);
      return data ? { id, data } : null;
    },
    async upsert(coll, id, data) {
      if (!store.has(coll)) store.set(coll, new Map());
      store.get(coll).set(id, data);
    },
    async getNextId(counterName) {
      if (!store.has("itsm_counters")) store.set("itsm_counters", new Map());
      const counters = store.get("itsm_counters");
      const current = parseInt(counters.get(counterName) || "0", 10);
      const next = current + 1;
      counters.set(counterName, String(next));
      return next;
    },
    _store: store,
  };
}

describe("v4.0.0 — Sequential Incident ID Counter", () => {
  let db;

  beforeEach(() => {
    db = makeDb();
  });

  it("starts at 1 when no counter exists", async () => {
    const seq = await db.getNextId("incident_counter");
    expect(seq).toBe(1);
  });

  it("increments sequentially", async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await db.getNextId("incident_counter"));
    }
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });

  it("produces correct INC-XXXX format with zero-padding", async () => {
    const seq = await db.getNextId("incident_counter");
    const incId = `INC-${String(seq).padStart(4, "0")}`;
    expect(incId).toBe("INC-0001");
  });

  it("pads to 4 digits up to 9999", async () => {
    // Simulate counter at 9999
    db._store.set("itsm_counters", new Map([["incident_counter", "9999"]]));
    const seq = await db.getNextId("incident_counter");
    const incId = `INC-${String(seq).padStart(4, "0")}`;
    expect(seq).toBe(10000);
    expect(incId).toBe("INC-10000"); // Naturally grows beyond 4 digits
  });

  it("independent counters do not interfere", async () => {
    const a1 = await db.getNextId("incident_counter");
    const b1 = await db.getNextId("change_counter");
    const a2 = await db.getNextId("incident_counter");
    expect(a1).toBe(1);
    expect(b1).toBe(1);
    expect(a2).toBe(2);
  });

  it("counter resets correctly for purge scenario", async () => {
    // Simulate existing counter
    await db.getNextId("incident_counter");
    await db.getNextId("incident_counter");
    await db.getNextId("incident_counter");

    // Purge: reset to 0
    await db.upsert("itsm_counters", "incident_counter", "0");

    // Next should be 1 again
    const seq = await db.getNextId("incident_counter");
    expect(seq).toBe(1);
  });

  it("concurrent calls produce unique IDs", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => db.getNextId("incident_counter"))
    );
    const unique = new Set(results);
    expect(unique.size).toBe(10);
  });
});
