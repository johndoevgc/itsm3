import { Readable } from "stream";
import { createRequire } from "module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const createCoreRoutes = require("../routes/core.js");

// Regression for the v3.21.1 fix: routes/core.js used to call a bare
// `auditLog(...)` symbol that was never defined, causing 7 endpoints to
// throw ReferenceError on their success paths. The fix added an inline
// `auditLog(action, req, detail)` wrapper inside `handleCoreRoutes`.
//
// These tests pin that the wrapper exists and that each affected endpoint
// completes without ReferenceError, writing to db.audit().

function makeDb(seed = {}) {
  const store = new Map();
  for (const [k, v] of Object.entries(seed)) store.set(k, v);
  const audits = [];
  return {
    store,
    audits,
    async getOne(collection, id) {
      const data = store.get(`${collection}:${id}`);
      return data ? { data } : null;
    },
    async getAll(collection) {
      const out = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(collection + ":")) out.push({ data: v });
      }
      return out;
    },
    async upsert(collection, id, data) {
      store.set(`${collection}:${id}`, data);
    },
    async audit(collection, recordId, action, data, user) {
      audits.push({ collection, recordId, action, data, user });
    },
    async getNextId(counterName) {
      const key = `itsm_counters:${counterName}`;
      const cur = parseInt(store.get(key) || "0", 10);
      const next = cur + 1;
      store.set(key, String(next));
      return next;
    },
  };
}

function makeReq(method, body = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.headers = { "user-agent": "vitest", host: "localhost" };
  req.url = "/";
  req.userEmail = "tester@example.com";
  return req;
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    rawBody: "",
    writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers; },
    end(body) { this.rawBody = body; try { this.body = JSON.parse(body); } catch { this.body = body; } },
  };
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
  return data;
}

const authResult = {
  authenticated: true,
  user: { email: "tester@example.com", name: "Tester", id: "ENTRA-T" },
  role: "Administrator",
};

function buildHandler(db, ctxOverrides = {}) {
  return createCoreRoutes({
    db,
    json,
    readBody: req => new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", c => { raw += c; });
      req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (err) { reject(err); } });
      req.on("error", reject);
    }),
    parseBody: req => new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", c => { raw += c; });
      req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (err) { reject(err); } });
      req.on("error", reject);
    }),
    cacheLayer: { invalidatePrefix: () => {} },
    FEATURE_PDPA: true,
    FEATURE_PORTAL: true,
    FEATURE_BILLING: true,
    FEATURE_SETUP_WIZARD: true,
    ...ctxOverrides,
  });
}

async function call(handle, method, pathname, body) {
  const req = makeReq(method, body);
  req.url = pathname;
  const res = makeRes();
  await handle(req, res, pathname, {}, authResult, new URL(`http://localhost${pathname}`));
  return res;
}

describe("auditLog wrapper regression (v3.21.1)", () => {
  it("PUT /api/sg-holidays writes audit and returns 200 (no ReferenceError)", async () => {
    const db = makeDb();
    const handle = buildHandler(db);
    const res = await call(handle, "PUT", "/api/sg-holidays", {
      year: 2027,
      holidays: [{ date: "2027-01-01", name: "New Year" }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(db.audits.some(a => a.action === "sg_holidays_updated")).toBe(true);
  });

  it("PUT /api/pdpa/config writes audit and returns 200", async () => {
    const db = makeDb();
    const handle = buildHandler(db);
    const res = await call(handle, "PUT", "/api/pdpa/config", { retentionDays: 365, consentRequired: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(db.audits.some(a => a.action === "pdpa_config_updated")).toBe(true);
  });

  it("POST /api/pdpa/dsar creates a request, writes audit, and returns 201", async () => {
    const db = makeDb();
    const handle = buildHandler(db);
    const res = await call(handle, "POST", "/api/pdpa/dsar", {
      type: "access",
      subjectEmail: "subject@example.com",
      subjectName: "Subject Name",
      reason: "I want my data",
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toMatch(/^DSAR-/);
    expect(db.audits.some(a => a.action === "dsar_created")).toBe(true);
  });

  it("PUT /api/pdpa/dsar/<id> updates and writes audit", async () => {
    const db = makeDb();
    const handle = buildHandler(db);
    const created = await call(handle, "POST", "/api/pdpa/dsar", {
      type: "access", subjectEmail: "x@y.com",
    });
    expect(created.statusCode).toBe(201);
    const id = created.body.id;
    const upd = await call(handle, "PUT", `/api/pdpa/dsar/${id}`, { status: "completed" });
    expect(upd.statusCode).toBe(200);
    expect(upd.body.status).toBe("completed");
    expect(db.audits.some(a => a.action === "dsar_updated")).toBe(true);
  });

  it("POST /api/billing/entries writes audit and returns 201", async () => {
    const db = makeDb();
    const handle = buildHandler(db);
    const res = await call(handle, "POST", "/api/billing/entries", {
      ticketId: "INC-1234", ticketTitle: "Sample", hours: 1.5, rate: 100,
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toMatch(/^BIL-/);
    expect(db.audits.some(a => a.action === "billing_entry_created")).toBe(true);
  });

  it("POST /api/portal/submit creates ticket, writes audit, and returns 201", async () => {
    const db = makeDb();
    const handle = buildHandler(db);
    const res = await call(handle, "POST", "/api/portal/submit", {
      email: "user@example.com", subject: "Help", description: "Stuff is broken",
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toMatch(/^INC-/);
    expect(db.audits.some(a => a.action === "portal_ticket_created")).toBe(true);
  });
});
