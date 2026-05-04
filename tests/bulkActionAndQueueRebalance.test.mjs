import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createAIRoutes = require("../routes/ai.js");

function makeMockDb() {
  const store = new Map();
  return {
    _store: store,
    async getOne(coll, id) { const row = store.get(`${coll}::${id}`); return row ? { id, data: row } : null; },
    async getAll(coll) {
      const out = [];
      for (const [k, v] of store.entries()) if (k.startsWith(`${coll}::`)) out.push({ id: k.split("::")[1], data: v });
      return out;
    },
    async upsert(coll, id, data) { store.set(`${coll}::${id}`, data); },
    audit: vi.fn(async () => {}),
  };
}
function jsonHelper(res, status, body) { res.statusCode = status; res.body = body; return body; }
async function parseBodyHelper(req) { return req._body || {}; }
function makeReq(method, body) { return { method, _body: body, headers: {} }; }
function makeRes() { return { statusCode: 0, body: null }; }

function setupHandler() {
  const db = makeMockDb();
  const handle = createAIRoutes({
    db, json: jsonHelper, parseBody: parseBodyHelper, readBody: parseBodyHelper, sendText: () => {},
    callAI: vi.fn(async () => ({ text: "{}", model: "gpt-5.4-mini" })), extractAIText: () => "",
    wsServer: { broadcast: vi.fn() },
    AI_THRESHOLDS: {}, AI_MODELS: {}, getAIModel: () => null,
    shouldSkipAction: () => false, trackNewAction: () => {},
    getAiActionsDedupState: () => ({}), getSlaMap: () => ({}),
    getSlaDescription: () => "", getBusinessHoursElapsed: () => 0,
  });
  return { handle, db };
}

const adminAuth = { authenticated: true, role: "admin", name: "TestAdmin" };
const userAuth = { authenticated: true, role: "user", name: "Bob" };

async function seedIncidents(db, list) {
  for (const inc of list) await db.upsert("incidents", inc.id, JSON.stringify(inc));
}

describe("v3.32.2 POST /api/admin/bulk-action-preview", () => {
  it("403 for non-admin", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { filter: {}, action: { type: "close" } }), res, "/api/admin/bulk-action-preview", userAuth, null);
    expect(res.statusCode).toBe(403);
  });

  it("400 for unknown action type", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { filter: {}, action: { type: "explode" } }), res, "/api/admin/bulk-action-preview", adminAuth, null);
    expect(res.statusCode).toBe(400);
  });

  it("returns matchCount + sample for filter on status+ageDays", async () => {
    const { handle, db } = setupHandler();
    const old = new Date(Date.now() - 12 * 86400000).toISOString();
    const fresh = new Date().toISOString();
    await seedIncidents(db, [
      { id: "INC-1", title: "Old open", status: "Open", priority: "P3", createdAt: old, assignee: "Alice" },
      { id: "INC-2", title: "Fresh open", status: "Open", priority: "P3", createdAt: fresh, assignee: "Alice" },
      { id: "INC-3", title: "Old closed", status: "Closed", priority: "P3", createdAt: old, assignee: "Alice" },
    ]);
    const res = makeRes();
    await handle(makeReq("POST", { filter: { status: "Open", ageDaysGte: 7 }, action: { type: "close", comment: "stale" } }), res, "/api/admin/bulk-action-preview", adminAuth, null);
    expect(res.statusCode).toBe(200);
    expect(res.body.matchCount).toBe(1);
    expect(res.body.sample[0].id).toBe("INC-1");
    expect(res.body.action.type).toBe("close");
  });
});

