import { Readable } from "stream";
import { createRequire } from "module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const createCoreRoutes = require("../routes/core.js");

function makeDb() {
  const store = new Map();
  const audits = [];
  return {
    store,
    audits,
    async getOne(collection, id) {
      const data = store.get(`${collection}:${id}`);
      return data ? { data } : null;
    },
    async upsert(collection, id, data) {
      store.set(`${collection}:${id}`, data);
    },
    async audit(collection, recordId, action, data, user) {
      audits.push({ collection, recordId, action, data, user });
    },
  };
}

function makeReq(method, body = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.headers = { "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" };
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function makeRes(req) {
  return {
    req,
    statusCode: 0,
    headers: {},
    headersSent: false,
    body: null,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      this.rawBody = body;
      try { this.body = JSON.parse(body); } catch { this.body = body; }
    },
  };
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
  return data;
}

async function call(handle, pathname, body, authResult) {
  const req = makeReq("POST", body);
  const res = makeRes(req);
  await handle(req, res, pathname, {}, authResult, new URL(`http://localhost${pathname}`));
  return res;
}

const authResult = {
  authenticated: true,
  user: { email: "architect@example.com", name: "Solution Architect", id: "ENTRA-001" },
  role: "VGC Dev Admin",
};

describe("portal session routes", () => {
  it("replaces the active session and rejects stale heartbeats", async () => {
    const db = makeDb();
    const broadcasts = [];
    const handle = createCoreRoutes({
      db,
      json,
      readBody: req => new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", chunk => { raw += chunk; });
        req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (err) { reject(err); } });
        req.on("error", reject);
      }),
      cacheLayer: { invalidatePrefix: () => {} },
      wsServer: { broadcast: (...args) => broadcasts.push(args) },
    });

    const firstStart = await call(handle, "/api/auth/session/start", { sessionId: "session-A-123456" }, authResult);
    expect(firstStart.statusCode).toBe(200);
    expect(firstStart.body.active).toBe(true);
    expect(firstStart.body.previousSessionReplaced).toBe(false);

    const firstHeartbeat = await call(handle, "/api/auth/session/heartbeat", { sessionId: "session-A-123456" }, authResult);
    expect(firstHeartbeat.statusCode).toBe(200);
    expect(firstHeartbeat.body.active).toBe(true);

    const secondStart = await call(handle, "/api/auth/session/start", { sessionId: "session-B-123456" }, authResult);
    expect(secondStart.statusCode).toBe(200);
    expect(secondStart.body.previousSessionReplaced).toBe(true);

    const staleHeartbeat = await call(handle, "/api/auth/session/heartbeat", { sessionId: "session-A-123456" }, authResult);
    expect(staleHeartbeat.statusCode).toBe(409);
    expect(staleHeartbeat.body.code).toBe("STALE_SESSION");

    const oldSignOut = await call(handle, "/api/auth/session/end", { sessionId: "session-A-123456" }, authResult);
    expect(oldSignOut.statusCode).toBe(200);

    const liveHeartbeat = await call(handle, "/api/auth/session/heartbeat", { sessionId: "session-B-123456" }, authResult);
    expect(liveHeartbeat.statusCode).toBe(200);
    expect(liveHeartbeat.body.active).toBe(true);

    const liveSignOut = await call(handle, "/api/auth/session/end", { sessionId: "session-B-123456" }, authResult);
    expect(liveSignOut.statusCode).toBe(200);

    const afterSignOut = await call(handle, "/api/auth/session/heartbeat", { sessionId: "session-B-123456" }, authResult);
    expect(afterSignOut.statusCode).toBe(409);
    expect(broadcasts.length).toBeGreaterThan(0);
  });
});
