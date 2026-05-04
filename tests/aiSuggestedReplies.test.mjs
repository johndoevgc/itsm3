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
    audit: vi.fn(async () => {}),
  };
}

function jsonHelper(res, status, body) { res.statusCode = status; res.body = body; return body; }
async function parseBodyHelper(req) { return req._body || {}; }
function makeReq(method, body) { return { method, _body: body, headers: {} }; }
function makeRes() { return { statusCode: 0, body: null }; }

function setupHandler(callAIImpl) {
  const db = makeMockDb();
  const callAI = callAIImpl || vi.fn(async () => ({ text: "{}", model: "gpt-5.4-mini" }));
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

describe("v3.32.1 POST /api/ai/suggested-replies", () => {
  it("400 when ticketId missing", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", {}), res, "/api/ai/suggested-replies", null, { authenticated: true });
    expect(res.statusCode).toBe(400);
  });

  it("404 when ticket not found", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "MISSING" }), res, "/api/ai/suggested-replies", null, { authenticated: true });
    expect(res.statusCode).toBe(404);
  });

  it("returns 3 replies with allowed tones on success", async () => {
    const aiImpl = vi.fn(async () => ({
      text: JSON.stringify({
        replies: [
          { tone: "diagnostic", text: "Could you confirm whether this happens after a fresh reboot?" },
          { tone: "kb-link", text: "Please try the steps in [KB0042]: 1. Restart the VPN service. 2. Reconnect." },
          { tone: "closing", text: "Glad this is sorted — could you confirm so we can close the ticket?" },
        ],
      }),
      model: "gpt-5.4-mini",
    }));
    const { handle, db } = setupHandler(aiImpl);
    await db.upsert("incidents", "INC-R-1", JSON.stringify({
      id: "INC-R-1", title: "VPN drops", description: "VPN drops after sleep",
      status: "Open", priority: "High",
    }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-R-1" }), res, "/api/ai/suggested-replies", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.ticketId).toBe("INC-R-1");
    expect(res.body.replies).toHaveLength(3);
    expect(res.body.replies.map(r => r.tone).sort()).toEqual(["closing", "diagnostic", "kb-link"]);
    expect(res.body.replies[1].text).toMatch(/KB0042/);
  });

  it("502 on unparseable AI output", async () => {
    const { handle, db } = setupHandler(async () => ({ text: "not json" }));
    await db.upsert("incidents", "INC-R-2", JSON.stringify({ id: "INC-R-2", title: "T", description: "d" }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-R-2" }), res, "/api/ai/suggested-replies", null, { authenticated: true });
    expect(res.statusCode).toBe(502);
  });

  it("clamps to 3 replies and replaces unknown tone with diagnostic", async () => {
    const { handle, db } = setupHandler(async () => ({
      text: JSON.stringify({
        replies: [
          { tone: "diagnostic", text: "Q1" },
          { tone: "weirdo", text: "X" },
          { tone: "closing", text: "C" },
          { tone: "kb-link", text: "K" },
        ],
      }),
    }));
    await db.upsert("incidents", "INC-R-3", JSON.stringify({ id: "INC-R-3", title: "T", description: "d" }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-R-3" }), res, "/api/ai/suggested-replies", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.replies).toHaveLength(3);
    expect(res.body.replies[1].tone).toBe("diagnostic");
  });
});

describe("v3.32.1 POST /api/ai/draft-resolution", () => {
  it("400 when ticketId missing", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", {}), res, "/api/ai/draft-resolution", null, { authenticated: true });
    expect(res.statusCode).toBe(400);
  });

  it("404 when ticket not found", async () => {
    const { handle } = setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "NOPE" }), res, "/api/ai/draft-resolution", null, { authenticated: true });
    expect(res.statusCode).toBe(404);
  });

  it("returns resolutionDraft, rootCause, preventiveTip on success", async () => {
    const { handle, db } = setupHandler(async () => ({
      text: JSON.stringify({
        resolutionDraft: "Restarted the VPN gateway after detecting a stuck IPSec session. Verified end-to-end connectivity. Customer reconnected successfully.",
        rootCause: "Stale IPSec session blocked re-auth after laptop sleep.",
        preventiveTip: "Disconnect VPN before putting laptop to sleep.",
      }),
      model: "gpt-5.4-mini",
    }));
    await db.upsert("incidents", "INC-DR-1", JSON.stringify({ id: "INC-DR-1", title: "VPN", description: "drops", category: "Network", priority: "High" }));
    await db.upsert("worklogs", "WL-1", JSON.stringify({ id: "WL-1", incidentId: "INC-DR-1", user: "Eng", description: "Restarted IPSec", loggedAt: "2026-05-04T10:00:00Z" }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-DR-1" }), res, "/api/ai/draft-resolution", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.resolutionDraft).toMatch(/IPSec/);
    expect(res.body.rootCause).toMatch(/Stale/);
    expect(res.body.preventiveTip).toMatch(/Disconnect/);
    expect(res.body.model).toBe("gpt-5.4-mini");
  });

  it("502 when AI returns unparseable garbage", async () => {
    const { handle, db } = setupHandler(async () => ({ text: "I cannot help with that" }));
    await db.upsert("incidents", "INC-DR-2", JSON.stringify({ id: "INC-DR-2", title: "T", description: "d" }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-DR-2" }), res, "/api/ai/draft-resolution", null, { authenticated: true });
    expect(res.statusCode).toBe(502);
  });

  it("works even when there are zero worklogs", async () => {
    const { handle, db } = setupHandler(async () => ({
      text: JSON.stringify({ resolutionDraft: "Activity sparse; closed at customer's request.", rootCause: "Unknown.", preventiveTip: "Open a fresh ticket if the issue recurs." }),
    }));
    await db.upsert("incidents", "INC-DR-3", JSON.stringify({ id: "INC-DR-3", title: "Quiet", description: "no logs" }));
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-DR-3" }), res, "/api/ai/draft-resolution", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.resolutionDraft).toMatch(/sparse/i);
  });
});