describe("v3.32.2 POST /api/admin/bulk-action-apply", () => {
  it("403 for non-admin", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { ids: ["INC-1"], action: { type: "close" } }), res, "/api/admin/bulk-action-apply", userAuth, null);
    expect(res.statusCode).toBe(403);
  });

  it("400 for empty ids", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { ids: [], action: { type: "close" } }), res, "/api/admin/bulk-action-apply", adminAuth, null);
    expect(res.statusCode).toBe(400);
  });

  it("applies close action and updates status", async () => {
    const { handle, db } = setupHandler();
    await seedIncidents(db, [
      { id: "B-1", title: "X", status: "Open", priority: "P3" },
      { id: "B-2", title: "Y", status: "Open", priority: "P3" },
    ]);
    const res = makeRes();
    await handle(makeReq("POST", { ids: ["B-1", "B-2"], action: { type: "close", comment: "auto" } }), res, "/api/admin/bulk-action-apply", adminAuth, null);
    expect(res.statusCode).toBe(200);
    expect(res.body.applied).toBe(2);
    expect(res.body.failed).toBe(0);
    const b1 = JSON.parse((await db.getOne("incidents", "B-1")).data);
    expect(b1.status).toBe("Closed");
    expect(b1.resolutionNotes).toMatch(/bulk-close/);
  });

  it("applies reassign and skips when value missing", async () => {
    const { handle, db } = setupHandler();
    await seedIncidents(db, [{ id: "R-1", title: "T", status: "Open", priority: "P3", assignee: "Alice" }]);
    const res = makeRes();
    await handle(makeReq("POST", { ids: ["R-1"], action: { type: "reassign" } }), res, "/api/admin/bulk-action-apply", adminAuth, null);
    expect(res.body.applied).toBe(0);
    expect(res.body.failed).toBe(1);

    const res2 = makeRes();
    await handle(makeReq("POST", { ids: ["R-1"], action: { type: "reassign", value: "Bob" } }), res2, "/api/admin/bulk-action-apply", adminAuth, null);
    expect(res2.body.applied).toBe(1);
    const r1 = JSON.parse((await db.getOne("incidents", "R-1")).data);
    expect(r1.assignee).toBe("Bob");
  });

  it("reports failed for missing ids", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { ids: ["NOPE-1"], action: { type: "close" } }), res, "/api/admin/bulk-action-apply", adminAuth, null);
    expect(res.body.applied).toBe(0);
    expect(res.body.failed).toBe(1);
    expect(res.body.errors[0].id).toBe("NOPE-1");
  });
});

describe("v3.32.2 GET /api/admin/queue-rebalance-suggest", () => {
  it("403 for non-admin", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("GET", null), res, "/api/admin/queue-rebalance-suggest", userAuth, null);
    expect(res.statusCode).toBe(403);
  });

  it("returns engineers with load + suggestions when imbalance exists", async () => {
    const { handle, db } = setupHandler();
    const incs = [];
    // Alice: 8 P2 Network tickets (overloaded)
    for (let i = 0; i < 8; i++) incs.push({ id: `A-${i}`, title: `vpn ${i}`, status: "Open", priority: "P2", category: "Network", assignee: "Alice" });
    // Bob: 1 Network ticket (underloaded but skill match)
    incs.push({ id: "B-0", title: "router", status: "Open", priority: "P3", category: "Network", assignee: "Bob" });
    // Carol: 1 random
    incs.push({ id: "C-0", title: "x", status: "Open", priority: "P3", category: "Email", assignee: "Carol" });
    await seedIncidents(db, incs);
    const res = makeRes();
    await handle(makeReq("GET", null), res, "/api/admin/queue-rebalance-suggest", adminAuth, null);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.engineers)).toBe(true);
    expect(res.body.engineers.find(e => e.name === "Alice").openCount).toBe(8);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    const s = res.body.suggestions[0];
    expect(s.currentAssignee).toBe("Alice");
    expect(["Bob", "Carol"]).toContain(s.suggestedAssignee);
  });

  it("returns empty suggestions when load is balanced", async () => {
    const { handle, db } = setupHandler();
    await seedIncidents(db, [
      { id: "X-1", title: "t", status: "Open", priority: "P3", category: "Email", assignee: "Alice" },
      { id: "X-2", title: "t", status: "Open", priority: "P3", category: "Email", assignee: "Bob" },
    ]);
    const res = makeRes();
    await handle(makeReq("GET", null), res, "/api/admin/queue-rebalance-suggest", adminAuth, null);
    expect(res.statusCode).toBe(200);
    expect(res.body.suggestions.length).toBe(0);
  });

  it("does not include 'Unassigned' as an engineer", async () => {
    const { handle, db } = setupHandler();
    await seedIncidents(db, [{ id: "U-1", title: "t", status: "Open", priority: "P3", assignee: "Unassigned" }]);
    const res = makeRes();
    await handle(makeReq("GET", null), res, "/api/admin/queue-rebalance-suggest", adminAuth, null);
    expect(res.body.engineers.find(e => e.name === "Unassigned")).toBeUndefined();
  });
});
