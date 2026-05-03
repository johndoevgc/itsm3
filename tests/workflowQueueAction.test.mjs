import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createCoreRoutes = require("../routes/core.js");

// ─── In-memory db that mirrors the MSSQL/MySQL contract: `data` MUST be a
// string. Throws if a route ever passes a raw object — same failure mode that
// produced the production "Internal server error" on workflow approve.
function makeStrictDb() {
  const store = new Map();
  return {
    _store: store,
    async upsert(coll, id, data) {
      if (data != null && typeof data !== "string") {
        // Mirror MSSQL behaviour — fail loud if route forgets to stringify.
        throw new Error(`db.upsert(${coll}) expected string data, got ${typeof data}`);
      }
      store.set(`${coll}::${id}`, data);
    },
    async getOne(coll, id) {
      const data = store.get(`${coll}::${id}`);
      return data == null ? null : { id, data };
    },
    async getAll(coll) {
      const out = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${coll}::`)) out.push({ id: k.split("::")[1], data: v });
      }
      return out;
    },
    async deleteOne(coll, id) { store.delete(`${coll}::${id}`); },
    audit: vi.fn(async () => {}),
  };
}

function jsonHelper(res, status, body) {
  res.statusCode = status;
  res.body = body;
  return body;
}
async function parseBodyHelper(req) { return req._body || {}; }
function makeReq(method, body) { return { method, _body: body, headers: {} }; }
function makeRes() { return { statusCode: 0, body: null, headersSent: false, end: () => {}, writeHead: () => {} }; }

function buildHandler(db) {
  return createCoreRoutes({
    db, json: jsonHelper, parseBody: parseBodyHelper,
    sendText: () => {}, readBody: async () => "",
    callAI: async () => ({}), extractAIText: () => "",
    wsServer: { broadcast: vi.fn() },
    cacheLayer: { invalidatePrefix: vi.fn() },
    slaEngine: {}, normalizeCategory: (x) => x,
    AI_THRESHOLDS: {}, AI_MODELS: {}, getAIModel: () => "test",
  });
}

describe("POST /api/ai/workflow-queue/action", () => {
  it("approves a suggestion and stringifies the upsert payload", async () => {
    const db = makeStrictDb();
    await db.upsert("ai_workflow_queue", "WF-1", JSON.stringify({
      id: "WF-1", status: "pending", action: "tag", incidentId: "INC-1", internalNote: "note",
    }));
    const handle = buildHandler(db);
    const res = makeRes();
    await handle(
      makeReq("POST", { suggestionId: "WF-1", action: "approve", approvedBy: "agent@vgc.com" }),
      res, "/api/ai/workflow-queue/action",
      { authenticated: true, name: "agent@vgc.com" },
      { authenticated: true, user: { email: "agent@vgc.com" } },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const stored = JSON.parse(db._store.get("ai_workflow_queue::WF-1"));
    expect(stored.status).toBe("approved");
    expect(stored.approvedBy).toBe("agent@vgc.com");
    expect(db.audit).toHaveBeenCalled();
  });

  it("escalates an incident through the same code path without 500", async () => {
    const db = makeStrictDb();
    await db.upsert("incidents", "INC-2", JSON.stringify({
      id: "INC-2", priority: "Sev-C", status: "Open",
    }));
    await db.upsert("ai_workflow_queue", "WF-2", JSON.stringify({
      id: "WF-2", status: "pending", action: "escalate", incidentId: "INC-2",
    }));
    const handle = buildHandler(db);
    const res = makeRes();
    await handle(
      makeReq("POST", { suggestionId: "WF-2", action: "approve", approvedBy: "agent@vgc.com" }),
      res, "/api/ai/workflow-queue/action",
      { authenticated: true, name: "agent@vgc.com" },
      { authenticated: true, user: { email: "agent@vgc.com" } },
    );
    expect(res.statusCode).toBe(200);
    const inc = JSON.parse(db._store.get("incidents::INC-2"));
    expect(inc.priority).toBe("Sev-B");
    expect(inc.escalated).toBe(true);
  });

  it("rejects a suggestion cleanly", async () => {
    const db = makeStrictDb();
    await db.upsert("ai_workflow_queue", "WF-3", JSON.stringify({ id: "WF-3", status: "pending", action: "tag" }));
    const handle = buildHandler(db);
    const res = makeRes();
    await handle(
      makeReq("POST", { suggestionId: "WF-3", action: "reject", approvedBy: "agent@vgc.com" }),
      res, "/api/ai/workflow-queue/action",
      { authenticated: true, name: "agent@vgc.com" },
      { authenticated: true, user: { email: "agent@vgc.com" } },
    );
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(db._store.get("ai_workflow_queue::WF-3"));
    expect(stored.status).toBe("rejected");
  });

  it("returns 404 for unknown suggestion", async () => {
    const db = makeStrictDb();
    const handle = buildHandler(db);
    const res = makeRes();
    await handle(
      makeReq("POST", { suggestionId: "missing", action: "approve" }),
      res, "/api/ai/workflow-queue/action",
      { authenticated: true, name: "x" },
      { authenticated: true, user: { email: "x" } },
    );
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when suggestionId or action missing", async () => {
    const db = makeStrictDb();
    const handle = buildHandler(db);
    const res = makeRes();
    await handle(
      makeReq("POST", { action: "approve" }),
      res, "/api/ai/workflow-queue/action",
      { authenticated: true, name: "x" },
      { authenticated: true, user: { email: "x" } },
    );
    expect(res.statusCode).toBe(400);
  });
});
