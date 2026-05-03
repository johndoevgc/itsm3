import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const createAIRoutes = require("../routes/ai.js");

// ─── Mock infrastructure ─────────────────────────────────────────────────
function makeDb(seed = {}) {
  const store = new Map(); // collection -> Map(id -> data string)
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
    async audit() { /* noop */ },
    _store: store,
  };
}

function makeReqRes(method, pathname, query = {}) {
  const url = new URL(`http://test${pathname}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const req = { method, url: url.pathname + url.search, headers: {} };
  let _status = null, _body = null;
  const res = {
    setHeader() { /* noop */ },
    writeHead(s, _h) { _status = s; },
    end(b) { try { _body = JSON.parse(b); } catch { _body = b; } },
  };
  const json = (r, status, body) => { _status = status; _body = body; };
  return { req, res, json, urlObj: url, get status() { return _status; }, get body() { return _body; } };
}

function makeCtx(db) {
  return {
    db,
    json: (res, status, body) => { res._status = status; res._body = body; },
    parseBody: async (req) => req._body || {},
    readBody: async (req) => req._body || {},
    sendText: () => {},
    callAI: async () => ({}),
    extractAIText: () => "",
    wsServer: null,
    slaEngine: null,
    normalizeCategory: (x) => x,
    graphSendMail: async () => ({ ok: true }),
    AI_THRESHOLDS: { slaRisk: 50, monitorIntervalMin: 15 },
    AI_MODELS: {},
    getAIModel: () => "test-model",
    shouldSkipAction: () => false,
    trackNewAction: () => {},
    getAiActionsDedupState: async () => ({}),
    getSlaMap: () => ({}),
    getSlaDescription: () => "",
    getBusinessHoursElapsed: () => 0,
    getManagedIdentityToken: async () => "tok",
    getOrgName: () => "VGC",
    PORT: 0,
    PROD_TEST_MODE: false,
    workflowEngine: null,
  };
}

async function invoke(handler, ctx, method, pathname, query = {}, body = null) {
  const url = new URL(`http://test${pathname}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const req = { method, url: url.pathname + url.search, headers: {}, _body: body };
  const res = { _status: null, _body: null, setHeader() {}, writeHead(s) { this._status = s; }, end(b) { try { this._body = JSON.parse(b); } catch { this._body = b; } } };
  // ctx.json mutates res directly
  const ctxLocal = { ...ctx, json: (r, status, b) => { res._status = status; res._body = b; } };
  const handlerWithCtx = createAIRoutes(ctxLocal);
  await handlerWithCtx(req, res, url.pathname, null, null, url);
  return { status: res._status, body: res._body };
}

// ─── Tests ───────────────────────────────────────────────────────────────
describe("/api/sla/forensics", () => {
  it("returns empty buckets when no breaches in window", async () => {
    const db = makeDb({});
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/forensics", { days: "30" });
    expect(r.status).toBe(200);
    expect(r.body.totalBreaches).toBe(0);
    expect(r.body.windowDays).toBe(30);
    expect(r.body.buckets).toBeDefined();
  });

  it("classifies a no_assignee breach", async () => {
    const recentIso = new Date(Date.now() - 86400000).toISOString();
    const db = makeDb({
      sla_breach_notifications: [{ id: "INC-1", notifiedAt: recentIso, hoursElapsed: 12, worstResponseTarget: 9 }],
      incidents: [{ id: "INC-1", priority: "Sev-B", status: "Open", assignee: "Unassigned", createdAt: recentIso, activityLog: [] }],
    });
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/forensics", { days: "30" });
    expect(r.status).toBe(200);
    expect(r.body.totalBreaches).toBe(1);
    expect(r.body.buckets.no_assignee).toBe(1);
    expect(r.body.samples[0].causes).toContain("no_assignee");
  });

  it("excludes breaches outside the window", async () => {
    const oldIso = new Date(Date.now() - 200 * 86400000).toISOString();
    const db = makeDb({
      sla_breach_notifications: [{ id: "INC-OLD", notifiedAt: oldIso, hoursElapsed: 99 }],
      incidents: [{ id: "INC-OLD", priority: "Sev-C", status: "Open", assignee: "x", createdAt: oldIso }],
    });
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/forensics", { days: "30" });
    expect(r.body.totalBreaches).toBe(0);
  });
});

describe("/api/sla/extend-candidates", () => {
  it("returns empty when no incidents are blocked", async () => {
    const db = makeDb({ incidents: [{ id: "INC-1", status: "Open", createdAt: new Date().toISOString() }] });
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/extend-candidates");
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(0);
  });

  it("flags a Pending incident older than 4h", async () => {
    const oldIso = new Date(Date.now() - 6 * 3600000).toISOString();
    const db = makeDb({
      incidents: [
        { id: "INC-OLD", title: "Stuck", status: "Pending", priority: "Sev-C", createdAt: oldIso },
        { id: "INC-NEW", title: "Fresh", status: "Pending", priority: "Sev-C", createdAt: new Date().toISOString() }, // <4h, ignored
        { id: "INC-DONE", title: "Done", status: "Resolved", createdAt: oldIso }, // resolved, ignored
      ],
    });
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/extend-candidates");
    expect(r.body.count).toBe(1);
    expect(r.body.candidates[0].id).toBe("INC-OLD");
    expect(r.body.candidates[0].hoursElapsed).toBeGreaterThanOrEqual(4);
  });
});

describe("/api/sla/reassign-suggestions", () => {
  it("returns empty + note when no skill map configured", async () => {
    const db = makeDb({ incidents: [{ id: "INC-1", priority: "Sev-A", status: "Open", assignee: "Unassigned", createdAt: new Date().toISOString(), category: "Network" }] });
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/reassign-suggestions");
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(0);
    expect(r.body.note).toMatch(/no skill map/i);
  });

  it("suggests lowest-workload skilled engineer for unassigned Sev-A", async () => {
    const db = makeDb({
      incidents: [
        { id: "INC-1", priority: "Sev-A", status: "Open", assignee: "Unassigned", createdAt: new Date().toISOString(), category: "Network" },
        { id: "INC-2", priority: "Sev-C", status: "Open", assignee: "alice", createdAt: new Date().toISOString(), category: "Network" },
        { id: "INC-3", priority: "Sev-C", status: "Open", assignee: "alice", createdAt: new Date().toISOString(), category: "Network" },
      ],
      workflow_config: [{ id: "skill_map", Network: ["alice", "bob"] }],
    });
    // The route reads skill_map row and parses .data — but our seed stored full obj. Adjust:
    db._store.set("workflow_config", new Map([["skill_map", JSON.stringify({ Network: ["alice", "bob"] })]]));
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/reassign-suggestions");
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(1);
    expect(r.body.suggestions[0].suggestedAssignee).toBe("bob"); // bob has 0 load, alice has 2
    expect(r.body.suggestions[0].incidentId).toBe("INC-1");
  });
});

describe("/api/sla/forecast-accuracy", () => {
  it("returns null precision/recall when no predictions", async () => {
    const db = makeDb({});
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/forecast-accuracy", { days: "7" });
    expect(r.status).toBe(200);
    expect(r.body.totalPredictions).toBe(0);
    expect(r.body.precisionPct).toBeNull();
    expect(r.body.recallPct).toBeNull();
  });

  it("computes precision=100 / recall=100 when prediction matches breach", async () => {
    const recentIso = new Date(Date.now() - 3600000).toISOString();
    const db = makeDb({
      sla_predictions: [{ id: "P1", incidentId: "INC-1", predictedAt: recentIso, predictedBreach: true, confidence: 90 }],
      sla_breach_notifications: [{ id: "INC-1", notifiedAt: recentIso }],
    });
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/forecast-accuracy", { days: "14" });
    expect(r.body.truePositives).toBe(1);
    expect(r.body.falsePositives).toBe(0);
    expect(r.body.falseNegatives).toBe(0);
    expect(r.body.precisionPct).toBe(100);
    expect(r.body.recallPct).toBe(100);
  });

  it("counts false negative when breach was not predicted", async () => {
    const recentIso = new Date(Date.now() - 3600000).toISOString();
    const db = makeDb({
      sla_predictions: [],
      sla_breach_notifications: [{ id: "INC-MISSED", notifiedAt: recentIso }],
    });
    const r = await invoke(null, makeCtx(db), "GET", "/api/sla/forecast-accuracy", { days: "14" });
    expect(r.body.falseNegatives).toBe(1);
    expect(r.body.recallPct).toBe(0);
  });
});

describe("/api/sla/track-prediction", () => {
  it("rejects missing incidentId", async () => {
    const db = makeDb({});
    const r = await invoke(null, makeCtx(db), "POST", "/api/sla/track-prediction", {}, {});
    expect(r.status).toBe(400);
  });

  it("writes a prediction row", async () => {
    const db = makeDb({});
    const r = await invoke(null, makeCtx(db), "POST", "/api/sla/track-prediction", {}, {
      incidentId: "INC-42", predictedBreach: true, predictedHorizonHours: 2, confidence: 75, model: "gpt-test",
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const rows = await db.getAll("sla_predictions");
    expect(rows.length).toBe(1);
    const rec = JSON.parse(rows[0].data);
    expect(rec.incidentId).toBe("INC-42");
    expect(rec.predictedBreach).toBe(true);
  });
});
