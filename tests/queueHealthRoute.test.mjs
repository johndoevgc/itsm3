import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const createCoreRoutes = require("../routes/core.js");

function makeDb(seed = {}) {
  const store = new Map();
  for (const [coll, items] of Object.entries(seed)) {
    const inner = new Map();
    for (const it of items) inner.set(it.id, JSON.stringify(it));
    store.set(coll, inner);
  }
  return {
    async ping() { return true; },
    type: "mysql",
    label: "test-db",
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
    async countAudit() { return 0; },
  };
}

function makeCtx(db) {
  return {
    db,
    AI_THRESHOLDS: {
      pendingAgeHoursWarn: 4,
      pendingAgeHoursCritical: 24,
      maxPendingPerIncident: 3,
      maxPendingTotal: 50,
    },
    APP_VERSION: { version: "3.35.0", build: "test" },
    AI_MODELS: {},
    MERAKI_API_KEYS: [],
    EMAIL_REDIRECT_TARGET: "",
    PROD_TEST_MODE: false,
    json: (_res, status, data) => ({ status, data }),
  };
}

async function invoke(db, authResult) {
  const url = new URL("http://test/api/ops/queue-health");
  let captured = null;
  const ctx = {
    ...makeCtx(db),
    json: (_res, status, data) => { captured = { status, data }; return true; },
  };
  const handler = createCoreRoutes(ctx);
  const req = { method: "GET", headers: {}, url: url.pathname };
  const res = { setHeader() {}, writeHead() {}, end() {} };
  await handler(req, res, url.pathname, null, authResult, url);
  return captured;
}

describe("/api/ops/queue-health (v3.35.0 Phase B)", () => {
  it("returns 401 when unauthenticated", async () => {
    const r = await invoke(makeDb(), { authenticated: false, role: "anonymous" });
    expect(r.status).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const r = await invoke(makeDb(), { authenticated: true, role: "User" });
    expect(r.status).toBe(403);
  });

  it("returns full shape for admin", async () => {
    const nowIso = new Date().toISOString();
    const oldIso = new Date(Date.now() - 90 * 60000).toISOString(); // 90 min ago
    const db = makeDb({
      incidents: [
        { id: "INC-U1", priority: "Sev-A", status: "Open", assignee: "Unassigned", createdAt: oldIso },
        { id: "INC-U2", priority: "Sev-B", status: "Open", assignee: "Unassigned", createdAt: nowIso },
        { id: "INC-A1", priority: "Sev-C", status: "Open", assignee: "alice", createdAt: nowIso },
        { id: "INC-A2", priority: "Sev-C", status: "Open", assignee: "alice", createdAt: nowIso },
        { id: "INC-A3", priority: "Sev-C", status: "Open", assignee: "bob", createdAt: nowIso },
        { id: "INC-EM", priority: "Sev-C", status: "Open", assignee: "alice", source: "email",
          createdAt: new Date(Date.now() - 6000).toISOString(), routedAt: nowIso },
      ],
      ai_actions: [
        { id: "A1", status: "pending_approval", createdAt: new Date(Date.now() - 30 * 60000).toISOString(), riskTier: "low" },
        { id: "A2", status: "pending_approval", createdAt: new Date(Date.now() - 5 * 3600000).toISOString(), riskTier: "med" },
        { id: "A3", status: "approved", createdAt: nowIso, riskTier: "low" }, // not pending — excluded
      ],
    });
    const r = await invoke(db, { authenticated: true, role: "Administrator" });
    expect(r.status).toBe(200);
    expect(r.data.unassignedByPriority["Sev-A"]).toBe(1);
    expect(r.data.unassignedByPriority["Sev-B"]).toBe(1);
    expect(r.data.unassignedAgeMaxMin["Sev-A"]).toBeGreaterThanOrEqual(89);
    expect(r.data.aiActionsBacklog.total).toBe(2);
    expect(r.data.aiActionsBacklog.byAgeBucket["1-4h"]).toBe(0);
    expect(r.data.aiActionsBacklog.byAgeBucket["4-24h"]).toBe(1);
    expect(r.data.aiActionsBacklog.byAgeBucket["<1h"]).toBe(1);
    expect(r.data.emailRoutingLatency.samples).toBe(1);
    expect(r.data.topAssigneesByLoad[0].name).toBe("alice");
    expect(r.data.topAssigneesByLoad[0].openTickets).toBe(3);
    expect(r.data.aiActionsBacklog.thresholds.criticalH).toBe(24);
  });

  it("returns 200 with empty buckets when DB has no data", async () => {
    const r = await invoke(makeDb(), { authenticated: true, role: "VGC Dev Admin" });
    expect(r.status).toBe(200);
    expect(r.data.unassignedByPriority["Sev-A"]).toBe(0);
    expect(r.data.aiActionsBacklog.total).toBe(0);
    expect(r.data.emailRoutingLatency.p50Ms).toBeNull();
    expect(r.data.topAssigneesByLoad).toEqual([]);
  });
});
