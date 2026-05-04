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

function setupHandler(callAIImpl) {
  const db = makeMockDb();
  const callAI = callAIImpl || vi.fn(async () => ({
    text: JSON.stringify({
      summary: "VPN crashes after laptop sleep on Windows 11.",
      openQuestions: ["Which VPN client version?", "Reproducible after fresh reboot?"],
      suggestedNextStep: "Collect VPN client logs from %APPDATA% and reproduce after fresh reboot.",
    }),
    model: "gpt-5.4-mini",
  }));
  const handle = createAIRoutes({
    db, json: jsonHelper, parseBody: parseBodyHelper,
    readBody: parseBodyHelper, sendText: () => {},
    callAI, extractAIText: () => "",
    wsServer: { broadcast: vi.fn() },
    AI_THRESHOLDS: {}, AI_MODELS: {}, getAIModel: () => null,
    shouldSkipAction: () => false, trackNewAction: () => {},
    getAiActionsDedupState: () => ({}), getSlaMap: () => ({}),
    getSlaDescription: () => "", getBusinessHoursElapsed: () => 0,
  });
  return { handle, db, callAI };
}

describe("v3.32.0 POST /api/ai/ticket-summary", () => {
  it("400 when ticketId missing", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", {}), res, "/api/ai/ticket-summary", null, { authenticated: true });
    expect(res.statusCode).toBe(400);
  });

  it("404 when ticket not found", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "MISSING" }), res, "/api/ai/ticket-summary", null, { authenticated: true });
    expect(res.statusCode).toBe(404);
  });

  it("returns parsed summary, openQuestions, suggestedNextStep on success", async () => {
    const { handle, db } = setupHandler();
    await db.upsert("incidents", "INC-S-1", JSON.stringify({
      id: "INC-S-1", title: "VPN drops", description: "VPN keeps disconnecting after sleep.",
      status: "Open", priority: "High", category: "Network",
      createdAt: "2026-05-01T10:00:00Z", lastModified: "2026-05-01T10:00:00Z",
    }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-S-1" }), res, "/api/ai/ticket-summary", null, { authenticated: true, name: "Eng" });
    expect(res.statusCode).toBe(200);
    expect(res.body.ticketId).toBe("INC-S-1");
    expect(res.body.summary).toMatch(/VPN/);
    expect(res.body.openQuestions).toHaveLength(2);
    expect(res.body.suggestedNextStep).toMatch(/logs/i);
    expect(res.body.cached).toBe(false);
    expect(res.body.model).toBe("gpt-5.4-mini");
  });

  it("second identical call hits cache (callAI invoked once)", async () => {
    const { handle, db, callAI } = setupHandler();
    await db.upsert("incidents", "INC-S-2", JSON.stringify({
      id: "INC-S-2", title: "Printer", description: "won't print",
      status: "Open", priority: "Medium", lastModified: "2026-05-02T10:00:00Z",
    }));
    const res1 = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-S-2" }), res1, "/api/ai/ticket-summary", null, { authenticated: true });
    expect(res1.statusCode).toBe(200);
    expect(res1.body.cached).toBe(false);
    const res2 = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-S-2" }), res2, "/api/ai/ticket-summary", null, { authenticated: true });
    expect(res2.statusCode).toBe(200);
    expect(res2.body.cached).toBe(true);
    expect(callAI).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses cache", async () => {
    const { handle, db, callAI } = setupHandler();
    await db.upsert("incidents", "INC-S-3", JSON.stringify({
      id: "INC-S-3", title: "AD", description: "lockout",
      status: "Open", priority: "Low", lastModified: "2026-05-03T10:00:00Z",
    }));
    await handle(makeReq("POST", { ticketId: "INC-S-3" }), makeRes(), "/api/ai/ticket-summary", null, { authenticated: true });
    await handle(makeReq("POST", { ticketId: "INC-S-3", force: true }), makeRes(), "/api/ai/ticket-summary", null, { authenticated: true });
    expect(callAI).toHaveBeenCalledTimes(2);
  });

  it("worklog change invalidates cache (different fingerprint)", async () => {
    const { handle, db, callAI } = setupHandler();
    await db.upsert("incidents", "INC-S-4", JSON.stringify({
      id: "INC-S-4", title: "Email", description: "down",
      status: "Open", priority: "High", lastModified: "2026-05-04T10:00:00Z",
    }));
    await handle(makeReq("POST", { ticketId: "INC-S-4" }), makeRes(), "/api/ai/ticket-summary", null, { authenticated: true });
    // Add a worklog after first summary.
    await db.upsert("worklogs", "WL-1", JSON.stringify({
      id: "WL-1", incidentId: "INC-S-4", user: "Eng", hours: 0.5,
      category: "diagnostic", description: "Restarted MX cluster", loggedAt: "2026-05-04T11:00:00Z",
    }));
    const res2 = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-S-4" }), res2, "/api/ai/ticket-summary", null, { authenticated: true });
    expect(res2.body.cached).toBe(false);
    expect(callAI).toHaveBeenCalledTimes(2);
  });

  it("502 when AI returns non-JSON unparseable garbage", async () => {
    const { handle, db } = setupHandler(async () => ({ text: "I am not JSON at all sorry" }));
    await db.upsert("incidents", "INC-S-5", JSON.stringify({
      id: "INC-S-5", title: "X", description: "Y",
      status: "Open", priority: "Low", lastModified: "2026-05-05T10:00:00Z",
    }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-S-5" }), res, "/api/ai/ticket-summary", null, { authenticated: true });
    expect(res.statusCode).toBe(502);
  });

  it("salvages JSON object embedded in extra text", async () => {
    const { handle, db } = setupHandler(async () => ({
      text: "Here you go!\n```json\n{\"summary\":\"ok\",\"openQuestions\":[\"q?\"],\"suggestedNextStep\":\"do x\"}\n```\nHope that helps.",
      model: "gpt-5.4-mini",
    }));
    await db.upsert("incidents", "INC-S-6", JSON.stringify({
      id: "INC-S-6", title: "T", description: "D",
      status: "Open", priority: "Low", lastModified: "2026-05-06T10:00:00Z",
    }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-S-6" }), res, "/api/ai/ticket-summary", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.summary).toBe("ok");
    expect(res.body.suggestedNextStep).toBe("do x");
  });
});
