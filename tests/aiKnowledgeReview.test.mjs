import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createAIRoutes = require("../routes/ai.js");

function makeMockDb() {
  const store = new Map();
  return {
    _store: store,
    async getOne(coll, id) {
      const row = store.get(`${coll}::${id}`);
      return row ? { id, data: row } : null;
    },
    async getAll(coll) {
      const out = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${coll}::`)) out.push({ id: k.split("::")[1], data: v });
      }
      return out;
    },
    async upsert(coll, id, data) { store.set(`${coll}::${id}`, data); },
    async deleteOne(coll, id) { store.delete(`${coll}::${id}`); },
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
    db, json: jsonHelper, parseBody: parseBodyHelper,
    readBody: parseBodyHelper, sendText: () => {},
    callAI: async () => ({}), extractAIText: () => "",
    wsServer: { broadcast: vi.fn() },
    AI_THRESHOLDS: {}, AI_MODELS: {}, getAIModel: () => null,
    shouldSkipAction: () => false, trackNewAction: () => {},
    getAiActionsDedupState: () => ({}), getSlaMap: () => ({}),
    getSlaDescription: () => "", getBusinessHoursElapsed: () => 0,
  });
  return { handle, db };
}

describe("AI Knowledge review queue", () => {
  it("GET /api/ai/knowledge/pending returns only reviewStatus=pending entries", async () => {
    const { handle, db } = setupHandler();
    await db.upsert("ai_knowledge", "k1", JSON.stringify({ id: "k1", title: "Approved", reviewStatus: "approved", createdAt: "2024-01-01" }));
    await db.upsert("ai_knowledge", "k2", JSON.stringify({ id: "k2", title: "Pending A",  reviewStatus: "pending",  createdAt: "2024-02-01" }));
    await db.upsert("ai_knowledge", "k3", JSON.stringify({ id: "k3", title: "Pending B",  reviewStatus: "pending",  createdAt: "2024-03-01" }));
    await db.upsert("ai_knowledge", "k4", JSON.stringify({ id: "k4", title: "Old (no flag)" }));
    const res = makeRes();
    await handle(makeReq("GET"), res, "/api/ai/knowledge/pending", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(2);
    // Newest first
    expect(res.body.entries[0].id).toBe("k3");
    expect(res.body.entries[1].id).toBe("k2");
  });

  it("POST /:id/review approve flips reviewStatus and applies edits", async () => {
    const { handle, db } = setupHandler();
    await db.upsert("ai_knowledge", "k1", JSON.stringify({ id: "k1", title: "Old", content: "old body", reviewStatus: "pending" }));
    const res = makeRes();
    await handle(makeReq("POST", {
      action: "approve", reviewer: "alice@vgc",
      edits: { title: "New title", content: "Cleaned up", category: "Network", tags: ["wifi"] },
      notes: "looks good",
    }), res, "/api/ai/knowledge/k1/review", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.action).toBe("approve");
    const row = JSON.parse(db._store.get("ai_knowledge::k1"));
    expect(row.reviewStatus).toBe("approved");
    expect(row.title).toBe("New title");
    expect(row.content).toBe("Cleaned up");
    expect(row.category).toBe("Network");
    expect(row.tags).toEqual(["wifi"]);
    expect(row.reviewedBy).toBe("alice@vgc");
    expect(row.reviewNotes).toBe("looks good");
    expect(db.audit).toHaveBeenCalledWith("ai_knowledge", "k1", "review-approve",
      expect.any(String), "alice@vgc");
  });

  it("POST /:id/review reject deletes the row", async () => {
    const { handle, db } = setupHandler();
    await db.upsert("ai_knowledge", "k1", JSON.stringify({ id: "k1", title: "Bad", reviewStatus: "pending" }));
    const res = makeRes();
    await handle(makeReq("POST", { action: "reject", reviewer: "bob@vgc", notes: "duplicate" }),
      res, "/api/ai/knowledge/k1/review", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.action).toBe("reject");
    expect(db._store.get("ai_knowledge::k1")).toBeUndefined();
    expect(db.audit).toHaveBeenCalledWith("ai_knowledge", "k1", "review-reject",
      expect.any(String), "bob@vgc");
  });

  it("rejects invalid action", async () => {
    const { handle, db } = setupHandler();
    await db.upsert("ai_knowledge", "k1", JSON.stringify({ id: "k1", reviewStatus: "pending" }));
    const res = makeRes();
    await handle(makeReq("POST", { action: "shred" }), res, "/api/ai/knowledge/k1/review", null, { authenticated: true });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for missing entry", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { action: "approve" }), res, "/api/ai/knowledge/nope/review", null, { authenticated: true });
    expect(res.statusCode).toBe(404);
  });
});
